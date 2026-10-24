# MCP接続と直接操作

更新日: 2026-10-07

MCPは既存の`LocalVaultService`を使い、Web/Desktopと同じ正本Markdownを読む・更新する。
SuggestionやPKM独自の承認画面はない。変更の意図確認はAgent clientの会話で行い、
PKMは認証、許可field、Validation、hash競合、下書き保護を確認して直接保存する。

## 提供するツール

| ツール | 動作 |
| --- | --- |
| `get_capabilities` | 接続先Vault、書込可否、引用可否、制限を確認 |
| `search_entities` | type/status/priority/context/topic等で検索、cursorで次のページへ |
| `get_entity` | 安全なmetadata、本文ページ、現在の`fileHash`を取得 |
| `get_backlinks` | 公開範囲内の参照元を取得 |
| `get_project_context` | Projectと所属Entityのページを取得 |
| `search` / `fetch` | OpenAIのknowledge取得契約。公開Web URLを設定した時だけ提供 |
| `upload_asset` | ファイルbytesをBase64で保存し、Entry / Resource本文用のMarkdownリンクとResource添付用pathを返す（上限10 MiB） |
| `validate_entity` | 任意の事前検証。保存時も同じ検証を必ず再実行 |
| `create_entry` / `create_task` | 1 Entityを作成。Entryは`origin: ai`、生成時刻・source IDsを記録 |
| `update_entry` / `update_task` | 許可した項目のみ更新。Entry本文も変更可能 |
| `create_project` / `update_project` | Projectの作成・表示名、説明、status、priority、Areaの更新 |
| `create_resource` / `update_resource` | Resourceの作成・本文、表示名、説明、著者、関連Entity、識別子、source URIの更新 |
| `create_topic` / `update_topic` | Topicの明示的な作成・表示名、説明の更新 |
| `create_area` / `update_area` | Areaの作成・表示名、説明の更新 |
| `update_topics` | 明示したTopic IDだけを追加・除去。Topicを自動作成しない |
| `set_entry_context` | Entryのcontextを変更 |

Resourceの全般メモはResource自身のMarkdown本文に保存する。`create_resource`の`body`、`update_resource`の`patch.body`で作成・更新でき、空文字で本文を消去できる。省略時は既存本文を維持する。本文は最大256 KiBで、参照先の可視性・fileHash・draft競合の保護はEntryと同じ。全般メモ用のEntryを別途作る必要はない。

`exclude_from_ai`、削除済み、invalid file、同期競合は利用不可。
非公開のsourceから派生した未curated AI Entryも読取不可。unknown frontmatter、draft、
内部file path、添付file本体は返さない。既存本文内の文字列や参照記法を自動展開しない。
検索の基本公開条件をSQLへ適用後、実ファイルとsourceの可視性を再確認する。
watcher待ちの変更は検索結果から除外するため、ページが指定件数より短くなることがある。
cursorは暗号化し、除外したEntity IDを返さない。MCP hostを再起動したら検索をやり直す。

書込は`operationId`が必須。更新は直前に取得した`expectedFileHash`も必須。
同じ意図の再送には同じID・同じ引数を使い、別の編集には新しいIDを使う。
下書きやhash競合で失敗した操作を、問題解消後に変更して実行する場合も新しいIDを使う。
`OPERATION_RECOVERY_REQUIRED`は外部変更等で復旧を判断できない状態。内容を確認してから
新しい操作として行い、pending記録を消して自動再適用しない。
重複防止は同一host・Vault・認証principalの範囲で、peerを跨ぐ重複は防がない。

作成時は`displayName`が必須（Entryのみ省略可能）。ProjectとTaskのstatusは
未指定なら`not_started`。Topic以外は作成時に`topics`を指定でき、作成後の付け替えは
`update_topics`を使う。更新は`patch`内に変更する項目だけを渡し、nullableな項目は
`null`で解除できる。Project / Task / Topic / Areaは本文を持たず、説明は1行の
`description`に保存する。Resourceの`assetPath`には存在するassetのpathを指定でき、`null`で解除する。任意frontmatterは編集対象に含めない。
参照先は保存直前にも存在・公開範囲・競合を確認する。

例えば、既存AreaとTopicに属するProjectを作成する指定は次のとおり。

```json
{
  "operationId": "create-project-20261005-001",
  "displayName": "学習計画",
  "description": "今月の学習を進める",
  "areaId": "area_01997c2a-7b1c-7a01-8a10-000000000001",
  "topics": ["topic_01997c2a-7b1c-7a01-8a10-000000000002"]
}
```

添付は`upload_asset`で保存したあと、返された`markdown`をEntry / Resource本文に挿入するか、
`path`をResourceの`assetPath`に指定する。操作ごとに別の`operationId`を使う。

```json
{
  "operationId": "upload-notes-20261007-001",
  "fileName": "notes.txt",
  "dataBase64": "SGVsbG8="
}
```

クライアントのファイルbytesを標準Base64にする。ローカルpath・URLからの取得や分割転送は
未対応。詳細と中断時の扱いは[添付ファイル](attachments.md#mcpからの添付)を参照する。

Dockerへ実装変更を反映するにはimageも再buildする。

```sh
docker compose --env-file deploy/.env --profile web up -d --build pkm
```

`.env`の変更だけならコンテナの再作成で反映できる。Tunnelの再起動だけでは
PKMコンテナの設定は変わらない。反映後はclient側のtool一覧も再取得する。

## ローカルserverからCodexへ接続

まずbuildする。Web listenerは既定の3210、専用MCP listenerは3211で、MCP listenerに
`/api/*`やWeb UIを公開しない。MCPは明示的に有効化するまで起動しない。

```sh
corepack pnpm build
export PKM_VAULT_ROOT=/path/to/vault
export PKM_MCP_ENABLED=1
export PKM_MCP_AUTH=token
export PKM_MCP_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
export PKM_MCP_WRITES=1
export PKM_SERVER_DATA_DIR=/path/to/device-local-server-data
corepack pnpm server
```

tokenは32文字以上。native起動の既定listenerはloopback。コンテナ内で非loopbackへbindする場合は
`PKM_MCP_ALLOWED_HOSTS`を明示する。ホスト側のport公開範囲はComposeが制御する。
Agentの設定にはHTTPのURLとBearer headerを指定するか、
stdio bridgeを登録する。bridgeはVaultを別にopenせず、起動済みowner processへ接続する。

```toml
[mcp_servers.pkm]
command = "node"
args = ["/absolute/path/to/pkms/packages/mcp/dist/bridge-main.js"]

[mcp_servers.pkm.env]
PKM_MCP_URL = "http://127.0.0.1:3211/mcp"
PKM_MCP_TOKEN = "same-token-as-owner"
```

`PKM_MCP_WRITES=1`を指定しない接続では読取toolのみ提供する。
変更用の2つの操作モードはなく、書込可否はhost設定と認証scopeで決まる。

## DesktopからCodexへ接続

```sh
PKM_DESKTOP_MCP_ENABLED=1 corepack pnpm desktop
```

Vaultを開くとランダムportのloopback MCPを同じElectron main processで開始し、
Electronの`userData`内に`mcp-connection.json`をpermission `0600`で保存する。
PKMの開発版では通常`~/Library/Application Support/@pkm/desktop/`またはElectronが
app名から決めたuserData directoryになるので、実際に作成されたfileを指定する。
Vault切替時にportとtokenを更新し、旧接続を停止する。bridgeも再接続する。
local tokenは同じowner identityを認証するため、token更新後も同じVaultの再送記録を引き継ぐ。

```toml
[mcp_servers.pkm]
command = "node"
args = ["/absolute/path/to/pkms/packages/mcp/dist/bridge-main.js"]

[mcp_servers.pkm.env]
PKM_MCP_CONNECTION_FILE = "/absolute/path/to/userData/mcp-connection.json"
```

Desktopはoperation記録をVault内`.pkm/agent-state.sqlite`へ保存する。
`.pkm`はSyncthingのignore対象。serverは`PKM_SERVER_DATA_DIR/agent-state.sqlite`へ保存し、
正本Vaultと分離する。どちらもindexのrebuildで削除しない。

## ChatGPTからOpenAI Secure MCP Tunnelで接続

[公式導入手順](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)に従い、
`tunnel-client`のinstall、tunnel ID、OpenAI側のorganization/workspace associationを設定する。
このリポジトリはアカウントのassociationや鍵を自動作成しない。

推奨構成はホスト上の`tunnel-client`からDockerのMCPへHTTPで直接接続する。
同じコンテナに同居させる必要はなく、Nodeのstdio bridgeも不要。

```text
ChatGPT → OpenAI Secure MCP Tunnel → ホストのtunnel-client
  → ホストの127.0.0.1:3211 → Docker port転送 → コンテナの0.0.0.0:3211/mcp
```

`deploy/.env.example`を`deploy/.env`へコピーし、次の項目を設定する。
既存のBearerを使う場合は`MCP_BEARER_TOKEN`という名前も利用できる。
両方が設定されていれば`PKM_MCP_TOKEN`を優先し、Compose・PKM・launcherで同じ値を使う。

```dotenv
PKM_MCP_ENABLED=1
PKM_MCP_AUTH=token
PKM_MCP_HOST=0.0.0.0
PKM_MCP_ALLOWED_HOSTS=localhost,127.0.0.1
PKM_MCP_HTTP_PORT=3211
PKM_MCP_TOKEN=your-bearer-token-at-least-32-characters
PKM_MCP_WRITES=1
CONTROL_PLANE_API_KEY=your-openai-tunnel-runtime-key
OPENAI_TUNNEL_ID=your-tunnel-id
```

`PKM_MCP_WRITES=1`で直接更新も使える。読取だけなら`0`にする。
`tunnel-client`のbinaryをPATHまたは`~/.local/bin/`へ配置する。
別の場所なら`.env`に`TUNNEL_CLIENT_BIN=/absolute/path/to/tunnel-client`を設定する。

```sh
docker compose --env-file deploy/.env --profile web up -d --build
./deploy/start-openai-tunnel.sh
```

launcherは`.env`を読み、提示された既存スクリプトと同じCLI引数で`tunnel-client run`を実行する。
control-plane keyは`env:CONTROL_PLANE_API_KEY`で渡し、MCPのtool callとdiscoveryの両方に
Bearer headerを設定する。launcher自体はsecretを出力しない。健康確認用portも
`127.0.0.1:18080`へ限定し、`OPENAI_TUNNEL_HEALTH_PORT`で変更できる。

既存の環境fileを使う場合は、Composeとlauncherの両方に同じfileを指定する。
launcherはbashの`source`で読むため、自分で管理するbash互換の`KEY=value` fileを使う。

```sh
docker compose --env-file /absolute/path/to/existing/.env --profile web up -d --build
./deploy/start-openai-tunnel.sh /absolute/path/to/existing/.env
```

既存スクリプトをそのまま使うなら、上流URLは`http://127.0.0.1:3211/mcp`へ変更する。
元の`9001`を維持したい場合は`PKM_MCP_HTTP_PORT=9001`とすれば、launcherもそのportへ接続する。
Composeの`--profile tunnel`は既存のCloudflare Web用。OpenAI tunnelには`--profile web`を使う。

コンテナの待受を`0.0.0.0`にしても、Composeの公開先は`127.0.0.1`に固定するので、
MacのLAN IPからこのMCP portへは直接接続できない。BearerとHost/Origin検証も維持する。
Mac上のprocessと同じDocker networkのcontainerからは到達可能だが、Bearerが必要。
OpenAI tunnel経由の利用範囲はOpenAI側のorganization/workspace associationで制御する。

stdioしか扱えないclientには、引き続き`bridge-main.js`を使える。
認証省略の`PKM_MCP_AUTH=private-tunnel`はloopback・読取限定とし、Dockerの非loopback
listenerでは利用できない。標準構成は認証付きHTTPで接続する。

OpenAI側の実アカウント・tunnel接続・ChatGPT画面上の引用表示は、環境設定後に確認する。

## OAuthでpublic remote接続

既存IdPをAuthorization Serverとして使う。PKMはJWT access tokenを検証するResource Server。
PKM独自のlogin、token発行、client登録、ユーザー管理は実装しない。
IdP側ではMCP clientが利用できるOAuth flow・client登録と`pkm:read` / `pkm:write`を設定する。
JWTの`scope`は空白区切り文字列、`sub`・`exp`必須。署名はRS256/ES256/EdDSAに対応。
opaque tokenのintrospectionは未対応。

```sh
export PKM_MCP_ENABLED=1
export PKM_MCP_AUTH=oauth
export PKM_MCP_OAUTH_ISSUER=https://idp.example.com/
export PKM_MCP_OAUTH_JWKS_URL=https://idp.example.com/.well-known/jwks.json
export PKM_MCP_OAUTH_AUDIENCE=https://mcp.example.com/mcp
export PKM_MCP_RESOURCE_URL=https://mcp.example.com/mcp
export PKM_MCP_ALLOWED_HOSTS=mcp.example.com,localhost,127.0.0.1
export PKM_MCP_WRITES=1
```

HTTPS reverse proxyから専用port3211へ`/mcp`と`/.well-known/oauth-protected-resource*`だけを転送する。
listenerは通常loopbackのままでよい。container間のproxyなら`PKM_MCP_HOST=0.0.0.0`と
明示的なallowed hostsを設定する。Originを持つclientには`PKM_MCP_ALLOWED_ORIGINS`に
許可するhostnameを列挙する。未指定ならOriginなしのnative clientだけを受け入れる。

各リクエストでissuer・audience・期限・署名・scopeを検証し、書込にはreadとwriteの両方が必要。
resource metadataはrootと`/.well-known/oauth-protected-resource/mcp`に提供する。
rate limitはprincipalごと120 request/minute、同時8 request、request bodyは読取専用で最大1 MiB、書込有効時は添付転送用に最大15 MiB。
MCP listenerはrequest body・token・note textをログに残さない。

## Docker Compose

ComposeのMCPは既定でtoken認証・container内0.0.0.0:3211、hostのport転送はloopback限定。
MCP自体は`PKM_MCP_ENABLED=1`を設定するまで無効。上のOpenAI tunnel手順で起動する。
`server-data` volumeをoperation記録に使い、prepare serviceがnode UIDへ所有権を設定する。

公開HTTPS経路を使う場合は`.env`に`PKM_MCP_AUTH=oauth`、IdP項目、public hostnameを含む
allowed hostsを設定する。Cloudflare等のproxyでMCP用hostnameの転送先を`http://pkm:3211`にし、
Web用の`http://pkm:3210`と区別する。proxyではOAuthのBearer headerを通す。
`tunnel-client`のbinaryやOpenAI account設定はimageに同梱しない。

同じVault directoryをDesktopとserverの両方で同時にopenする構成は使わない。
同じhostのAgentはownerへのbridgeで接続し、別端末ではSyncthingで同期した別directoryを使う。

## 引用URL

serverに次を設定する。引用先はMCP入口とは別の、ユーザーがブラウザで開けるPKM WebのURL。

```sh
export PKM_MCP_PUBLIC_WEB_URL=https://pkm.example.com/
```

`search`は`id/title/url`を、`fetch`は`id/title/text/url/metadata`を返す。
URLは`https://pkm.example.com/?entity=<EntityId>`。Webは起動・再読込時に対象Entityを開く。
Web側のloginを経由する場合はproxy/IdPで元のqueryを保つよう設定する。
SDKの`structuredContent`と同じJSONをtext contentにも入れる。
[OpenAIのMCP knowledge契約](https://developers.openai.com/api/docs/mcp)に沿うが、
すべてのChatGPT回答で引用を表示することをサーバー側から保証するものではない。

通常responseは64 KiB、本文ページは8,000文字、検索snippetは400文字。
`fetch`は本文とmetadataを合わせたtext最大256 KiB、serialized response最大1 MiB。
超過時は黙って切り詰めずerrorを返す。大きなEntryには`get_entity`の本文paginationを使う。

## 検証範囲

自動テストは公式SDKのHTTP接続、実stdio child process、引用payload、OAuth JWT検証、
直接更新、draft・hash・同期競合保護、非公開sourceの派生Entry、重複再送、
write後の中断からの復旧、復旧前の外部編集、Desktopのhost lifecycle、
非loopbackのBearer listenerのHTTP呼出し、launcherのCLI引数・認証転送を確認する。
ChatGPTと任意の実IdPへの接続、Desktop GUIからの操作は別途環境で確認する。

### 検索の期間フィルタ

`search_entities` は `createdAt`（作成日時）、`updatedAt`（更新日時）、
`occurredAt`（Entryの発生日時）、`dueAt`（Taskの期限）、
`journalDateRange`（Entryの記録日）を指定できます。
それぞれ `{ "from": "...", "to": "..." }` で、開始を含み、終了は含みません。
片方のみの指定も可能です。複数の期間や既存フィルタはAND条件で結合します。
対象日時が未設定のEntityは、その期間フィルタに一致しません。
日時にはISO 8601のタイムゾーンを必須とし、記録日は `YYYY-MM-DD` を使います。

例えば、日本時間の2026年9月に作成したEntryは次の指定です。

```json
{
  "type": "entry",
  "createdAt": {
    "from": "2026-09-01T00:00:00+09:00",
    "to": "2026-10-01T00:00:00+09:00"
  }
}
```

期間の変更時はcursorを引き継がず、最初のページから検索します。
引用用の簡易 `search` は引き続きテキストqueryのみです。
