# サーバーのセットアップ（Docker Compose・Cloudflare Tunnel）

更新日: 2026-11-14

サーバーでContextoryを動かし、ブラウザーやiPhoneから使うための手順。サーバーがSQLiteのDBを開き、HTTP APIとWeb画面を配信する。Cloudflare Tunnelを通して外部から接続し、Cloudflare Accessで認証する。

```text
ブラウザー / iPhone → Cloudflare Access → Cloudflare Tunnel → Contextory（objects.sqlite）
```

MacアプリのDBとサーバーのDBは別々で、同期しない。

この構成は、Cloudflareで管理するドメイン、Tunnel、Access applicationを作れることが前提。

## 1. Web画面を起動する

サーバーでリポジトリを取得し、次を実行する。

```sh
docker compose --env-file deploy/.env --profile web up -d --build
docker compose --env-file deploy/.env logs --tail 100 pkm
```

ビルドでは、Node.js用の`better-sqlite3`とWeb画面をLinuxコンテナ内で作る。MacのElectron向けのバイナリはイメージへ持ち込まない。DBはnamed volume `server-data`の`objects.sqlite`に置く。

HTTPはサーバーのloopbackの3210番だけで待ち受ける。初回の確認はSSH経由で行う。

```sh
ssh -L 3210:127.0.0.1:3210 USERNAME@SERVER
```

`http://127.0.0.1:3210`で今日のDailyが開くことを確かめる。

## 2. Cloudflare AccessとTunnelを設定する

HTTP API自体には認証が無いので、外部に公開するhostname全体をCloudflare Accessで保護する。

1. CloudflareのZero TrustでAccess application（Self-hosted）を作り、使うhostname（例: `pkm.example.com`）全体に、自分のメールアドレスなどのAllow policyを設定する。`/api/*`と`/health`も認証の対象に含める。
2. Cloudflareでremotely managed Tunnelを作り、Docker connector用のTunnel tokenを取得する。
3. `deploy/.env`の`CLOUDFLARE_TUNNEL_TOKEN`にtokenを設定する。
4. Tunnelのpublished application routeを次のように設定する。

   | 項目         | 値                                |
   | ------------ | --------------------------------- |
   | Hostname     | Accessで保護した`pkm.example.com` |
   | Service type | HTTP                              |
   | Service URL  | `pkm:3210`（`http://pkm:3210`）   |

   `localhost:3210`はcloudflaredコンテナ自身を指すので使わない。

5. サーバーでTunnelを起動する。

```sh
docker compose --env-file deploy/.env --profile tunnel up -d --build
docker compose --env-file deploy/.env logs --tail 100 cloudflared
```

6. 未ログインのプライベートウィンドウで`https://pkm.example.com/health`を開き、Accessのログインが求められることを確かめる。
7. ログイン後にWeb画面を開く。iPhoneではSafariの共有メニューから「ホーム画面に追加」できる。

Tunnelは外向きの接続を使う。Cloudflareへの7844番の接続を許可する。3210番をインターネットへ開ける必要は無い。`deploy/.env`はGitの管理対象外。

## 運用・バックアップ

```sh
docker compose --env-file deploy/.env --profile tunnel ps -a
docker compose --env-file deploy/.env logs --tail 100 pkm cloudflared
docker compose --env-file deploy/.env --profile tunnel stop
```

停止してもnamed volumeは残る。`docker compose down -v`はDBを削除するので使わない。`server-data` volumeの`objects.sqlite`を定期的にバックアップする。

## 公式資料

- [Cloudflare Tunnelセットアップ](https://developers.cloudflare.com/tunnel/get-started/)
- [Cloudflare AccessでSelf-hosted applicationを保護する](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
