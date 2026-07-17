'use strict';

// ── State ──────────────────────────────────────────────
let stream = null;
let currentFacing = 'environment';
let flashOn = false;
let flashSupported = false;
let timerValue = 0;           // 0 / 3 / 5 / 10
let gridVisible = false;
let brightnessValue = 1.0;    // 0.5 – 2.0
let zoomValue = 1.0;
let zoomMin = 1.0;
let zoomMax = 5.0;
let hwZoomSupported = false;
let currentMode = 'photo';  // 'photo' | 'video'
let currentRatio = '1-1'; // '1-1' | '3-4' | '9-16' | 'full'
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];
let capturedBlob = null;
let capturedType = null;      // 'photo' | 'video'
let capturedMime = null;
let capturedUrl = null;
let burstTimer = null;
let burstInterval = null;
let isBurst = false;
let countdownTimer = null;
let recordingTimer = null;
let recordingSeconds = 0;

// ── DOM ────────────────────────────────────────────────
const video          = document.getElementById('video');
const captureCanvas  = document.getElementById('capture-canvas');
const gridCanvas     = document.getElementById('grid-canvas');
const countdownEl    = document.getElementById('countdown-display');
const toast          = document.getElementById('toast');

const ratioBtn       = document.getElementById('ratio-btn');
const ratioBox       = document.getElementById('ratio-box');
const viewfinder     = document.getElementById('viewfinder');
const flashBtn       = document.getElementById('flash-btn');
const timerBtn       = document.getElementById('timer-btn');
const gridBtn        = document.getElementById('grid-btn');
const brightnessSlider = document.getElementById('brightness-slider');
const zoomSlider     = document.getElementById('zoom-slider');
const shutterBtn     = document.getElementById('shutter-btn');
const shutterIcon    = document.getElementById('shutter-icon');
const flipBtn        = document.getElementById('flip-btn');
const thumbnailBtn   = document.getElementById('thumbnail-btn');
const thumbnailImg   = document.getElementById('thumbnail-img');

// ── Native plugins (iOS only) ───────────────────────────
// ネイティブアプリ実行時のみ有効。Web版では何もしない（従来通りの挙動にフォールバック）。
const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const ShutterSound = isNativeApp ? window.Capacitor.registerPlugin('ShutterSound') : null;
const PhotoSaver   = isNativeApp ? window.Capacitor.registerPlugin('PhotoSaver')   : null;

function playShutterSound() {
  if (ShutterSound) ShutterSound.play().catch(() => {});
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const recordingIndicator = document.getElementById('recording-indicator');
const recordingTimeEl    = document.getElementById('recording-time');

const cameraScreen   = document.getElementById('camera-screen');
const previewScreen  = document.getElementById('preview-screen');
const previewImage   = document.getElementById('preview-image');
const previewVideo   = document.getElementById('preview-video');
const shareBtn       = document.getElementById('share-btn');
const saveBtn        = document.getElementById('save-btn');
const retakeBtn      = document.getElementById('retake-btn');

// ── Camera init ────────────────────────────────────────

async function initCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  const constraints = {
    video: {
      facingMode: currentFacing,
      width:  { ideal: 3840 },
      height: { ideal: 2160 }
    },
    audio: false
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;

    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};

    // Flash
    flashSupported = !!caps.torch;
    flashBtn.classList.toggle('disabled', !flashSupported);
    if (!flashSupported && flashOn) {
      flashOn = false;
      flashBtn.classList.remove('active');
    }

    // Hardware zoom
    if (caps.zoom) {
      hwZoomSupported = true;
      zoomMin = caps.zoom.min || 1;
      zoomMax = Math.min(caps.zoom.max || 5, 10);
      zoomSlider.min   = zoomMin;
      zoomSlider.max   = zoomMax;
      zoomSlider.step  = 0.1;
      zoomSlider.value = zoomMin;
      zoomValue = zoomMin;
    } else {
      hwZoomSupported = false;
      zoomSlider.min   = 1;
      zoomSlider.max   = 5;
      zoomSlider.step  = 0.1;
      zoomSlider.value = 1;
      zoomValue = 1;
    }

    // Mirror front camera
    video.style.transform = currentFacing === 'user' ? 'scaleX(-1)' : '';

    // Apply ratio box after stream layout settles
    requestAnimationFrame(applyRatioBox);

  } catch (err) {
    console.error(err);
    showToast('カメラへのアクセスが許可されていません');
  }
}

// ── Photo capture (silent) ─────────────────────────────

function capturePhoto() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  // Crop to selected aspect ratio
  const RATIO_MAP = { '1-1': 1, '3-4': 3/4, '9-16': 9/16 };
  let cropW = vw, cropH = vh;

  if (currentRatio !== 'full') {
    const target = RATIO_MAP[currentRatio];
    if (target > vw / vh) {
      cropW = vw;
      cropH = Math.round(vw / target);
    } else {
      cropH = vh;
      cropW = Math.round(vh * target);
    }
  }

  const sx = Math.round((vw - cropW) / 2);
  const sy = Math.round((vh - cropH) / 2);

  captureCanvas.width  = cropW;
  captureCanvas.height = cropH;
  const ctx = captureCanvas.getContext('2d');

  ctx.save();
  ctx.filter = `brightness(${brightnessValue})`;

  if (currentFacing === 'user') {
    ctx.translate(cropW, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
  ctx.restore();

  captureCanvas.toBlob(blob => {
    setCapture('photo', blob, 'image/jpeg');
    showPreview();
    flashShutter();
    playShutterSound();
  }, 'image/jpeg', 0.95);
}

function flashShutter() {
  const flash = document.getElementById('shutter-flash');
  flash.style.opacity = '0.6';
  setTimeout(() => { flash.style.opacity = '0'; }, 80);
}

// ── Flash ──────────────────────────────────────────────

async function toggleFlash() {
  if (!flashSupported) {
    showToast('このデバイスはフラッシュに非対応です');
    return;
  }
  flashOn = !flashOn;
  flashBtn.classList.toggle('active', flashOn);
  const track = stream.getVideoTracks()[0];
  try {
    await track.applyConstraints({ advanced: [{ torch: flashOn }] });
  } catch (e) {
    showToast('フラッシュの切り替えに失敗しました');
    flashOn = !flashOn;
    flashBtn.classList.toggle('active', flashOn);
  }
}

// ── Camera flip ────────────────────────────────────────

async function flipCamera() {
  // Turn off flash before switching
  if (flashOn) {
    flashOn = false;
    flashBtn.classList.remove('active');
    try {
      const track = stream?.getVideoTracks()[0];
      if (track) await track.applyConstraints({ advanced: [{ torch: false }] });
    } catch (_) {}
  }
  currentFacing = currentFacing === 'environment' ? 'user' : 'environment';
  await initCamera();
}

// ── Timer ──────────────────────────────────────────────

const TIMER_CYCLE = [0, 3, 5, 10];

function cycleTimer() {
  const idx = TIMER_CYCLE.indexOf(timerValue);
  timerValue = TIMER_CYCLE[(idx + 1) % TIMER_CYCLE.length];
  timerBtn.querySelector('.label').textContent = timerValue === 0 ? 'タイマー' : `${timerValue}s`;
  timerBtn.classList.toggle('active', timerValue !== 0);
}

function shootWithTimer() {
  if (timerValue === 0) {
    capturePhoto();
    return;
  }
  let remaining = timerValue;
  countdownEl.textContent = remaining;
  countdownEl.style.display = 'flex';

  countdownTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      countdownEl.style.display = 'none';
      capturePhoto();
    } else {
      countdownEl.textContent = remaining;
    }
  }, 1000);
}

// ── Shutter UI ─────────────────────────────────────────

const ICON_PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="#1a1a1a"/>
  <circle cx="12" cy="13" r="4" fill="rgba(255,255,255,0.6)"/>
  <circle cx="12" cy="13" r="2.4" fill="none" stroke="#1a1a1a" stroke-width="1"/>
</svg>`;

const ICON_VIDEO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
  <rect x="1" y="5" width="14" height="14" rx="2.5" fill="#fff"/>
  <polygon points="16,8.5 23,6 23,18 16,15.5" fill="#fff"/>
</svg>`;

const ICON_STOP = `<svg viewBox="0 0 24 24" width="28" height="28">
  <rect x="5" y="5" width="14" height="14" rx="3" fill="#fff"/>
</svg>`;

function updateShutterUI() {
  if (currentMode === 'photo') {
    shutterBtn.classList.remove('video-mode');
    shutterIcon.innerHTML = ICON_PHOTO;
  } else {
    shutterBtn.classList.add('video-mode');
    shutterIcon.innerHTML = isRecording ? ICON_STOP : ICON_VIDEO;
  }
}

// ── Mode switcher ──────────────────────────────────────

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === currentMode) return;
    if (isRecording) stopRecording();
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    updateShutterUI();
  });
});

// ── Burst mode ─────────────────────────────────────────

shutterBtn.addEventListener('pointerdown', () => {
  if (currentMode === 'video') return;
  if (isRecording) return;
  burstTimer = setTimeout(() => {
    isBurst = true;
    shutterBtn.classList.add('burst-mode');
    capturePhoto();
    burstInterval = setInterval(capturePhoto, 400);
  }, 600);
});

shutterBtn.addEventListener('pointerup', () => {
  if (currentMode === 'video') {
    toggleRecording();
    return;
  }
  clearTimeout(burstTimer);
  if (isBurst) {
    clearInterval(burstInterval);
    shutterBtn.classList.remove('burst-mode');
    isBurst = false;
  } else {
    if (!isRecording) shootWithTimer();
  }
});

shutterBtn.addEventListener('pointercancel', () => {
  if (currentMode === 'video') return;
  clearTimeout(burstTimer);
  clearInterval(burstInterval);
  shutterBtn.classList.remove('burst-mode');
  isBurst = false;
});

// ── Zoom ───────────────────────────────────────────────

zoomSlider.addEventListener('input', () => {
  zoomValue = parseFloat(zoomSlider.value);
  applyZoom(zoomValue);
});

async function applyZoom(val) {
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  if (hwZoomSupported) {
    try {
      await track.applyConstraints({ advanced: [{ zoom: val }] });
      return;
    } catch (_) {}
  }
  // CSS fallback (does NOT affect canvas capture)
  const origin = currentFacing === 'user' ? 'right center' : 'center';
  video.style.transformOrigin = origin;
  video.style.transform = `${currentFacing === 'user' ? 'scaleX(-1) ' : ''}scale(${val})`;
}

// Pinch zoom
let pinchStart = 0;
let zoomAtPinchStart = 1;

viewfinder.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    // スライダー操作中はピンチズームを発火させない
    if (e.target.tagName === 'INPUT') return;
    pinchStart = pinchDist(e.touches);
    zoomAtPinchStart = zoomValue;
    e.preventDefault();
  }
}, { passive: false });

viewfinder.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    const dist = pinchDist(e.touches);
    const scale = dist / pinchStart;
    const newZoom = Math.min(parseFloat(zoomSlider.max), Math.max(parseFloat(zoomSlider.min), zoomAtPinchStart * scale));
    zoomValue = newZoom;
    zoomSlider.value = newZoom;
    applyZoom(newZoom);
    e.preventDefault();
  }
}, { passive: false });

function pinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Brightness ─────────────────────────────────────────

brightnessSlider.addEventListener('input', () => {
  brightnessValue = parseFloat(brightnessSlider.value);
  video.style.filter = `brightness(${brightnessValue})`;
});

// ── Grid ───────────────────────────────────────────────

function toggleGrid() {
  gridVisible = !gridVisible;
  gridBtn.classList.toggle('active', gridVisible);
  gridCanvas.style.display = gridVisible ? 'block' : 'none';
  if (gridVisible) drawGrid();
}

function drawGrid() {
  const w = gridCanvas.offsetWidth;
  const h = gridCanvas.offsetHeight;
  if (!w || !h) return;
  gridCanvas.width  = w;
  gridCanvas.height = h;
  const ctx = gridCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(w * i / 3, 0); ctx.lineTo(w * i / 3, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, h * i / 3); ctx.lineTo(w, h * i / 3); ctx.stroke();
  }
}

window.addEventListener('resize', () => {
  if (gridVisible) drawGrid();
  applyRatioBox();
});

// ── Video recording ────────────────────────────────────

function toggleRecording() {
  isRecording ? stopRecording() : startRecording();
}

function startRecording() {
  recordedChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType });
  } catch (_) {
    mediaRecorder = new MediaRecorder(stream);
  }
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const mime = mediaRecorder.mimeType || mimeType;
    const blob = new Blob(recordedChunks, { type: mime });
    setCapture('video', blob, mime);
    showPreview();
  };
  mediaRecorder.start(200);
  isRecording = true;
  updateShutterUI();
  startRecordingIndicator();
}

function stopRecording() {
  mediaRecorder.stop();
  isRecording = false;
  updateShutterUI();
  stopRecordingIndicator();
}

// ── Recording indicator (視覚的な記録中表示) ───────────

function startRecordingIndicator() {
  recordingSeconds = 0;
  recordingTimeEl.textContent = '00:00';
  recordingIndicator.classList.remove('hidden');
  recordingTimer = setInterval(() => {
    recordingSeconds++;
    const m = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
    const s = String(recordingSeconds % 60).padStart(2, '0');
    recordingTimeEl.textContent = `${m}:${s}`;
  }, 1000);
}

function stopRecordingIndicator() {
  clearInterval(recordingTimer);
  recordingIndicator.classList.add('hidden');
}

// ── Capture management ─────────────────────────────────

function setCapture(type, blob, mime) {
  if (capturedUrl) URL.revokeObjectURL(capturedUrl);
  capturedBlob = blob;
  capturedType = type;
  capturedMime = mime || (type === 'photo' ? 'image/jpeg' : 'video/mp4');
  capturedUrl = URL.createObjectURL(blob);

  // Thumbnail
  if (type === 'photo') {
    thumbnailImg.src = capturedUrl;
    thumbnailImg.classList.add('visible');
    thumbnailBtn.dataset.type = 'photo';
  } else {
    thumbnailImg.classList.remove('visible');
    thumbnailImg.src = '';
    thumbnailBtn.dataset.type = 'video';
  }
}

// ── Preview ────────────────────────────────────────────

function showPreview() {
  cameraScreen.classList.add('hidden');
  previewScreen.classList.remove('hidden');

  if (capturedType === 'photo') {
    previewImage.src = capturedUrl;
    previewImage.classList.add('visible');
    previewVideo.classList.remove('visible');
    previewVideo.pause();
  } else {
    previewVideo.src = capturedUrl;
    previewVideo.classList.add('visible');
    previewImage.classList.remove('visible');
    previewVideo.loop = true;
    previewVideo.muted = true;
    previewVideo.play().catch(() => {});
  }
}

thumbnailBtn.addEventListener('click', () => {
  if (capturedUrl) showPreview();
});

// ── 共通：ファイル生成・ダウンロード ───────────────────

function fallbackDownload(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast('ダウンロードしました');
}

function buildFile() {
  const ext = capturedType === 'photo' ? 'jpg' : (capturedMime?.includes('webm') ? 'webm' : 'mp4');
  const fileName = `photo_${Date.now()}.${ext}`;
  return new File([capturedBlob], fileName, { type: capturedMime });
}

// ── 保存 ───────────────────────────────────────────────

saveBtn.addEventListener('click', async () => {
  if (!capturedBlob) return;

  // ネイティブアプリ環境：共有シートを介さず直接フォトライブラリに保存
  if (PhotoSaver) {
    try {
      const base64 = await blobToBase64(capturedBlob);
      await PhotoSaver.save({ data: base64, type: capturedType });
      showToast('写真ライブラリに保存しました');
    } catch (e) {
      showToast('保存に失敗しました');
    }
    return;
  }

  const file = buildFile();
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // ① File 共有 API（iOS 15+ / Android Chrome）
  const canShareFiles = navigator.canShare && (() => {
    try { return navigator.canShare({ files: [file] }); } catch (_) { return false; }
  })();

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }

  // ② iOS フォールバック：新タブで画像を開き長押し保存を案内
  if (isIOS) {
    window.open(capturedUrl, '_blank');
    showToast('画像を長押し →「写真に追加」で保存');
    return;
  }

  // ③ Android / Desktop：ダウンロード
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast('ダウンロードしました');
});

// ── 共有 ───────────────────────────────────────────────

shareBtn.addEventListener('click', async () => {
  if (!capturedBlob) return;
  const file = buildFile();

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '無音カメラ' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  fallbackDownload(file);
});

// ── Retake ─────────────────────────────────────────────

retakeBtn.addEventListener('click', () => {
  previewVideo.pause();
  previewScreen.classList.add('hidden');
  cameraScreen.classList.remove('hidden');
});

// ── Toast ──────────────────────────────────────────────

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Event bindings ─────────────────────────────────────

// ── Aspect ratio ───────────────────────────────────────

const RATIO_CYCLE  = ['1-1', '3-4', '9-16', 'full'];
const RATIO_LABELS = { '1-1': '1:1', '3-4': '3:4', '9-16': '9:16', 'full': '□' };
const RATIO_VALUES = { '1-1': 1/1, '3-4': 3/4, '9-16': 9/16 };

function applyRatioBox() {
  // Full mode: viewfinder covers entire screen, bars become overlays
  if (currentRatio === 'full') {
    cameraScreen.classList.add('ratio-full');
    ratioBox.style.width  = '100%';
    ratioBox.style.height = '100%';
    return;
  }

  cameraScreen.classList.remove('ratio-full');

  const vfW = viewfinder.offsetWidth;
  const vfH = viewfinder.offsetHeight;
  if (!vfW || !vfH) return;

  const target = RATIO_VALUES[currentRatio];
  const testH  = vfW / target;
  let boxW, boxH;
  if (testH <= vfH) {
    boxW = vfW;
    boxH = Math.round(testH);
  } else {
    boxH = vfH;
    boxW = Math.round(vfH * target);
  }

  ratioBox.style.width  = boxW + 'px';
  ratioBox.style.height = boxH + 'px';
}

function cycleRatio() {
  const idx = RATIO_CYCLE.indexOf(currentRatio);
  currentRatio = RATIO_CYCLE[(idx + 1) % RATIO_CYCLE.length];
  ratioBtn.querySelector('.ratio-label').textContent = RATIO_LABELS[currentRatio];
  applyRatioBox();
}

ratioBtn.addEventListener('click', cycleRatio);

flashBtn.addEventListener('click', toggleFlash);
timerBtn.addEventListener('click', cycleTimer);
gridBtn.addEventListener('click', toggleGrid);
flipBtn.addEventListener('click', flipCamera);

// Prevent default scroll/zoom on viewfinder
viewfinder.addEventListener('touchmove', e => {
  if (e.touches.length >= 2) e.preventDefault();
}, { passive: false });

// ── PWA install ────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.error);
}

// ── Start ──────────────────────────────────────────────

initCamera();
// Apply initial ratio box size after first layout paint
requestAnimationFrame(() => requestAnimationFrame(applyRatioBox));
