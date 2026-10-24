# 開発・運用ガイド

ソースからMacアプリをビルドしてインストールする手順は、[READMEの「Macで始める」](../README.md#macで始める)を参照してください。このページは、開発やCLI操作、サーバー運用を行う方向けの補足です。

## 開発環境と検証

リポジトリのルートで実行します。Node.jsは`.nvmrc`、pnpmは`package.json`の`packageManager`でバージョンを固定しています。

```sh
nvm use
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm rebuild better-sqlite3
corepack pnpm check
corepack pnpm build
```

`check`はフォーマット、型、lint、テストを検証します。Desktopを起動・パッケージ化したあとも、Node.jsでテストやCLIを実行する前に`corepack pnpm rebuild better-sqlite3`を実行してください。SQLiteのバイナリはNode.js用とElectron用で異なります。

## Desktopを開発起動する

```sh
corepack pnpm desktop
```

ビルドと`better-sqlite3`のElectron向け再ビルドを行ってから、アプリを起動します。Vaultの選択と初期化はインストール済みアプリと同じです。動作確認には空のフォルダや一時Vaultを使ってください。

## macOS配布ファイルを作る

依存関係のインストール後、リポジトリのルートで実行します。

```sh
corepack pnpm --filter @pkm/desktop rebuild:electron-native
corepack pnpm desktop:package
```

`release/Contextory.app`と`release/Contextory-<version>-<arch>.dmg`を生成します。バージョンは`apps/desktop/package.json`、アーキテクチャは実行したMacの`arm64`または`x64`を使います。別アーキテクチャへのクロスビルドは行いません。

Electron本体・実行時の依存関係・アイコンを含め、Vault・API Key・端末設定・開発用依存関係は含めません。パッケージ化の処理は開発環境のSQLiteバイナリやVaultを変更しませんが、先に実行する`rebuild:electron-native`は開発環境のバイナリを変更します。検証後は次を実行してNode.js用へ戻します。

```sh
corepack pnpm rebuild better-sqlite3
```

生成時にローカルのad-hoc署名、署名検証、アプリ内のSQLite動作、画面の起動、DMG整合性を検証します。Apple Developerの証明書は不要で、Developer ID署名・公証は含みません。macOS標準の`ditto`・`sips`・`codesign`・`hdiutil`を使用します。

パッケージ作成コマンドは検証用にアプリを起動しますが、インストールや通常起動は行いません。生成物はGit管理対象外です。開発変更の検証とインストール済みアプリの置換・復旧は、[PKMS開発スキル](../.agents/skills/pkms-development/SKILL.md)を参照してください。

## Vault開発CLI

最初に`corepack pnpm build`したあと、リポジトリのルートで実行します。

```sh
corepack pnpm pkm init /path/to/empty-vault
corepack pnpm pkm validate /path/to/vault
corepack pnpm pkm rebuild-index /path/to/vault
corepack pnpm pkm sync-index /path/to/vault
corepack pnpm pkm check-sync /path/to/vault
corepack pnpm pkm sync-status /path/to/vault
```

`validate`はMarkdownと`vault.yaml`の保存形式との互換性を直接検証します。`rebuild-index`は索引`.pkm/index.sqlite`を全件作り直し、`sync-index`は内容のハッシュが変わったファイルだけを索引へ反映します。自動処理から利用する場合は`--json`を付けます。

`check-sync`は、同期する各端末のVaultのルートにある`.stignore`を検査します。`.stignore`は端末間で同期されないため、Macとサーバーの両方で実行してください。

SyncthingのREST APIを使うコマンドでは、`PKM_SYNCTHING_API_KEY`を環境変数で渡します。`sync-status`はサービスと同期フォルダの状態を読み取ります。初回のフォルダ登録は明示的に実行します。

```sh
PKM_SYNCTHING_API_KEY=... corepack pnpm pkm bootstrap-sync /path/to/vault
```

共有先デバイスを同時登録する場合は、デバイスIDをカンマ区切りの`PKM_SYNCTHING_DEVICE_IDS`で指定します。管理画面のアドレスが既定の`http://127.0.0.1:8384`以外なら、`PKM_SYNCTHING_URL`も指定します。

Mac / Linuxへの導入、端末登録、Vault共有、変更監視の確認、競合試験は[Syncthingセットアップ](syncthing-setup.md)を参照してください。

## Server API / Web application

サーバー1つにつきVault1つのHTTP APIとWeb UIを起動します。Vaultを環境変数で固定し、localhostで待ち受けます。

```sh
PKM_VAULT_ROOT=/path/to/vault corepack pnpm server
```

ブラウザーで`http://127.0.0.1:3210`を開くと、一覧・検索・作成・Live / Raw編集・下書き保存・競合解決・逆参照を利用できます。Vaultの外部変更は変更監視とSSEを通じて画面へ反映されます。APIに認証は含まないため、外部公開時は認証ゲートウェイの背後へ置いてください。

Web UIはホーム画面に追加できるPWAとして配信します。iPhoneではHTTPSで開き、Safariの共有メニューから「ホーム画面に追加」を選ぶと、独立したアプリ画面で起動します。ビルドにmanifestとアイコンを含むため、既存サーバーの静的ファイル配信で利用できます。Vaultの読み書きにはサーバーへの接続が必要で、オフライン用のAPIキャッシュは持ちません。

Docker Compose構成とCloudflare Tunnel / AccessによるWeb接続は[Vault・同期環境セットアップ](server-setup.md)、取得・保存境界は[コード構成](architecture.md)を参照してください。

## MCP / Agent接続

読み取り、引用用search/fetch、6種Entityの直接作成・更新、添付uploadを提供します。Suggestionや承認Queueは設けていません。MCPは既定で無効です。

サーバーの専用HTTP入口、Desktopと同じプロセスのlocal MCP、stdio bridge、OpenAI tunnelとOAuthの設定は、[MCP接続と直接操作](mcp-setup.md)を参照してください。

## 関連ドキュメント

- [設計ドキュメント一覧](README.md)
- [現在の実装状況](implementation-status.md)
- [コード構成](architecture.md)
- [今後の計画](future-roadmap.md)
