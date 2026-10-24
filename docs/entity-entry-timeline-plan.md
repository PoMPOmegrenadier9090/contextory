# Entity関連・Entry Timeline仕様

更新日: 2026-10-13
状態: 現行実装契約。

## 三つの関連query

| 契約                                   | 目的                                | 範囲・結果                                                                            |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| scopeType / scopeId                    | 有効な所属によるfilter              | entity_scopesに投影したdirect / inherited。明示contextの優先順位を使う                |
| entryRelationMode: direct / scoped     | Entity画面のEntries表とTimeline     | 明示context・topic・本文参照とArea / Projectの所属階層。entryRelationで代表経路を返す |
| relatedResolution: direct / transitive | 構造化関連queryとEntityActivityView | 索引済み構造化辺を逆方向に集約。relatedViaで代表最短経路を返す                        |

relatedToだけのqueryは従来の意味を維持する。三つのqueryの探索範囲を同一視しない。
各modeは対応する用途から明示指定し、両方を一つのqueryへ混在させない。

## Entity画面と操作

Area / Project / Task / Resource / Topicは「詳細 / Timeline」を切り替える。
Entryは常に本文エディタ・詳細・Backlinksを表示し、Timelineと関連範囲の切替を表示しない。
Resourceの詳細には、プロパティの下に全般メモの本文エディタを表示する。Resource本文と関連Entryは独立して保存し、ResourceのTimelineには関連Entryを表示する。
初期表示は詳細、関連Entryの範囲は直接のみ。表示形式と関連範囲は独立した状態とする。

「直接のみ / 配下も含む」はEntries表とEntity Timelineへ適用し、他種別の表の範囲を変更しない。
Task / Resource / Topicは所属階層の配下がないため、配下の選択肢を無効にする。
表示 / 範囲はVault + Entity別にセッション内のメモリへ保持する。再起動後は復元しない。
画面移動とタブの保存 / draft / scroll保護は既存の経路を通す。

## Entryの直接関連

| 対象     | 直接関連するEntry           |
| -------- | --------------------------- |
| Area     | contexts.areaが一致         |
| Project  | contexts.projectが一致      |
| Task     | contexts.taskが一致         |
| Resource | contexts.resourceが一致     |
| Topic    | Entry自身のtopicsに含まれる |

5種別すべてで、その対象への本文Direct Referenceを持つEntryも含む。
対象自身を結果に含めず、本文参照を無条件に双方向化しない。
Resourceのrelated_entity_idsはArea / Project / Task / Resourceだけを許し、EntryとTopicは対象外。
ResourceからEntryへの明示関連を現行schemaの作成経路として説明しない。

## Entryの配下集約

直接関連との和集合として、次を追加する。

| 対象                    | 追加範囲                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| Area                    | 直下Project・standalone Task・配下ProjectのTaskへ直接関連するEntry |
| Project                 | 配下Taskへ直接関連するEntry                                        |
| Task / Resource / Topic | 追加なし                                                           |

配下Entityへの直接関連はcontextと本文参照を含む。
所属階層の深さは最大2。任意の本文参照graph、Topic付与先、Resourceの明示関連先を再帰探索しない。
複数経路はEntry IDで重複排除し、直接を優先する。推移のみの場合は代表経路1件を表示する。
明示contextと別の所属経路が異なっても、その経路に関連があれば含める。
contextを正本へ書き戻さず、entity_scopesの既存優先順位も変更しない。
削除済みEntry・中間Entityは除外し、完了Taskは含める。人間向けUIの範囲とAI可視性を混同しない。

## queryと共通UI

```ts
const query = {
  type: "entry",
  relatedTo: entityId,
  entryRelationMode: "scoped", // "direct" または "scoped"
  view: "timeline",
  sort: "createdAt",
  direction: "desc",
  limit: 50,
  cursor,
};
```

entryRelationModeはtype: entryとrelatedToがある場合だけ有効。
詳細Entries表は本文なし、Timelineはpreview付きで、同じ関連条件を使う。
SQLiteでfilter・重複排除・sortを実行してからcursorページングする。
Timelineの順序はcreatedAt DESC / id DESC、日本時間の日付でグループ化する。
journal_date / occurred_at切替、月カレンダー、期限TaskはEntity Timelineへ含めない。

previewは1件1,200文字、ページ合計128 KiB。省略本文は詳細から全文を取得する。
Todo編集は最新本文・draft・hashを確認し、省略previewでは無効にする。
query modeをcursor / Web cacheの識別へ含める。条件切替時は先頭へ戻り、旧requestと応答を無効にする。
変更・削除・復元・中間Entity変更でqueryと経路ラベルを更新する。

Web / DesktopはuseEntityPage、EntityRelatedEntries、EntityEntryTimelineを共有する。
日付グループと本文カードはEntryTimelineGroupsへ集約し、全体Timelineでも使う。
DesktopのEntityタブはIPC queryEntitiesをEntityQueryContextへ接続する。

TimelineのQuick Captureは現在Entityを初期contextにし、非空の保存draftを尊重する。
入力draftはEntity別のstorageKeyへ保存する。TopicではTopic付与を使う。
取得範囲が配下でも、保存する関連は表示中Entityへの直接関連にする。

## 全体TimelineとDaily

全体Timelineは「すべて」をcreated_atの新しい順、日本時間の日付グループで表示する。
日付選択時はjournal_dateで絞り、未設定Entryをcreated_atから補完しない。
前日 / 翌日 / 今日への移動、選択日への追加、TodoありEntry filterを提供する。
日付選択中の追加にはその日付、通常作成には作成時の日本時間の日付を保存する。

月カレンダーは表示月の42日分の日別件数queryを使い、Entry件数とTask期限を別々に表示する。
月移動だけでは選択日のfilterを変更しない。選択日の期限Task一覧はリストでも表示する。
リスト / 月表示はセッション内で保持する。カレンダーから「すべて」へ戻す時は本文へ自動focusしない。
Quick Captureの入力はモード / 日付別のlocalStorageへ保持する。

## 構造化関連の推移探索

relatedResolutionはContext・親・Topic付与・Resource関連を逆方向に集約する。
directは1段、transitiveは構造化辺を繰り返し辿る。Entryは終端。
本文参照は表示対象への直接Backlinksだけを合流し、探索seedや中間EntityのBacklinksとして使わない。
Resourceの明示的な外向き関連は直接表へ残すが、その辺から配下を辿らない。
削除済み・未解決Entityを中間ノードにせず、訪問済み集合で循環を止める。

重複を除去して直接を優先し、間接行に代表最短経路を返す。
到達集合を作ってから返却type・filter・cursorを適用する。pageと関連表で集合を共有し、索引更新時に失効する。
cacheは最大16query、探索は最大20,000ノード。超過時はエラーにして不完全な結果を返さない。

EntityActivityView / EntryTimelineFeedはこのquery用の公開部品。
現在のWeb / DesktopのEntity画面はEntry専用のEntityEntryTimelineを使う。

## 実装の参照先

- [query・結果契約](../packages/contracts/src/application.ts)、[入力検証](../packages/core/src/entity-query.ts)
- [所属投影](../packages/storage-node/src/entity-scope.ts)、[Entry階層query](../packages/storage-node/src/entry-relation-query.ts)
- [構造化resolver](../packages/storage-node/src/related-entities.ts)、[SQLite page query](../packages/storage-node/src/index-query.ts)
- [Entity Entry UI](../packages/ui/src/entity-entry-view.tsx)、[全体Timeline](../packages/ui/src/entry-timeline-view.tsx)
- [構造化関連UI](../packages/ui/src/entity-activity-view.tsx)

追加候補は[Roadmapの関連情報](future-roadmap.md#関連情報の拡張)を参照する。

<a id="verification-2026-10-12"></a>

## 検証記録（2026-10-12）

- `vitest run --maxWorkers=4`: 521 tests / 87 files通過。通常の高並列実行では既存のMarkdown構文解析テスト1件が一度失敗したため、並列数を制限して確認した。HTTP listenerを使う既存MCPテストはsandbox外で実行した。
- lint、format check、typecheck、全workspace build通過。既存のbundle size warningは残る。
- `corepack pnpm --filter @pkm/desktop smoke:entry-timeline`: Electron / Chromiumで15 checks通過。共通UIの表示・範囲切替、50件からの追加取得、古いresponseの破棄、revision更新、Vault / Entity別の状態復元、EntryのTimeline切替が非表示であることと、本文エディタ・未保存draftの表示を確認した。
- HTTP integration testでpreview / 経路のDTO、直接／配下の差、cursorの条件検証を確認した。
- in-memory SQLiteに1 Area / 100 Project / 1,000 Task / 10,000 Entryを投入し、Area配下の初回50件のTimeline queryを5回実行した。取得は35 / 20 / 20 / 20 / 20 ms。これはネットワークやDOM描画を含まない合成データの参考値。追加の永続索引は不要だった。
- 画面検証は共通UIとDesktopエディタのテストharnessを用いた。実Vaultの操作・同期の新しいE2E試験は行っていない。
- 900px / 390px幅の共通TimelineをElectronで撮影し、切替操作と本文カードが表示幅に収まることを確認した。
