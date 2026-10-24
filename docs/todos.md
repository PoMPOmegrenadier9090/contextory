# Todo一覧

更新日: 2026-10-13

## 利用方法

Web/Desktopのサイドバーから「Todo」を開く。Entry本文のGFMチェックリストを1項目ずつ表示し、初期状態は未完了のみとする。完了済み・すべてへの切替、Area/Project/Task/ResourceのContextによる絞り込み、元のEntryへの移動ができる。項目はEntryの作成日時が新しい順、同一Entryでは本文順に並べ、50件ずつページングする。

チェックすると元のMarkdownの `[ ]` / `[x]` を変更し、`updated_at`も更新する。親項目と子項目は独立して完了を切り替える。Task Entityとは別機能であり、Todo用の永続ID・frontmatterプロパティ・期限は追加していない。

Entryの未保存draftがある場合、または一覧取得後に外部更新があった場合、操作を拒否して理由を表示し、一覧を再取得する。draftがあるときは詳細画面で保存・破棄してから操作する。読み取り専用Vaultでは一覧の閲覧のみ可能。

## 派生索引

`.pkm/index.sqlite`の`entry_todos`は本文から再構築できる項目索引。現行のschema生成は[index-database.ts](../packages/storage-node/src/index-database.ts)を参照する。

- `entity_id`: 元のEntry ID
- `marker_from` / `marker_to`: 本文内のチェックマーカーのUTF-16 offset（frontmatterは含めない）
- `text`: 項目の表示用plain text。子リストは親項目のテキストに含めない
- `checked`: 完了状態
- `depth`: 入れ子の深さ
- `source_hash`: 抽出に使ったMarkdownファイル全体のhash

主キーは`(entity_id, marker_from)`である。本文位置は編集で変わるため、永続的なTodo identityとして使わない。重複した文言も位置で区別する。GFMの構文木から抽出し、箇条書き・番号付きリスト・引用内のTodoを扱う。コード・inline code・HTML・表セルの単なるチェックマーカーはTodoとして扱わない。

既存の差分同期時に、変更されたEntryのTodo行だけを削除・再抽出する。物理削除・構文不正化で索引から除去し、論理削除されたEntryは一覧から除外する。Contextの継承による絞り込みは既存の`entity_scopes`を参照する。古い派生indexは全体をリセットし、次の走査で正本から再構築する。通常更新で全Todoを再構築しない。

全再構築でも同じ内容を復元できる。索引は同期対象外で、Markdownのみが正本となる。`local-state.sqlite`のdraftは索引再構築から独立する。

## APIと保存

- `GET /api/todos`: `state=unchecked|checked|all`（既定unchecked）、`limit`（既定50、最大100）、`cursor`、任意の`scopeType`と`scopeId`の組。`created_at DESC, entity_id DESC, marker_from ASC`を基準に`items, nextCursor`を返し、OFFSETとページごとのCOUNTを行わない。Entry本文全体は返さない。
- `PUT /api/todos/check`: `entryId`、`markerFrom`、`checked`、`expectedFileHash`を受け取る。変更済み・draftありは409、不正なパラメータは400となる。
- Desktopも同じVault serviceへIPC経由で問い合わせる。

保存時は最新の正本を読み、hash・Entity identity・削除状態・指定位置のTodoを検証する。正本の他の本文とfrontmatterを保持してマーカーを変更し、保存直前にもhashを確認する。Todo操作のためのdraftは作らず、既存draftも削除しない。同一プロセスの同一パスへの書込みは直列化して、同じ版への並行更新の片方を拒否する。別プロセスのエディタやSyncthingを排他ロックするものではない。

専用Todo一覧とWebのTimeline「Todoを含むEntryのみ」はentry_todos索引を使う。Webの一般一覧もページqueryへ移行済み。Desktopの一般一覧には全件取得とローカルfilterが残る。取得境界は[architecture](architecture.md)を参照する。
