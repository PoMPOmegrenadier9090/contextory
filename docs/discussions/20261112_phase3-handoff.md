# Phase 3への引き継ぎ（2026-11-12）

Object文書の再設計を、別の担当へ引き継ぐための文書である。Phase 2までの到達点、変えない前提、Phase 3の要件と進め方をまとめる。

「決定」と書いた項目はユーザーと合意済みである。「提案」と書いた項目は前任の案で、ユーザーの確認を取っていない。

## 1. 最初に読むもの

| 文書                                                                           | 内容                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [AGENTS.md](../../AGENTS.md)                                                   | 作業の決まり。ブランチ作業、検証、commit・push・PRの扱い     |
| [object-document-design-proposal.md](../object-document-design-proposal.md)    | 再設計の元になった設計案。Quick CaptureやDailyの考え方を含む |
| [20261112_object-editor-prototype.md](20261112_object-editor-prototype.md)     | Tiptapを選んだ経緯と、エディタ核（Phase 0〜1）               |
| [20261112_object-store-phase2.md](20261112_object-store-phase2.md)             | SQLiteの保存層とAPI（Phase 2）、Object作成の入口の決定       |
| [20261112_type-and-field-schema.md](20261112_type-and-field-schema.md)         | 種別・Field・Contextの定義と、残した近道                     |
| [architecture.md](../architecture.md)、[pkm-schema-v1.md](../pkm-schema-v1.md) | 既存アプリの構成と、既存Vaultの保存形式                      |

## 2. 現在地

作業ブランチは`codex/object-view-demo`で、[PR #1](https://github.com/PoMPOmegrenadier9090/contextory/pull/1)に積んでいる。mainへはmergeしていない。

新しい仕組みは、既存アプリと並んで動く試作の段階にある。既存のEntity（Markdownファイル）の画面や保存には、まだつながっていない。

### できていること

- 編集中は1つの文書木として扱い、保存時にObject単位へ分ける。開く時に結合し直す。
- `#`で、書いた段落をその場でObjectにする。既存に無い名前を打てば、新しい種別になる。
- `@`で参照チップを置く。言及した最小の構造（段落、リスト項目、見出し以下）が、参照先のTimelineに届く。
- ContextはObject間の関係で、推移的に辿ってTimelineを組み立てる。新しいObjectは、置かれた場所からContextを継ぐ。
- 種別ごとにFieldを定義できる。型はContext、テキスト、参照、日付、選択。種別は継承元を持てる。
- 種別のページで、名前・色・チェックボックスの有無・継承元・Fieldを編集できる。

### コードの場所

| 場所                                        | 役割                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/core/src/object-document.ts`      | 文書木の分割と結合、Field行の出し入れ、言及の単位の抽出、時刻順のID                  |
| `packages/core/src/object-model.ts`         | Object・種別・Field・Timelineの型、種別名の検証、Contextの継承規則                   |
| `packages/storage-node/src/object-store.ts` | `ObjectStore`。SQLiteの保存、索引、Timeline、種別の定義。スキーマはv4                |
| `apps/server/src/object-api.ts`             | `/api/next`配下のHTTP API                                                            |
| `packages/editor/src/object-editor.tsx`     | Tiptapのエディタ。`ObjectEditor`と`EditorHost`（外側へ頼む操作の窓口）               |
| `packages/editor/src/editor.css`            | エディタの見た目。色は`--pe-*`で上書きする                                           |
| `apps/web/src/object-document-demo.tsx`     | 試作の画面。`?demo=object-document`で開く。Daily、Objectのページ、種別のページを持つ |

`ObjectStore`を開いているのは`apps/server`だけである。Desktop（Electron）のmain側とIPCには、まだ入口が無い。

### 動かし方

```bash
corepack pnpm check
```

```bash
corepack pnpm build
```

試作の画面は、ビルド後にサーバーを一時Vaultで起動して開く。利用中のVaultを指さないこと。

```bash
PKM_VAULT_ROOT=/path/to/temp-vault PKM_SERVER_PORT=5198 node apps/server/dist/server-main.js
```

開くURLは`http://localhost:5198/?demo=object-document`である。DBは`<Vault>/.pkm/objects.sqlite`に作られる。

Webの本番ビルドはService Workerを登録する。ビルドし直した後に古い画面が出る時は、Service Workerの登録とキャッシュを消してから読み込み直す。

## 3. 変えない前提（決定）

- **Objectの作成は`#`が主な入口である。** Tana Outlinerの「`#`でその場に作る」体験を手本にする。`@`からの新規作成は補助で、参照チップだけを置き、その場へは埋め込まない。
- **`@`は所属を変えない。** 言及した記述を参照先のTimelineへ届けるだけである。
- **Contextはアプリの中核である。** すべての種別が持つ特別なFieldとして見せ、推移的な収集と作成位置からの継承を保つ。
- **Memoと「参照付きの文章」の違いを、ユーザーに意識させない。** 集約の仕方は仕組みの側で揃える。
- **種別の定義は種別のページで行う。** Fieldの並び順が、そのまま見せる優先度になる。`>`でFieldを書きながら定義する入力は入れない。
- **行の見た目はTanaに寄せる。** 行頭に開閉のトグルと「開く」ための点、行末に種別のタグを置く。Taskも1つのObjectとして表示し、チェックボックスは種別ごとの設定にする。
- **Fieldは、畳むと値のあるものを行末に、展開するとTitleと本文の間に行として出す。** Object自身のページでは、文書の先頭に常に並べる。
- **エディタはTiptap 3を土台にする。** 入力体験をゼロから作らない。
- **Viewは既製のヘッドレスな部品と、自前の問い合わせ層で作る。** Phase 4で扱う。

## 4. Phase 3の要件

Phase 3の目的は、試作を既存アプリの本体へ組み込み、日常の入力に使える状態にすることである。ロードマップで挙げていた項目は次の5つで、ここまではユーザーと合意している。項目ごとの細かい仕様は未決のものが多い。

### 4.1 画面への組み込み

- WebとDesktopの両方で、Daily、Objectのページ、種別のページを本体の画面として開けるようにする。
- 試作の画面（`object-document-demo.tsx`）の状態管理は、本体へそのまま持ち込まない。保存の列、遅延保存、Objectの要約のキャッシュを、本体の取得・通知の仕組みに合わせて作り直す。
- Desktopでは、main側で`ObjectStore`を開き、IPCの入口を足す。入力の検証は、HTTPと同じものを使う。
- 既存アプリとは仕組みが大きく変わるため、入力体験と画面構成は刷新してよい（ユーザーと合意済み）。
- AreaやProjectのように置き場所を持たないObjectには、ナビゲーションの「＋」やコマンドパレットなど、文書の外の入口を用意する（決定。未実装）。

### 4.2 Daily

- Dailyは日付ごとの自由文書で、直接書き込める（決定）。その日に作成したObjectの一覧を下に並べる。
- 過去の日付への移動を足す。文書のIDは`daily:YYYY-MM-DD`である。

### 4.3 Quick Capture

- 設計案では「Quick CaptureはMemo Objectを作る」としている。Capture元とContextを区別する考え方も、設計案にある。
- 既存アプリにもQuick Captureがある。前任はその実装を読んでいない。既存の入口を活かして保存先を新しいObjectへ向けるのか、作り直すのかは、実装を確認してから決める。

### 4.4 既存Vaultの取り込み

- 既存のEntity（Markdown）を、新しいObjectへ変換する。`ObjectStore.importWorkspace`が、内容をすべて置き換える入口として用意してある。
- 種別、親子関係、本文、Todo、参照をどう対応させるかは未決である。既存の形式は[pkm-schema-v1.md](../pkm-schema-v1.md)で確認する。
- 利用中のVaultを書き換えない。変換は別の場所へ書き出し、元のMarkdownには触れない。

### 4.5 MCPツール

- 既存のMCP（`packages/mcp`）は、Entityを対象にしている。新しいObject、Context、Timeline、種別を扱うツールを足す。
- 設計案には「人間向けの画面とAgent向けのContextは表示を分ける」という方針がある。

## 5. 先にユーザーへ確認すること

次の点は実装の形を大きく左右する。着手前にユーザーへ確認する。前任は答えを持っていない。

1. **正本と同期。** 新しい仕組みはSQLiteが正本である。既存アプリは、MarkdownをSyncthingで端末間に同期している。DBを`.pkm`配下に置いているのは試作上の都合で、正本の置き場所と端末間の同期の方法は未決である。設計案には「サーバー側のDBを正本にする方向で検討する」とある。
2. **移行の仕方。** 既存の画面と新しい画面をしばらく併存させるのか、一度に置き換えるのか。併存させるなら、どちらを正本にするのか。
3. **Phase 3の最初の一手。** 画面への組み込み、Quick Capture、既存Vaultの取り込みのどれから始めるか。ユーザーは未回答である。
4. **Desktopの扱い。** Desktopは自分で`ObjectStore`を開くのか、サーバーへつなぐのか。1の答えに依存する。

## 6. 進め方（提案）

1. 上の確認事項、とくに正本と同期の方針を決める。ここが決まらないと、DesktopのIPCも取り込みも形が定まらない。
2. Webの本体に、Daily、Objectのページ、種別のページを組み込む。`/api/next`を使い、試作の画面と同じ操作ができることを完了条件にする。
3. 既存Vaultを一時的な場所へ取り込み、実データで画面を確かめる。対応づけの穴をここで洗い出す。
4. Quick Captureを新しいObjectへ向ける。
5. Desktopへ入口を足す。
6. MCPツールを足す。

各段階で、次のことを守る。

- 段階ごとにcommitし、PRへpushする。経過と決定は`docs/discussions/`に、`yyyymmdd_`を先頭に付けたファイルで残す。
- 画面の変更は、ブラウザーで実際に操作して確かめる。確認用に入れたデータは消す。
- 日本語入力（変換中のEnter、確定直後のEnterやTab）は自動操作では確かめられない。ユーザーに確認を頼む。
- 入力体験で迷ったら、Tana Outlinerの挙動を手本にする。ユーザーの手元にTanaがあり、挙動の確認やスクリーンショットの提供を申し出てくれている。

## 7. 残っている近道と、気をつける点

Phase 3で本体へ組み込む時に、問題になりやすいものを挙げる。全体は各文書の「残した近道」にある。

- **同時編集の競合検出が無い。** 後から届いた保存が勝つ。別の端末やタブで同じ文書を開いていると、古い内容で上書きされる。試作中も、開いたままのタブが古い内容を保存し直すことがあった。
- **文書から消したObjectは、他のどこにも置かれていなければ削除される。** 取り消しても、作成日時や手で付けたContextは戻らない。
- **Contextを付けるAPIは、開いている文書のContextの行と同期しない。**
- **`/api/next`には、認証や入力サイズの独自の制限を足していない。**
- **種別の名前が主キーを兼ねる。** 名前の変更は3つの表を書き換える。
- **検索用のTitle文字列は、参照先のTitle変更に追従しない。**
- **日付と選択の行には、キーボードだけでは入れない。**
- **モバイルのSafariでは確かめていない。**
- **Fieldの行は`isolating`にしている。** そのままだと行のすき間にカーソルが置け、そこで入力するとObjectが2つに分かれる。`CollapsedGuard`で塞いでいるので、Fieldまわりのノードを足す時はこの対処を保つ。
- **行末のタグは、ProseMirrorのwidget decorationで置いている。** タグのすぐ左での日本語入力は、ユーザーの確認がまだ取れていない。

## 8. Phase 4以降

- **Phase 4: View。** 種別ごとの一覧、Fieldでの絞り込みと並べ替え、表やボード。種別のページが置き場所になる。TanStack TableとTanStack Virtual、dnd-kit、Mantineを使う想定である。
- **Phase 5: 仕上げと同期。** 競合の検出、モバイルでの入力、端末間の同期。
