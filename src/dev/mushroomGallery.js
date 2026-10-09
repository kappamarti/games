// Pagina di sviluppo: galleria di tutte le specie e stadi (?test=funghi)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SPECIES } from '../data/species.js';
import { mushroomGeometry, mushroomMaterial } from '../render/mushroomMesh.js';

export function runGallery() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2a2d28');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 50);
  cam.position.set(0.9, 1.1, 1.9);
  const ctl = new OrbitControls(cam, renderer.domElement);
  ctl.target.set(0.9, 0, 0.5);
  scene.add(new THREE.HemisphereLight('#ffffff', '#554433', 1.2));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2); sun.position.set(2, 4, 3); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: '#4a3c2a' }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const stages = ['giovane', 'maturo', 'vecchio'];
  SPECIES.forEach((sp, i) => {
    stages.forEach((st, k) => {
      const g = mushroomGeometry(sp, st, i % 4, { eaten: k === 2 && i % 3 === 0, slugs: k === 1 && i % 5 === 0 });
      const m = new THREE.Mesh(g, mushroomMaterial());
      m.position.set((i % 7) * 0.3 + k * 0.08, 0, Math.floor(i / 7) * 0.4 + k * 0.1);
      scene.add(m);
    });
  });
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;top:8px;left:8px;color:#fff;font:12px monospace;white-space:pre';
  label.textContent = SPECIES.map((s, i) => `${i}: ${s.name}`).join('\n');
  document.body.appendChild(label);
  renderer.setAnimationLoop(() => { ctl.update(); renderer.render(scene, cam); });
}
