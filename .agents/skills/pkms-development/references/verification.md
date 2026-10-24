# 検証手順

コマンドはリポジトリrootから実行する。Nodeのバージョンは `.nvmrc` と `package.json`、pnpmは `packageManager` に合わせ、`corepack pnpm` を使う。依存関係がなければ `corepack pnpm install --frozen-lockfile`。

## コード変更の基準

```sh
corepack pnpm check
corepack pnpm build
```

`check` はformat → typecheck → lint → Vitestの順。workspaceの型・distを先に更新しないと、型付きlintやworkspace packageのテストが古い出力を参照する。変更箇所のテストで問題を絞り、最後にこの共通チェックとbuildを通す。

HTTP/MCPのテストはlocalhostでlistenする。sandboxの `listen EPERM` はテスト不合格の代わりに無視せず、必要な権限でその検証を再実行する。Electronの `SIGABRT` も権限・実行環境を確認する。

## 操作の実行確認

変更した操作を既存のbrowser harnessに追加・拡張して確認する。DOMやキーボード・フォーカス・スクロールはVitestのstateテストだけでは確認できない。

| 変更領域 | 実行コマンド |
| --- | --- |
| Markdown、本文検索、表編集 | `corepack pnpm --filter @pkm/desktop smoke:markdown-editor` |
| Entity別Timeline、関連範囲、Context付き入力 | `corepack pnpm --filter @pkm/desktop smoke:entry-timeline` |
| タブ切替とスクロール復元 | `corepack pnpm --filter @pkm/desktop smoke:page-scroll` |
| Electron起動・native addon・終了／再起動 | build後に `corepack pnpm --filter @pkm/desktop smoke:electron` |

狭い画面の挙動を変更した場合は、共通runnerの `--mobile` も使う。例:

```sh
corepack pnpm --filter @pkm/desktop exec electron markdown-editor-smoke.cjs --entry-timeline --mobile
```

必要ならスクリーンショットや実画面でも確認する。Electron lifecycleの検証は一時Vaultを使う既存runnerに任せる。

## Node / ElectronのSQLite ABI

`better-sqlite3` はNodeとElectronでABIが違う。同じ依存ディレクトリを両方のrebuildで同時に変更しない。

- Nodeのcheck/test前にElectron向けbinaryが残っていれば `corepack pnpm rebuild better-sqlite3` で戻す。
- `smoke:electron` はElectron向けrebuildを含む。単独でnative/renderer検証する場合は先に `corepack pnpm --filter @pkm/desktop rebuild:electron-native`。
- Electron検証・配布物生成が終わった後は、失敗時もNode向けに戻す。配布済みアプリ内のbinaryには影響しない。

検証失敗で原因が修正可能なら直す。権限・外部認証・正常終了のキャンセル等で完了不能なら、既存アプリと作業内容を保持し、その段階と必要な対応を報告する。同じ失敗を無条件に繰り返さない。
