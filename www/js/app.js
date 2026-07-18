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
const ShutterSound  = isNativeApp ? window.Capacitor.registerPlugin('ShutterSound')  : null;
const PhotoSaver    = isNativeApp ? window.Capacitor.registerPlugin('PhotoSaver')    : null;
const CameraPreview = isNativeApp ? window.Capacitor.registerPlugin('CameraPreview') : null;
const CapShare      = isNativeApp ? window.Capacitor.registerPlugin('Share')         : null;
// ネイティブ時はカメラをネイティブプレビュー(@capgo/camera-preview)で動かす。
// Web(PWA)時は従来通り getUserMedia を使う。
const useNativeCam = !!CameraPreview;

// ネイティブ録画の状態
let nativeCamStarted = false;
let nativeVideoPath = null;   // stopRecordVideoで得た動画ファイルパス(file://)
// 録画の状態機械: 'idle' | 'starting' | 'recording' | 'stopping'
// 開始/停止の非同期処理中の多重操作・状態競合を防ぐ。
let recState = 'idle';
let recFinalizedForCurrent = false;

function playShutterSound() {
  if (ShutterSound) ShutterSound.play().catch(() => {});
}

// ネイティブプレビューを撮影画面全体に敷く（UIは透過したWebViewが上に重なる）。
// width/height/x/y は省略しプラグインのフルスクリーン既定に任せる（座標のズレ回避）。
function nativeStartOptions() {
  return {
    position: currentFacing === 'user' ? 'front' : 'rear',
    toBack: true,           // HTML(UI)を前面、カメラプレビューを背面に
    disableAudio: false,    // 動画に音声を含めるためマイクも有効化
    storeToFile: false,     // capture()はbase64で返す（トリミングのため）
    enableHighResolution: true
    // enableVideoMode:true は写真撮影を壊す(反転・黒)ため使わない。
    // 録画中プレビューの暗転は既知の制約として扱う（録画自体は音声付きで成功）。
  };
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
  if (useNativeCam) {
    return initNativeCamera();
  }

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  const videoConstraints = {
    facingMode: currentFacing,
    width:  { ideal: 3840 },
    height: { ideal: 2160 }
  };

  try {
    // まず音声ありで取得を試みる（動画に音声を含めるため）。
    // マイク拒否や非対応の場合は映像のみで再取得し、カメラ自体は止めない。
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
    } catch (audioErr) {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    }
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

// ── Native camera (iOS: @capgo/camera-preview) ─────────

async function initNativeCamera() {
  // 既存プレビューを止めてから開始（切替時の二重起動を防ぐ）
  try { await CameraPreview.stop({ force: true }); } catch (_) {}
  nativeCamStarted = false;
  // 撮影画面の背面にネイティブプレビューを出すため、UI側を透過にする
  document.body.classList.add('native-cam');
  try {
    await CameraPreview.start(nativeStartOptions());
    nativeCamStarted = true;
    // フラッシュはネイティブで制御。既定OFF。
    flashSupported = true;
    flashBtn.classList.remove('disabled');
    // ズームは setZoom で制御。スライダー範囲を設定。
    hwZoomSupported = true;
    try {
      const z = await CameraPreview.getZoom();
      zoomMin = z.min ?? 1;
      zoomMax = Math.min(z.max ?? 5, 10);
    } catch (_) { zoomMin = 1; zoomMax = 5; }
    zoomSlider.min = zoomMin;
    zoomSlider.max = zoomMax;
    zoomSlider.step = 0.1;
    zoomSlider.value = zoomMin;
    zoomValue = zoomMin;
  } catch (err) {
    showToast('カメラの起動に失敗: ' + (err?.message || err), 8000);
  }
}

// ── Photo capture (silent) ─────────────────────────────

function capturePhoto() {
  if (useNativeCam) { captureNativePhoto(); return; }

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
    flashShutter();
    playShutterSound();
    // 連写中はプレビューへ遷移せずカメラ画面に留まる（最後の1枚のみ pointerup で表示）
    if (!isBurst) showPreview();
  }, 'image/jpeg', 0.95);
}

// ネイティブ撮影: プラグインcapture()のbase64を選択画角にトリミングして保存
async function captureNativePhoto() {
  try {
    // quality:100 は品質最大。プラグインの品質換算バグ(整数除算)があっても
    // 100/100=1で最高品質になり安全。
    const { value } = await CameraPreview.capture({ quality: 100 });
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const RATIO_MAP = { '1-1': 1, '3-4': 3 / 4, '9-16': 9 / 16 };
      let cropW = iw, cropH = ih;
      if (currentRatio !== 'full') {
        const target = RATIO_MAP[currentRatio];
        if (target > iw / ih) { cropW = iw; cropH = Math.round(iw / target); }
        else { cropH = ih; cropW = Math.round(ih * target); }
      }
      const sx = Math.round((iw - cropW) / 2);
      const sy = Math.round((ih - cropH) / 2);
      captureCanvas.width = cropW;
      captureCanvas.height = cropH;
      const ctx = captureCanvas.getContext('2d');
      // 前面カメラの左右反転はプラグイン側で処理済みのため、ここでは反転しない
      ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
      captureCanvas.toBlob(blob => {
        setCapture('photo', blob, 'image/jpeg');
        flashShutter();
        playShutterSound();
        if (!isBurst) showPreview();
      }, 'image/jpeg', 0.95);
    };
    img.onerror = () => showToast('撮影画像の読み込みに失敗しました');
    img.src = 'data:image/jpeg;base64,' + value;
  } catch (e) {
    showToast('撮影に失敗: ' + (e?.message || e), 6000);
  }
}

function flashShutter() {
  // ガイドライン2.5.14対応: 撮影(=記録)したことを視覚的に明示する。
  // マナーモード時は無音になるため、この白フラッシュが唯一の撮影通知になる。
  const flash = document.getElementById('shutter-flash');
  flash.style.opacity = '0.7';
  setTimeout(() => { flash.style.opacity = '0'; }, 150);
}

// ── Flash ──────────────────────────────────────────────

async function toggleFlash() {
  if (useNativeCam) {
    flashOn = !flashOn;
    flashBtn.classList.toggle('active', flashOn);
    try {
      // 写真は撮影時にフラッシュ発光、動画はtorch(常時点灯)が近い。
      // ここでは torch(点灯) / off をトグルする。
      await CameraPreview.setFlashMode({ flashMode: flashOn ? 'torch' : 'off' });
    } catch (e) {
      showToast('フラッシュの切り替えに失敗しました');
      flashOn = !flashOn;
      flashBtn.classList.toggle('active', flashOn);
    }
    return;
  }
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
    if (!useNativeCam) {
      try {
        const track = stream?.getVideoTracks()[0];
        if (track) await track.applyConstraints({ advanced: [{ torch: false }] });
      } catch (_) {}
    }
  }
  currentFacing = currentFacing === 'environment' ? 'user' : 'environment';

  if (useNativeCam) {
    try {
      await CameraPreview.flip();
    } catch (_) {
      // flipが使えない場合はプレビューを再起動して切替
      await initNativeCamera();
    }
    return;
  }
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
    if (useNativeCam) {
      // 録画の開始/録画中/停止処理中はモード切替を無効（開始中に切り替わる競合を防ぐ）。
      // 録画を止めたい場合はシャッターで停止してから切り替える。
      if (recState !== 'idle') return;
    } else {
      if (isRecording) stopRecording();
    }
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    updateShutterUI();
  });
});

// ── Burst mode ─────────────────────────────────────────

shutterBtn.addEventListener('pointerdown', () => {
  if (currentMode === 'video') return;
  if (isRecording) return;
  if (useNativeCam) return; // ネイティブのcapture()は非同期で連写に不向きなため連写は無効
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
    // 連写終了時に最後の1枚をプレビュー表示する
    if (capturedUrl) showPreview();
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
  if (useNativeCam) {
    try { await CameraPreview.setZoom({ level: val, ramp: false }); } catch (_) {}
    return;
  }
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
// ネイティブプレビューにはCSSフィルタをかけられないため明るさ調整は非対応。スライダーを隠す。
if (useNativeCam) {
  const bWrap = brightnessSlider.closest('.slider-wrap');
  if (bWrap) bWrap.style.display = 'none';
}

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

async function startRecording() {
  if (useNativeCam) {
    if (recState !== 'idle') return; // 開始/停止処理中の多重操作を防ぐ
    recState = 'starting';
    try {
      // disableAudio:false でマイクを含めて録画（@capgoが録画前にマイクを再取得する）
      await CameraPreview.startRecordVideo({ disableAudio: false });
      recState = 'recording';
      recFinalizedForCurrent = false;
      isRecording = true;
      updateShutterUI();
      startRecordingIndicator();
    } catch (e) {
      recState = 'idle';
      showToast('録画開始に失敗: ' + (e?.message || e), 6000);
    }
    return;
  }

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

async function stopRecording() {
  if (useNativeCam) {
    if (recState !== 'recording') return; // 録画中以外は無視（多重停止防止）
    recState = 'stopping';
    try {
      // 手動停止では戻り値とrecordingFinishedイベントの両方が発火する。
      // 戻り値をフォールバックの最終処理に使う（イベントが先なら二重処理はガードされる）。
      const res = await CameraPreview.stopRecordVideo();
      if (res && res.videoFilePath) onNativeRecordingFinished(res.videoFilePath);
    } catch (e) {
      // stopRecordVideoの拒否は「録画がエラー終了した」or「既に録画していない」を意味する
      // （recStateガードで多重停止は起きないため、録画継続中の拒否は実質発生しない）。
      // 録画中UIのまま固まらないよう、失敗として終了処理する。
      showToast('録画に失敗しました: ' + (e?.message || e), 6000);
      onNativeRecordingFinished(null);
    }
    return;
  }

  mediaRecorder.stop();
  isRecording = false;
  updateShutterUI();
  stopRecordingIndicator();
}

// ネイティブ録画の終了処理（手動停止・自動終了の両方を一元化）。
// recordingFinished イベントから呼ばれ、二重処理をガードする。
function onNativeRecordingFinished(path) {
  if (recFinalizedForCurrent) return;
  recFinalizedForCurrent = true;
  recState = 'idle';
  isRecording = false;
  updateShutterUI();
  stopRecordingIndicator();
  if (!path) { showToast('録画に失敗しました'); return; }
  if (capturedUrl && capturedBlob) URL.revokeObjectURL(capturedUrl);
  nativeVideoPath = path;
  capturedType = 'video';
  capturedMime = 'video/mp4';
  capturedBlob = null; // ネイティブ動画はファイルパスで扱う
  capturedUrl = (window.Capacitor && window.Capacitor.convertFileSrc)
    ? window.Capacitor.convertFileSrc(path)
    : path;
  thumbnailImg.classList.remove('visible');
  thumbnailImg.src = '';
  thumbnailBtn.dataset.type = 'video';
  showPreview();
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
  // ネイティブ動画はファイルパスで保存（base64を経由しないので大きい動画も安全）
  if (useNativeCam && capturedType === 'video' && nativeVideoPath) {
    try {
      await PhotoSaver.saveFile({ path: nativeVideoPath, type: 'video' });
      showToast('写真ライブラリに保存しました');
      returnToCamera();
    } catch (e) {
      showToast('保存に失敗: ' + (e?.message || e), 8000);
    }
    return;
  }

  if (!capturedBlob) return;

  // ネイティブアプリ環境：共有シートを介さず直接フォトライブラリに保存（写真）
  if (PhotoSaver) {
    try {
      const base64 = await blobToBase64(capturedBlob);
      await PhotoSaver.save({ data: base64, type: capturedType });
      showToast('写真ライブラリに保存しました');
      returnToCamera(); // 保存後は自動でカメラに戻る
    } catch (e) {
      showToast('保存に失敗: ' + (e?.message || e), 8000);
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
  // ネイティブ動画: ファイルパスを@capacitor/shareに渡す（動画をメモリに読み込まない）
  if (useNativeCam && capturedType === 'video' && nativeVideoPath && CapShare) {
    try {
      await CapShare.share({ title: 'ZERO Camera', files: [nativeVideoPath] });
      returnToCamera(); // 共有成功 → 一時ファイル削除してカメラへ戻る
    } catch (e) {
      // キャンセル・失敗時は動画を削除せずプレビューに留め、再共有/保存できるようにする。
      // キャンセルは無言、実エラーはトースト表示。
      const msg = ((e && e.message) || '') + '';
      if (!/cancel/i.test(msg)) showToast('共有に失敗しました', 4000);
    }
    return;
  }

  if (!capturedBlob) return;
  const ext = capturedType === 'photo' ? 'jpg' : 'mp4';
  const file = new File([capturedBlob], `zerocam_${Date.now()}.${ext}`, { type: capturedMime });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'ZERO Camera' });
      returnToCamera(); // 共有完了後は自動でカメラに戻る
      return;
    } catch (e) {
      if (e.name === 'AbortError') { returnToCamera(); return; }
    }
  }
  fallbackDownload(file);
});

// ── Retake / カメラ復帰 ────────────────────────────────

async function cleanupNativeVideo() {
  // 保存/共有/撮り直し後、録画一時ファイルを削除して蓄積を防ぐ
  const p = nativeVideoPath;
  if (!p) return;
  if (CameraPreview && CameraPreview.deleteFile) {
    try {
      await CameraPreview.deleteFile({ path: p });
      nativeVideoPath = null; // 削除成功時のみ参照をクリア
    } catch (_) {
      // 削除失敗時は参照を保持し次回returnToCamera時に再試行できるようにする
      // （次の録画でonNativeRecordingFinishedが上書きするため蓄積は最小限）。
    }
  } else {
    nativeVideoPath = null;
  }
}

async function returnToCamera() {
  previewVideo.pause();
  previewVideo.removeAttribute('src');
  previewScreen.classList.add('hidden');
  cameraScreen.classList.remove('hidden');

  if (useNativeCam) {
    // プレビューで参照していた録画一時ファイルを削除
    await cleanupNativeVideo();
    // ネイティブプレビューはプレビュー画面表示中も背面で動き続けているが、
    // 念のため停止していたら再起動する。
    try {
      const s = await CameraPreview.isRunning();
      if (!s?.isRunning) await initNativeCamera();
    } catch (_) { await initNativeCamera(); }
    return;
  }

  // 保存/共有中にiOSのシステムダイアログや共有シートが出ると、
  // getUserMediaの映像トラックが停止して画面が真っ暗になることがある。
  // トラックが生きていれば再生を再開、停止していれば再取得する。
  const track = stream && stream.getVideoTracks()[0];
  if (track && track.readyState === 'live') {
    video.play().catch(() => {});
  } else {
    initCamera();
  }
}

retakeBtn.addEventListener('click', returnToCamera);

// ── Toast ──────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, duration = 2500) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
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
// Service Worker は Web(PWA)版のオフライン対応専用。
// ネイティブアプリ(Capacitor)ではアセットをローカルから読むため不要で、
// むしろ Cache First がアプリ更新後も古いJS/CSSを配信し続けるリスクがあるため登録しない。
if (!isNativeApp && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.error);
}

// ── Start ──────────────────────────────────────────────

// ネイティブ録画の自動終了(maxDuration/OS割り込み等)や手動停止を一元処理するため、
// recordingFinished イベントを1回だけ購読する。
if (useNativeCam && CameraPreview.addListener) {
  CameraPreview.addListener('recordingFinished', (data) => {
    onNativeRecordingFinished(data && data.videoFilePath);
  });
}

initCamera();
// Apply initial ratio box size after first layout paint
requestAnimationFrame(() => requestAnimationFrame(applyRatioBox));
