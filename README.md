# Contextory

**Contextに紐づけて書く。知識が自然にまとまる。**

Contextoryは、Contextに紐づけてメモを書くことで、知識が自然にまとまることを目指す、ローカルファーストのナレッジアプリです。
Contextは、そのメモがどの活動領域・プロジェクト・タスク・資料に関係するかを表します。
記録は手元のMarkdownファイルに保存し、MacアプリとWebから読み書きできます。AIツールを接続する仕組みのMCPを使えば、AIも同じ記録を参照・更新できます。

[Macで始める](#macで始める) · [設計思想](#設計思想) · [操作ガイド](docs/input-shortcuts.md) · [開発・運用](docs/development.md)

## 書いていくうちに、知識がまとまる

プロジェクトで考えたことは、そのプロジェクトへ。資料を読んだメモは、その資料へ。Contextに紐づけて記録を重ねることで、関連する知識が同じContextのもとに集まっていきます。

蓄積した記録をTimelineや逆参照からたどり、学習や振り返りに使えます。しばらく離れた作業へ戻るときにも、それまでの記録から文脈を取り戻して再開できます。

- Quick Captureで、Contextに紐づけてメモやTodoを記録できます。タイトルやContextを決めずに、ひとまず書き残すこともできます。
- プロジェクト・タスク・資料に関連づけた記録を、Timelineや逆参照からたどれます。
- Dailyで日々の記録を振り返り、タスクの期限や本文中のTodoを一覧で確認できます。
- Markdownの編集、画像・ファイルの添付、日本語検索に対応しています。

## 設計思想

### Contextに紐づけて、そのまま書く

作業や資料に関するメモを、そのContextに紐づけて残します。短いメモも整理した長文も、Entryという同じ単位で扱います。

すぐに書きたいときは、タイトルやContextを決めずに記録することもできます。ContextやTopicはあとから追加でき、記録するときの負担を抑えています。

### 記録を、自分のファイルとして持つ

保存先のフォルダをVaultと呼びます。記録は1件につき1つのMarkdownファイルに保存し、検索や逆参照のためのSQLite索引は、ファイルから作り直せます。人間とAIの両方が扱え、特定のアプリに閉じない保存形式を選んでいます。

DesktopはローカルのVaultを直接使うため、サーバーが止まっていても記録できます。端末間の同期にはSyncthingを使い、検索索引や画面の状態は各端末で管理します。

### 人とAIが、同じ記録を扱う

AIはMCPを通じて、記録の検索・参照、プロジェクトの文脈の取得、記録やタスクの作成・更新を行えます。アプリと同じ保存サービスで形式を検証し、保存前にファイルの変更を確かめます。外部での編集と競合した場合は、上書きせずに検出します。

詳しい方針は[現在設計](docs/pkm-current-design-v3.md)、保存形式は[Markdown Schema](docs/pkm-schema-v1.md)を参照してください。

## Macで始める

Mac単体で記録を始められます。同期サーバーやAI接続は、必要になってから設定できます。
以下はソースからビルドする手順です。Apple Silicon / IntelのMacに対応し、ビルドしたMacと同じアーキテクチャのアプリを生成します。

### 1. ビルド環境を用意する

Git、[nvm](https://github.com/nvm-sh/nvm)、Python 3、Xcode Command Line Toolsを用意してください。Command Line Toolsが未導入なら、次を実行してインストールします。

```sh
xcode-select --install
```

### 2. ソースを取得してビルドする

ターミナルで実行します。Node.jsは`.nvmrc`、pnpmは`package.json`で指定したバージョンを使います。

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

`release/Contextory.app`と`release/Contextory-<version>-<arch>.dmg`が生成されます。ビルド時に署名とアプリ内のSQLite動作、画面の起動、DMGの整合性を検証します。

### 3. Applicationsへ配置する

1. Finderでリポジトリの`release`フォルダを開き、生成されたDMGを開きます。
2. 中の`Contextory.app`を`Applications`へドラッグします。既存のContextoryを更新する場合は、先にアプリを終了してください。
3. `/Applications/Contextory.app`を起動します。インストール後の利用にはNode.jsやpnpmは不要です。

現在，Apple Developer IDによる署名・公証は行っていません。

### 4. 記録を保存するフォルダを選ぶ

初回起動時に空のフォルダを選ぶと、Vaultを初期化します。Quick Capture（Cmd + Shift + Enter）から最初のメモを残してください。
最後に開いたVaultは次回起動時に自動で開きます。場所を変えるときは「Vault・同期設定」を使います。

操作は[入力・ショートカット](docs/input-shortcuts.md)、ビルド後に開発やテストを続ける場合は[開発・運用ガイド](docs/development.md)を参照してください。

## 同期・Web・AIを使う

| やりたいこと | 手順 |
| --- | --- |
| Macと別の端末でVaultを同期する | [Syncthingセットアップ](docs/syncthing-setup.md) |
| サーバーを用意してWebやiPhoneから使う | [Vault・同期環境セットアップ](docs/server-setup.md) |
| AIから記録を検索・更新する | [MCP接続と直接操作](docs/mcp-setup.md) |

Syncthingは別途導入が必要です。Webはサーバーへの接続が必要で、オフライン編集には対応していません。MCPは既定で無効です。

## 開発状況とドキュメント

macOSアプリ、Web UI、ファイル同期、MCPによる直接操作を実装しています。Memory・Embeddingによる検索やGit Snapshotによる履歴復旧は未実装です。

- [現在の実装状況と制限](docs/implementation-status.md)
- [今後の計画](docs/future-roadmap.md)
- [開発・運用ガイド](docs/development.md): 開発起動、検証、Vault CLI、サーバー起動
- [コード構成](docs/architecture.md)
- [設計ドキュメント一覧](docs/README.md)
