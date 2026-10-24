# 今後の展望・TODO

更新日: 2026-10-13
状態: 未実装の候補と残る判断。確定方針と提案を区別する。

実装済み機能は[実装状況](implementation-status.md)、全体方針は[現在設計](pkm-current-design-v3.md)、
保存形式は[Schema](pkm-schema-v1.md)を参照する。完了した機能のTODOをこの文書へ重複して残さない。

## 残作業と推奨順

| 順             | 項目                | 現在の土台                                                       | 残る作業                                                     |
| -------------- | ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| 1              | 共通queryと保存View | EntityPageQuery、日時範囲、Webページングは実装済み               | Desktop一般一覧のquery統一、汎用operator、保存・rename・pin  |
| 2              | 未整理Entry         | Quick Capture、Timeline、Context / Topic編集は実装済み           | 未整理条件と整理用filter                                     |
| 3              | 関連情報の拡張      | Entry直接 / 配下と代表path、構造化推移queryは実装済み            | Entry経由Resourceの集約、根拠pathとBacklinks専用表示         |
| 4              | Daily / Calendar    | journal_date、月カレンダー、日別件数、選択日の期限Taskは実装済み | 週表示、汎用日付filter UI、共通tableの日付カラム             |
| 並行候補       | ショートカット設定  | タブ・並べ替え・既定キー・本文検索は実装済み                     | command registry、変更・解除・一覧ヘルプ                     |
| 受入確認       | MCP接続             | ツール、ledger、HTTP / bridge、JWT、tunnel launcherは実装済み    | 実アカウントのtunnel、引用、実IdPの認可flow                  |
| 必要性に応じて | 添付・取り込み      | 基本添付と確認付き孤立asset整理は実装済み                        | URL本文取り込み、WebP変換、Resource種別、複数主ファイル      |
| 継続           | 品質・規模          | 合成1万Entityの計測、各adapterとrenderer harnessは実装済み       | 実Vault長期計測、同期障害、cold cache、disk full等の追加試験 |
| 保留           | 履歴・AI派生機能    | Markdown正本とMCP読取が土台                                      | Git Snapshot・backup / restore、Memory、Embedding、chunk検索 |

これは着手候補の順序で、全項目を実装する承認や日程を表さない。
実装時は一つのuse caseについて契約・実装・検証・配布をまとめる。
検証と完了操作は[PKMS開発スキル](../.agents/skills/pkms-development/SKILL.md)を使う。

## 共通queryと保存View

確定方針: 保存ViewはVault別・端末ローカルのlocalStorageへ保存し、Web / Desktop間で同期しない。
保存するのはqueryと表示設定で、Entity IDの結果一覧や本文を複製しない。

日時範囲のfrom包含 / to非包含は実装済み。作成日時、更新日時、Entry発生日時、Task期限、
journal_dateを扱う。ここを新規の基盤TODOとしない。

追加案:

- version付きSavedViewとしてID・名前・対象type・text query・filter・sort・group・表示columnを保存する。
- 許可fieldとoperatorを列定義から選び、任意SQLや任意property pathを受け付けない。
- 初期operator候補はequals、not_equals、contains_any、is_empty、日付on / before / after / between。
- Desktopの一般一覧も同じpage queryへ移し、Web / Desktopでfilterとsortの意味を揃える。
- 壊れた保存値や使えないfieldを明示し、一覧・rename・削除・pinを提供する。

残る判断: ANDだけかOR / groupも許すか、sidebarへ直接pinするか、column順・表示・幅の保存範囲。
受入条件: 全対象へfilter / sortを適用してからページングし、保存後の再読込と条件変更で結果が混在しない。

## 未整理Entryと削除済み参照

無題Entry、context未設定、topics未設定、未curatedを同じ「未整理」と暗黙にみなさない。
未整理の判定条件・表示と、ユーザーが後から整理する操作を先に決める。

削除・復元は既存の単体・非cascade方針を維持する。
削除済み参照の非表示 / ID表示 / 「削除済み」表示をDirect Reference・階層・関連表で統一する。
複数選択復元や確認画面は必要性を見て追加する。
完全削除は設定のゴミ箱から単体で行う。Markdownと端末の下書きを削除し、添付は既存の未参照添付の整理で扱う。保持期間・自動GC・同期後の復活対策は保留する。

## 関連情報の拡張

現行の二つのresolverとscope filterは[関連・Timeline仕様](entity-entry-timeline-plan.md)を参照する。
所属階層のEntry集約と代表経路は実装済みで、根拠pathの初期導入をTODOへ戻さない。

追加候補:

- スコープ内Entryのcontexts.resource / Direct ReferenceからResourceを派生集約し、
  Area > Project > Task > Entry > Resourceの根拠を返す。
- Backlinks専用表示とスコープ内表示を区別する。
- 複数の根拠経路を展開表示する。現在の代表1件を変更する必要性を確認する。
- Topic付与先やResourceの明示関連先からのEntry集約は、既存entryRelationModeの範囲と分けて設計する。

Resourceへarea_id / project_id / task_idを追加して所属を二重保存しない。
任意Direct Reference graphの再帰探索は保留し、追加する場合は方向・深さ・循環・上限を先に決める。
受入条件: 重複排除、削除済み中間Entity、代表path、ページ境界、AI可視性、1万Entityでの計測を含める。

## Dailyとカレンダー

確定方針: Dailyは通常Entryの派生Viewで、1日1Entryの制約を置かない。
journal_date未設定をcreated_atから補完せず、日付解釈はAsia/Tokyoを使う。
選択日へのEntry追加と期限Task表示、月カレンダーは実装済み。

残作業は週表示、共通tableのjournal_dateカラム、作成日 / 出来事日 / Daily日付を別々に選ぶfilter UI。
範囲queryの基盤を再実装せず、未設定値・終日値・日時offset・期間境界のテストを再利用する。
残る判断: 期限Taskを全期間の時系列へ混在させるか、完了Projectを表示するか、Vaultごとのtimezone設定を追加するか。

## タブとショートカット設定

Homeの新規作成・置き換え・close、Entity既存タブの再利用、背景open、ドラッグ並べ替えは実装済み。
再起動後のタブ復元は不要という判断を維持する。
現在の既定キーとモバイルの一画面操作は[入力・ショートカット](input-shortcuts.md)が正本。

追加案:

- command ID・label・scope・enabled条件・executeを持つregistryへ操作を集約する。
- key bindingをapp全体の端末ローカル設定としてversion付きで保存し、検索・変更・解除・default復帰を提供する。
- 最初はアプリにfocusがある時の単一strokeだけ。OS global shortcutと連続key chordは後続。
- editor・modal・IME・read-only・競合画面の優先順位と、同scopeの重複やOS予約keyを検証する。
- ボタン・キー・native menuから同じcommandを使う。

残る判断: 追加キーの既定割当、app全体 / Vault別設定、native menuへの表示、background Quick Capture。
既存のT / W / K / Sや背景openを未着手扱いにしない。Webのブラウザー予約キー制約を保つ。

## MCP接続の受入確認と拡張

現行tool・policy・制限・認証は[MCP接続と直接操作](mcp-setup.md)を参照する。
6種Entityの直接操作、upload_asset、事前Validation、期間検索は実装済み。

受入確認:

- 実OpenAI account associationとtunnelを使って接続し、切断 / 再接続を確認する。
- ChatGPTでsearch / fetchの引用表示と、Web認証後のEntity deep link表示を確認する。
- 実IdPでclient登録・認可flow・scope・期限切れを確認する。PKMのJWT検証テストと区別する。

後続候補はMCPを使うSkills・参照リンク、専用常駐daemon、asset本体読取policy、
Todo専用操作、Vault全体の安全な診断、Direct Reference専用command、長文引用chunk、複数Entity操作。
削除・復元・Repairを公開する場合は許可field・hash・draft・再送・可視性を先に定義する。
本文のDirect Referenceは現在もupdate_entryの本文置換で編集できるが、位置ベースの専用commandはない。

専用daemonを追加するならDesktopもその操作clientにし、同一Vaultのwriterを増やさない。
公開plugin配布の認証とendpointは別工程。Suggestion・outbox・PKM内再承認は導入しない。

## 添付・取り込み・同期

追加候補はURL本文の取得、WebP自動変換、Resource化の入力導線、複数主ファイル、添付改名と分割転送。
複雑なHTML表の貼付け、リスト記号のネスト別表示も必要性を確認して追加する。
ZoteroとResource資料種別の拡張は保留する。

現在の命名・10 MiB上限・孤立asset確認付き削除は[添付仕様](attachments.md)が正本。
画像variant、添付のstream / Range対応、通信量の削減も追加候補とする。

Syncthingの同梱・process lifecycle・初期peer登録の自動化は別工程。
現行の外部サービス運用とDesktopからの登録 / 状態取得を維持し、同梱時の署名・更新・常駐化を検証する。
競合一覧の取得失敗を0件と区別し、外部同期による0→1 / 1→0の画面更新を追加確認する。

## Git Snapshotとbackup / restore（保留）

Gitは履歴・復旧用の候補で、ファイル同期の手段にしない。現在はsnapshot job・履歴画面・restoreを持たない。

将来案:

- サーバーで変更が落ち着いた時、定期、手動、大規模操作前後のsnapshotを作る。
- 過去のEntityを現在Vaultへの通常更新として復元し、indexとSyncthingへ反映する。
- Vault全体rollbackより個別restoreを優先する。
- vault.yaml・Markdownの履歴対象、assetsのGit採否、snapshot周期・保持期間を決める。

Git historyだけではassetsや未保存draft、操作ledgerを復旧できない。
backup対象と復旧手順は正本・assets・端末draft・host ledger・必要設定を分けて設計する。
未同期peerの扱いと同期停止 / 再開、ledger rollback後の古い操作の再送を決め、復旧試験を行う。
サーバーsnapshotが守れるのはサーバーへ到着済みの版に限る。

<a id="memory"></a>

## Memory・Embedding・chunk検索（未実装）

現在はEntity単位のplain text / FTS。既存検索で解けない具体的な問題が確認できてから着手する。

将来案:

- 長文を再生成可能なchunkに分割し、リンクの永続単位はEntryのままにする。Block IDを導入しない。
- Embeddingのモデル・vector保存先・更新コストと検索の受入目標を決める。
- Project等のMemoryは再生成可能な圧縮理解で、source ID・生成時刻・clean / dirtyを持つ。
- source hashの変更や所属変更をwatcherから検出し、dirty化と必要時の再生成を行う。
- 人間向けに残す整理文書は派生Memoryへ置かず、AI生成Entryとして保存する。
- 除外・削除されたsourceからの既存Memoryを無効化する。非公開内容をcacheや生成材料から返さない。

MemoryをMCP読取の前提にせず、空tableやplaceholderを先行追加しない。
モデル名・prompt・token・行/token単位の詳細provenanceは正本の必須項目にしない。

## 品質と規模

実Vaultの長期計測、cold cache、巨大本文、頻繁な同期、3 peerの切断 / 再接続・論理削除・初回取得、
競合解決中断 / 同時解決、disk full、破損file、backup restore drill、新規環境導入を追加確認する。
Desktop / Webの離脱・draft・IME・未保存確認・タブ / scroll保持を実rendererで検証する。
合成データの単発計測を実Vaultの性能保証や自動E2E完了として扱わない。
