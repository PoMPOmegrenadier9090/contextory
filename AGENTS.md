# Contextoryの開発方針

このプロジェクトの開発変更では、実装前に [.agents/skills/pkms-development/SKILL.md](.agents/skills/pkms-development/SKILL.md) を読み、実装から検証・配布まで進める。

- 指定がなければmainブランチで作業し、origin/mainへ直接pushする。Desktopの実行コードや共有コードを変更した場合は、検証後に新しいビルド物でローカルのContextory.appを置き換えて起動確認する。
- ブランチ作業を指定された場合は、そのブランチで実装・検証し、リモートpushとPR作成まで行う。この場合はインストール済みアプリを置き換えず、PRを自動mergeしない。
- 上記のcommit・push・PR作成・mainでのアプリ置換はユーザーの継続的な承認に基づく。ユーザーによる今回の明示的な指示を優先し、通常の完了操作について再確認しない。
- 既存の未コミット変更を消さず、今回の対象として承認されていない変更を勝手にcommitへ含めない。
- ドキュメント・skillsだけの変更では、それらを検証してcommit/pushする。Desktopの再ビルド・置換は不要。

検証コマンド、Node / ElectronのSQLite ABI、アプリの置換・復旧手順は上記スキルの参照資料を使う。

## Ponytail

開発作業では [.agents/skills/ponytail/SKILL.md](.agents/skills/ponytail/SKILL.md) も読み、既定のfullモードで必要な変更を最小限に実装する。ユーザーによるモード変更・停止の指定を優先し、Contextoryの検証・配布手順は引き続き守る。

レビュー・監査などを含む導入内容と使い方は [docs/ponytail.md](docs/ponytail.md) を参照する。

## 日本語文書

日本語の文書やPR説明文を作成・推敲するときは [.agents/skills/natural-japanese/SKILL.md](.agents/skills/natural-japanese/SKILL.md) を使う。元の内容や確信の度合いを保ち、読みやすい日本語に整える。導入内容と実行例は [docs/natural-japanese.md](docs/natural-japanese.md) を参照する。
