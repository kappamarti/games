// Uniform ambientali condivisi (vento, bagnato, neve) iniettati nei materiali standard.
import * as THREE from 'three';

export const envUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.2 },
  uWet: { value: 0 },
  uSnow: { value: 0 },
  uFrost: { value: 0 },
};

/**
 * @param {THREE.Material} mat
 * @param {{sway?: number, swayStart?: number, snow?: boolean, wet?: number}} opts
 */
export function patchMaterial(mat, opts = {}) {
  const sway = opts.sway ?? 0;
  const swayStart = opts.swayStart ?? 0;
  const snow = opts.snow ?? true;
  const wet = opts.wet ?? 1;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, envUniforms);
    shader.uniforms.uSwayAmt = { value: sway };
    shader.uniforms.uSwayStart = { value: swayStart };
    shader.uniforms.uWetAmt = { value: wet };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind; uniform float uSwayAmt; uniform float uSwayStart;
        varying float vWorldNormalY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (uSwayAmt > 0.0) {
          #ifdef USE_INSTANCING
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 ip = vec3(modelMatrix[3][0], 0.0, modelMatrix[3][2]);
          #endif
          float hgt = max(0.0, transformed.y - uSwayStart);
          float sw = (sin(uTime * 1.3 + ip.x * 0.31 + ip.z * 0.17) + 0.45 * sin(uTime * 2.9 + ip.z * 0.53)) * uWind * hgt * uSwayAmt;
          transformed.x += sw; transformed.z += sw * 0.6;
        }`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vWorldNormalY = (vec4(transformedNormal, 0.0) * viewMatrix).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWet; uniform float uSnow; uniform float uFrost; uniform float uWetAmt;
        varying float vWorldNormalY;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0, 0.6, uWet * uWetAmt);
        ${snow ? `float snowMask = smoothstep(0.45, 0.85, vWorldNormalY);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.98), clamp(uSnow * snowMask, 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.9), uFrost * snowMask * 0.55);` : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.28, uWet * uWetAmt * 0.85);`);
  };
  mat.customProgramCacheKey = () => `env-${sway}-${swayStart}-${snow}-${wet}`;
  return mat;
}
