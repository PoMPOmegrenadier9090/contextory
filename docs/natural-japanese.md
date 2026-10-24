# natural-japanese

日本語文書の作成・推敲に使う[natural-japanese](https://github.com/coji/natural-japanese)を、`.agents/skills/natural-japanese/` に導入している。スキル本体、参照資料、検査スクリプト、サンプル文書は上流の原文を使う。

- バージョン: 1.6.0
- 導入元コミット: [`03bc944a0c4a9f0b2a66eab065b30de5c529bf08`](https://github.com/coji/natural-japanese/tree/03bc944a0c4a9f0b2a66eab065b30de5c529bf08)
- ライセンス: MIT。原文は [LICENSE](../.agents/skills/natural-japanese/LICENSE) に同梱。

## 使い方

次のターンから利用できる。表示されない場合は新しいチャットを開く。
`$natural-japanese` を指定するほか、「この文章を読みやすくして」「PRの説明文を書いて」などの依頼でも使う。

```text
$natural-japanese docs/example.md を読みやすくして
$natural-japanese score docs/example.md
```

既定はquickモード。`full` を指定すると、構成や専門用語の説明も詳しく点検する。
`score` は書き換えずに診断する。内容や数値、書き手の意見、確信の度合いは保つ。

## 検査スクリプト

リポジトリのルートから実行する。Python 3.10以上と `uv` が必要で、初回は `uv` が形態素解析用のライブラリと辞書を取得する。

```sh
uv run .agents/skills/natural-japanese/scripts/lint.py docs/example.md --genre tech
uv run .agents/skills/natural-japanese/scripts/outline.py docs/example.md
uv run .agents/skills/natural-japanese/scripts/newfacts.py original.md revised.md
```

検出結果は修正候補として扱い、文脈を読んで直すか決める。`uv` が使えない環境では、スキルに同梱した [手動チェックリスト](../.agents/skills/natural-japanese/references/manual-checklist.md) を使う。

更新するときは上流の新しいコミットを確認し、スキルのディレクトリとライセンスを置き換えて、この文書のバージョン・コミットも更新する。
