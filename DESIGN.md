# DESIGN.md — ツール_無音カメラ

## 概要

iOS Safari で動作する無音カメラ PWA。
標準カメラアプリの強制シャッター音を回避するため、
`getUserMedia` + `canvas.toBlob()` によるフレームキャプチャ方式を採用。

---

## 技術スタック

| 項目 | 内容 |
|---|---|
| フロントエンド | HTML / CSS / Vanilla JS（フレームワークなし） |
| カメラ API | `navigator.mediaDevices.getUserMedia` |
| 写真キャプチャ | `canvas.drawImage(video)` → `toBlob()` |
| 動画録画 | `MediaRecorder API` |
| フラッシュ | `MediaTrackConstraints.torch` |
| ズーム | `MediaTrackConstraints.zoom` + CSS transform fallback |
| 明るさ | `canvas ctx.filter` + CSS filter（プレビュー） |
| 共有 | `navigator.share()` (Web Share API) |
| PWA | `manifest.json` + Service Worker |
| サーバー | 不要（静的ファイルのみ） |

---

## 機能要件

| 機能 | 実装方法 |
|---|---|
| 無音撮影 | canvas フレームキャプチャ（OS シャッター音非発火） |
| インカメ/アウトカメ切替 | `facingMode` 切替 + ストリーム再取得 |
| フラッシュ ON/OFF | `torch` constraint（非対応端末は自動無効化） |
| 動画録画 | MediaRecorder（mp4 / webm 自動判定） |
| 連写 | シャッター長押し 0.5秒後に 400ms 間隔で連続キャプチャ |
| タイマー | OFF / 3s / 5s / 10s トグル、カウントダウン表示 |
| ズーム | ピンチ操作 + スライダー（hardware zoom → CSS fallback） |
| 明るさ調整 | スライダー（0.5〜2.0）、canvas フィルタに反映 |
| グリッド表示 | canvas 3×3 オーバーレイ ON/OFF |
| 撮影後共有 | Web Share API（files）→ fallback: download |
| PWA | ホーム画面追加、オフライン対応（Service Worker） |

---

## ファイル構成

```
ツール_無音カメラ/
├── DESIGN.md
├── index.html          ← メイン画面
├── manifest.json       ← PWA 設定
├── sw.js               ← Service Worker
├── css/
│   └── style.css
├── js/
│   └── app.js
└── icons/
    └── icon.svg
```

---

## 画面レイアウト

### カメラ画面

```
┌─────────────────────┐
│ [⚡] [⏱] [⊞]       │  ← 上部バー（フラッシュ / タイマー / グリッド）
│                     │
│                     │
│    カメラ映像        │  ← フルスクリーン video
│   [グリッドON時]     │
│                     │
│ ☀ ━━━●━━━  明るさ   │  ← 右端スライダー
│ 🔍 ━━━●━━━  ズーム   │
│                     │
├─────────────────────┤
│ [サムネイル] [○撮影] [↺フリップ] │  ← 下部バー
│             [● 動画]            │
└─────────────────────┘
```

### プレビュー画面

```
┌─────────────────────┐
│      [← 撮り直し]   │
│                     │
│   撮影した写真/動画  │
│                     │
│      [↑ 共有]       │
└─────────────────────┘
```

---

## 動作環境

- **主ターゲット**: iOS Safari（iPhone）
- iOS 14.3 以上推奨（MediaRecorder 対応バージョン）
- HTTPS またはローカルファイル（`file://`）で動作
- Android Chrome でも動作確認済み想定

---

## 重要な実装ノート

1. **前面カメラ撮影時の左右反転**
   `facingMode: 'user'` の場合、canvas に描画する際に `ctx.scale(-1, 1)` で水平反転する（ミラー表示と一致させるため）

2. **torch 非対応端末の扱い**
   `track.getCapabilities().torch` が falsy の場合、フラッシュボタンを半透明＋タップ無効にする

3. **ズームの優先順位**
   hardware zoom（`zoom` constraint）が使えない場合は CSS `transform: scale()` にフォールバックする。CSS zoom は canvas キャプチャには反映されない点に注意

4. **明るさの canvas 反映**
   CSS filter はプレビューのみ。実際の保存画像には `ctx.filter = brightness(n)` を適用してから `drawImage` する

5. **Service Worker キャッシュ戦略**
   Cache First（全静的アセット）。更新時はキャッシュバスティングなし（手動更新）
