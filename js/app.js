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

// ── DOM ────────────────────────────────────────────────
const video          = document.getElementById('video');
const captureCanvas  = document.getElementById('capture-canvas');
const gridCanvas     = document.getElementById('grid-canvas');
const countdownEl    = document.getElementById('countdown-display');
const toast          = document.getElementById('toast');

const flashBtn       = document.getElementById('flash-btn');
const timerBtn       = document.getElementById('timer-btn');
const gridBtn        = document.getElementById('grid-btn');
const brightnessSlider = document.getElementById('brightness-slider');
const zoomSlider     = document.getElementById('zoom-slider');
const shutterBtn     = document.getElementById('shutter-btn');
const flipBtn        = document.getElementById('flip-btn');
const videoBtn       = document.getElementById('video-btn');
const thumbnailBtn   = document.getElementById('thumbnail-btn');
const thumbnailImg   = document.getElementById('thumbnail-img');

const cameraScreen   = document.getElementById('camera-screen');
const previewScreen  = document.getElementById('preview-screen');
const previewImage   = document.getElementById('preview-image');
const previewVideo   = document.getElementById('preview-video');
const shareBtn       = document.getElementById('share-btn');
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

  } catch (err) {
    console.error(err);
    showToast('カメラへのアクセスが許可されていません');
  }
}

// ── Photo capture (silent) ─────────────────────────────

function capturePhoto() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;

  captureCanvas.width  = w;
  captureCanvas.height = h;
  const ctx = captureCanvas.getContext('2d');

  ctx.save();
  ctx.filter = `brightness(${brightnessValue})`;

  // Flip back front camera (CSS mirrors preview but canvas must match)
  if (currentFacing === 'user') {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  captureCanvas.toBlob(blob => {
    setCapture('photo', blob, 'image/jpeg');
    showPreview();
    flashShutter();
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

// ── Burst mode ─────────────────────────────────────────

shutterBtn.addEventListener('pointerdown', () => {
  if (isRecording) return;
  burstTimer = setTimeout(() => {
    isBurst = true;
    shutterBtn.classList.add('burst-mode');
    capturePhoto(); // immediate first shot
    burstInterval = setInterval(capturePhoto, 400);
  }, 600);
});

shutterBtn.addEventListener('pointerup', () => {
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
const viewfinder = document.getElementById('viewfinder');
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

window.addEventListener('resize', () => { if (gridVisible) drawGrid(); });

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
  videoBtn.classList.add('recording');
  videoBtn.querySelector('.label').textContent = '停止';
}

function stopRecording() {
  mediaRecorder.stop();
  isRecording = false;
  videoBtn.classList.remove('recording');
  videoBtn.querySelector('.label').textContent = '動画';
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

// ── Share ──────────────────────────────────────────────

shareBtn.addEventListener('click', async () => {
  if (!capturedBlob) return;
  const ext  = capturedType === 'photo' ? 'jpg' : (capturedMime?.includes('webm') ? 'webm' : 'mp4');
  const fileName = `photo_${Date.now()}.${ext}`;
  const file = new File([capturedBlob], fileName, { type: capturedMime });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '無音カメラ' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  // Fallback: download
  const a = document.createElement('a');
  a.href = capturedUrl;
  a.download = fileName;
  a.click();
  showToast('ダウンロードしました');
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

flashBtn.addEventListener('click', toggleFlash);
timerBtn.addEventListener('click', cycleTimer);
gridBtn.addEventListener('click', toggleGrid);
flipBtn.addEventListener('click', flipCamera);
videoBtn.addEventListener('click', toggleRecording);

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
