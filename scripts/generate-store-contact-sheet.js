'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const inputDir = path.join(root, 'app-store-assets', 'output');
const output = path.join(root, 'app-store-assets', 'review', 'store-screenshots-contact-sheet.png');
const files = ['01-photo.png', '02-video.png', '03-ratio.png', '04-controls.png', '05-save-share.png'];
const labels = ['01 PHOTO', '02 VIDEO', '03 RATIO', '04 CONTROL', '05 SAVE + SHARE'];

(async () => {
  const width = 2500;
  const height = 1500;
  const cardW = 430;
  const cardH = 934;
  const gap = 45;
  const startX = 95;
  const top = 260;
  const layers = [];

  for (let i = 0; i < files.length; i++) {
    const input = path.join(inputDir, files[i]);
    if (!fs.existsSync(input)) throw new Error(`Missing ${input}`);
    const thumb = await sharp(input).resize(cardW, cardH, { fit: 'fill' }).png().toBuffer();
    const left = startX + i * (cardW + gap);
    layers.push({ input: thumb, left, top });
    const label = Buffer.from(`<svg width="${cardW}" height="55" xmlns="http://www.w3.org/2000/svg"><text x="${cardW / 2}" y="34" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="3">${labels[i]}</text></svg>`);
    layers.push({ input: label, left, top: top + cardH + 28 });
  }

  const bg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#080808"/><text x="95" y="105" fill="#fff" font-family="Arial, sans-serif" font-size="48" font-weight="700" letter-spacing="5">ZERO CAMERA / STORE SCREENSHOTS</text><text x="95" y="165" fill="#8e8e93" font-family="Arial, sans-serif" font-size="26" letter-spacing="2">REVIEW DRAFT — NOT FOR SUBMISSION</text><circle cx="2355" cy="95" r="9" fill="#ff3b30"/><path d="M2305 95h-70M2355 48v-30" stroke="#ff3b30" stroke-width="3" opacity=".65"/></svg>`);
  await sharp(bg).composite(layers).png({ compressionLevel: 9 }).toFile(output);
  console.log(output);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
