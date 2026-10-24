# PKM 技術構成

更新日: 2026-10-13
状態: package.json・実行コードに基づく採用済み構成。初期の候補比較はGit履歴へ残す。

Mac + Web、Markdown原文を保持するライブ編集、既存部品の再利用を優先する。
採用した製品とPKMが担う処理を以下に分ける。バージョンは各package.jsonとpnpm-lock.yamlが正本。

| 領域           | 採用済み                                          | 選定理由・PKMの責務                                                                   |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Desktop        | Electron                                          | NodeのVault操作をmainへ置き、rendererへ型付きIPCを公開する                            |
| 言語・build    | TypeScript、pnpm workspace、Vite                  | core・contracts・UIをDesktopとWebで共有する                                           |
| UI             | React、Mantine                                    | 画面・入力・ダイアログを再利用する                                                    |
| 本文編集       | CodeMirror 6、codemirror-live-markdown            | 本文原文を編集状態として持ち、Direct Reference、表セル、検索、IME等を拡張する         |
| 本文解析・表示 | unified / remark、react-markdown、KaTeX           | GFM・参照・Todoの解析とMarkdown・数式表示を行う                                       |
| frontmatter    | yaml Document API、Zod                            | 既知field検証と未知fieldの保持を分離する                                              |
| 保存・監視     | write-file-atomic、Chokidar                       | atomic writeと変更通知を使い、PKM側でhash・draft・競合を確認する                      |
| SQLite・検索   | better-sqlite3、FTS5                              | Entity・scope・Todoの投影、trigramと1〜2文字専用索引を構成する                        |
| Web API        | Fastify、HTTP / SSE                               | 同じLocalVaultServiceへ接続し、ページ取得・通知・圧縮・304を提供する                  |
| Webキャッシュ  | 独自request/page cache、IndexedDB、Service Worker | query要求を共有し、取得済みpageと静的shellを保持する。APIのオフライン編集は提供しない |
| 同期           | 外部Syncthing                                     | ファイル転送を再利用し、PKM側でpeer登録・除外規則・競合解決を接続する                 |
| MCP            | 公式server / client / node / fastify SDK、jose    | 専用listener・bridge・JWT検証とAgent操作のadapterを実装する                           |
| macOS配布      | mac-package.ts、ditto / sips / codesign / hdiutil | Contextory.app・DMGを生成し、ad-hoc署名とSQLite・DMG検証を行う                               |
| 検証           | Vitest、Electron / Chromium harness               | fixture・service・adapterと実renderer操作を確認する                                   |

TanStack Query、Electron Forge、@codemirror/mergeを採用済みとして記述しない。
競合UIは既存の共通比較・手動編集画面を使う。Playwrightを初期計画の必須runnerとしない。
履歴用Git Snapshot、Memory、Embeddingは未実装で、[Roadmap](future-roadmap.md)の候補とする。

## 実装の参照先

- [UIの依存](../packages/ui/package.json)、[MCPの依存](../packages/mcp/package.json)、[Desktopの依存と配布コマンド](../apps/desktop/package.json)
- [Serializer](../packages/core/src/markdown-serializer.ts)、[派生index](../packages/storage-node/src/index-database.ts)、[保存](../packages/storage-node/src/vault-store.ts)
- [Web page cache](../apps/web/src/entity-page-cache.ts)、[Service Worker](../apps/web/src/service-worker.ts)、[macOS配布実装](../apps/desktop/src/mac-package.ts)

責務と依存方向は[architecture](architecture.md)、セットアップは[server-setup](server-setup.md)、
Node / ElectronのSQLite ABIと検証は[開発スキル](../.agents/skills/pkms-development/SKILL.md)を参照する。
