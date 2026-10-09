// Texture generate proceduralmente su canvas (nessun asset esterno).
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, { repeat = false, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// Dettaglio del terreno: granulosità, piccole foglie, aghi e sassolini (in scala di grigi, moltiplica i colori vertice)
export function groundDetailTexture() {
  const [c, g] = canvas(1024);
  const r = mulberry32(42);
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 1024, 1024);
  const img = g.getImageData(0, 0, 1024, 1024);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 150 + r() * 90;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  // macchie
  for (let k = 0; k < 900; k++) {
    const x = r() * 1024, y = r() * 1024, s = 4 + r() * 22;
    g.fillStyle = `rgba(${r() < 0.5 ? 255 : 60},${r() < 0.5 ? 255 : 60},${r() < 0.5 ? 255 : 60},${0.05 + r() * 0.08})`;
    g.beginPath(); g.ellipse(x, y, s, s * (0.4 + r() * 0.6), r() * 3, 0, Math.PI * 2); g.fill();
  }
  // foglioline
  for (let k = 0; k < 2600; k++) {
    const x = r() * 1024, y = r() * 1024, s = 3 + r() * 9;
    const v = Math.floor(120 + r() * 135);
    g.fillStyle = `rgba(${v},${v},${v},0.55)`;
    g.save(); g.translate(x, y); g.rotate(r() * 6.28);
    g.beginPath(); g.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(40,40,40,0.25)`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-s, 0); g.lineTo(s, 0); g.stroke();
    g.restore();
  }
  // aghi e rametti
  g.lineCap = 'round';
  for (let k = 0; k < 2200; k++) {
    const x = r() * 1024, y = r() * 1024, l = 4 + r() * 14, a = r() * 6.28;
    const v = Math.floor(70 + r() * 120);
    g.strokeStyle = `rgba(${v},${v},${v},0.5)`; g.lineWidth = 0.6 + r() * 1.2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // sassolini
  for (let k = 0; k < 500; k++) {
    const x = r() * 1024, y = r() * 1024, s = 1 + r() * 3.5;
    const v = Math.floor(170 + r() * 80);
    g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(x, y, s, 0, 6.28); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(x + s * 0.4, y + s * 0.4, s, 0, 6.28); g.fill();
  }
  return finish(c, { repeat: true, srgb: false });
}

// Corteccia (grigio, moltiplica il colore vertice)
export function barkTexture() {
  const [c, g] = canvas(256, 512);
  const r = mulberry32(7);
  g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, 256, 512);
  // placche di corteccia
  for (let k = 0; k < 260; k++) {
    const x = r() * 256, y = r() * 512, h = 20 + r() * 90, w = 2 + r() * 6;
    const v = Math.floor(120 + r() * 100);
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(x, y, w, h);
    if (x + w > 256) g.fillRect(x - 256, y, w, h);
  }
  // fessure verticali sinuose (si ripetono orizzontalmente)
  g.lineCap = 'round';
  for (let k = 0; k < 34; k++) {
    let x = r() * 256, y = -10;
    const dark = Math.floor(25 + r() * 50);
    g.strokeStyle = `rgba(${dark},${dark},${dark},0.85)`;
    g.lineWidth = 1.2 + r() * 3.2;
    g.beginPath(); g.moveTo(x, y);
    while (y < 522) {
      y += 6 + r() * 14; x += (r() - 0.5) * 7;
      g.lineTo(x, y);
      if (r() < 0.06) { g.stroke(); g.beginPath(); y += 8 + r() * 30; g.moveTo(x, y); }
    }
    g.stroke();
  }
  for (let k = 0; k < 4000; k++) {
    const v = Math.floor(r() * 255);
    g.fillStyle = `rgba(${v},${v},${v},0.12)`; g.fillRect(r() * 256, r() * 512, 2, 2);
  }
  return finish(c, { repeat: true, srgb: false });
}

// Foglia singola con canale alfa
export function leafTexture() {
  const [c, g] = canvas(64);
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(32, 4);
  g.bezierCurveTo(54, 18, 54, 44, 32, 60);
  g.bezierCurveTo(10, 44, 10, 18, 32, 4);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(32, 6); g.lineTo(32, 60); g.stroke();
  for (let k = 0; k < 5; k++) {
    const y = 14 + k * 9;
    g.beginPath(); g.moveTo(32, y + 4); g.lineTo(20, y - 2); g.moveTo(32, y + 4); g.lineTo(44, y - 2); g.stroke();
  }
  return finish(c, { srgb: false });
}

// Ciuffo d'erba con alfa
export function grassTexture() {
  const [c, g] = canvas(128);
  const r = mulberry32(3);
  g.clearRect(0, 0, 128, 128);
  for (let k = 0; k < 34; k++) {
    const x = 10 + r() * 108, h = 50 + r() * 76, bend = (r() - 0.5) * 30, w = 2 + r() * 3;
    const v = Math.floor(150 + r() * 105);
    const grad = g.createLinearGradient(0, 128, 0, 128 - h);
    grad.addColorStop(0, `rgb(${v * 0.5},${v * 0.5},${v * 0.5})`); grad.addColorStop(1, `rgb(${v},${v},${v})`);
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(x - w, 128); g.quadraticCurveTo(x + bend * 0.5, 128 - h * 0.6, x + bend, 128 - h); g.quadraticCurveTo(x + bend * 0.5 + 1, 128 - h * 0.6, x + w, 128); g.fill();
  }
  return finish(c, { srgb: false });
}

// Fronda di felce con alfa
export function fernTexture() {
  const [c, g] = canvas(128, 256);
  g.clearRect(0, 0, 128, 256);
  g.strokeStyle = '#ffffff'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(64, 256); g.quadraticCurveTo(70, 120, 60, 8); g.stroke();
  g.fillStyle = '#ffffff';
  for (let k = 0; k < 22; k++) {
    const t = k / 22; const y = 240 - t * 228; const x = 64 + Math.sin(t * 2) * 3;
    const len = Math.sin(t * Math.PI) * 52 + 6;
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + s * len * 0.6, y - 10, x + s * len, y - 4 - t * 8);
      g.quadraticCurveTo(x + s * len * 0.5, y + 2, x, y + 5); g.fill();
    }
  }
  return finish(c, { srgb: false });
}

// Sprite morbido (gocce, fiocchi, nebbia)
export function softDot() {
  const [c, g] = canvas(64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return finish(c);
}

// Muschio / chiazze sui tronchi
export function mossTexture() {
  const [c, g] = canvas(256);
  const r = mulberry32(99);
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 3000; k++) {
    const v = Math.floor(120 + r() * 135);
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.beginPath(); g.arc(r() * 256, r() * 256, 1 + r() * 3, 0, 6.28); g.fill();
  }
  return finish(c, { repeat: true, srgb: false });
}

// Atlante del fogliame: metà sinistra = grappolo di foglie, metà destra = ramo di conifera,
// fascia inferiore opaca (usata dai volumi interni delle chiome).
export function foliageAtlas() {
  const [c, g] = canvas(1024, 512);
  const r = mulberry32(2024);
  g.clearRect(0, 0, 1024, 512);
  // fascia opaca
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 448, 1024, 64);
  // grappolo di foglie (latifoglie)
  g.save();
  g.beginPath(); g.rect(0, 0, 512, 448); g.clip();
  for (let k = 0; k < 170; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 200;
    const x = 256 + Math.cos(a) * d, y = 224 + Math.sin(a) * d * 0.85;
    const s = 15 + r() * 15;
    const v = Math.floor(150 + r() * 105 - d * 0.25);
    g.save(); g.translate(x, y); g.rotate(r() * Math.PI * 2);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.moveTo(0, -s); g.bezierCurveTo(s * 0.62, -s * 0.5, s * 0.55, s * 0.55, 0, s); g.bezierCurveTo(-s * 0.55, s * 0.55, -s * 0.62, -s * 0.5, 0, -s); g.fill();
    g.strokeStyle = `rgba(0,0,0,0.22)`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, -s); g.lineTo(0, s); g.stroke();
    g.restore();
  }
  g.strokeStyle = 'rgba(70,60,50,0.9)'; g.lineWidth = 3;
  for (let k = 0; k < 6; k++) { const a = r() * 6.28; g.beginPath(); g.moveTo(256, 224); g.lineTo(256 + Math.cos(a) * 150, 224 + Math.sin(a) * 130); g.stroke(); }
  g.restore();
  // ramo di conifera (aghi)
  g.save();
  g.beginPath(); g.rect(512, 0, 512, 448); g.clip();
  const bx = 540, by = 224;
  g.strokeStyle = '#6a5a4a'; g.lineWidth = 5; g.beginPath(); g.moveTo(bx, by); g.lineTo(1000, by + 20); g.stroke();
  for (let k = 0; k < 26; k++) {
    const t = k / 26;
    const px = bx + t * 450, py = by + t * 20;
    const len = (1 - t * 0.6) * 150;
    for (const side of [-1, 1]) {
      const ex = px + 50 + r() * 30, ey = py + side * len * (0.7 + r() * 0.3);
      g.strokeStyle = '#7a6a5a'; g.lineWidth = 2; g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.stroke();
      for (let n = 0; n < 16; n++) {
        const u = n / 16;
        const qx = px + (ex - px) * u, qy = py + (ey - py) * u;
        const v = Math.floor(140 + r() * 115);
        g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 2.2;
        for (const s2 of [-1, 1]) { g.beginPath(); g.moveTo(qx, qy); g.lineTo(qx + 14 + r() * 6, qy + s2 * (10 + r() * 6)); g.stroke(); }
      }
    }
  }
  g.restore();
  const t = finish(c, { srgb: false });
  t.generateMipmaps = true;
  return t;
}

// Normal map ricavata dalla luminanza di una texture (Sobel), per dare rilievo a terreno, corteccia e rocce
export function normalFromTexture(tex, strength = 2) {
  const src = tex.image;
  const w = src.width, h = src.height;
  const sg = src.getContext('2d');
  const data = sg.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255 * (data[i * 4 + 3] / 255);
  const [c, g] = canvas(w, h);
  const out = g.createImageData(w, h);
  const at = (x, y) => lum[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    out.data[i] = (nx * 0.5 + 0.5) * 255; out.data[i + 1] = (ny * 0.5 + 0.5) * 255; out.data[i + 2] = (nz * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = finish(c, { repeat: true, srgb: false });
  t.repeat.copy(tex.repeat);
  return t;
}

// Corolla di fiore (bianca, tinta per istanza) con centro giallo scuro
export function flowerTexture() {
  const [c, g] = canvas(64);
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#ffffff';
  for (let k = 0; k < 6; k++) {
    g.save(); g.translate(32, 32); g.rotate((k / 6) * Math.PI * 2);
    g.beginPath(); g.ellipse(0, -15, 7, 14, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  g.fillStyle = '#c8a020'; g.beginPath(); g.arc(32, 32, 7, 0, Math.PI * 2); g.fill();
  return finish(c);
}
