# 外観設定

更新日: 2026-10-14

Web / Desktopのヘッダーの歯車 →「外観」で設定する。変更はすぐに反映し、
Vaultと分離した端末のlocalStorageに保存する。WebとDesktopの設定はそれぞれ独立する。

| 設定 | 範囲 | 初期値 |
| --- | --- | --- |
| カラーモード | OSに合わせる／ライト／ダーク | OSに合わせる |
| 本文の文字サイズ | 12〜24px、1px刻み | 16px |
| UIの文字サイズ | 12〜18px、1px刻み | 14px |
| 見出しを色分け | オン／オフ | オフ |
| 見出しをコンパクトに表示 | オン／オフ | オフ |

本文サイズはLive編集、Raw、本文表示、Timeline、Quick Captureで共通。
スマホの編集欄は、入力時の自動ズームを避けるため16px以上とし、本文表示は指定どおりのサイズにする。
UIサイズはメニュー・表・設定等の文字と操作部品を比例して調整し、本文サイズには影響させない。
見出しの色分けとコンパクト表示はLive編集と本文表示へ適用する。RawはMarkdownのソース表示を維持する。
「外観を初期値に戻す」は外観だけを初期化し、キー割り当てやVault設定は変更しない。

## 実装

- `packages/ui/src/appearance.ts`: 型、既定値、保存値の検証、OS追従時の色の決定。
- `appearance-provider.tsx`: 端末設定の読込み・更新、OSの明暗変更の監視、CSS変数とMantineへの接続。
- `appearance-settings-panel.tsx`: 設定フォームと本文プレビュー。
- `compact.css`: 本文サイズ、見出しの大きさ・色・余白、エディタの明暗対応。

`AppearanceProvider`をWeb / Desktopのルートに置く。カラーモードはOSの`prefers-color-scheme`と
ユーザーの選択から決めてMantineへ渡す。UIサイズはdocument rootのrem倍率、本文サイズは独立したpx変数。
固定pxで記述されているUI文字には`--pkm-ui-font-scale`を適用する。
見出しはh1〜h6とCodeMirrorの対応する装飾に同じCSS変数を使い、ATXとSetextの両方を扱う。
外観の変更ではEditorView・本文・Undo履歴を再作成しない。

保存キーは`pkm:appearance:v1`。形式は以下。

```json
{
  "version": 1,
  "colorScheme": "auto",
  "bodyFontSize": 16,
  "uiFontSize": 14,
  "headingColors": false,
  "compactHeadings": false
}
```

未知version・不正JSONは既定値に戻す。不正な項目は項目単位で既定値を使い、未知項目は無視する。
保存できない場合はメモリ上の変更を維持して設定画面に通知する。
同じWeb originの別タブで変更された設定もstorageイベントで反映する。

## 検証

- `corepack pnpm exec vitest run packages/ui/src/appearance.test.ts`
- `corepack pnpm --filter @pkm/desktop smoke:appearance`
- `corepack pnpm --filter @pkm/desktop exec electron markdown-editor-smoke.cjs --appearance --mobile --capture`

ブラウザー検証は専用の一時設定キーを使い、利用中の設定へ書き込まない。
本文／UIサイズの分離、フォームからの変更、全見出しの明暗時のコントラスト、OS追従、保存復元、
保存失敗時の通知、本文・選択・Undo保持、最大UIサイズでの横はみ出しをElectronで確認する。
