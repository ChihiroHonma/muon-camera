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
   Cache First（全静的アセット）。CSS/JS/HTML を変更したら必ず `sw.js` の `CACHE_NAME` バージョンをインクリメントする。
   現行バージョン: `silent-camera-v10`

---

## やらかしやすいミス集

### M1. `const` の二重宣言 → JS全体がサイレントクラッシュ

同じ変数名（例: `const viewfinder`）をファイル内の2カ所で宣言すると `SyntaxError` になり
JSファイル全体が読み込まれなくなる。カメラが映らない・ボタンが反応しない症状が出る。

対処: 変数名で全文検索して重複を確認する。

---

### M2. `#ratio-box` に初期 CSS サイズがないとカメラが映らない

`ratio-box` の `width/height` を JS で後から設定する設計の場合、
CSS 側にデフォルト値がないと初期レンダリングで `0×0` になる。
`<video>` に `width:100%; height:100%` を指定しても親が `0×0` なら何も映らない。

対処:
```css
#ratio-box {
  width: 100%;
  height: 100%;
  /* JS が上書きするまでのデフォルト */
}
```

---

### M3. iOS Safari で CSS `aspect-ratio` が flex 子要素に効かない

`display:flex` の子要素に `aspect-ratio` を指定しても iOS Safari では無視される既知バグ。
映像が潰れたり消えたりする。

対処: `aspect-ratio` を使わず、JS 側で `offsetWidth/offsetHeight` を計算して
`style.width` / `style.height` をピクセル値で直接セットする。

---

### M4. `applyRatioBox()` を呼ぶタイミング

`requestAnimationFrame` で呼んでも、その時点で `viewfinder.offsetWidth === 0` なら
早期 `return` して `ratio-box` が永久に `0×0` のままになる。

対処:
- CSS にデフォルトサイズを入れておく（M2 参照）
- `initCamera()` 内でストリーム設定後に `requestAnimationFrame(applyRatioBox)` を呼ぶ
- フルモード時は `classList.add('ratio-full')` で CSS 側に委ねる

---

### M5. 関数を削除したのに呼び出しが残っていると無言クラッシュ

リファクタ時に `fallbackDownload()` などの関数を削除しても、
イベントリスナー内に呼び出しが残っているとボタンタップ時に `ReferenceError` でクラッシュ。

対処: 関数を削除するときは呼び出し箇所も同時に検索して修正する。

---

### M6. フルスクリーンモードのレイアウト崩れ

`#viewfinder` を `position: absolute; inset: 0` にして flex フローから外すと、
`#bottom-bar` が `#top-bar` の直下に詰まってしまう。

対処: フルモード時は `#bottom-bar` にも `position: absolute; bottom: 0` を付与する。

```css
#camera-screen.ratio-full #viewfinder  { position: absolute; inset: 0; z-index: 0; flex: none; }
#camera-screen.ratio-full #top-bar     { position: relative; z-index: 10; }
#camera-screen.ratio-full #bottom-bar  { position: absolute; bottom: 0; left: 0; right: 0; z-index: 10; }
```

---

### M7. SVG アイコンで絵文字を置き換えるときのポイント

フラッシュボタンを `⚡` 絵文字から SVG に変更した際の注意点。

**色の継承**
`fill="currentColor"` を SVG に付けることで、親の `.icon-btn` のテキスト色（白 / active 時は黄）を自動で引き継ぐ。
`fill="#fff"` のように固定色にすると、active 時の黄色変化が効かなくなる。

**SVG 内の描画順序**
SVG は後に書いた要素が上に重なる。斜線（strike-through）をボルトの上に見せたい場合は
ボルトの `<path>` → 斜線の `<line>` の順に書く。逆にすると斜線がボルトの下に隠れる。

**CSS での子要素の表示切替**
SVG の子要素（`<line>` など）は `display: none` で非表示にできる。
```css
/* OFF 時（デフォルト）: 斜線あり */
.flash-strike { display: block; }

/* ON 時（.active 付与時）: 斜線なし */
#flash-btn.active .flash-strike { display: none; }
```

**状態管理の参照先**
フラッシュ ON/OFF は `app.js` の `flashOn` 変数で管理。
ON になると `flashBtn.classList.add('active')` が呼ばれる。
CSS は `.active` の有無だけ見ればよい。OFF がデフォルト（クラスなし）なので
「斜線を見せる = デフォルト状態」と覚えると迷わない。

**斜線の向き**
iOS カメラに合わせて左下 → 右上（`x1=3,y1=21` → `x2=21,y2=3`）とした。
左上 → 右下（`\` 方向）にしたい場合は `x1=3,y1=3` → `x2=21,y2=21`。

---

## 承認・認証について

このアプリはブラウザ内で完結しており OAuth やサーバー認証は一切ない。
GAS のようなトークン切れは発生しない。
必要な「許可」はデバイスのカメラ権限のみ（一度許可すれば維持される）。

URL を共有するだけで誰でもログイン不要で利用可能。

---

## Phase 2: App Store 公開（要件定義）2026-07-14

### 概要・背景

現状の PWA（Web公開）から一歩進め、iOS ネイティブアプリとして App Store で
一般公開する。

**重要な前提**：無音カメラは Apple の審査でリジェクトされやすい機能。
事前調査により以下が判明した。

- 実際にリジェクトされた事例（[8bitブログ](https://blog.8bit.co.jp/?p=20658)）：
  「常時・無条件で無音」というコンセプトのまま再申請した結果、
  ガイドライン 2.5.14（記録中であることをユーザーに視覚/音声で明示する義務）違反、
  および Apple から「Silence camera concept is not appropriate under Japanese law」
  という明確な指摘を受けてリジェクトされた（迷惑防止条例抵触懸念）。
- 実際に公開されているアプリの傾向（断定はできないが、複数事例から見える傾向）：
  国内開発者・法人名義のアプリ（[Capera](https://apps.apple.com/jp/app/%E7%84%A1%E9%9F%B3%E3%82%AB%E3%83%A1%E3%83%A9-capera/id887166306)、
  [CAMERA0](https://apps.apple.com/jp/app/camera0-%E7%84%A1%E9%9F%B3%E9%AB%98%E7%94%BB%E8%B3%AA%E3%83%9E%E3%83%8A%E3%83%BC%E3%82%AB%E3%83%A1%E3%83%A9%E3%82%A2%E3%83%97%E3%83%AA/id1444755520)、
  [StageCameraHD](https://apps.apple.com/jp/app/stagecamerahd-%E9%AB%98%E7%94%BB%E8%B3%AA%E3%83%9E%E3%83%8A%E3%83%BC-%E3%82%AB%E3%83%A1%E3%83%A9/id912177018)）は
  軒並み「マナーモード連動方式」（端末がマナーモードの時のみ無音、通常時はシャッター音あり）を
  採用している。「常時無音」を明確に謳うのは海外開発者のアプリのみだった。

→ **本アプリもマナーモード連動方式に仕様変更する**方針で合意（ユーザー承認済み）。

### 機能要件（追加・変更分）

| 項目 | 内容 |
|---|---|
| プラットフォーム化 | 既存 PWA（HTML/CSS/JS）を Capacitor でラップし iOS ネイティブアプリ化 |
| 無音仕様の変更 | 常時無音 → **マナーモード連動方式**。技術方針：撮影時にネイティブプラグイン（Swift）経由で `AudioServicesPlaySystemSound`（システムのシャッター音相当のサウンドID）を呼び出す。このAPIはサイレントスイッチ ON 時は自動的に鳴らず、OFF（通常時）は鳴るという OS 側の挙動を利用する想定。**これは技術的仮説であり、実機・実装での検証が必須**（確実に動作する保証はまだない） |
| ガイドライン 2.5.14 対応 | 「記録中であることを視覚的に示す」要件があるため、撮影中/録画中インジケーターの有無を実装時に確認し、必要なら追加する |
| 権限説明文 | `Info.plist` に `NSCameraUsageDescription` / `NSMicrophoneUsageDescription`（動画機能があるため）/ `NSPhotoLibraryAddUsageDescription` を追加 |

### 非機能要件・構成・料金

| 項目 | 内容 | 料金 |
|---|---|---|
| ネイティブラップ | Capacitor（`@capacitor/core` + `@capacitor/ios`） | 無料 |
| ビルド環境 | Codemagic（GitHub リポジトリ `ChihiroHonma/muon-camera` と連携、Mac 不要） | 無料枠：月500分（小規模アプリなら収まる見込み） |
| Apple Developer Program | **Individual（本人名・ローマ字表記）**で登録 | **年間 $99（必須）** |
| プライバシーポリシー | GitHub Pages でホスティング（提案） | 無料 |
| アイコン | 既存 `icons/icon.svg` から各サイズの PNG を生成 | 無料 |

補足：Individual 登録では App Store 上の開発者名（Seller name）が
Apple Account 登録時のローマ字本名で表示される（複数の実例報告に基づく、
公式一次情報での確定ではない点に留意）。屋号表示が必要になった場合は
将来的に Organization（法人）登録への切り替えも可能（D-U-N-S 番号取得が必要）。

### 実装順序

1. Capacitor プロジェクト化（`www/` 構成への整理、iOS platform 追加）
2. マナーモード連動の無音撮影ネイティブプラグイン実装・実機相当の検証
3. 撮影中インジケーター等、審査ガイドライン対応の実装
4. Info.plist・アイコン・スクリーンショット等メタデータ整備
5. Apple Developer Program 登録（Individual）
6. Codemagic でビルド設定・TestFlight 配布・動作検証
7. App Store 審査提出
