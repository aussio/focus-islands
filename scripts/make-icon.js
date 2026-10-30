// Draws the Focus Islands app icon and its two menu bar images.
//
//   node scripts/make-icon.js           writes:
//     assets/app-icon.png (1024 px), assets/app-icon-256.png (a preview), assets/app-icon.icns (used by
//     scripts/package-app.js), and electron/tray/island-day.png and island-night.png, each with @2x (used by
//     electron/main.js: day while you are at the Mac, night while you are away)
//   node scripts/make-icon.js --check   also writes enlarged copies on light and dark backgrounds to
//                                       .build/icon-check/, to judge the small sizes by eye
//
// Uses only Node's built-in zlib and macOS's built-in iconutil. No Electron, no downloads.
// Shapes are placed on a fixed grid (1024 x 1024 for the app icon, 24 x 18 points for the menu bar).
// Each output pixel averages many sample points, so edges stay smooth at every size.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
const trayFolder = path.join(root, 'electron', 'tray');

// Colours copied from the game palette: P, HOUSE_LOOKS[0] and the focus sky in
// electron/renderer/game/scene/style.js. The night colours are darker, cooler versions of the same.
const COLOURS = {
  skyTop: '#62b9f5', skyMiddle: '#bfe6ff', skyLow: '#fff1df',
  grass: '#8edb6c', grassSide: '#6cc35a',
  soilDeep: '#e9a982', soilShade: '#c99467',
  wall: '#ffd25e', roof: '#e9553f', door: '#2fb8a5',
  trunk: '#b9825a', leaf: '#5cc85d', leafLight: '#73d56a',
  cloud: '#ffffff',
  dayLine: '#4a3a2c', sun: '#ffcf33', sunLine: '#b8601a', ray: '#f59a1d',
  nightGrass: '#4f9a8c', nightGrassSide: '#3b7a72', nightSoil: '#7a6cb8', nightSoilShade: '#5d5296',
  nightWall: '#8f86c4', nightRoof: '#4256a8', window: '#ffd25e',
  nightLine: '#1c2045', moon: '#fff2b3', star: '#fff6cc',
};
const rgb = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
const colour = Object.fromEntries(Object.entries(COLOURS).map(([name, hex]) => [name, rgb(hex)]));

// Shapes. `distance` is negative inside, positive outside (close to the true distance near the edge),
// which lets the menu bar images draw an outline around a group of shapes.
function roundedBoxDistance(x, y, centreX, centreY, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x - centreX) - (halfWidth - radius);
  const qy = Math.abs(y - centreY) - (halfHeight - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}
function segmentDistance(x, y, [ax, ay], [bx, by]) {
  const t = Math.min(Math.max(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2), 0), 1);
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}
const shape = (fill, box, distance, hit = (x, y) => distance(x, y) <= 0) => ({ fill, box, distance, hit });
const ellipse = (cx, cy, rx, ry, fill) => shape(fill, [cx - rx, cy - ry, cx + rx, cy + ry], (x, y) => {
  const dx = x - cx; const dy = y - cy;
  const gradient = 2 * Math.hypot(dx / (rx * rx), dy / (ry * ry));
  return gradient ? (((dx / rx) ** 2 + (dy / ry) ** 2 - 1) / gradient) : -Math.min(rx, ry);
});
const circle = (cx, cy, r, fill) => shape(fill, [cx - r, cy - r, cx + r, cy + r], (x, y) => Math.hypot(x - cx, y - cy) - r);
const roundedRect = (x0, y0, x1, y1, r, fill) => shape(fill, [x0, y0, x1, y1],
  (x, y) => roundedBoxDistance(x, y, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, r));
const capsule = (from, to, r, fill) => shape(fill,
  [Math.min(from[0], to[0]) - r, Math.min(from[1], to[1]) - r, Math.max(from[0], to[0]) + r, Math.max(from[1], to[1]) + r],
  (x, y) => segmentDistance(x, y, from, to) - r);
const cutOut = (keep, remove, fill) => shape(fill, keep.box, (x, y) => Math.max(keep.distance(x, y), -remove.distance(x, y)));
function polygon(points, fill) {
  const xs = points.map(p => p[0]); const ys = points.map(p => p[1]);
  const inside = (x, y) => {
    let result = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i]; const [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) result = !result;
    }
    return result;
  };
  return shape(fill, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], (x, y) => {
    let nearest = Infinity;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) nearest = Math.min(nearest, segmentDistance(x, y, points[j], points[i]));
    return inside(x, y) ? -nearest : nearest;
  }, inside);
}
const star = (cx, cy, size, fill) => polygon([0, 1, 2, 3, 4, 5, 6, 7].map(step => {
  const angle = (step * Math.PI) / 4 - Math.PI / 2; const reach = step % 2 ? size * 0.36 : size;
  return [cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach];
}), fill);
const within = ([x0, y0, x1, y1], x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

// ---- App icon: 1024 x 1024 grid ----

// The standard macOS app shape: an 824 px rounded square centred on the canvas, with a soft shadow.
const BODY = { centre: 512, half: 412, radius: 185 };
const SHADOW = { drop: 12, blur: 26, alpha: 0.28 };

// Shapes from back to front. `small` leaves out details that cannot show at 16 or 32 px.
function iconShapes(small) {
  const shapes = [];
  // One small cloud, upper right.
  if (!small) {
    shapes.push(circle(676, 246, 38, colour.cloud), circle(728, 222, 52, colour.cloud),
      circle(782, 250, 34, colour.cloud), roundedRect(640, 236, 816, 284, 24, colour.cloud));
  }
  // The earthy underside, tapering to a point, with a darker facet on the shaded right side.
  shapes.push(polygon([[206, 590], [236, 664], [298, 724], [368, 764], [428, 822], [492, 866], [538, 902],
    [588, 856], [652, 796], [724, 744], [790, 682], [818, 590]], colour.soilDeep));
  shapes.push(polygon([[538, 902], [572, 672], [818, 590], [790, 682], [724, 744], [652, 796], [588, 856]],
    colour.soilShade));
  // The grass: a darker side band under a lighter top.
  shapes.push(ellipse(512, 588, 314, 94, colour.grassSide));
  shapes.push(ellipse(512, 546, 314, 92, colour.grass));
  // The tree, right of centre.
  shapes.push(roundedRect(640, 444, 668, 566, 10, colour.trunk));
  shapes.push(circle(654, 418, small ? 82 : 74, colour.leaf));
  if (!small) shapes.push(circle(632, 396, 34, colour.leafLight));
  // The house, left of centre: yellow walls, a warm red roof, and a door.
  shapes.push(roundedRect(328, 432, 496, 572, 6, colour.wall));
  shapes.push(polygon([[300, 452], [412, 316], [524, 452]], colour.roof));
  if (!small) shapes.push(roundedRect(392, 498, 432, 572, 18, colour.door));
  return shapes;
}

function sky(y) {
  const t = Math.min(Math.max((y - (BODY.centre - BODY.half)) / (BODY.half * 2), 0), 1);
  const [from, to, local] = t < 0.55
    ? [colour.skyTop, colour.skyMiddle, t / 0.55]
    : [colour.skyMiddle, colour.skyLow, (t - 0.55) / 0.45];
  return from.map((value, index) => value + (to[index] - value) * local);
}

function iconSampler(shapes) {
  return (x, y) => {
    const body = roundedBoxDistance(x, y, BODY.centre, BODY.centre, BODY.half, BODY.half, BODY.radius);
    if (body > 0) {
      const shadow = roundedBoxDistance(x, y - SHADOW.drop, BODY.centre, BODY.centre, BODY.half, BODY.half, BODY.radius);
      const fade = Math.min(Math.max((shadow + SHADOW.blur * 0.4) / (SHADOW.blur * 1.4), 0), 1);
      return [0, 0, 0, SHADOW.alpha * (1 - fade * fade * (3 - 2 * fade))];
    }
    for (let index = shapes.length - 1; index >= 0; index--) {
      const item = shapes[index];
      if (within(item.box, x, y) && item.hit(x, y)) return [...item.fill, 1];
    }
    return [...sky(y), 1];
  };
}

const renderIcon = size => rasterize(size, size, 1024 / size, Math.max(4, Math.ceil(2048 / size)), iconSampler(iconShapes(size <= 32)));

// ---- Menu bar images: 24 x 18 point grid ----
// Colour images on a clear background. Each group of shapes gets a dark outline around its outside edge,
// so it reads on a light menu bar; the bright fills carry it on a dark one.

const TRAY = { width: 24, height: 18 };

function trayIsland(night) {
  const shapes = [
    polygon([[2.4, 10.2], [4.3, 12.7], [6.9, 14.6], [9.5, 16.9], [12.2, 14.5], [14.6, 12.6], [16.6, 10.2]],
      night ? colour.nightSoil : colour.soilDeep),
    polygon([[9.5, 16.9], [10.3, 12.0], [16.6, 10.2], [14.6, 12.6], [12.2, 14.5]], night ? colour.nightSoilShade : colour.soilShade),
    ellipse(9.5, 10.4, 7.1, 2.3, night ? colour.nightGrassSide : colour.grassSide),
    ellipse(9.5, 9.4, 7.1, 2.2, night ? colour.nightGrass : colour.grass),
    roundedRect(5.0, 5.8, 8.8, 9.9, 0.3, night ? colour.nightWall : colour.wall),
    polygon([[4.0, 6.4], [6.9, 2.9], [9.8, 6.4]], night ? colour.nightRoof : colour.roof),
  ];
  if (night) shapes.push(roundedRect(6.1, 7.0, 7.7, 8.6, 0.25, colour.window));
  return { shapes, line: night ? colour.nightLine : colour.dayLine, width: 0.85 };
}

function trayElements(night) {
  if (!night) {
    const rays = [0, 1, 2, 3, 4, 5, 6, 7].map(step => {
      const angle = (step * Math.PI) / 4; const cx = 19.9; const cy = 5.3;
      return capsule([cx + Math.cos(angle) * 3.5, cy + Math.sin(angle) * 3.5], [cx + Math.cos(angle) * 4.4, cy + Math.sin(angle) * 4.4], 0.42, colour.ray);
    });
    return [
      { shapes: rays, line: colour.sunLine, width: 0 },
      { shapes: [circle(19.9, 5.3, 2.5, colour.sun)], line: colour.sunLine, width: 0.75 },
      trayIsland(false),
    ];
  }
  return [
    { shapes: [cutOut(circle(19.6, 5.6, 3.3, colour.moon), circle(21.3, 4.2, 2.8, colour.moon), colour.moon)], line: colour.nightLine, width: 0.8 },
    { shapes: [star(13.3, 2.5, 1.6, colour.star)], line: colour.nightLine, width: 0.6 },
    { shapes: [star(22.2, 12.6, 1.3, colour.star)], line: colour.nightLine, width: 0.55 },
    trayIsland(true),
  ];
}

function traySampler(elements) {
  return (x, y) => {
    for (let index = elements.length - 1; index >= 0; index--) {
      const { shapes, line, width } = elements[index];
      let nearest = Infinity;
      for (let at = shapes.length - 1; at >= 0; at--) {
        const distance = shapes[at].distance(x, y);
        if (distance <= 0) return [...shapes[at].fill, 1];
        nearest = Math.min(nearest, distance);
      }
      if (nearest <= width) return [...line, 1];
    }
    return [0, 0, 0, 0];
  };
}

const renderTray = (night, scale) => rasterize(TRAY.width * scale, TRAY.height * scale, 1 / scale, 16, traySampler(trayElements(night)));

// ---- Pixels and PNG files ----

// Averages steps x steps sample points per pixel. `unit` is grid units per pixel.
function rasterize(width, height, unit, steps, sampleAt) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < steps; sy++) {
        for (let sx = 0; sx < steps; sx++) {
          const [cr, cg, cb, ca] = sampleAt((px + (sx + 0.5) / steps) * unit, (py + (sy + 0.5) / steps) * unit);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const at = (py * width + px) * 4;
      pixels[at] = a ? Math.round(r / a) : 0;
      pixels[at + 1] = a ? Math.round(g / a) : 0;
      pixels[at + 2] = a ? Math.round(b / a) : 0;
      pixels[at + 3] = Math.round((a / (steps * steps)) * 255);
    }
  }
  return { width, height, pixels };
}

function png({ width, height, pixels }) {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * rowLength + 1, y * width * 4, (y + 1) * width * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// For --check: images enlarged with square pixels, each shown on a light and a dark background.
function checkSheet(images, factor) {
  const backgrounds = [[236, 236, 236], [42, 42, 46]];
  const gap = 8;
  const cellWidth = Math.max(...images.map(image => image.width)) * factor + gap;
  const width = cellWidth * images.length + gap; const height = (Math.max(...images.map(image => image.height)) * factor + gap) * 2 + gap;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = Math.min(Math.floor(y / (height / 2)), 1); const background = backgrounds[row];
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4; const column = Math.floor((x - gap) / cellWidth);
      const image = images[column];
      const ix = Math.floor((x - gap - column * cellWidth) / factor); const iy = Math.floor((y - gap - row * (height / 2)) / factor);
      pixels.set([...background, 255], at);
      if (!image || ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) continue;
      const from = (iy * image.width + ix) * 4; const alpha = image.pixels[from + 3] / 255;
      for (let c = 0; c < 3; c++) pixels[at + c] = Math.round(image.pixels[from + c] * alpha + background[c] * (1 - alpha));
    }
  }
  return { width, height, pixels };
}

function main() {
  const icons = new Map([16, 32, 64, 128, 256, 512, 1024].map(size => [size, renderIcon(size)]));
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, 'app-icon.png'), png(icons.get(1024)));
  fs.writeFileSync(path.join(assets, 'app-icon-256.png'), png(icons.get(256)));
  const iconset = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'focus-islands-icon-')), 'app-icon.iconset');
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), png(icons.get(size)));
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), png(icons.get(size * 2)));
  }
  const built = spawnSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'app-icon.icns')], { stdio: 'inherit' });
  fs.rmSync(path.dirname(iconset), { recursive: true, force: true });
  if (built.status !== 0) throw new Error('iconutil could not build assets/app-icon.icns.');

  fs.mkdirSync(trayFolder, { recursive: true });
  const trays = {};
  for (const [name, night] of [['day', false], ['night', true]]) {
    trays[name] = [renderTray(night, 1), renderTray(night, 2)];
    fs.writeFileSync(path.join(trayFolder, `island-${name}.png`), png(trays[name][0]));
    fs.writeFileSync(path.join(trayFolder, `island-${name}@2x.png`), png(trays[name][1]));
  }

  if (process.argv.includes('--check')) {
    const check = path.join(root, '.build', 'icon-check');
    fs.mkdirSync(check, { recursive: true });
    fs.writeFileSync(path.join(check, 'icon-16-and-32.png'), png(checkSheet([icons.get(16), icons.get(32)], 8)));
    fs.writeFileSync(path.join(check, 'tray-1x.png'), png(checkSheet([trays.day[0], trays.night[0]], 12)));
    fs.writeFileSync(path.join(check, 'tray-2x.png'), png(checkSheet([trays.day[1], trays.night[1]], 6)));
    fs.writeFileSync(path.join(check, 'tray-actual.png'), png(checkSheet([trays.day[1], trays.night[1]], 1)));
    console.log(`Wrote check sheets to ${check}`);
  }
  console.log('Wrote assets/app-icon.png, assets/app-icon-256.png, assets/app-icon.icns and electron/tray/island-{day,night}{,@2x}.png');
}

main();
