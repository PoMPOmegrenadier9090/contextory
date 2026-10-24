# mainモードのDesktop更新

ブランチ／PRモードではこの置換手順を実行しない。macOSのこの環境ではインストール先が `/Applications/Contextory.app`、bundle IDが `com.pkms.desktop`。別の環境では実在するインストール先を確認する。旧名の `/Applications/PKM.app` が残っている場合は同じbundle IDを確認し、初回の名称変更では旧名のアプリをbackupへ移してから新名で配置する。失敗時は旧名・旧パスへ復旧する。

## 新しい配布物

Node用の検証とworkspace buildを終えてから実行する:

```sh
corepack pnpm --filter @pkm/desktop rebuild:electron-native
corepack pnpm desktop:package
```

現在のpackagerは `apps/desktop/src/mac-package.ts`。Electron向けnative binaryを確認してから `release/Contextory.app` と `release/Contextory-VERSION-ARCH.dmg` を公開する。生成時に署名検証、アプリ内のSQLite動作、renderer smoke、DMG整合性を検証する。`desktop:package` 自体はインストールしない。

Electron検証とpackagingの終了後、失敗した場合も `corepack pnpm rebuild better-sqlite3` で開発依存関係をNode向けに戻す。検証が通った配布物だけを置換に使う。`release/` の生成物はGitに追加しない。

## 終了と置換

1. ソースとインストール先の `Contents/Info.plist` でbundle IDを確認する。リポジトリと関係のないアプリを名前だけで上書きしない。
2. インストール済みのContextory（旧PKM）が動作中なら通常の終了操作を使う。例はAppleScriptの `tell application id "com.pkms.desktop" to quit`。最大30秒程度で終了を確認する。未保存確認などで終了がキャンセルされた場合は旧アプリを保持して止まり、ユーザーに保存／終了の対応を伝える。強制終了しない。
3. `/Applications` と同じfilesystem内の一意なステージング先へ `/usr/bin/ditto release/Contextory.app STAGED_APP` でコピーする。コピーの完了と `codesign --verify --deep --strict STAGED_APP`、bundle IDを確認してから切り替える。ソースからdestinationへ直接重ね書きしない。
4. 旧 `/Applications/Contextory.app` を同じ親ディレクトリの一意なbackup名へrenameし、ステージング済みアプリを `/Applications/Contextory.app` へrenameする。切替に失敗したら旧アプリを元の名前へ戻す。初回インストールならbackupは不要。
5. インストール先で再度署名を検証し、配布物と一致することを確認する。同じversionが繰り返し使われるため、versionだけで新旧を判定せず、renderer出力とmainのファイルhash等も比較する。
6. インストール先の実行ファイル `Contents/MacOS/Electron` を `PKM_ELECTRON_SMOKE=1`、`ELECTRON_RUN_AS_NODE` を空にした環境で起動し、終了コードとrenderer smoke成功を確認する。現在のsmokeモードは既存Vault／接続設定を読み込まない。timeoutを設け、動作確認で本物のVaultへ書き込まない。
7. 旧アプリが動いていた場合は `open /Applications/Contextory.app` で通常起動に戻し、新しいプロセスがインストール先から起動したことを確認する。ユーザーが明示的に通常起動も求めた場合も行う。

署名・起動確認が失敗した場合は新アプリを退避し、backupを元の名前に戻す。成功後は、この作業で作ったステージング／backupだけを片付ける。Vault、`~/Library/Application Support`、認証情報や端末設定は削除しない。成功してからmainへpushする。

sandboxの書込み権限が足りない場合は `/Applications/Contextory.app` の置換目的を明示して昇格を要求する。ユーザーの継続的な承認は追加の確認会話を不要にするが、ツールによる権限審査を省略しない。
