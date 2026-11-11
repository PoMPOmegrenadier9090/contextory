# Object入力体験のPrototypeとTiptap移行の経過

記録日: 2026-11-12

[自由文書とObjectを両立する入力・表示設計案](../object-document-design-proposal.md)をもとに、`codex/object-view-demo`ブランチで進めた試作と技術検証の経過をまとめる。確定した仕様ではない。

## 方針として固まったこと

- Objectは独立した本文を持ち、文書には埋め込みBlockとして置く。Block範囲をContainerで包む方式は採らない。
- 編集時は埋め込みObjectを展開した一つの文書木として扱い、保存時にObject単位へ分ける。入れ子の別エディタにはしない。
- `@`は「それを含む最小の構造」を参照先へ届ける。段落、リスト項目と子、見出し以下、Memo全体がその単位になる。所属は変えない。
- Contextが固有の意味を持つのはTyped Objectだけとする。TaskがProjectに属する、Subtaskが親Taskに属する、といった関係を推移的に辿る。
- Memoは、Quick Captureの受け皿と、任意の範囲を切り出したいときの補助的な道具とする。Dailyの本文では、段落をMemoにしなくても`@`だけで関連先へ集まる。
- 埋め込んだTaskはチェックボックス付きの1行で見せる。置いた場所から自明なContextと操作ボタンは、普段は表示しない。
- 入力体験は自作せず、Tiptap 3（ProseMirror、MIT）を土台にする。

## 経過

### 1. 自作エディタでの試作

`contentEditable`を直接扱うエディタで、`@`での参照と新規作成、`#`でのObject化、Contextの継承、推移的なTimelineを確かめた。操作の大枠は確認できたが、段落をまたぐ移動や結合など、入力体験を一から作る負担が大きいと分かった。このコードはPhase 1で削除した。

試作中に、次の点を見直した。

- Dailyで`@`を書いても参照先に反映されない点に違和感があった。言及した段落を、所属を変えずに参照先のTimelineへ出すようにした。
- 埋め込みObjectの枠、種別ラベル、Statusボタンが重かった。Taskはチェックボックス付きの1行にした。
- 「Memoは複数行をまとめる単位」という説明は、参照付きテキストとの違いが分かりにくかった。集約の単位を仕組み側で統一し、利用者に区別を求めないことにした。

### 2. 土台の選定

| 候補                   | 判断               | 理由                                                                                 |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| Tiptap 3 / ProseMirror | 採用               | MIT。Block IDの付与、`@`候補メニュー、独自Node、ReactでのNode描画がそろう            |
| BlockNote              | 対抗馬             | Tiptap上のNotion風エディタ。本体はMPL-2.0で一部はGPL-3.0。Schemaの自由度に懸念がある |
| Lexical                | 見送り             | 入れ子コンテナの事例がProseMirror系より薄い                                          |
| AFFiNE（BlockSuite）   | 見送り             | 独自フレームワークで、既存のReact構成へ組み込む負担が大きい                          |
| Logseq DB版、SiYuan    | 振る舞いの参考のみ | AGPL-3.0のためコードは流用しない                                                     |

現行アプリのエディタはCodeMirror 6のMarkdownライブ編集で、Block IDや入れ子のObjectを載せるには向かない。

### 3. Phase 0: Tiptapでの技術検証

Objectを、Titleと本文を持つコンテナNodeとして同じ文書木に置く構成を試した。ブラウザ操作で次の点を確認した。

- `@`の候補メニューから既存Objectの参照と新規作成ができる
- `#`で段落をTaskやDecisionへ変え、次の行で書き続けられる
- TitleでのEnter、本文末尾の空行でのEnterでObjectの外へ出る。Title先頭のBackspaceでObjectを解除する
- 段落から入れ子のTaskへまたがる選択を削除でき、Undoで元に戻る
- 文書内のTaskのTitleを編集すると、同じ文書の参照チップが追従する
- 文書木をObject単位へ分解し、元の文書木へ復元できる

日本語IMEでの入力は、利用者が実機で試して問題がないことを確認した。

### 4. Phase 1: エディタ核

`packages/editor`を新設し、Phase 0の構成と自作Prototypeの操作を統合した。`?demo=object-document`で確認できる。

- `document-model.ts`: 文書木の分解と復元、時刻順のID、言及が届く単位の抽出
- `workspace-model.ts`: Objectの保存、作成位置からのContext継承、推移的なTimeline
- `object-editor.tsx`: Tiptapの独自Node（参照チップ、Objectブロック）、`@`と`#`のメニュー、`ObjectEditor`コンポーネント

デモはメモリ上のWorkspaceを持ち、Daily、Area、Project、Taskの各画面で同じエディタを使う。文書を編集するたびにObject単位へ分けて保存し、画面を移ると保存内容から文書木を組み立て直す。ブラウザ操作で次の点を確認した。

- Projectの本文で`#task`や`@`から作ったTaskが、そのProjectのContextを継承してTimelineに出る
- Dailyで見出しや段落に`@`を書くと、参照先のTimelineに見出し、段落の単位で出る
- 別の画面へ移って戻っても、作成したObjectと本文が残る

BlockのIDは先頭に作成時刻を持たせ、Timelineの並び順に使っている。

## 未実装・未確認

- 保存。変更はページを再読み込みすると消える
- Quick Capture、複数Blockをまとめた取り込み、同じObjectの複数箇所への埋め込み
- 埋め込みObject上でのContext追加。Object自身の画面からは追加できる
- モバイルSafariの実機での挙動
- 文書から消したObjectは、他に置かれていなければ削除する。Undoで戻すと、作成日時と手動で付けたContextは失われる

## 次の段階

| Phase           | 内容                                                                         |
| --------------- | ---------------------------------------------------------------------------- |
| 2. 保存と索引   | SQLite Schema、参照とContextの索引、Timelineの問い合わせ、API                |
| 3. アプリ統合   | Daily、Project / Task画面、Quick Capture、既存VaultのImport、MCPツールの対応 |
| 4. SchemaとView | ユーザー定義SchemaとProperty、Table / ListなどのView、Markdown Export        |
| 5. 仕上げ       | モバイルの操作性、端末間の同期方式、オフライン                               |

SQLiteを正本にすると、Syncthingでの同期や外部エディタからの直接編集は使えなくなる。このトレードオフは未決である。
