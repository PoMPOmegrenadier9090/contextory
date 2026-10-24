# 現在の実装状況

更新日: 2026-10-13

全体方針は[現在設計](pkm-current-design-v3.md)、責務と保存境界は[architecture](architecture.md)、
未実装項目の計画は[Roadmap](future-roadmap.md)を参照する。

## 実装済み

| 領域             | 利用できる機能                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 保存基盤         | Markdown正本、schema検証、未知frontmatter保持、hash競合検知、atomic write、差分索引と再構築                                          |
| Entity           | 6種別の作成・プロパティ編集、Topic同時作成、TaskのProject / Area所属、Entry以外の一行description                                     |
| ナビゲーション   | Home階層、種別ごとの表、pin、戻る・進む、親Entityへの移動                                                                            |
| タブ             | Web / Desktop共通のページタブ、Entity再open時の既存タブ再利用、背景タブ、新規Home、close、ドラッグ並べ替え。モバイルでは一画面遷移   |
| 本文編集         | Live / Raw、Direct Reference補完・遷移、リスト・チェックリスト、表のセル編集・行列追加・セル内改行、数式、HTML貼付け変換、本文検索とUndo / Redo              |
| Quick Capture    | メモとTodo、任意タイトル、Context検索、添付、端末ローカル入力保持、画面内・ダイアログからの入力                                      |
| Timeline / Daily | 作成日時順リスト、journal_date指定、月カレンダーと日別件数、選択日の期限Task、TodoありEntryの絞り込み                                |
| Entity関連       | 非Entryの詳細 / Timeline、直接 / 配下Entry、代表経路、構造化関連の直接 / 推移query                                                   |
| Task期限         | 日付・時刻と終日の編集、解除、期限順ソート、期限切れ・今日・7日間・期限あり/なしfilter                                               |
| 検索             | Vault横断Quick Open、名前優先ranking、snippet・階層、recent / pin、短い日本語の専用FTS                                               |
| Web取得          | SQL filter / sort / cursor、候補lazy検索、includedラベル、query別失効、共有requestの中止、page cache、圧縮・ETag、静的PWA cache      |
| Todo             | Entry本文の項目索引、完了状態・Context filter、50件ページング、hash / draftを確認したチェック保存                                    |
| Resource・添付   | 複数著者と検索・sort、Area / Project / Task / Resourceへの複数関連、主ファイル1件、画像・任意ファイル、確認付き孤立asset削除         |
| 削除・同期       | 論理削除、設定内のゴミ箱・単体非cascade復元・完全削除、Syncthing設定・状態、競合コピーの検出・両版比較・解決                                           |
| MCP              | 読取・Project context・Backlinks・引用search/fetch、全6種Entityの作成/更新、topics/context変更、添付upload、事前Validation、期間検索 |
| MCP接続          | server専用HTTP、Desktop同一process host、stdio bridge、Bearer、JWT OAuth Resource Server、OpenAI tunnel launcher                     |
| 配布             | macOS Contextory.app / DMGの生成、ad-hoc署名・SQLite / DMG検証、Docker Composeでのserver運用                                                |

## 実装上の制限

- Entryタイトルはfrontmatterの任意title。H1から自動生成しない。Todoは独立Taskへ自動変換しない。
- WebのEntity編集・手動競合draftはVault別のlocalStorage。serverのdraft DB・HTTP draft endpointは持たない。DesktopはSQLite draftを維持する。
- Web一覧・Timeline・ゴミ箱・関連表は既定50件。Desktopの一般一覧は全件取得が残るが、Entity別Entry表 / TimelineとTodoは共通のページqueryを使う。
- 一覧は本文なし。Timeline previewは1件1,200文字・ページ128 KiB上限。省略本文でTodo編集せず、全文は詳細で取得する。
- 作成/更新/発生/期限日時とjournal_dateの範囲queryは実装済み。保存View向けの汎用property operator・設定UIは未実装。
- タブとEntity表示 / 範囲はアプリのセッション内で保持し、再起動 / Webリロード後のタブ復元を行わない。Desktopの非表示Entityエディタは保持する。Webの未保存確認とブラウザーdraftは別の経路で保護する。
- Syncthingは外部サービスとして導入する。同梱とPKMによる常駐process管理は未対応。
- PWAは起動用静的ファイルをcacheする。Vault読書きにserver接続が必要で、API・添付のService Worker cacheとデータのオフライン編集は未対応。
- MCPは既定で無効。操作IDの再送防止は同一host / Vault / principal内に限る。削除・復元・任意path編集・一括変更・専用Repair・Todo操作はMCPへ公開していない。
- descriptionは全文検索とQuick Openのranking対象外。Agent読取metadataには含まれる。
- 完全削除、保存View、変更可能なキー設定、Git Snapshot・履歴復旧、Memory・Embedding・chunk検索、URL取り込み・WebP自動変換・Zotero連携は未実装。

操作仕様は[入力](input-shortcuts.md)、[関連・Timeline](entity-entry-timeline-plan.md)、
[Todo](todos.md)、[添付](attachments.md)、[MCP](mcp-setup.md)を参照する。

## 既存の検証記録と残る確認

検証コマンドは[開発・運用ガイド](development.md)、個別機能の検証範囲は以下を参照する。

| 記録                                                                         | 検証範囲                                                                      |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Entity Timeline検証](entity-entry-timeline-plan.md#verification-2026-10-12) | 521 tests / 87 files、共通Electron harness 15 checks、所属階層queryの合成計測 |
| [MCPの検証範囲](mcp-setup.md#検証範囲)                                       | 公式SDK接続、JWT、直接更新、再送・中断回復、可視性、添付等の自動テスト        |

Mac / Linuxの双方向同期と意図的な競合解決は過去に実機確認した記録があるが、自動E2Eの網羅を意味しない。
実OpenAI tunnel・ChatGPT引用画面・実IdP login、実Vaultの長期性能、同期障害の追加E2Eは残る。
