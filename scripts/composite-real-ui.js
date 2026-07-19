'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'app-store-assets', 'source');
const aiDir = path.join(root, 'app-store-assets', 'ai-backplates');
const outputDir = path.join(root, 'app-store-assets', 'composited');

// Coordinates measured from the supplied 553 x 1200 real iPhone screenshots.
const FRAME_W = 553;
const FRAME_H = 1200;
const PREVIEW = { left: 0, top: 289, width: 553, height: 552 };

const jobs = [
  {
    source: '01-photo.png',
    backplate: path.join('puppy', '01-sleep.png'),
    output: '01-photo.png'
  },
  {
    source: '02-video.png',
    backplate: path.join('puppy', '02-running.png'),
    output: '02-video.png'
  },
  {
    source: '01-photo.png',
    backplate: path.join('landscape', '04-mountain.png'),
    output: '04-controls.png'
  },
  {
    source: '03-ratio.png',
    backplate: path.join('green', '03-ratio.png'),
    output: '03-ratio.png',
    preview: { left: 62, top: 230, width: 428, height: 719 },
    preservePreviewUi: false
  },
  {
    source: '05-save-share.png',
    backplate: path.join('landscape', '05-cafe.png'),
    output: '05-save-share.png',
    preview: { left: 0, top: 0, width: 553, height: 1000 },
    preservePreviewUi: false,
    preserveStatusBar: true
  }
];

async function buildUiOverlay(sourcePath, previewRegion) {
  const preview = await sharp(sourcePath)
    .extract(previewRegion)
    .removeAlpha()
    .png()
    .toBuffer();

  // The supplied preview is black. Convert every non-black UI pixel into an
  // alpha mask so the genuine sliders/icons can sit over the AI photograph.
  const alpha = await sharp(preview)
    .greyscale()
    .threshold(12)
    .png()
    .toBuffer();

  return sharp(preview)
    .joinChannel(alpha)
    .png()
    .toBuffer();
}

async function composite(job) {
  const sourcePath = path.join(sourceDir, job.source);
  const backplatePath = path.join(aiDir, job.backplate);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing real UI source: ${sourcePath}`);
  if (!fs.existsSync(backplatePath)) throw new Error(`Missing AI backplate: ${backplatePath}`);

  const metadata = await sharp(sourcePath).metadata();
  if (metadata.width !== FRAME_W || metadata.height !== FRAME_H) {
    throw new Error(`${job.source} must be ${FRAME_W}x${FRAME_H}; got ${metadata.width}x${metadata.height}`);
  }

  const previewRegion = job.preview || PREVIEW;
  const photo = await sharp(backplatePath)
    .resize(previewRegion.width, previewRegion.height, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  const layers = [
    { input: photo, left: previewRegion.left, top: previewRegion.top }
  ];
  if (job.preservePreviewUi !== false) {
    const uiOverlay = await buildUiOverlay(sourcePath, previewRegion);
    layers.push({ input: uiOverlay, left: previewRegion.left, top: previewRegion.top });
  }
  if (job.preserveStatusBar) {
    // Status chrome is OS-owned rather than application UI. Rebuild it cleanly
    // so no pixels from the original photographed curtain leak into the result.
    const status = Buffer.from(`<svg width="553" height="82" xmlns="http://www.w3.org/2000/svg">
      <text x="55" y="52" fill="#fff" font-family="Arial, sans-serif" font-size="25" font-weight="700">19:54</text>
      <path d="M126 34l16-7-7 16-3-6z" fill="#fff"/>
      <rect x="187" y="13" width="180" height="58" rx="29" fill="#000"/>
      <circle cx="307" cy="42" r="5" fill="#34c759"/>
      <g fill="#fff"><rect x="397" y="43" width="5" height="9" rx="2"/><rect x="405" y="38" width="5" height="14" rx="2"/><rect x="413" y="33" width="5" height="19" rx="2"/><rect x="421" y="27" width="5" height="25" rx="2"/></g>
      <path d="M435 35q13-12 26 0M440 42q8-8 16 0M446 49q2-3 4 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
      <rect x="472" y="27" width="39" height="25" rx="7" fill="#fff"/>
      <rect x="512" y="34" width="4" height="11" rx="2" fill="#fff"/>
      <text x="491.5" y="46" fill="#333" font-family="Arial, sans-serif" font-size="16" font-weight="700" text-anchor="middle">82</text>
    </svg>`);
    layers.push({ input: status, left: 0, top: 0 });
  }

  await sharp(sourcePath)
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, job.output));
  console.log(`CREATED ${job.output}`);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const job of jobs) await composite(job);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
