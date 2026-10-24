# UIコマンドとキー割り当て

更新日: 2026-10-14

`packages/ui/src/app-commands.ts`が共通操作の定義、`use-app-commands.ts`が実行とキー入力の振り分け、
`app-settings-dialog.tsx`が設定画面を担当する。Web / Desktopの各アプリが実行処理を登録する。
本文編集はCodeMirrorに残す。外観設定は[外観設定](appearance-settings.md)を参照する。

## 共通インターフェース

- `CommandDefinition`: 安定したID、表示名、カテゴリ、適用範囲、既定キー、保存前の入力確定。
- `AppCommandId`: `APP_COMMANDS`から導出する操作ID。IDは設定の保存キーでもある。
- `CommandHandler`: `run`と任意の`isEnabled`。`run`は同期・非同期の両方に対応する。
- `CommandHandlers`: 操作IDと実行処理の対応。処理の未登録・実行条件不成立では実行しない。
- `AppCommands`: `execute`、`keys`、`label`、`setKeys`、`reset`。エラーは各アプリの`onError`へ渡す。

```tsx
const commands = useAppCommands({
  enabled: ready && !modalOpen,
  onError: showError,
  handlers: {
    "document.save": { run: save, isEnabled: () => writable },
    "quickOpen.open": { run: () => setQuickOpen(true) },
  },
});

<Button onClick={() => commands.execute("document.save")}>保存</Button>
```

UIコマンドは画面上の操作であり、Vaultの読み書きを表す`contracts/application.ts`の操作とは分離する。
コマンドを追加するときは`APP_COMMANDS`に定義を追加し、各アプリのhookへ実行処理を登録する。
設定画面には定義から自動で行が追加される。現在の対応は引数なしの操作のみで、
対象Entity ID等を必要とする個別のボタンを一律にコマンドへ移すことはしない。

## キーの解決と実行条件

キーは`Mod+Shift+Enter`のような文字列。`Mod`はMacではMeta、それ以外ではCtrl。
キーは`KeyboardEvent.key`を使うため文字配列に従う。修飾キーの組合せは完全一致とする。
文字キー単独・Shiftと文字キーのみは通常入力を保護するため禁止し、ファンクションキー単独は許可する。
複数キーの連続入力によるコードや、OS全体のグローバルホットキーは扱わない。

`workspace`は入力欄でも動作し、`navigation`は入力欄・contenteditable以外で動作する。
両scopeは入力欄の外で重なるため、同じキーへの割り当ては競合として拒否する。
CodeMirrorや他の入力UIが`preventDefault`したイベント、IME変換中、モーダル中は処理しない。
押し続けによる反復実行も止める。壊れた保存値などで複数操作に一致した場合は実行順で選ばず中止する。

保存ではプロパティ入力をblurし、次のフレームで最新の処理を呼び、従来の確定・保存動作を維持する。
実行条件はボタン・キーボード双方で確認する。未保存の保護は引き続き既存の保存・タブ処理が担当する。
本文検索・太字・Undoなどの既存編集キーは共通操作へ割り当てできない。

## 設定の保存と拡張

localStorageの`pkm:app-settings:v1`に次の形式で保存する。Vault間で共通、Web / Desktopでは別の設定。

```json
{
  "version": 1,
  "keybindings": {
    "quickOpen.open": ["Mod+j"],
    "tab.close": []
  }
}
```

キーが欠けている操作はその時点の既定値、空配列は明示的な解除。操作には複数のキーを持てるが、
現在のUIでの記録は1つへ置換する。不正なJSON・未知versionは既定値へ戻し、未知の操作IDや不正な項目は無視する。
保存できない場合はメモリ上の変更を維持して設定画面にエラーを表示する。

`AppSettingsSection`の`id / label / content`で設定カテゴリを追加できる。
Desktopでは「Vault・同期」のパネルにVault情報と同期設定フォームを直接表示する。
接続処理中は設定画面の閉じる操作とカテゴリ切替を停止する。カテゴリを離れると入力したAPI Keyは破棄する。
共通の「外観」カテゴリは`AppearanceSettingsPanel`で表示し、`AppearanceProvider`から端末設定を適用する。

## 検証

- `corepack pnpm exec vitest run packages/ui/src/app-commands.test.ts`
- `corepack pnpm --filter @pkm/desktop smoke:commands`
- `corepack pnpm --filter @pkm/desktop exec electron markdown-editor-smoke.cjs --commands --mobile --capture`

ブラウザー検証は一時的な設定キーのみを使う。実際にフォーカスを持つElectronウィンドウで、
blurによる入力確定、割り当て変更・復元・競合、再マウント後の保持、IME・モーダルの保護を確認する。
