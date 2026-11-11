# 自由文書とObjectを両立する入力・表示設計案

更新日: 2026-11-11

状態: 次期設計のたたき台。現行実装の仕様ではない。

Contextoryでは、自由な文書編集と、TanaのSupertagに近いObject化を同じ画面で扱う。文章を書いている途中で任意の範囲をObjectへ変えられ、Objectは元の場所に残る。TableやListなどのViewから同じObjectを作成・編集する経路も用意する。

この文書は、2026年11月時点の入力体験とObject境界の案をまとめたものだ。View、Quick Capture、Daily、Context継承も対象に含む。AIとのWorking Contextや既存Vaultからの移行は、入力体験の設計と分けて扱う。

## 現時点の中心案

- すべての記述要素は、安定したIDと作成日時を持つBlockまたはNodeとして保存する。
- すべてのBlockを意味的なObjectにはしない。任意のBlock群を、明示的なObject Containerで包めるようにする。
- Object ContainerはPropertyを持たなくてもよい。Schemaを付けると、TaskやDecisionなどのTyped Objectになる。
- Object化は補助機能ではなく、文書内の標準操作にする。
- Objectは文書内でもView内でも作成できる。どちらから作っても同じObjectである。
- Objectの配置、由来、Context、業務上のRelationを別々に保存する。
- Quick Captureは、入力項目の少ないMemo Objectを作る。
- Dailyは内容の複製先ではなく、その日に作成・編集した内容を表示するViewとして扱う。

## Block、Object、Schemaを分ける

| 単位             | 役割                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| Block / Node     | 見出し、段落、リスト項目などの記述要素。安定ID、作成日時、更新日時、所属Containerを持つ |
| Object Container | Block群を囲む明示的な記録単位。PropertyやSchemaを持たないObjectも許す                   |
| Typed Object     | SchemaとPropertyを持つObject。Task、Decision、Projectなど                               |
| Memo             | Quick Capture用の軽量なObject。TitleやPropertyの入力を要求しない                        |
| Relation         | Project所属、Parent Task、Related Taskなどの意味的な関係                                |
| View             | 条件に合うObjectをTable、List、Calendarなどで表示・作成する投影面                       |
| Activity         | Block追加、Object作成、編集などの出来事。Dailyを構成するために使う                      |

「すべての記述要素にIDがあること」と「すべてが意味的なObjectであること」は分ける。一方で、Propertyを持たないObject Containerは許す。Memoは、その代表となる。

## 文書内のObject化を標準操作にする

通常の見出し、段落、リスト項目、選択中のBlock群を、その場でObject化できるようにする。Object化しても文章を別のDatabaseページへ移動せず、元の位置と本文を保つ。

入力方法として、次の候補がある。

- 見出しやBlockの末尾で`#`を入力し、Schemaを選ぶ
- 選択メニューから「Objectにする」を実行する
- Slash CommandからObject ContainerまたはTyped Objectを作る
- 既存Objectを`@`で参照する
- Viewの「追加」から新しいObjectを作る

`#task`などの入力文字は本文に残さず、確定後はSchemaラベルへ置き換える案を想定している。

### Objectの境界を常に見せる

Object化した範囲は通常文書へ溶かし込まず、次の表示で境界を明示する。

- SchemaまたはObject種別ごとの色付き左レール
- 薄い背景色
- Object種別、Title、主要Propertyを置くヘッダー
- 入れ子になったObject Containerのインセット表示
- HoverやFocus時の境界強調

```text
┌ Memo ───────────── Context: Contextory ┐
│ 思いついたことを書く                   │
│                                        │
│ ┌ Task ──────────────── 進行中 ┐       │
│ │ 入力体験を再設計する          │       │
│ │ Taskの本文                    │       │
│ └───────────────────────────────┘       │
│                                        │
│ ここはMemoの本文                        │
└────────────────────────────────────────┘
```

コンテナへの出入りも暗黙に決めない。通常のEnterは現在のContainer内で入力を続ける。Container末尾には「このObject内に追加」「Objectの外へ出る」「Nested Objectを追加」などの操作を置く。キーボード操作とドラッグにも対応するが、現在の所属先を画面で確認できるようにする。

Objectを解除した場合はContainerとSchemaを外し、本文Blockは残す。

### Object化する範囲は未決

見出しをObject化したときに、その見出しだけを包むか、次の同階層見出しまでをSectionとして包むかは決まっていない。リスト項目の子要素や、複数Blockを選択した場合の範囲も含め、編集によって境界が変わらない方式を検証する必要がある。

## ViewはObjectを作成・管理する別の入口にする

文書内のObject化とViewからの追加は、どちらも標準の作成経路とする。

- 考えながら書く場合は、文書内でBlockをObject化する。
- 計画や一覧整理を行う場合は、TableやListなどのViewから追加する。
- Viewから作ったObjectも自由記述の本文を持てる。
- 文書内で作ったObjectは、条件に合うViewへすぐ反映する。

Viewが持つFilterは、新規Objectの初期値に使える。ProjectのTasks ViewからTaskを追加した場合は、そのProjectをRelationへ設定する。TaskのSubtasks Viewから追加した場合は、現在のTaskをParent Taskへ設定する。

Project画面で、すべての子Objectを種類に関係なく一つの一覧へ混ぜる表示は標準にしない。ProjectにはTasks View、Decisions View、関連Memoなど、用途の分かるViewを置く。View設定をObjectごとに繰り返さずに済むよう、ProjectやSchemaの既定Viewを継承できる形を検討する。

## 配置と意味的なRelationを分ける

Object Containerの入れ子は、文書上の配置を表す。配置しただけで、常に業務上の親子関係が生まれるわけではない。

| 状況                                  | 配置             | Relationの案                                         |
| ------------------------------------- | ---------------- | ---------------------------------------------------- |
| Task内にTaskを作る                    | Task Container内 | Task Schemaが入れ子を許す場合、Parent Taskを設定する |
| Task内にDecisionを作る                | Task Container内 | Related Taskを候補として設定する                     |
| Task内にPersonを置く                  | Task Container内 | 配置だけではRelationを作らない                       |
| Project Context付きMemo内にTaskを作る | Memo Container内 | MemoのProject ContextをTaskへ継承する                |

Schema側で、Containerの入れ子をどのRelationへ対応させるかを定義する案がある。すべてのSchemaに同じ親子規則は適用しない。

### Taskは再帰的なSubtaskを持てる

Taskは同じTaskへの自己RelationとしてParent Taskを持つ。データ上は任意の深さを許し、画面では一段ずつ開閉する。

```text
Task A
├─ Task A-1
│  ├─ Task A-1-a
│  └─ Task A-1-b
└─ Task A-2
```

Tasks Viewでは、次の表示を切り替えられるようにする。

- ネスト表示: ルートTaskを初期表示し、各行を一段ずつ開く
- 一覧表示: 子孫Taskを平坦な一覧にし、所属経路を表示する

DecisionはTask階層へ入れず、TaskやProjectとのRelationを持つ独立Objectとして扱う案に傾いている。

## Project画面は文書、View、関連Memoを分ける

Project画面には、役割の異なる表示を同居させる。

```text
Project

概要ドキュメント
  自由な文章と文書内Object

Tasks View
  TaskとSubtaskの一覧

Decisions View
  ProjectまたはTaskに関係するDecision

関連Memo
  Context Relationで集約したMemo
```

概要ドキュメントは、Projectの背景や方針を自由に書く場所とする。Memoを自動的に本文へ混ぜず、関連Memoとして別に表示する。必要なMemoだけを明示的に参照または埋め込めるようにする。

Objectの通常表示では、種別、Title、Status、期限など重要なPropertyだけをヘッダーに置く。ほかのPropertyは展開領域やサイドパネルで編集する。

## Reference、Context、Embedを別の操作にする

本文中のObjectへの言及、情報の所属、内容の表示は意味が異なる。

| 操作      | 意味                                                              |
| --------- | ----------------------------------------------------------------- |
| Reference | 本文中でObjectへ言及する。通常はRelationや所属を自動生成しない    |
| Context   | MemoやObjectをProject、Taskなどの文脈へ紐づけ、関連Viewへ集約する |
| Embed     | ObjectまたはViewの内容を、その場所に表示する                      |
| Placement | Object Containerが文書上のどこに置かれているかを表す              |

同じObjectを複数の場所に表示するときも、正本の本文を複製しない。参照または埋め込みとして表示する。

## Quick CaptureはMemo Objectを作る

Quick Captureはどの画面からでも開けるようにし、常に一つのMemo Objectを作る。Memoは入力時の分類を求めない、システム標準の軽量Objectとする。

Memoが持つ情報は、次の範囲を想定している。

- 本文Block
- 作成日時
- Capture元
- 任意のContext
- Memo内から派生したObjectへの由来

Title、Status、期限などの入力は要求しない。最初の行を一覧のPreviewとして使う案がある。

### Capture元とContextを区別する

Quick Captureを起動した場所は、Capture originとして自動記録できる。一方、現在開いているObjectを意味的なContextにするかは、ユーザーが選ぶ。

- グローバルショートカットから起動した場合は、Contextなしを既定にする。
- Objectを開いている場合は、そのObjectをContext候補として表示する。
- Object内の「Memoを追加」から起動した場合は、そのObjectを選択済みにする。
- 保存前にContextを追加、削除、変更できるようにする。

現在のObjectを画面の裏でContextへ追加しない。候補または選択済みのチップとして、保存前に確認できるようにする。

### Memo内で作ったObjectはContextを継承できる

Project Contextを一つ持つMemo内でTaskを作った場合は、TaskのProject RelationへそのContextを設定する案とする。

```text
Project: Contextory 〈Memoから継承〉
```

継承した値はTaskヘッダーに表示し、作成時に削除または変更できるようにする。Memoに複数のProject Contextがある場合は選択を求める。継承はTask作成時に確定し、後からMemoのContextを変更してもTaskを自動変更しない。

この場合も、次の情報を分けて扱う。

- `containedIn`: TaskがMemo本文のどこにあるか
- `derivedFrom`: TaskがどのMemoから生まれたか
- `project`: Taskが属するProject
- `parentTask`: Taskの親Task

Memo内にTaskを置いただけでは、MemoがParent Taskになることはない。

## Dailyはその日の内容を再構成するViewにする

DailyへMemoやObjectの本文を複製せず、作成日時とActivityからその日の内容を表示する。

```text
Daily — 11月11日

自由記述
  その日の文章

Captured
  10:42 Memo
  14:05 Memo

Created Objects
  Task  入力体験を再設計する
  Decision  Memoを軽量Objectにする

Activity
  Contextoryの概要へBlockを追加
  Task Aを完了
```

標準表示の案は次のとおり。

- その日にCaptureしたMemoは、本文付きで表示する。
- その日に作成したTyped Objectは、Object行として表示する。
- 既存Object内で追加した通常Blockは、Object単位でActivityへまとめる。
- 編集履歴は折りたたみ可能なActivityとして表示する。
- 単に閲覧または参照したObjectは、標準では表示しない。

Dailyに自由記述欄を持たせる案も残す。その欄へMemoやObjectを組み込みたい場合は、明示的なReferenceまたはEmbedを使う。

## 人間向け画面とAgent向けContextは表示を分ける

人間とAgentは同じ正本データを使えるが、必要な表示は異なる。人間向け画面では、概要ドキュメント、主要Property、必要なView、関連Memoを選び、読み返せる量に抑える。短い要約だけに限定せず、元の文章や根拠へ辿れるようにする。

Agentには、目的に応じてObject、Relation、Activity、元Blockを問い合わせられる取得方法を用意する。人間向け画面へ全データを表示することや、人間とAgentが別々に同じ内容を入力することは前提にしない。

議論の目的、前提、仮説、未決事項を共有するWorking Contextは別の研究課題として残す。入力体験の設計を固める前提にはしない。

## 保存はサーバー側のDBを正本にする方向で検討する

次期構想では、サーバー側でDBを保持し、各端末はAPIを通じてTransaction単位で読み書きする方向を想定している。各端末へDBファイルを分散しない。MarkdownへのExportとImportは、正本の形式とは分けて検討する。

BlockとObject ContainerをDBでどのように表すかは未決である。Schema、Property、Relation、Placement、Activityの保存方法も決まっていない。入力体験を小さなPrototypeで検証してから、保存Schemaを決める。

この方向は、Markdown正本とSyncthingを使う現行実装からの変更案である。現行仕様は[現在設計 v3](pkm-current-design-v3.md)を参照する。

## 現在のPrototypeで確認できること

`codex/object-view-demo`ブランチのWeb Prototypeでは、次の操作を確認できる。

- Tasks ViewからTaskを追加する
- 任意の深さへSubtaskを追加する
- Taskを一段ずつ開閉する
- ネスト表示と一覧表示を切り替える
- Taskの本文とPropertyをサイドパネルで見る
- DecisionをTask階層と分けて表示する
- 関連MemoをProject本文とは別に表示する

Prototypeには、Block Editor、文書内のObject化、明示的なObject Containerは含まれていない。Quick CaptureのContext候補、Dailyの再構成View、DB保存も未実装である。現在のPrototypeはViewからのObject作成を確認するもので、次期設計全体を表してはいない。

## 未決事項

- Object化するBlock範囲と、編集後も境界を安定させる方法
- Object Containerへ入る操作、外へ出る操作、キーボード操作
- 一つのObjectへ複数Schemaを付けられるか
- 文書内で作ったObjectの正本位置と、Viewから作ったObjectの本文の置き場所
- Schemaごとの入れ子とRelation継承をどこまで自動化するか
- 継承したContextの確認操作と、複数Contextがある場合の選択
- Memo全体を別のTyped Objectへ変えるか、Memoから新しいObjectを派生させるか
- Dailyの自由記述とActivity Viewを同じ画面でどう配置するか
- ProjectやSchemaが持つ既定Viewと、ユーザーが変更できる範囲
- 人間向けの情報量とAgent向け取得Contextの組み立て方
- DB Schema、Markdown Export / Import、既存Vaultからの移行方法

## 次に確認するPrototype

次のPrototypeでは、通常の文書を中心に置き、Object化の一連の操作を確認する。

1. 見出し、段落、複数BlockをObject Containerで包む。
2. Containerの内側と外側へ明示的に移動する。
3. Schemaを付け、主要Propertyを表示する。
4. 文書内で作ったObjectをViewへ反映する。
5. Project Context付きMemo内でTaskを作り、継承値を確認・変更する。

ここで入力と境界の扱いを確認してから、View設定や保存Schemaを具体化する。
