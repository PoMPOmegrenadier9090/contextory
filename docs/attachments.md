# 添付ファイル

Entry本文とQuick Captureで添付アイコン、貼り付け、ドロップを使える。1ファイルの上限は10 MiB。画像（PNG/JPEG/GIF/WebP）は形式を確認して `assets/images/`、それ以外は `assets/files/` に衝突しないID名で保存する。SVGや形式の一致しない画像はファイル扱いとし、Webではダウンロードさせる。Quick Captureでは本文入力欄を画像プレビューで広げず、添付を小さな一覧に分けて保存時にMarkdownリンクを本文末尾へ追加する。添付だけのEntryも作成できる。一覧から添付を外しても、アップロード済みassetは即時削除しない。

本文には `![元のファイル名](../assets/images/<id>.png)` または `[元のファイル名](../assets/files/<id>.ext)` を挿入する。相対参照なのでVaultのMarkdownとassetを一緒に同期・バックアップすれば、端末を移してもリンクを維持できる。Webでは `/api/assets/` 経由、DesktopではローカルVaultを読むアプリ専用プロトコル経由で画像を表示する。ファイルリンクと添付一覧はWebで直接ダウンロードし、DesktopではOSの関連アプリを開く。Webの本文表示用画像はinlineのまま、画像を添付一覧から選ぶとダウンロードする。本文のリンク名を保存名に使い、Resourceなど保存名がない参照はassetのID名を使う。`GET /api/assets/<path>?download=1&fileName=<保存名>`で画像もダウンロードできる。保存名はUTF-8のContent-Dispositionで返し、パス部分を除き、制御文字を拒否する。

Resourceのプロパティからも主ファイルを1件添付できる。保存先は同じ `assets/` で、Resourceのfrontmatterに `asset_path: assets/files/<id>.pdf` のように記録する。ファイルの有無は `asset_path` を正とし、既存の `local_content_status` は添付操作で自動更新しない。添付の置き換え・解除は参照だけを変更し、古いファイルをその場では削除しない。複数添付やURLからの取り込みは未対応。

Web/Desktopの「添付整理」では、7日以上前のassetのうち、Markdown本文・Resourceのfrontmatter・ローカル下書き・Syncthing競合コピーにパスが現れないものを候補に挙げる。削除は自動実行しない。候補一覧と確認チェックを経て明示的に実行し、直前に参照とファイル内容を再確認する。削除は永久削除でありSyncthingの他端末にも伝播するため、両端末の同期完了とバックアップを確認してから実行すること。未保存のQuick Capture添付や他端末からまだ到着していない参照は検出できないため、これらがある間は整理しない。

現段階では元画像を保持し、WebPへの自動変換はしない。添付の改名、容量の大きいファイルの分割転送は後続とする。`assets/`はSyncthingの同期対象であり、バックアップ時にはMarkdownだけでなく必ず含める。

## MCPからの添付

書込を有効にしたMCPに`upload_asset`を提供する。`operationId`、`fileName`、標準Base64の`dataBase64`を渡すと、Web/Desktopと同じ保存処理でassetを作成し、`path`、`fileName`、`mimeType`、`size`、`markdown`、`replayed`を返す。上限は1バイト以上・10 MiB以下。MCPの書込listenerはBase64とJSONを収容するためHTTP body上限を15 MiBとし、読取専用listenerは1 MiBを維持する。

`upload_asset`はファイル保存のみ行う。続いて`create_entry` / `update_entry`、または`create_resource` / `update_resource`の本文に返された`markdown`を入れるか、`create_resource`または`update_resource`の`assetPath`に`path`を指定する。Resourceへの指定時はファイルの存在を保存直前にも確認し、`null`で参照だけを解除できる。本文更新には既存と同じhash・下書き保護を適用する。

同じprincipalとVaultで同じ`operationId`・引数を再送した場合は同じassetを返す。操作記録に予約pathと内容hashを保存し、再起動後も重複を防ぐ。中断した書込はファイルが存在しなければ再開、内容hashが一致すれば完了扱いにする。内容変更や完了済みファイルの消失は`OPERATION_RECOVERY_REQUIRED`となり、自動で上書き・再作成しない。添付前に中断したファイルは通常の孤立asset整理の対象になる。

クライアントのローカルパスを送ってもサーバーから読めるとは限らないため、ファイルのbytesをBase64にして渡す。URLからの取得、分割転送、既存添付の本体読取は未対応。クライアントや中継側の転送上限が小さい場合はその上限も適用される。
