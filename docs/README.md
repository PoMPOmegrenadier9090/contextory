# Contextory 設計ドキュメント案内

更新日: 2026-11-14

2026-11にMarkdown Vaultを使う旧版を外し、SQLiteを正本とするObject文書へ移った。旧版の仕様書は削除し、Git履歴に残している。

| 読みたい内容                              | 文書                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| 自由文書とObjectを両立する設計            | [設計案](object-document-design-proposal.md)                                 |
| 種別とFieldの決定事項                     | [種別とField](discussions/20261112_type-and-field-schema.md)                 |
| Phase 3の要件と進め方                     | [Phase 3への引き継ぎ](discussions/20261112_phase3-handoff.md)                |
| 正本の置き場所とアプリへの組み込み        | [Phase 3のアプリ統合](discussions/20261112_phase3-app-integration.md)        |
| 保存の競合検出                            | [文書の保存に競合検出を入れる](discussions/20261114_page-conflict.md)        |
| コードの責務と依存                        | [現在のコード構成](architecture.md)                                          |
| 開発時の起動・検証・配布物の生成          | [開発・運用ガイド](development.md)                                           |
| Docker ComposeとCloudflare Tunnelでの公開 | [サーバーのセットアップ](server-setup.md)                                    |
| 開発作業の進め方                          | [PKMS開発スキル](../.agents/skills/pkms-development/SKILL.md)                |

`discussions/`には、作業の途中経過と判断を日付つきで残している。`decisions/`は旧版の判断記録である。
