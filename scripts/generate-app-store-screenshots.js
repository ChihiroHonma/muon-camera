'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'app-store-assets', 'composited');
const outputDir = path.join(root, 'app-store-assets', 'output');

const WIDTH = 1320;
const HEIGHT = 2868;
const SCREEN_X = 130;
const SCREEN_Y = 530;
const SCREEN_W = 1060;
const SCREEN_H = 2250;
const RADIUS = 72;

const pages = [
  { file: '01-photo.png', output: '01-photo.png', line1: 'マナーモードで', line2: '静かに撮影', marker: '01 / PHOTO' },
  { file: '02-video.png', output: '02-video.png', line1: '写真も動画も', line2: 'これひとつ', marker: '02 / VIDEO' },
  { file: '03-ratio.png', output: '03-ratio.png', line1: 'シーンに合わせて', line2: '画角を選択', marker: '03 / FRAME' },
  { file: '04-controls.png', output: '04-controls.png', line1: '明るさとズームを', line2: '直感的に調整', marker: '04 / CONTROL' },
  { file: '05-save-share.png', output: '05-save-share.png', line1: '撮ったらすぐに', line2: '保存・共有', marker: '05 / SHARE' }
];

function escapeXml(value) {
  return value.replace(/[<>&'\"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]));
}

function backgroundSvg(page) {
  return Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#050505"/>
          <stop offset="0.62" stop-color="#101010"/>
          <stop offset="1" stop-color="#050505"/>
        </linearGradient>
      </defs>
      <rect width="1320" height="2868" fill="url(#bg)"/>
      <circle cx="1116" cy="160" r="7" fill="#ff3b30"/>
      <path d="M1116 128V78 M1084 160h-50" stroke="#ff3b30" stroke-width="2" opacity="0.55"/>
      <text x="130" y="104" fill="#8b8b8f" font-family="Arial, sans-serif" font-size="25" letter-spacing="5">ZERO CAMERA</text>
      <text x="1190" y="104" fill="#8b8b8f" font-family="Arial, sans-serif" font-size="20" text-anchor="end" letter-spacing="3">${escapeXml(page.marker)}</text>
      <text x="130" y="240" fill="#ffffff" font-family="Yu Gothic, Hiragino Sans, sans-serif" font-size="78" font-weight="700">${escapeXml(page.line1)}</text>
      <text x="130" y="346" fill="#ffffff" font-family="Yu Gothic, Hiragino Sans, sans-serif" font-size="78" font-weight="700">${escapeXml(page.line2)}</text>
      <rect x="130" y="410" width="92" height="7" rx="3.5" fill="#ff3b30"/>
      <rect x="${SCREEN_X - 2}" y="${SCREEN_Y - 2}" width="${SCREEN_W + 4}" height="${SCREEN_H + 4}" rx="${RADIUS + 2}" fill="#242424" stroke="#3a3a3c" stroke-width="3"/>
    </svg>`);
}

function roundedMask() {
  return Buffer.from(`<svg width="${SCREEN_W}" height="${SCREEN_H}" xmlns="http://www.w3.org/2000/svg"><rect width="${SCREEN_W}" height="${SCREEN_H}" rx="${RADIUS}" fill="white"/></svg>`);
}

async function generate(page) {
  const input = path.join(sourceDir, page.file);
  if (!fs.existsSync(input)) {
    console.log(`SKIP ${page.file}: source image is missing`);
    return false;
  }

  const screen = await sharp(input)
    .resize(SCREEN_W, SCREEN_H, { fit: 'cover', position: 'centre' })
    .composite([{ input: roundedMask(), blend: 'dest-in' }])
    .png()
    .toBuffer();

  await sharp(backgroundSvg(page))
    .composite([{ input: screen, left: SCREEN_X, top: SCREEN_Y }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, page.output));

  console.log(`CREATED ${page.output}`);
  return true;
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const results = await Promise.all(pages.map(generate));
  const count = results.filter(Boolean).length;
  console.log(`Done: ${count}/${pages.length} screenshots generated at ${outputDir}`);
  if (count === 0) process.exitCode = 2;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
