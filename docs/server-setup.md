# Desktop Vault・Docker Compose・Cloudflare Tunnel セットアップ

更新日: 2026-10-04

DesktopはローカルVaultを読み書きし、Syncthingでサーバーと正本ファイルを双方向同期する。
サーバーでは同じVaultをHTTP API / Web UIとして提供し、Cloudflare Tunnelを通して
ブラウザやiPhoneからアクセスする。

```text
Desktop → ローカルVault ← Syncthing → サーバーVault ← PKM Web / API
                                                       ↑
ブラウザ / iPhone → Cloudflare Access → Cloudflare Tunnel
```

TunnelのHTTP公開ルートはWeb UI用。Syncthingのファイル転送には、Syncthingの
直接接続またはリレーを使う。通常のHTTPルートに22000番の転送先を指定しても同期できない。
この構成はCloudflareで管理するドメイン、Tunnel、Access applicationの作成が前提。
ChatGPT用のOpenAI Secure MCP Tunnelは別の接続経路で、ホストの`tunnel-client`から
Bearer付きMCPへ直接接続する。[MCP接続手順](mcp-setup.md#chatgptからopenai-secure-mcp-tunnelで接続)を参照する。

## 1. DesktopでVaultを選ぶ

```sh
corepack pnpm desktop
```

- 初回は「Vaultを選択」から既存Vaultまたは空のフォルダを選ぶ。macOSでは選択ダイアログ内で新しいフォルダを作成できる。
- 空のフォルダ（Finderの`.DS_Store`だけの場合も含む）は自動で初期化する。
  UUIDv7の`vault_id`、`schema_version`、6種のEntityディレクトリ、`assets/`、`.stignore`を作る。
- `vault.yaml`がある場合はそのIDと内容を使う。既存の設定や`.stignore`は上書きしない。
- ファイルがあるのに`vault.yaml`がない場合、初期化せずエラーを表示する。
- 最後に正常に開いたVaultの絶対パスをElectronの`userData/vault-preferences.json`へ保存する。
  次回起動時は自動で開く。キャンセルや失敗した選択では保存先を変更しない。
- 保存先が見つからない、または`vault.yaml`が失われた場合は選択画面へ戻る。
  自動復元では初期化しないため、移動後のパスを選び直す。
- 「Vault・同期設定」で場所・Vault ID・同期Folder IDを確認し、Vaultを変更できる。

CLIから空のフォルダを初期化する場合は、build後に次を使う。

```sh
mkdir -p /path/to/new-vault
corepack pnpm pkm init /path/to/new-vault
```

すでに使っているVaultを別端末に同期する場合、その端末で空の受信先を新規Vaultとして
開かない。Syncthingで`vault.yaml`が届いてから選択する。

## 2. サーバーでSyncthingを起動する

サーバーにDocker EngineとDocker Composeを導入し、このリポジトリをcloneする。
以下はすべてリポジトリrootで実行する。

```sh
cp deploy/.env.example deploy/.env
docker compose --env-file deploy/.env up -d syncthing
docker compose --env-file deploy/.env ps -a
```

Composeは受信先と`.stignore`を先に用意する。サーバー側で`vault.yaml`を新規作成しない。
`vault`と`syncthing-config`のnamed volumeを永続化し、書き込み所有者はUID/GID 1000に揃える。
独立したVaultを運用する場合はComposeの`-p`で別のproject名を指定する。

Syncthing GUIはサーバーのloopbackの8385番に公開する。SSH経由で開く。

```sh
ssh -L 8385:127.0.0.1:8385 USERNAME@SERVER
```

Macのブラウザで`http://127.0.0.1:8385`を開く。ローカル8385が使用中なら
`-L 8386:127.0.0.1:8385`とし、ブラウザも8386にする。GUIのusername/passwordを設定する。
このGUIやREST APIをTunnelで公開する必要はない。

ファイル転送はTCP/UDP 22000番を使用する。直接接続する場合はこのportへの到達性を確保する。
NATやfirewallで到達できない場合はSyncthingのdiscovery/relayを使う。
Dockerのbridge networkではLAN discoveryに制約があるため、LAN内の直接接続を使う場合は
相手のDevice設定のAddressesに`tcp://SERVER:22000`を追加する。

## 3. MacとサーバーのVaultを共有する

Mac側は[Syncthingセットアップ](syncthing-setup.md)の手順でSyncthingを起動する。

```sh
brew install syncthing
brew services start syncthing
```

1. MacのGUI（`http://127.0.0.1:8384`）とサーバーGUIで「Actions → Show ID」を開く。
2. 両側の「Add Remote Device」で相手のDevice IDを相互登録する。
3. Mac GUIの「Settings → GUI」でAPI Keyを確認する。
4. Desktopの「Vault・同期設定」にMacのAPI KeyとサーバーのDevice IDを入力する。
   URLは通常`http://127.0.0.1:8384`のまま。「接続・同期状態を確認」でMacのDevice IDとFolder状態を確認できる。
5. 「Vaultを同期に登録」で`pkm-<vault_id>`のSend & Receive folderを登録する。
   `.stignore`がない既存Vaultでは作成する。既存のignore設定が同期境界を満たさない場合は
   エラーを表示するため、`.pkm`と`.git`を除外し正本を含む設定へ手動で直す。
6. サーバーGUIで共有要求を承認する。**Folder IDを変更せず、Folder Pathを
   `/var/syncthing/vault`、Folder TypeをSend & Receiveにする。**
7. 両側が「Up to Date」になるまで待つ。

API Keyは設定画面を閉じると破棄する。Vaultにもアプリ設定にも保存しない。
登録済みFolderのpathや共有先はこの画面から変更しない。共有先の追加はSyncthing GUIの
Folder → Sharingで行う。Default Folderは使用しないため、不要なら両側のGUIで削除する。

## 4. Web UIを起動する

Vaultの初回同期後、サーバーで次を実行する。

```sh
docker compose --env-file deploy/.env --profile web up -d --build
docker compose --env-file deploy/.env logs --tail 100 pkm
docker compose --env-file deploy/.env exec pkm node apps/server/dist/cli-main.js validate /var/syncthing/vault
docker compose --env-file deploy/.env exec pkm node apps/server/dist/cli-main.js check-sync /var/syncthing/vault
```

buildはNode.js用の`better-sqlite3`とWeb UIをLinuxコンテナ内で生成する。
MacのElectron向けnative binaryはイメージへ持ち込まない。
HTTPはサーバーのloopback 3210番のみ。初回確認はSSH経由で行う。

```sh
ssh -L 3210:127.0.0.1:3210 USERNAME@SERVER
```

`http://127.0.0.1:3210`で一覧が見えることを確認する。`vault.yaml`の受信前に起動した場合は
PKMがエラーで再起動を繰り返すので、GUIの受信pathと共有状態を確認する。

## 5. Cloudflare AccessとTunnelを設定する

PKM HTTP API自体には認証がないため、外部公開するhostname全体をCloudflare Accessで保護する。

1. CloudflareのZero TrustでAccess application（Self-hosted）を作り、使うhostname
   （例: `pkm.example.com`）全体に、自分のメールアドレスなどのAllow policyを設定する。
   `/api/*`（SSEの`/api/events`や添付の`/api/assets/*`を含む）と`/health`も認証対象になる設定にする。
2. Cloudflareでremotely managed Tunnelを作成し、Docker connector用のTunnel tokenを取得する。
3. `deploy/.env`の`CLOUDFLARE_TUNNEL_TOKEN`にtokenを設定する。
4. Tunnelのpublished application routeを次のように設定する。

   | 項目 | 値 |
   | --- | --- |
   | Hostname | Accessで保護した`pkm.example.com` |
   | Service type | HTTP |
   | Service URL | `pkm:3210`（`http://pkm:3210`） |

   `localhost:3210`はcloudflaredコンテナ自身を指すため使用しない。
5. サーバーでTunnelを起動する。

```sh
docker compose --env-file deploy/.env --profile tunnel up -d --build
docker compose --env-file deploy/.env logs --tail 100 cloudflared
```

6. 未ログインのプライベートウィンドウで`https://pkm.example.com/health`と`/api/entities`を開き、
   Vault情報ではなくAccessのログインが要求されることを確認する。
7. ログイン後にWeb UIを開き、Mac/Desktopとブラウザで互いの編集が反映されることを確認する。
   iPhoneはSafariの共有メニューから「ホーム画面に追加」できる。

Tunnelは外向き接続を使う。Cloudflareへの7844番の接続を許可する。
PKMの3210番やSyncthing GUIの8385番をinternetへ開放する必要はない。
Tunnel tokenが空の場合はconnectorが起動できない。`deploy/.env`はGit管理対象外。

## 運用・バックアップ

```sh
docker compose --env-file deploy/.env --profile tunnel ps -a
docker compose --env-file deploy/.env logs --tail 100 syncthing pkm cloudflared
docker compose --env-file deploy/.env --profile tunnel stop
```

停止後もnamed volumeは残る。`docker compose down -v`はVaultとSyncthing設定を削除するため使わない。
同期はバックアップの代わりにはならない。定期的にVaultの正本とSyncthing設定volumeをバックアップする。
`.pkm/`の索引は端末ごとに再生成できる。コンテナイメージのtag/digestは`deploy/.env`で固定できる。
固定したimageの更新時はバックアップ後にpull・再起動する。

## 実機検証（2026-10-04）

Docker Engine 29.4.0 / Compose 5.1.2、Linux arm64コンテナで、実データとは別の
テスト用Vault・named volumeを使って次を確認した。

- Dockerfileからのクリーンビルドと、UID 1000でのPKM起動・SQLiteへの書き込み。
- Composeの受信先準備、Syncthing / PKMのhealthcheck成功。
- Syncthing 2台間での`vault.yaml`初回受信、双方向転送、同期完了への収束。
- `.pkm`とサーバー生成の`index.sqlite`が相手へ転送されないこと。
- Web UI、PWA manifest / service worker、SSE接続の配信。
- HTTP APIからEntryを作成・読取・更新し、相手に同期されること。
- 相手側で編集したEntryがSyncthingとwatcherを経由してHTTP APIへ反映されること。
- 添付ファイルのAPI書き込み・読取・相手側への同期。
- コンテナ内での`validate` / `check-sync`成功。
- cloudflared 2026.7.3の起動、`TUNNEL_TOKEN`対応、Compose内の`http://pkm:3210`への到達性。

実際のCloudflare Tunnel / Access経由の接続は、利用するドメインとTunnel tokenの設定後に
「5. Cloudflare AccessとTunnelを設定する」の手順で確認する。

## 公式資料

- [Syncthing Docker image・UID/GID・GUI・discovery](https://github.com/syncthing/syncthing/blob/main/README-Docker.md)
- [Cloudflare Tunnelセットアップ](https://developers.cloudflare.com/tunnel/get-started/)
- [Cloudflare AccessでSelf-hosted applicationを保護する](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
