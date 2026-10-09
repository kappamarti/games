// Pipeline di rendering basata su threepipe (https://github.com/repalash/threepipe):
// HDR half-float, MSAA, G-Buffer + SSAO, ombre a cascata (CSM), tone mapping ACES,
// grana pellicola e leggera aberrazione cromatica (la vignettatura è un overlay CSS).
import * as THREE from 'three';
import {
  ThreeViewer, SSAOPlugin, GBufferPlugin, CascadedShadowsPlugin, TonemapPlugin, FilmicGrainPlugin, ChromaticAberrationPlugin,
} from 'threepipe';

// Preset di qualità: scala di rendering, effetti e ombre
export const QUALITY = {
  bassa: { label: 'Bassa', lod: 50, scale: 0.6, ssao: false, cascades: 1, shadowSize: 1024, shadowEvery: 3, grain: false, msaa: false },
  media: { label: 'Media', lod: 75, scale: 0.8, ssao: false, cascades: 2, shadowSize: 1024, shadowEvery: 2, grain: true, msaa: true },
  alta: { label: 'Alta', lod: 95, scale: 1, ssao: true, cascades: 2, shadowSize: 1024, shadowEvery: 1, grain: true, msaa: true },
  ultra: { label: 'Ultra', lod: 150, scale: 1.2, ssao: true, cascades: 3, shadowSize: 2048, shadowEvery: 1, grain: true, msaa: true },
};

function probeGpu() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}
const INTEGRATED = /intel|uhd|iris|mali|adreno|powervr|apple gpu|swiftshader|llvmpipe/i;

export function createViewer(canvas) {
  const gpu = probeGpu();
  const forced = new URLSearchParams(location.search).get('msaa');
  const viewer = new ThreeViewer({
    canvas,
    // l'MSAA su buffer HDR è costoso sulle GPU integrate
    msaa: forced ? forced === '1' : !INTEGRATED.test(gpu),
    rgbm: false, // pipeline HDR half-float: colori migliori nel post-processing
    renderScale: Math.min(devicePixelRatio, 1.25),
    tonemap: true,
    backgroundColor: null,
    dropzone: false,
    plugins: [SSAOPlugin, CascadedShadowsPlugin, FilmicGrainPlugin, ChromaticAberrationPlugin],
  });
  const r = viewer.renderManager.renderer;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;

  const tone = viewer.getPlugin(TonemapPlugin);
  if (tone) {
    tone.toneMapping = THREE.ACESFilmicToneMapping;
    tone.exposure = 1.35;
    tone.contrast = 1.06;
    tone.saturation = 0.98;
  }
  const ssao = viewer.getPlugin(SSAOPlugin);
  if (ssao?.pass) {
    ssao.pass.intensity = 1.1;
    ssao.pass.occlusionWorldRadius = 1.4;
    ssao.pass.falloff = 1.2;
    ssao.pass.numSamples = 6;
  }
  const grain = viewer.getPlugin(FilmicGrainPlugin);
  if (grain) { grain.intensity = 2.5; grain.multiply = false; }
  const ca = viewer.getPlugin(ChromaticAberrationPlugin);
  if (ca) ca.intensity = 0.015;

  // la camera principale è guidata dal controller in prima persona del gioco
  const cam = viewer.scene.mainCamera;
  cam.controlsMode = '';
  cam.autoLookAtTarget = false;
  cam.autoNearFar = false;
  cam.minNearPlane = 0.03;
  cam.maxFarPlane = 1200;
  cam.near = 0.03; cam.far = 1200; cam.fov = 70;
  cam.updateProjectionMatrix();
  viewer.scene.background = null;
  viewer.userData = { gpu: gpuName(r), frame: 0 };
  // senza G-buffer il passaggio finale può lasciare alpha = 0: forziamo il canvas opaco
  viewer.addEventListener('postFrame', () => {
    const gl = r.getContext();
    r.setRenderTarget(null);
    gl.colorMask(false, false, false, true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.colorMask(true, true, true, true);
    r.resetState(); // riallinea la cache di stato di three.js
  });
  return viewer;
}

function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
  } catch { return ''; }
}

// Qualità predefinita in base alla GPU (le integrate partono da "media")
export function defaultQuality(viewer) {
  const g = (viewer.userData?.gpu || '').toLowerCase();
  if (INTEGRATED.test(g)) return 'media';
  return 'alta';
}

// Risoluzione di uscita: 'auto' segue la finestra, altrimenti altezza fissa (1080p, 1440p, 2160p = 4K)
export const RESOLUTIONS = [['auto', 'Automatica (finestra)'], ['1080', 'Full HD 1080p'], ['1440', 'QHD 1440p'], ['2160', '4K UHD 2160p']];
export function renderScaleFor(settings, q = QUALITY[settings.quality] || QUALITY.alta) {
  const res = settings.resolution || 'auto';
  if (res !== 'auto') return Math.max(0.25, Number(res) / Math.max(1, innerHeight));
  return Math.min(devicePixelRatio, 1.25) * q.scale * (settings.pixelRatio ?? 1);
}

export function applyQuality(viewer, settings) {
  const q = QUALITY[settings.quality] || QUALITY.alta;
  viewer.renderManager.renderScale = renderScaleFor(settings, q);
  const ssao = viewer.getPlugin(SSAOPlugin);
  const gb = viewer.getPlugin(GBufferPlugin);
  if (ssao) ssao.enabled = q.ssao;
  if (gb) gb.enabled = q.ssao;
  const grain = viewer.getPlugin(FilmicGrainPlugin);
  if (grain) grain.enabled = q.grain;
  setShadowCasting(viewer, settings.shadows !== false);
  viewer.setDirty();
}

function setShadowCasting(viewer, on) {
  const csm = viewer.getPlugin(CascadedShadowsPlugin);
  if (csm) for (const l of csm.lights) l.castShadow = on;
  viewer.userData.shadowsOn = on;
}

export function configureShadows(viewer, light, quality = 'alta') {
  const csm = viewer.getPlugin(CascadedShadowsPlugin);
  if (!csm) return;
  const q = QUALITY[quality] || QUALITY.alta;
  csm.light = light;
  csm.maxFar = q.cascades === 1 ? 50 : 80;
  csm.mode = 'practical';
  csm.fade = true;
  csm.setLightParams({ cascades: q.cascades, shadowMapSize: q.shadowSize, lightMargin: 60, shadowBias: -0.0003 }, light);
  viewer.userData.shadowEvery = q.shadowEvery;
  // calcola subito le cascate: i materiali compilati prima avrebbero CSM_CASCADES = 0
  csm.camera = viewer.scene.mainCamera;
  csm.cameraNeedsUpdate();
  csm._updateFrustums?.();
  csm.update();
  viewer.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
}

export function detachShadows(viewer) {
  const csm = viewer.getPlugin(CascadedShadowsPlugin);
  if (csm) csm.light = undefined;
}

// Da chiamare ogni frame: la camera è mossa dal gioco e la luce del sole cambia nel tempo.
// Le mappe d'ombra si aggiornano ogni N frame secondo la qualità.
export function updateShadows(viewer, refreshLight = false) {
  const csm = viewer.getPlugin(CascadedShadowsPlugin);
  if (!csm || !csm.light) return;
  if (refreshLight) csm.refreshLights();
  const on = viewer.userData.shadowsOn !== false;
  for (const l of csm.lights) { l.visible = true; l.castShadow = on; }
  const every = viewer.userData.shadowEvery || 1;
  viewer.userData.frame = (viewer.userData.frame || 0) + 1;
  if (viewer.userData.frame % every === 0) {
    csm.cameraNeedsUpdate();
    viewer.renderManager.renderer.shadowMap.needsUpdate = true;
  }
}
