# サーバーのセットアップ（Docker Compose・Cloudflare Tunnel）

更新日: 2026-11-14

サーバーでContextoryを動かし、ブラウザーやiPhoneから使うための手順。サーバーがSQLiteのDBを開き、HTTP APIとWeb画面を配信する。Cloudflare Tunnelを通して外部から接続し、Cloudflare Accessで認証する。

```text
ブラウザー / iPhone → Cloudflare Access → Cloudflare Tunnel → Contextory（objects.sqlite）
```

Macアプリは、Accessのservice tokenを使ってこのサーバーのDBへつなげる（「3. Macアプリからつなぐ」）。つながない間は、Mac内のDBを使う。二つのDBは同期しない。

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

## 3. Macアプリからつなぐ

Macアプリは、Cloudflare Accessのservice tokenをリクエストのヘッダー（`CF-Access-Client-Id`と`CF-Access-Client-Secret`）に付けてサーバーへつなぐ。Tunnelはそのまま使い、3210番は外へ開かない。

1. CloudflareのZero Trustで、service tokenを作る。表示されたClient IDとClient Secretを控える。
2. 「2.」で作ったAccess applicationに、Actionを**Service Auth**にしたpolicyを足し、そのservice tokenを許可する。ActionがAllowのままだと、ログイン画面へ転送されて接続できない。
3. Macアプリのメニュー「Contextory」→「サーバー接続…」を開き、サーバーのURL（例: `https://pkm.example.com`）、Client ID、Client Secretを入れて「接続して保存」を押す。
4. 接続と認証を確かめてから保存先が切り替わり、画面が読み直される。ナビゲーションの下の表示が「pkm.example.comへ保存」になる。

- Secretは、macOSのキーチェーンの鍵で暗号化して、アプリのデータフォルダの`server-connection.json`に保存する。
- 「このMacのDBに戻す」を押すと、接続設定を消してMac内のDBへ戻る。Mac内のDBの内容はそのまま残っている。
- サーバーにつながらない間は、読み込みも保存もできない。保存に失敗した入力は、画面を開いている間は3秒ごとに送り直す。
- 端末をなくしたときは、Cloudflareでその端末のservice tokenを削除する。端末ごとに別のtokenを作っておくと、ほかの端末に影響しない。

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
