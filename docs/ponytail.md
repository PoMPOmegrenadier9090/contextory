# Ponytail

開発エージェント向けの[Ponytail](https://github.com/DietrichGebert/ponytail)を、このリポジトリの `.agents/skills/` に導入している。

- バージョン: 5.3.2
- 導入元コミット: [`16352ac229eb08a9598dcae48fe9f2b342567d86`](https://github.com/DietrichGebert/ponytail/tree/16352ac229eb08a9598dcae48fe9f2b342567d86)
- ライセンス: MIT。各スキルの `LICENSE` に原文を同梱。
- 導入方式: [上流のSkills導入方式](https://github.com/DietrichGebert/ponytail/blob/16352ac229eb08a9598dcae48fe9f2b342567d86/INSTALL.md#skills-cli)に相当するプロジェクト内へのコピー。各 `SKILL.md` は上流の原文。

## 使い方

Codexでは次のターンからプロジェクト内のスキルを利用できる。表示されない場合は新しいチャットを開く。
開発作業ではルートの `AGENTS.md` に従ってPonytailのfullモードを適用し、PKMS固有の検証・配布手順も守る。

| スキル | Codexでの呼び出し例 | 用途 |
| --- | --- | --- |
| ponytail | `$ponytail` / `$ponytail lite` / `$ponytail ultra` | 必要な変更を最小限に実装 |
| ponytail-review | `$ponytail-review` | 変更差分と関連コードのレビュー |
| ponytail-audit | `$ponytail-audit` | リポジトリ全体の監査 |
| ponytail-debt | `$ponytail-debt` | `shortcut:` コメントの一覧 |
| ponytail-gain | `$ponytail-gain` | 上流ベンチマークの表示 |
| ponytail-help | `$ponytail-help` | スキルのヘルプ |

停止は「stop ponytail」または「normal mode」と伝える。モードの指定は会話内で適用する。

これはスキルのみの導入で、グローバルプラグインやライフサイクルフックは含まない。
上流ヘルプにあるプラグインの自動更新・環境変数による既定モード設定は、この導入方式には適用されない。
更新する場合は上流の新しいコミットを確認して6スキルとライセンスを置き換え、この文書のバージョン・コミットも更新する。
