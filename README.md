# Contextory

**Contextに紐づけて書く。知識が自然にまとまる。**

Contextoryは、自由に書いた文書の中で、まとまりをObjectとして切り出せるナレッジアプリです。ObjectにはTask・Project・Memoなどの種別があり、どのContextに属するかを持ちます。文書で`@`を使って言及すると、参照先のTimelineにその記述が出ます。

記録はSQLiteに保存します。Webはサーバーに置いたDBを使います。Macアプリは手元のDBか、サーバーのDBのどちらかを使います。

[Macで始める](#macで始める) · [開発・運用](docs/development.md) · [設計ドキュメント](docs/README.md)

## できること

- Dailyに自由に書き、段落や見出し、リストの項目を`#`でObjectにする
- `#`に知らない名前を入れると、新しい種別を作る
- 種別ごとにFieldを定義する。Contextはどの種別にもある特別なFieldで、そのObjectがどこに属するかを表す
- `@`で他のObjectに言及すると、参照先のTimelineにその記述が出る
- Quick Capture（⌘⇧M）でMemoを今日のDailyに足す。開いているProjectなどをContextに付けられる
- Dailyの「この日のMemo」で、ほかの文書でその日に作ったMemoを読み、そのまま編集する

## Macで始める

ソースからビルドします。Apple Silicon / IntelのMacに対応し、ビルドしたMacと同じアーキテクチャのアプリを作ります。

### 1. ビルド環境を用意する

Git、[nvm](https://github.com/nvm-sh/nvm)、Python 3、Xcode Command Line Toolsを用意してください。Command Line Toolsが未導入なら、次を実行してインストールします。

```sh
xcode-select --install
```

### 2. ソースを取得してビルドする

Node.jsは`.nvmrc`、pnpmは`package.json`で指定したバージョンを使います。

```sh
git clone https://github.com/PoMPOmegrenadier9090/contextory.git
cd contextory
nvm install
nvm use
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @pkm/desktop rebuild:electron-native
corepack pnpm desktop:package
```

`release/Contextory.app`と`release/Contextory-<version>-<arch>.dmg`ができます。ビルドの途中で、署名、アプリ内のSQLiteの動作、画面の起動、DMGの整合性を確かめます。

### 3. Applicationsへ配置する

1. Finderでリポジトリの`release`フォルダを開き、生成されたDMGを開きます。
2. 中の`Contextory.app`を`Applications`へドラッグします。既存のContextoryを更新する場合は、先にアプリを終了してください。
3. `/Applications/Contextory.app`を起動します。インストール後の利用にNode.jsやpnpmは要りません。

起動すると今日のDailyが開き、そのまま書き始められます。記録はアプリのデータフォルダにある`objects.sqlite`に保存します。

Apple Developer IDによる署名・公証は行っていません。

## Webで使う

サーバーで動かすと、ブラウザーやiPhoneから使えます。Macアプリも、メニューの「サーバー接続…」からサーバーのDBにつなげます。手順は[サーバーのセットアップ](docs/server-setup.md)を参照してください。つながっている間だけ使え、オフラインでの編集にはまだ対応していません。

## 開発状況

自由文書とObjectの編集、種別とFieldの定義、Timeline、Daily、Quick CaptureをWebとMacアプリで使えます。旧版のMarkdown Vault、Syncthing同期、MCP接続は外しました。MCPは、新しい保存形式の上に作り直す予定です。Quick Captureは画面の中のショートカットだけで、Macのどこからでも呼べるショートカットはまだありません。

- [開発・運用ガイド](docs/development.md)
- [コード構成](docs/architecture.md)
- [設計ドキュメント一覧](docs/README.md)
