// シャッター音(shutter.wav)をプログラムで合成する。
// 「カ」(絞り羽根の開放音、鋭い高域クリック)+「シャ」(シャッター幕の走行音、短いノイズ減衰)の2段構成。
'use strict';

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const DURATION_SEC = 0.14;
const numSamples = Math.floor(SAMPLE_RATE * DURATION_SEC);

function noise() {
  return Math.random() * 2 - 1;
}

// 一次IIRハイパスフィルタ(前サンプルとの差分)で低域を削り、クリック感を強調する
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

const raw = new Float32Array(numSamples);
const t1Start = 0;
const t1End = Math.floor(numSamples * 0.18);   // 「カ」: 鋭い立ち上がり、超高速減衰
const t2Start = Math.floor(numSamples * 0.22);
const t2End = numSamples;                      // 「シャ」: ノイズバースト、緩やかな減衰

for (let i = t1Start; i < t1End; i++) {
  const t = (i - t1Start) / (t1End - t1Start);
  const decay = Math.exp(-t * 18);
  raw[i] += noise() * decay * 0.9;
}

for (let i = t2Start; i < t2End; i++) {
  const t = (i - t2Start) / (t2End - t2Start);
  const decay = Math.exp(-t * 7);
  raw[i] += noise() * decay * 0.55;
}

const filtered = highpass(raw, 0.85);

// 正規化
let peak = 0;
for (let i = 0; i < filtered.length; i++) peak = Math.max(peak, Math.abs(filtered[i]));
const norm = peak > 0 ? 0.85 / peak : 1;

const pcm = new Int16Array(numSamples);
for (let i = 0; i < numSamples; i++) {
  const v = Math.max(-1, Math.min(1, filtered[i] * norm));
  pcm[i] = Math.round(v * 32767);
}

// WAVファイル(PCM 16bit mono)を書き出す
function writeWav(filePath, pcmData, sampleRate) {
  const byteRate = sampleRate * 2;
  const blockAlign = 2;
  const dataSize = pcmData.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);  // PCM
  buffer.writeUInt16LE(1, 22);  // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < pcmData.length; i++) {
    buffer.writeInt16LE(pcmData[i], 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
}

const outPath = path.join(__dirname, '..', 'ios', 'App', 'App', 'shutter.wav');
writeWav(outPath, pcm, SAMPLE_RATE);
console.log(`Generated: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
