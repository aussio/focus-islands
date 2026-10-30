// Small geometry and texture helpers shared by the models, the ground and the helpers.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Rounded (segments > 1) or chamfered (segments = 1) box. Style D keeps the rounding to a sliver.
export const rbox = (w, h, d, r = 0.03, segments = 3) => new RoundedBoxGeometry(w, h, d, segments, Math.max(1e-4, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));

// A log lying along x with bark sides and pale cut ends (colours baked in).
export function logGeometry(length, radius, bark, cut, radial = 10) {
  const g = new THREE.CylinderGeometry(radius, radius, length, radial).rotateZ(Math.PI / 2).toNonIndexed();
  g.computeVertexNormals();
  const n = g.attributes.normal, colors = new Float32Array(n.count * 3);
  const a = new THREE.Color(bark), b = new THREE.Color(cut);
  for (let i = 0; i < n.count; i++) colors.set((Math.abs(n.getX(i)) > 0.9 ? b : a).toArray(), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// Gable-end triangle (fills the wall under a pitched roof), ridge along x.
export function gableGeometry(width, depth, rise) {
  const shape = new THREE.Shape([new THREE.Vector2(-depth / 2, 0), new THREE.Vector2(depth / 2, 0), new THREE.Vector2(0, rise)]);
  return new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-width / 2, 0, 0);
}

// Lumpy sphere for rocks and leaf clumps; detail 0-1 reads faceted, 2+ reads smooth.
export function lump(radius, detail, amount, seed, squash = [1, 1, 1]) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + amount * Math.sin(x * 7.1 + seed) * Math.sin(y * 6.3 + seed * 2) * Math.sin(z * 5.7 + seed * 3);
    p.setXYZ(i, x * k * squash[0], y * k * squash[1], z * k * squash[2]);
  }
  g.computeVertexNormals();
  return g;
}

// A faceted chunk: a jittered low-detail sphere, squashed so it has a few broad flat faces.
export const chunk = (r, seed, squash = [1, 0.8, 1], detail = 0, amount = 0.16) => lump(r, detail, amount, seed, squash);

export function teardrop(height = 0.5, radius = 0.13, segments = 14) {
  const pts = [[0, 0], [radius * 0.75, height * 0.08], [radius, height * 0.26], [radius * 0.75, height * 0.5], [radius * 0.35, height * 0.78], [0, height]];
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

// A pointed crystal: a hexagonal prism with a pyramid top, flat shaded.
export function crystalGeometry(height, radius) {
  const pts = [[0, 0], [radius, 0.02], [radius, height * 0.7], [0, height]];
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 6);
}

// ---------- Canvas textures (one copy each per page) ----------
const textures = new Map();
function canvasTexture(key, size, draw, srgb = false) {
  if (textures.has(key)) return textures.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = size[0]; canvas.height = size[1];
  const g = canvas.getContext('2d');
  if (g) draw(g, canvas);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.shared = true; // never disposed with a scene
  textures.set(key, texture);
  return texture;
}

function radial(stops) {
  return g => {
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (const [at, color] of stops) gradient.addColorStop(at, color);
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
  };
}

export const glowTexture = () => canvasTexture('glow', [64, 64], radial([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]));
export const blobTexture = () => canvasTexture('blob', [64, 64], radial([[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]));

export function skyTexture(key, stops) {
  return canvasTexture(`sky:${key}`, [4, 512], g => {
    const gradient = g.createLinearGradient(0, 0, 0, 512);
    for (const [at, color] of stops) gradient.addColorStop(at, color);
    g.fillStyle = gradient;
    g.fillRect(0, 0, 4, 512);
  }, true);
}

export function textTexture(text, { font, color, size = 64, stroke }) {
  return canvasTexture(`text:${text}:${font}:${color}:${stroke}`, [size, size], g => {
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (stroke) { g.lineWidth = size / 10; g.strokeStyle = stroke; g.strokeText(text, size / 2, size / 2); }
    g.fillStyle = color;
    g.fillText(text, size / 2, size / 2);
  }, true);
}

// A pale moon disc with a soft rim.
export const moonTexture = () => canvasTexture('moon', [64, 64], radial([[0, 'rgba(255,250,228,1)'], [0.6, 'rgba(255,246,214,1)'], [0.72, 'rgba(255,244,210,0.35)'], [1, 'rgba(255,244,210,0)']]), true);
