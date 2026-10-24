# ADR 0001: Phase 0の初期判断

更新日: 2026-09-21
状態: Accepted（一部は後続判断で置換済み）

## 後続判断（2026-10-13整理）

以下のDecision / Consequencesは2026-09-21時点の記録。次の事項は現行仕様で置き換わった。

- Entryタイトルは任意frontmatter title。無題・H1なしのwarningは廃止した。
- Suggestion outboxは採用せず、local-state.sqliteにはDesktopのEntity / 競合draftを置く。
- Resourceのrelated_entity_idsに直接の複数関連を追加した。Entry / Topicは対象外。
- ID、参照ラベル非更新、外部Syncthing、draftとindex分離の判断は維持する。

現行の保存形式は[Schema v1](../pkm-schema-v1.md)、保存境界は[architecture](../architecture.md)、
Agent操作は[MCP接続と直接操作](../mcp-setup.md)を参照する。

## Context

現在設計 v3には、実装開始前に固定する小さな判断と、保存形式が未指定のローカル運用状態が残っている。Phase 0の型、fixture、保存境界を一貫させるため、MVPの初期値を決める。

## Decision

- Entity IDはUUIDv7を使用する。並び順の正本には日時fieldを使用する。
- level-1 headingのないEntryは保存可能とし、Validation warningにする。
- Direct Referenceの表示ラベルは参照先rename時に自動更新しない。
- Projectの関連Resourceは、関連Entryの `contexts.resource` とResourceへのDirect Referenceから派生表示する。
- SyncthingはMVPでは別プロセスとして扱う。
- 未保存draftとSuggestion outboxは端末固有の `.pkm/local-state.sqlite` に置く。
- `local-state.sqlite` は同期しない。再構築可能cacheではなく、端末上で永続化すべき運用状態として扱う。
- すべてのEntityは `created_at`、`updated_at`、nullableな `deleted_at` を共通fieldとして持つ。

## Consequences

- `index.sqlite` を再構築してもdraftとoutboxは失われない。
- ローカル運用状態には独立したmigrationと回復手順が必要になる。
- ResourceとProjectの直接多対多関係はv1 schemaへ追加しない。
- renameで古い表示ラベルが残りうるが、参照先はUUIDで正しく解決できる。
- Topic / Area / Resourceにも共通時刻fieldが必要になるため、Schema v1の完全な例に反映する。
