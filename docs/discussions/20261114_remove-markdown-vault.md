# Markdown Vaultの旧版を外し、Object文書だけにする

記録日: 2026-11-14

Phase 3でWebとDesktopの画面をObject画面へ切り替えた後も、旧版のMarkdown Vaultを扱うコードが残っていた。ユーザーは既存のフォルダを読めなくなってもよいとしたので、旧版を一式削除した。あわせて、確認で見つかった保存の弱いところを直した。

## 削除したもの

- `packages/contracts`と`packages/mcp`
- `core`と`storage-node`のMarkdown解析、Vault、索引、Syncthing、Agent操作
- `ui`・`apps/web`・`apps/desktop`の旧画面と、それを確かめるbrowser test・Electron smoke
- サーバーの旧API、CLI、MCP
- `fixtures/vault-v1`
- 旧版の仕様書（Schema、MCP接続、Syncthingの手順など）と、OpenAI Tunnel用の起動スクリプト

残したのは、Object文書に使っているコードだけである。`core`の入力検証のうち`requireRequestString`と`requireRequestRecord`は、`object-request-validation.ts`へ移した。

MCPとQuick Captureも使えなくなった。どちらも[Phase 3の要件](20261112_phase3-handoff.md)にあり、`ObjectStore`の上に作り直す。

## サーバーはVaultなしで起動する

`openServerApp`は`objectStorePath`だけを受け取り、`ObjectStore`のAPIとWebの静的ファイルを配信する。`PKM_VAULT_ROOT`は不要になった。Docker Composeからは、Syncthingと受信先の準備、MCPの設定を外した。DBはnamed volume `server-data`に置く。

## 保存の修正

- 保存に失敗した文書を捨てていた。新しい入力が無ければ、3秒後に送り直すようにした。サーバーを止めた状態で入力し、再起動すると、追加の入力なしで保存されることをブラウザーで確かめた。
- Desktopで窓を閉じるときの保存を、同期IPC（`sendSync`）にした。終了処理より先に書き終えるためである。Electronのsmokeに、入力の直後に終了しても再起動後に残っていることの確認を足した。ただし、非同期のままでもこのsmokeは通った。今回の環境では取りこぼしは再現しておらず、同期にしたのは順序を保証するためである。

## Service Workerのエラー表示

確認時にConsoleへ出ていた「An unknown error occurred when fetching the script.」を調べた。登録とキャッシュを消して読み込み直すと、Service Workerは有効になり、キャッシュも作られた。サーバーのログに4xxは無く、通常の再読み込みではエラーは増えなかった。初回登録のときにだけ出る表示で、動作には影響していないと判断し、コードは変えていない。
