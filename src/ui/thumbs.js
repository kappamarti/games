// Miniature delle specie per l'enciclopedia (renderer fuori schermo condiviso).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mushroomGeometry, mushroomMaterial } from '../render/mushroomMesh.js';

let R = null;
const cache = new Map();

function setup() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(180, 180, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight('#dfe8ff', '#5a4630', 0.8));
  const d = new THREE.DirectionalLight('#fff3e0', 2); d.position.set(0.5, 1, 0.7); scene.add(d);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  R = { renderer, scene, cam };
}

export function speciesThumb(sp, silhouette = false) {
  const key = `${sp.id}|${silhouette}`;
  if (cache.has(key)) return cache.get(key);
  if (!R) setup();
  const geo = mushroomGeometry(sp, 'maturo', 1, {});
  const mat = silhouette ? new THREE.MeshBasicMaterial({ color: '#2a2620' }) : mushroomMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  R.scene.add(mesh);
  const bb = new THREE.Box3().setFromObject(mesh);
  const size = bb.getSize(new THREE.Vector3());
  const c = bb.getCenter(new THREE.Vector3());
  const dist = Math.max(size.x, size.y, size.z) * 2.6;
  R.cam.position.set(c.x + dist * 0.75, c.y + dist * 0.45, c.z + dist * 0.75);
  R.cam.lookAt(c);
  R.renderer.render(R.scene, R.cam);
  const url = R.renderer.domElement.toDataURL('image/png');
  R.scene.remove(mesh);
  if (silhouette) mat.dispose();
  cache.set(key, url);
  return url;
}
