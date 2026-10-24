# Contextory 設計ドキュメント案内

更新日: 2026-10-24

現行仕様は以下の文書に集約する。実装済み機能と未実装の計画を同じ契約として扱わない。

| 読みたい内容                          | 正本となる文書                                                  |
| ------------------------------------- | --------------------------------------------------------------- |
| 目的・設計原則・全体像                | [現在設計 v3](pkm-current-design-v3.md)                         |
| Markdownのfield・enum・参照構文       | [Markdown Schema v1](pkm-schema-v1.md)                          |
| コードの責務・依存・保存・取得境界    | [現在のコード構成](architecture.md)                             |
| 採用済みの技術と選定理由              | [技術構成](pkm-technology-selection.md)                         |
| 利用できる機能と実装上の制限          | [現在の実装状況](implementation-status.md)                      |
| 未実装の候補・残る判断・推奨順        | [今後の展望・TODO](future-roadmap.md)                           |
| Entry Timelineと構造化関連の取得      | [Entity関連・Entry Timeline仕様](entity-entry-timeline-plan.md) |
| 入力・タブ・既定キー                  | [入力・ショートカット](input-shortcuts.md)                      |
| 画像・ファイル・孤立asset整理         | [添付ファイル](attachments.md)                                  |
| Entry本文のチェックリスト索引・保存   | [Todo一覧](todos.md)                                            |
| Agentのツール・policy・再送・接続設定 | [MCP接続と直接操作](mcp-setup.md)                               |
| Vault初期化・Docker・Web公開          | [Vault・同期環境セットアップ](server-setup.md)                  |
| 同期peer登録・除外規則・競合試験      | [Syncthingセットアップ](syncthing-setup.md)                     |
| 開発時の検証・配布                    | [PKMS開発スキル](../.agents/skills/pkms-development/SKILL.md)   |
| 開発起動・検証・CLI・配布物の生成     | [開発・運用ガイド](development.md)                            |

## 文書の使い分け

保存形式はSchema、内部構造はarchitecture、MCPの操作と設定はmcp-setupを参照する。
実装の有無はimplementation-status、追加する機能と判断事項はfuture-roadmapで管理する。
同じfield一覧やTODOを複数の文書へコピーせず、担当文書へリンクする。
実装変更時は対応する仕様と実装状況を同時に更新する。
