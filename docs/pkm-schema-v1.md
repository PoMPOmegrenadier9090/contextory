# PKM Markdown Schema v1

更新日: 2026-10-13
状態: 現行Markdown保存契約。型は[contracts](../packages/contracts/src/entity.ts)、値の検証は[core schema](../packages/core/src/entity-schema.ts)に対応する。
関連: [現在設計 v3](pkm-current-design-v3.md)、[architecture](architecture.md)

## 1. 共通ルール

- 1 Entity = 1 Markdown file。
- ファイル名は `<entity-id>.md`。Topic / Areaを含め、Entity IDにはUUIDを使う。
- 保存ディレクトリはEntity種別だけで分ける。Area / Project等の意味的な階層をディレクトリで表現しない。
- すべてのEntityは必須の `id` / `type` / `created_at` / `updated_at` と、optional / nullableな `deleted_at` を持つ。日時はISO 8601とtimezoneを使う。
- optional fieldは省略または明示的な `null` を許容し、どちらも業務上は「未設定」と解釈する。
- serializerは、存在するnull値を `key: null` と明示して出力する。単なる読込・保存で、省略とnullを相互変換しない。
- unknown fieldは許容し、既知fieldの編集時にも保持する。
- frontmatterのkey順はEntity種別ごとに固定する。

IDの例:

```text
ent_<uuid>
tsk_<uuid>
prj_<uuid>
res_<uuid>
topic_<uuid>
area_<uuid>
```

UUIDv7を使用する。時間順に並べやすい性質はデバッグ等に利用できるが、順序の正本には日時fieldを使う。

## 2. 表示名

Entryは任意のplain text `title` をfrontmatterに持てる。UI / MCPの表示名入力は一行を使う。直接編集されたfrontmatterのtitleはschemaでtrim後の非空文字列を検証し、行数制約は設けていない。Quick Captureではタイトルを省略でき、本文の見出しへ自動挿入しない。

```yaml
---
id: ent_<uuid>
type: entry
title: 同期方式を整理する
# その他のEntryプロパティ
---
```

新規の無題Entryは `title: null` を保存する。外部ファイルのtitle省略も許容する。本文のH1を正式タイトルには採用しない。見出しは不要で、Validation warningも出さない。Quick Captureでは本文を同じ作成操作で保存し、`journal_date` には作成時点の日本時間の日付を設定する。

Project / Task / Resourceはfrontmatterの `title`、Topic / Areaは `name` を表示名の正本とする。

Resourceは主ファイルを1件、optionalな `asset_path` で参照できる。値はVault内の `assets/images/<uuid>.<ext>` または `assets/files/<uuid>.<ext>` で、ファイル本体はResourceのMarkdownとは別に同期する。添付を解除しても直ちにファイルは削除せず、未参照添付の整理で確認後に削除する。

すべてのEntityは任意のMarkdown本文を持てる。基本的な記述先はEntryとし、Entry以外の本文は通常は空にする。ResourceなどのEntity自身に補足を残したい場合は、その本文を使える。

Project / Task / Topic / Areaの既存本文はそのまま保持し、検証時にも警告しない。

各Entityの本文は全文検索・Direct Reference・添付の対象とし、Desktop / WebでLive編集とRaw編集を提供する。本文とプロパティは同じdraft・fileHashで保存する。Entry以外の本文はBacklinksの上に閉じた状態で置き、開くと編集できる。全体Timelineとチェックリスト一覧は引き続きEntryを対象とする。正本のschema versionはv1のまま、既存ファイルやIDの移行は行わない。

### description

Project / Task / Resource / Topic / Areaは、optional / nullableな `description` をfrontmatterへ保存できる。Entryには追加しない。

- 一行のplain textとし、改行（CR / LF / Unicode line separator）は許可しない。
- 前後をtrimし、空文字は `null` へ正規化する。省略は未設定のまま保持する。
- MarkdownやDirect Referenceとして解釈せず、全文検索・Quick Openの検索文書やrankingにも含めない。
- serializerは `title` / `name` の直後に出力する。テーブルビューには表示せず、詳細の説明欄で編集する。
- SQLite summaryへ投影し、Agent読取metadataにも含める。本文や検索文書へ自動展開しない。

```yaml
title: PKM開発
description: 個人の記録をMarkdownで管理するプロジェクト
```

SQLiteのcreated_at / updated_at / deleted_atと時刻付きdue_atはUTC ISO形式へ投影する。occurred_atと終日の日付値は正本の表現を保持し、期間queryではjuliandayで日時を比較する。Markdownの日時offsetは、単なる読込・index更新では変更しない。正本のschema versionはv1。派生index versionは[index-database.ts](../packages/storage-node/src/index-database.ts)で独立管理し、古いindexはリセットして正本から再構築する。

### Resourceの著者と関連（2026-10-04）

Resourceはoptional / nullableな `authors` と `related_entity_ids` を持つ。省略された既存ファイルはそのまま読める。

- `authors` は著者名の順序付き配列。各名前はtrimした一行のplain text（1..512文字）で、重複を許可せず、最大100件とする。検索と著者順ソートの対象にする。
- `related_entity_ids` はArea / Project / Task / ResourceのID配列。最大100件で、重複と自己参照を許可しない。EntryとTopicは対象外とする。
- 正本はResource側だけに保存する。双方の詳細画面に直接の関連を表示するが、相手ファイルへの逆向き書込みや所属の継承は行わない。
- 関連先が未解決・削除済みでもIDを保持する。詳細とResource一覧から種類ごとに複数選択して編集できる。
- Entryの `contexts.resource` と本文のDirect Referenceは従来どおり別の関係として扱う。

```yaml
authors:
  - 山田 太郎
  - 佐藤 花子
related_entity_ids:
  - prj_01997c2a-7b1c-7a01-8a10-000000000003
  - tsk_01997c2a-7b1c-7a01-8a10-000000000004
```

## 3. statusとpriority

ProjectとTaskで共通のstatus enumを使う。

```yaml
status: not_started # not_started | in_progress | on_hold | done
```

新規作成時のdefaultは `not_started`。旧案の `active` は現行enumとして受け付けない。

ProjectとTaskはnullableな `completed_at` を持てる。アプリでstatusを `done` に変更したとき現在時刻を設定し、`done`から別statusへ戻したときは `null` にする。外部から取り込んだデータでは、`status: done`かつ`completed_at: null`も「完了日時不明」として許容する。

ProjectとTaskはoptionalな5段階priorityを持てる。Markdown上で意味が読めるenumを使う。

```yaml
priority: high # lowest | low | normal | high | highest
```

省略は「未設定」であり、`normal`とは区別する。並び順は `highest`、`high`、`normal`、`low`、`lowest`、未設定とする。

## 4. TopicとArea

`topics` は次のEntityで0..Nを許可する。

- Entry
- Project
- Task
- Resource
- Area

Topic自身の `topics`、Topic間の階層、同義語はv1に含めない。

Projectはoptionalな `area_id` を0..1で持つ。

```yaml
---
id: prj_<uuid>
type: project
title: PKM開発
status: in_progress
priority: high
area_id: area_<uuid>
topics:
  - topic_<uuid>
completed_at: null
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
---
```

Taskはoptionalな `project_id` を0..1で持つ。Projectに属さないTaskだけ、optionalな `area_id` を0..1で持てる。`project_id`がある場合、AreaはProjectから派生表示し、Task自身の `area_id` は省略する。

```yaml
---
id: tsk_<uuid>
type: task
title: 同期方式を整理する
status: not_started
priority: normal
project_id: prj_<uuid>
topics:
  - topic_<uuid>
due_at: null
completed_at: null
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
---
```

上位EntityのTopicは下位Entityへ書き写さない。たとえばProjectのTopicはTaskやEntryに自動追加せず、必要な検索・ビューでだけ派生利用する。

## 5. `updated_at`と外部編集

外部編集とは、PKMの保存サービスを通らずMarkdownファイルが変更されること。例:

- VS Code、Vim、Obsidian等で直接編集する。
- CLIやFilesystem toolを持つAgentが直接編集する。
- Syncthingが別端末の変更を受信する。
- アプリで開いているファイルを別プロセス・別ウィンドウが変更する。

アプリ、MCP、HTTP APIが共通保存サービスを通して保存する場合、そのサービスが `updated_at` を更新する。外部編集で `updated_at` が変わっていなくても、変更検出にはfile hashとmtimeを使うため更新を見逃さない。

外部編集によって変更されたMarkdownファイルそのものは通常どおり同期対象になる。同期から除外するという意味ではない。

外部変更を検出しただけでは、アプリがfrontmatterを書き直して `updated_at` だけを補正する追加保存は行わない。追加保存すると、本文を再serializeし、元の変更とは別の同期イベントを作るため。次にPKM経由で保存した時点で `updated_at` を更新する。したがって `updated_at` は同期versionや排他制御には使わない。

## 6. Direct Referenceの解釈範囲

Direct Referenceはfrontmatterを除いたMarkdown本文の通常のtext nodeだけから抽出する。

```markdown
[[task:tsk_<uuid>|同期方式を整理する]]
```

次の箇所では解釈しない。

- YAML frontmatter
- fenced code block、indented code block
- inline code
- HTML blockとHTML comment
- Markdown link / imageのdestination
- GFM table cell
- `\[[` のように開始記号をescapeした箇所

閉じていない記法、未知のEntity type、ID形式が不正な記法は参照indexへ入れない。表示上は通常の本文として残し、必要に応じてValidation warningを出す。

blockquote、list item等の通常テキスト内では解釈する。抽出は本文全体への単純な正規表現ではなく、Markdown parserの構文nodeを使う。

GFM table cell内のDirect Reference記法はプレーンテキストとして保持し、参照indexへ登録しない。Validatorは `UnsupportedTableReference` warningを返す。これはtable live previewが表全体を単一widgetとして描画し、通常本文のDirect Reference widgetをセル内へ適用できないためである。

```markdown
| Task                                                        |
| ----------------------------------------------------------- |
| [[task:tsk_<uuid>\|同期方式を整理する]]（プレーンテキスト） |
```

## 7. Phase 0で確定した実装判断

- Entity IDにはUUIDv7を使用する。
- 見出しのないEntryは保存可能とする。2026-09-26以降はQuick Captureの無題Entryを許可するため、表示名欠落のValidation warningは出さない。
- Direct Referenceの表示ラベルは参照先のrename時に自動更新しない。参照解決にはUUIDだけを使用する。
- Resourceの直接関連は `related_entity_ids`、Entryからの資料参照は `contexts.resource` / Direct Referenceを使う。各画面の探索範囲は[関連・Timeline仕様](entity-entry-timeline-plan.md)で定義する。Entry経由Resourceのスコープ集約拡張は[Roadmap](future-roadmap.md#関連情報の拡張)へ分離する。
- 6 Entityの完全な相互参照例は `fixtures/vault-v1/` を実行可能なschema fixtureとして管理する。

判断理由と影響は[ADR 0001](decisions/0001-phase-0-defaults.md)を参照する。

## 8. 種別ごとのfield一覧

すべて共通fieldに加える。任意fieldは省略とnullを許容する。Topic自身はtopicsを持たない。

| 種別     | 必須field               | 任意field                                                                                                                                                 |
| -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry    | origin、exclude_from_ai | title、occurred_at、journal_date、curated_at、contexts、topics、generated_at、source_entity_ids                                                           |
| Project  | title、status           | description、priority、area_id、topics、completed_at                                                                                                      |
| Task     | title、status           | description、priority、project_id、area_id、topics、due_at、completed_at                                                                                  |
| Resource | title                   | resource_type、description、authors、related_entity_ids、canonical_identifier、source_uri、asset_path、version、acquired_at、local_content_status、topics |
| Topic    | name                    | description                                                                                                                                               |
| Area     | name                    | description、topics                                                                                                                                       |

originはhuman / ai / system、exclude_from_aiはboolean。
source_entity_idsは6種EntityのID配列で、AI生成Entryの根拠を表し、通常の関連と区別する。
Resourceのresource_typeは任意で、book（書籍）、paper（論文）、web_article（Web記事）、other（その他）を指定する。
Resourceのsource_uriはURL、version / local_content_statusは任意文字列。添付操作はlocal_content_statusを自動変更しない。
新規生成のfield順はcontractsのFRONTMATTER_KEY_ORDERを使い、未知fieldは既知fieldの後に保持する。
既存本文の空白・改行を保持し、無関係な保存で末尾newlineを強制追加しない。

## 9. 時間と日付

created_at / updated_at / deleted_at / completed_at / curated_at / generated_at / acquired_atはtimezone付き日時。
Entryのoccurred_atとTaskのdue_atはYYYY-MM-DDの終日値、またはtimezone付き日時を許容する。
journal_dateは実在するYYYY-MM-DDの日付で、timezone変換しない。

Task期限のUIで「終日」を選ぶと日付だけ、時刻指定は日本時間の入力をUTC日時へ変換して保存する。
既存正本のoffsetはindex更新だけでは書き換えない。
Dailyはjournal_dateを基準とし、未設定値をcreated_atから補完しない。通常作成時は日本時間の作成日、
Timeline日付選択中の作成は選択日を保存する。created_atとoccurred_atは独立した意味を持つ。

期間queryは正本fieldと別のcamelCase契約で、from包含 / to非包含。
createdAt / updatedAt / occurredAt / dueAtはtimezone付き境界、journalDateRangeは日付境界を指定する。
未設定値は一致せず、複数条件はAND。query実装は[date-range.ts](../packages/core/src/date-range.ts)を参照する。
