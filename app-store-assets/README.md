# App Storeスクリーンショット素材

## 元画像の配置

iPhoneで撮影した未加工のPNGを、次の名前で `source` フォルダへ配置します。

1. `01-photo.png` — 写真モードの通常画面
2. `02-video.png` — 動画モードの通常画面
3. `03-ratio.png` — 画角変更画面
4. `04-controls.png` — 明るさ・ズーム調整画面
5. `05-save-share.png` — 撮影後の保存・共有画面

赤枠、書き込み、通知、個人情報が入った画像は使用しません。

## 生成

リポジトリ直下で次を実行します。

```powershell
node scripts/generate-app-store-screenshots.js
```

`output` にApp Store用の縦画像（1320 × 2868 PNG）が生成されます。

## 掲載コピー

| # | コピー |
|---|---|
| 1 | マナーモードで／静かに撮影 |
| 2 | 写真も動画も／これひとつ |
| 3 | シーンに合わせて／画角を選択 |
| 4 | 明るさとズームを／直感的に調整 |
| 5 | 撮ったらすぐに／保存・共有 |

デザイン方針は [DESIGN_PHILOSOPHY.md](DESIGN_PHILOSOPHY.md) を参照します。
