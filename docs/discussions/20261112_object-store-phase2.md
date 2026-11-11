# Object保存層と索引（Phase 2）の経過

記録日: 2026-11-12

[Object入力体験のPrototypeとTiptap移行の経過](20261112_object-editor-prototype.md)の続き。エディタの内容をサーバーのSQLiteへ保存し、Timelineを索引から組み立てるところまでを試作した。確定した仕様ではない。

## 構成

| 場所                    | 追加したもの                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`         | `object-document.ts`（文書木の分解と復元、時刻順のID、言及が届く単位）、`object-model.ts`（Objectの型、Contextの継承規則） |
| `packages/storage-node` | `object-store.ts`（`ObjectStore`。SQLiteへの保存、索引、Timelineの問い合わせ）                                             |
| `apps/server`           | `object-api.ts`（`/api/next`配下のHTTP API）                                                                               |
| `packages/editor`       | Tiptapのエディタだけを持つ形に整理。文書モデルは`core`から使う                                                             |
| `apps/web`              | `?demo=object-document`をAPI経由の保存へ切り替え                                                                           |

文書モデルを`core`へ移したのは、サーバー側の保存層がReactやTiptapに依存しないようにするためである。

## 保存Schema

DBは既存のVaultとは別のファイルで、既定では`<Vault>/.pkm/objects.sqlite`に置く。

| テーブル     | 役割                                                             | 位置づけ               |
| ------------ | ---------------------------------------------------------------- | ---------------------- |
| `objects`    | 種別、Title、本文、完了、作成日時。TitleとBodyはProseMirror JSON | 正本                   |
| `documents`  | Objectに属さない文書。いまは`daily:YYYY-MM-DD`だけ               | 正本                   |
| `contexts`   | Objectから文脈上の親への関係                                     | 正本                   |
| `placements` | どの文書にどのObjectが埋め込まれているか                         | 本文から作り直せる索引 |
| `mentions`   | `@`を含む最小の構造と、その参照先                                | 本文から作り直せる索引 |

本文はObjectごとに一つのJSONとして持ち、Block単位の行には分けていない。BlockのIDと作成時刻はJSON内の属性にある。

## 保存の流れ

1. エディタが、埋め込みObjectを展開した一つの文書木を送る。
2. サーバーが文書木をObject単位へ分け、一つのTransactionで保存する。
3. 初めて現れたObjectは、置かれた場所からContextを継承して作る。Memo内ならMemoのContextを、それ以外のObject内ならそのObject自体を継承する。
4. 保存した文書と各Objectについて、`placements`と`mentions`を作り直す。
5. その文書から消え、他のどこにも置かれていないObjectを削除する。

画面側は入力を0.4秒まとめてから送り、書き込みを一本の列に並べる。`@`での新規作成と、その直後の本文保存の順序を保つためである。

## Timelineの問い合わせ

対象ObjectへContextを辿って届くObjectの集合を、`contexts`の再帰問い合わせで求める。Timelineは次の二つを合わせ、新しい順に並べる。

- その集合に含まれるObject
- 参照先がその集合に含まれ、置かれている文書は集合に含まれない`mentions`

経路（`via`）は、集合を求めた後に`contexts`を辿って組み立てている。

## 確認したこと

- `ObjectStore`のテスト: Contextの継承、再保存でのContextと作成日時の保持、消したObjectの削除、他の文書に残るObjectの保持、推移的なTimeline、循環するContextの拒否
- HTTP APIのテスト: サーバーを開き直した後も文書とTimelineが残る
- ブラウザ操作: Projectの本文で`#ta`と`@`からTaskを作り、ページを再読み込みした後も本文とTimelineに残る。Titleの変更がナビゲーションへ反映される

確認には、`corepack pnpm --filter @pkm/web build`と`corepack pnpm build`の後に、一時的なVaultを指定して`node apps/server/dist/server-main.js`を起動した。Viteの開発サーバーだけでは`/api/next`へ届かない。

## 残した近道と未決事項

- 検索用のTitle文字列は書き込み時点のもので、参照先のTitle変更には追従しない。
- 経路の組み立ては、Objectごとに`contexts`を辿る。件数が増えたら再帰問い合わせへ寄せる。
- 画面のObject情報は読み込んだ分を持ち続けるため、削除済みのObjectのTitleが参照チップに残ることがある。
- 同時編集の競合検出は入れていない。後から届いた保存が勝つ。
- `/api/next`には認証や入力サイズの独自制限を足していない。既存のAPIと同じ前提で動く。
- DBを`.pkm`配下に置くのは試作上の都合である。正本をどこに置き、端末間でどう同期するかは未決のままである。
- 既存VaultからのImport、Quick Capture、MCPツールの対応はPhase 3で扱う。
