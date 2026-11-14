# 開発・運用ガイド

ソースからMacアプリをビルドしてインストールする手順は、[READMEの「Macで始める」](../README.md#macで始める)を参照してください。このページは、開発やサーバー運用を行う方向けの補足です。

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

`check`はフォーマット、型、lint、テストを検証します。SQLiteのバイナリはNode.js用とElectron用で異なります。Desktopを起動・パッケージ化したあとにNode.jsでテストやサーバーを動かすときは、先に`corepack pnpm rebuild better-sqlite3`を実行してください。

Electronでの起動、終了時の保存、再起動後の読み込みは次で確かめます。Electron向けの再ビルドを含むので、終わったら上のコマンドでNode.js用へ戻します。

```sh
corepack pnpm --filter @pkm/desktop smoke:electron
```

## Desktopを開発起動する

```sh
corepack pnpm desktop
```

ビルドと`better-sqlite3`のElectron向け再ビルドを行ってから、アプリを起動します。記録はアプリのデータフォルダにある`objects.sqlite`に保存します。

## macOS配布ファイルを作る

```sh
corepack pnpm --filter @pkm/desktop rebuild:electron-native
corepack pnpm desktop:package
```

`release/Contextory.app`と`release/Contextory-<version>-<arch>.dmg`を生成します。バージョンは`apps/desktop/package.json`、アーキテクチャは実行したMacの`arm64`または`x64`を使います。別アーキテクチャへのクロスビルドは行いません。

生成時にローカルのad-hoc署名、署名検証、アプリ内のSQLite動作、画面の起動、DMG整合性を検証します。Apple Developerの証明書は不要で、Developer ID署名・公証は含みません。終わったら`corepack pnpm rebuild better-sqlite3`でNode.js用へ戻します。

開発変更の検証とインストール済みアプリの置換・復旧は、[PKMS開発スキル](../.agents/skills/pkms-development/SKILL.md)を参照してください。

## サーバーとWeb

```sh
PKM_SERVER_DATA_DIR=/path/to/data corepack pnpm server
```

Webをビルドしてから、HTTP APIとWeb画面を`http://127.0.0.1:3210`で起動します。DBは`PKM_SERVER_DATA_DIR/objects.sqlite`に作ります。`PKM_SERVER_DATA_DIR`を省略すると`~/.local/share/pkm`を使うので、試すときは一時フォルダを指定してください。

APIに認証は無いので、外部に公開するときは認証ゲートウェイの背後に置きます。Docker ComposeとCloudflare Tunnelでの公開は[サーバーのセットアップ](server-setup.md)を参照してください。

Web画面はホーム画面に追加できるPWAとして配信します。読み書きにはサーバーへの接続が必要です。

## 関連ドキュメント

- [設計ドキュメント一覧](README.md)
- [コード構成](architecture.md)
