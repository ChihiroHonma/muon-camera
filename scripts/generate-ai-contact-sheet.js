'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const assetsRoot = path.join(root, 'app-store-assets', 'ai-backplates');
const output = path.join(root, 'app-store-assets', 'review', 'ai-backplates-contact-sheet.png');

const groups = [
  {
    title: 'A / GREEN STILL LIFE',
    dir: 'green',
    files: ['01-photo.png', '02-video.png', '03-ratio.png', '04-controls.png', '05-result.png']
  },
  {
    title: 'B / LANDSCAPE + OBJECT',
    dir: 'landscape',
    files: ['01-coast.png', '02-waves.png', '03-architecture.png', '04-mountain.png', '05-cafe.png']
  },
  {
    title: 'C / TOY POODLE PUPPY',
    dir: 'puppy',
    files: ['01-sleep.png', '02-running.png', '03-square.png', '04-closeup.png', '05-result.png']
  }
];

const WIDTH = 2700;
const HEIGHT = 2920;
const MARGIN_X = 100;
const TOP = 180;
const ROW_H = 900;
const CELL_W = 480;
const GAP = 20;
const IMAGE_W = 440;
const IMAGE_H = 700;

function svgText(text, width, height, size, color = '#ffffff', align = 'left') {
  const x = align === 'center' ? width / 2 : 0;
  const anchor = align === 'center' ? 'middle' : 'start';
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><text x="${x}" y="${Math.round(size * 1.05)}" fill="${color}" font-family="Arial, sans-serif" font-size="${size}" font-weight="700" text-anchor="${anchor}" letter-spacing="3">${text}</text></svg>`);
}

(async () => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const layers = [];
  layers.push({ input: svgText('ZERO CAMERA / AI BACKPLATE REVIEW', 2000, 80, 48), left: MARGIN_X, top: 60 });

  for (let row = 0; row < groups.length; row++) {
    const group = groups[row];
    const rowTop = TOP + row * ROW_H;
    layers.push({ input: svgText(group.title, 1200, 55, 30, '#9a9a9f'), left: MARGIN_X, top: rowTop });

    for (let col = 0; col < group.files.length; col++) {
      const file = group.files[col];
      const input = path.join(assetsRoot, group.dir, file);
      if (!fs.existsSync(input)) throw new Error(`Missing ${input}`);
      const thumb = await sharp(input)
        .resize(IMAGE_W, IMAGE_H, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer();
      const left = MARGIN_X + col * (CELL_W + GAP) + 20;
      layers.push({ input: thumb, left, top: rowTop + 80 });
      layers.push({ input: svgText(`${group.dir.toUpperCase()} ${col + 1}`, IMAGE_W, 45, 23, '#ffffff', 'center'), left, top: rowTop + 795 });
    }
  }

  const background = Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#090909"/><circle cx="2520" cy="88" r="9" fill="#ff3b30"/><path d="M2470 88h-75M2520 40v-30" stroke="#ff3b30" stroke-width="3" opacity=".65"/></svg>`);
  await sharp(background).composite(layers).png({ compressionLevel: 9 }).toFile(output);
  console.log(output);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
