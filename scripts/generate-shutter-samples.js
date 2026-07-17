// シャッター音のサンプルを5種類生成し、www/sound-samples/ に書き出す。
// ユーザーが試聴して選んだものを ios/App/App/shutter.wav として採用する。
'use strict';

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;

function noise() {
  return Math.random() * 2 - 1;
}

// 一次IIRハイパスフィルタ
function highpass(samples, alpha) {
  const out = new Float32Array(samples.length);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = alpha * (prevOut + x - prevIn);
    out[i] = y;
    prevIn = x;
    prevOut = y;
  }
  return out;
}

// 一次IIRローパスフィルタ
function lowpass(samples, alpha) {
  const out = new Float32Array(samples.length);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev = prev + alpha * (samples[i] - prev);
    out[i] = prev;
  }
  return out;
}

function addBurst(buf, startSec, durSec, decayRate, amp, sr) {
  const start = Math.floor(startSec * sr);
  const len = Math.floor(durSec * sr);
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / len;
    const decay = Math.exp(-t * decayRate);
    buf[start + i] += noise() * decay * amp;
  }
}

// 短いクリック（インパルス的、周期パルス列でメカ音の「カツン」感を出す）
function addMechClick(buf, startSec, freqHz, cycles, decayRate, amp, sr) {
  const start = Math.floor(startSec * sr);
  const period = sr / freqHz;
  const len = Math.floor(period * cycles);
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / len;
    const decay = Math.exp(-t * decayRate);
    const wave = Math.sign(Math.sin((2 * Math.PI * i) / period));
    buf[start + i] += wave * decay * amp * 0.5;
  }
}

function normalize(buf, target = 0.85) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  const norm = peak > 0 ? target / peak : 1;
  const pcm = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const v = Math.max(-1, Math.min(1, buf[i] * norm));
    pcm[i] = Math.round(v * 32767);
  }
  return pcm;
}

function writeWav(filePath, pcmData, sampleRate) {
  const byteRate = sampleRate * 2;
  const dataSize = pcmData.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcmData.length; i++) {
    buffer.writeInt16LE(pcmData[i], 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

const outDir = path.join(__dirname, '..', 'www', 'sound-samples');
fs.mkdirSync(outDir, { recursive: true });

// ── サンプル1: 一眼レフ風（ミラーアップ→シャッター→ミラーダウンの3段階、重厚） ──
{
  const dur = 0.22;
  const buf = new Float32Array(Math.floor(dur * SAMPLE_RATE));
  addMechClick(buf, 0.0, 180, 3, 25, 0.9, SAMPLE_RATE);   // ミラーアップ（低め）
  addBurst(buf, 0.02, 0.05, 12, 0.8, SAMPLE_RATE);         // シャッター幕
  addMechClick(buf, 0.11, 220, 3, 22, 0.7, SAMPLE_RATE);   // ミラーダウン
  const filtered = lowpass(highpass(buf, 0.55), 0.7);
  writeWav(path.join(outDir, 'sample1-dslr.wav'), normalize(filtered), SAMPLE_RATE);
}

// ── サンプル2: ミラーレス/スマホ風（シンプルな「カシャ」、軽い） ──
{
  const dur = 0.1;
  const buf = new Float32Array(Math.floor(dur * SAMPLE_RATE));
  addBurst(buf, 0.0, 0.02, 30, 0.9, SAMPLE_RATE);
  addBurst(buf, 0.015, 0.04, 15, 0.5, SAMPLE_RATE);
  const filtered = highpass(buf, 0.9);
  writeWav(path.join(outDir, 'sample2-mirrorless.wav'), normalize(filtered), SAMPLE_RATE);
}

// ── サンプル3: フィルムカメラ風（「カシャコン」、やや長めで巻き上げ感） ──
{
  const dur = 0.32;
  const buf = new Float32Array(Math.floor(dur * SAMPLE_RATE));
  addMechClick(buf, 0.0, 160, 4, 20, 0.85, SAMPLE_RATE);
  addBurst(buf, 0.03, 0.07, 10, 0.75, SAMPLE_RATE);
  addMechClick(buf, 0.16, 140, 5, 15, 0.6, SAMPLE_RATE);   // 巻き上げレバー的な余韻
  addBurst(buf, 0.2, 0.1, 8, 0.35, SAMPLE_RATE);
  const filtered = lowpass(highpass(buf, 0.5), 0.6);
  writeWav(path.join(outDir, 'sample3-film.wav'), normalize(filtered), SAMPLE_RATE);
}

// ── サンプル4: 高速シャッター風（非常に短く鋭い「タッ」） ──
{
  const dur = 0.05;
  const buf = new Float32Array(Math.floor(dur * SAMPLE_RATE));
  addBurst(buf, 0.0, 0.015, 45, 1.0, SAMPLE_RATE);
  const filtered = highpass(buf, 0.92);
  writeWav(path.join(outDir, 'sample4-fast.wav'), normalize(filtered), SAMPLE_RATE);
}

// ── サンプル5: ソフトシャッター風（柔らかめの「コトッ」、控えめ） ──
{
  const dur = 0.16;
  const buf = new Float32Array(Math.floor(dur * SAMPLE_RATE));
  addMechClick(buf, 0.0, 130, 3, 18, 0.6, SAMPLE_RATE);
  addBurst(buf, 0.02, 0.06, 14, 0.4, SAMPLE_RATE);
  const filtered = lowpass(highpass(buf, 0.4), 0.35);
  writeWav(path.join(outDir, 'sample5-soft.wav'), normalize(filtered), SAMPLE_RATE);
}

console.log('5 samples generated in', outDir);
