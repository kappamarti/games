// Cielo, nuvole, luci, nebbia e precipitazioni.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { sunTimes, dayOfYear } from '../data/calendar.js';
import { softDot } from './textures.js';
import { clamp, lerp, smoothstep } from '../core/rng.js';

const RAIN_N = 7000, SNOW_N = 5000;

const ACES_GLSL = `
vec3 acesFilm(vec3 x) {
  x *= 0.95;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`;

export class Atmosphere {
  constructor(parent, scene = parent) {
    this.scene = scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    parent.add(this.sky);
    // threepipe non applica il tone mapping ai pixel di sfondo: lo facciamo nello shader del cielo
    this.sky.material.fragmentShader = ACES_GLSL + this.sky.material.fragmentShader.replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = acesFilm(gl_FragColor.rgb * 0.55);');
    this.sky.material.needsUpdate = true;
    const su = this.sky.material.uniforms;
    su.turbidity.value = 6; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.005; su.mieDirectionalG.value = 0.8;

    // cupola di nuvole procedurali
    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide,
      uniforms: { uTime: { value: 0 }, uCover: { value: 0.3 }, uSunDir: { value: new THREE.Vector3() }, uLight: { value: new THREE.Color(1, 1, 1) }, uDark: { value: new THREE.Color(0.4, 0.42, 0.45) }, uFlash: { value: 0 }, uFogCol: { value: new THREE.Color() }, uFogAmt: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: ACES_GLSL + `
        uniform float uTime; uniform float uCover; uniform vec3 uSunDir; uniform vec3 uLight; uniform vec3 uDark; uniform float uFlash; uniform vec3 uFogCol; uniform float uFogAmt;
        varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          if (vDir.y < -0.05) discard;
          vec2 uv = vDir.xz / (vDir.y + 0.18) * 1.6 + vec2(uTime * 0.012, uTime * 0.006);
          float n = fbm(uv);
          float c = smoothstep(1.0 - uCover - 0.25, 1.0 - uCover + 0.35, n);
          float shade = fbm(uv * 1.7 + 3.0);
          vec3 col = mix(uLight, uDark, clamp(shade * 0.9 + uCover * 0.55, 0.0, 1.0));
          float sunGlow = pow(max(dot(normalize(vDir), uSunDir), 0.0), 8.0);
          col += uLight * sunGlow * 0.35 * (1.0 - uCover);
          col += vec3(0.75, 0.8, 1.0) * uFlash;
          float horizon = smoothstep(-0.05, 0.25, vDir.y);
          float a = c * horizon * clamp(0.35 + uCover, 0.0, 1.0);
          float fogA = uFogAmt * (1.0 - smoothstep(0.0, 0.7, vDir.y) * 0.45);
          col = mix(col, uFogCol, fogA);
          gl_FragColor = vec4(acesFilm(col), max(a, fogA));
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.cloudMat);
    this.clouds.renderOrder = -1;
    parent.add(this.clouds);

    this.hemi = new THREE.HemisphereLight('#bcd4ff', '#4a3a28', 0.8);
    this.ambient = new THREE.AmbientLight('#d8e0e8', 0.2);
    parent.add(this.hemi, this.ambient);
    this.sun = new THREE.DirectionalLight('#fff1d8', 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    parent.add(this.sun, this.sun.target);

    this.fog = new THREE.FogExp2('#a8b4b8', 0.006);
    scene.fog = this.fog;

    // pioggia
    const rg = new THREE.BufferGeometry();
    this.rainPos = new Float32Array(RAIN_N * 6);
    this.rainSeed = new Float32Array(RAIN_N * 3);
    for (let i = 0; i < RAIN_N; i++) { this.rainSeed[i * 3] = Math.random(); this.rainSeed[i * 3 + 1] = Math.random(); this.rainSeed[i * 3 + 2] = Math.random(); }
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#c8d4dc', transparent: true, opacity: 0.0, depthWrite: false }));
    this.rain.frustumCulled = false;
    parent.add(this.rain);
    // neve
    const sg = new THREE.BufferGeometry();
    this.snowPos = new Float32Array(SNOW_N * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ map: softDot(), size: 0.09, transparent: true, depthWrite: false, opacity: 0, color: '#ffffff' }));
    this.snow.frustumCulled = false;
    parent.add(this.snow);

    // scena ridotta per generare la mappa d'ambiente (illuminazione PBR dal cielo)
    this.envScene = new THREE.Scene();
    this.envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSun; varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 c = y > 0.0 ? mix(uHorizon, uZenith, pow(y, 0.6)) : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -y));
          float s = max(dot(normalize(vDir), uSunDir), 0.0);
          c += uSun * (pow(s, 64.0) * 6.0 + pow(s, 6.0) * 0.4);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.envMat));
    this.envTimer = 0;
    this.envRT = null;
    this.flash = 0; this.nextBolt = 5; this.time = 0;
    this.sunDir = new THREE.Vector3();
    this.info = { daylight: 1, sunElev: 0 };
  }

  updateEnvironment(renderer, rootScene, day01, cond) {
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(renderer);
    const u = this.envMat.uniforms;
    const clear = 1 - cond.cloud;
    u.uZenith.value.set('#3a6fb8').lerp(new THREE.Color('#8a9298'), cond.cloud).lerp(new THREE.Color('#9aa0a2'), cond.fog).multiplyScalar(Math.max(0.015, day01) * 1.1);
    u.uHorizon.value.copy(this.fog.color).multiplyScalar(1.15);
    u.uGround.value.set('#4a3f2a').multiplyScalar(Math.max(0.01, day01) * 0.8);
    u.uSunDir.value.copy(this.sunDir);
    u.uSun.value.copy(this.sun.color).multiplyScalar(clear * (1 - cond.fog) * smoothstep(-0.05, 0.1, this.info.sunElev));
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
    rootScene.environment = rt.texture;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
  }

  dispose() {
    if (this.envRT) this.envRT.dispose();
    if (this.pmrem) this.pmrem.dispose();
  }

  update(dt, { hour, day, cond, camPos, region }) {
    this.time += dt;
    const st = sunTimes(day);
    const doy = dayOfYear(day);
    const maxElev = lerp(0.36, 1.16, 0.5 + 0.5 * Math.sin(((doy - 80) / 365) * Math.PI * 2));
    const frac = (hour - st.sunrise) / st.dayLength;
    const elev = Math.sin(clamp(frac, -0.25, 1.25) * Math.PI) * maxElev;
    const az = clamp(frac, -0.2, 1.2) * Math.PI;
    this.sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
    const su = this.sky.material.uniforms;
    su.sunPosition.value.copy(this.sunDir);
    su.turbidity.value = lerp(4, 18, cond.cloud);
    su.rayleigh.value = lerp(1.4, 0.4, cond.cloud);

    const day01 = smoothstep(-0.12, 0.18, elev); // luce diurna
    const golden = smoothstep(0.35, 0.02, elev) * day01;
    const cloudDim = lerp(1, 0.38, cond.cloud);
    this.info.daylight = day01 * cloudDim;
    this.info.sunElev = elev;

    // lampi
    this.flash = Math.max(0, this.flash - dt * 4);
    let bolt = false;
    if (cond.lightning > 0) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = 3 + Math.random() * 10; bolt = true; }
    }
    const fl = this.flash > 0 ? (Math.sin(this.time * 60) > 0 ? this.flash : this.flash * 0.3) : 0;

    // luci
    const sunCol = new THREE.Color('#fff2dc').lerp(new THREE.Color('#ff9a50'), golden);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 4.2 * smoothstep(-0.02, 0.12, elev) * lerp(1, 0.1, cond.cloud) * (1 - cond.fog * 0.5);
    this.sun.position.copy(camPos).addScaledVector(this.sunDir, 120);
    this.sun.target.position.copy(camPos);
    // stabilizza l'ombra sul texel (riduce lo sfarfallio)
    const nightCol = new THREE.Color('#2a3448');
    const skyCol = new THREE.Color('#b8cce8').lerp(new THREE.Color('#9aa2a8'), cond.cloud);
    this.hemi.color.copy(nightCol).lerp(skyCol, day01);
    this.hemi.groundColor.set('#5a4a34').lerp(new THREE.Color('#0c0c10'), 1 - day01);
    this.hemi.intensity = lerp(0.12, 1.6, day01) * lerp(1, 0.85, cond.cloud) + fl * 6;
    this.ambient.intensity = lerp(0.03, 0.25, day01);

    // nebbia e colore dell'orizzonte
    const horizonDay = new THREE.Color('#b9c8d2').lerp(new THREE.Color('#a4a9aa'), cond.cloud).lerp(new THREE.Color('#d6b08a'), golden * (1 - cond.cloud));
    const fogCol = new THREE.Color('#0a0e16').lerp(horizonDay, day01);
    fogCol.lerp(new THREE.Color('#c4c8c8').multiplyScalar(lerp(0.15, 1, day01)), cond.fog * 0.7);
    fogCol.offsetHSL(0, 0, fl * 0.3);
    this.fog.color.copy(fogCol);
    this.fog.density = 0.0045 + cond.fog * 0.075 + cond.rain * 0.012 + cond.snow * 0.03 + (1 - day01) * 0.004;

    // cielo: con copertura alta o di notte domina il colore della nebbia
    this.sky.material.uniforms.up.value.set(0, 1, 0);
    this.sky.visible = true;
    this.sky.material.opacity = 1;
    this.cloudMat.uniforms.uTime.value = this.time + hour * 60;
    this.cloudMat.uniforms.uCover.value = cond.cloud;
    this.cloudMat.uniforms.uSunDir.value.copy(this.sunDir);
    this.cloudMat.uniforms.uLight.value.copy(sunCol).multiplyScalar(lerp(0.05, 1, day01) * lerp(1, 0.75, cond.cloud));
    this.cloudMat.uniforms.uDark.value.set('#5a6068').multiplyScalar(lerp(0.04, 1, day01));
    this.cloudMat.uniforms.uFlash.value = fl;
    this.cloudMat.uniforms.uFogCol.value.copy(fogCol);
    this.cloudMat.uniforms.uFogAmt.value = clamp(cond.fog * 1.15 + cond.rain * 0.35 + cond.snow * 0.5 + cond.cloud * 0.25, 0, 0.97);
    this.clouds.position.copy(camPos);
    this.sky.position.copy(camPos);
    // oscura il cielo di notte/coperto mescolando la cupola
    this.overcast = cond.cloud;

    // pioggia
    const rainI = cond.rain;
    this.rain.material.opacity = rainI * 0.45 * lerp(0.4, 1, day01);
    if (rainI > 0.01) {
      const n = Math.floor(RAIN_N * Math.min(1, rainI + 0.15));
      this.rain.geometry.setDrawRange(0, n * 2);
      const R = 22, H = 16, speed = 14;
      const wx = cond.wind * 2.5, wz = cond.wind * 1.2;
      for (let i = 0; i < n; i++) {
        const sx = this.rainSeed[i * 3], sy = this.rainSeed[i * 3 + 1], sz = this.rainSeed[i * 3 + 2];
        const y = (((sy * H - this.time * speed * (0.8 + sz * 0.4)) % H) + H) % H;
        const x = camPos.x + (sx - 0.5) * 2 * R + wx * (y / H);
        const z = camPos.z + (sz - 0.5) * 2 * R + wz * (y / H);
        const yy = camPos.y - 6 + y;
        const o = i * 6;
        this.rainPos[o] = x; this.rainPos[o + 1] = yy; this.rainPos[o + 2] = z;
        this.rainPos[o + 3] = x - wx * 0.04; this.rainPos[o + 4] = yy + 0.55; this.rainPos[o + 5] = z - wz * 0.04;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.visible = true;
    } else this.rain.visible = false;

    // neve
    const snowI = cond.snow;
    this.snow.material.opacity = snowI * 0.9;
    if (snowI > 0.01) {
      const R = 18, H = 12;
      for (let i = 0; i < SNOW_N; i++) {
        const sx = this.rainSeed[i * 3], sy = this.rainSeed[i * 3 + 1], sz = this.rainSeed[i * 3 + 2];
        const y = (((sy * H - this.time * (0.8 + sz * 0.5)) % H) + H) % H;
        const o = i * 3;
        this.snowPos[o] = camPos.x + (sx - 0.5) * 2 * R + Math.sin(this.time * 0.7 + i) * 0.4 + cond.wind * y * 0.4;
        this.snowPos[o + 1] = camPos.y - 4 + y;
        this.snowPos[o + 2] = camPos.z + (sz - 0.5) * 2 * R + Math.cos(this.time * 0.5 + i * 1.3) * 0.4;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
      this.snow.visible = true;
    } else this.snow.visible = false;

    this.day01 = day01;
    return { bolt };
  }
}
