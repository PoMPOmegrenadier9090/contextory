# Syncthing セットアップ

Docker Composeで同期サーバーを立て、Cloudflare Tunnel経由でWeb UIへ接続する場合は
[Vault・同期環境セットアップ](server-setup.md)を参照する。DesktopにはVaultの自動初期化と
Syncthingへの登録・状態確認画面がある。

更新日: 2026-09-23

MacとLinux serverの間でPKM Vaultを双方向同期するための手順を記す。
SyncthingはVaultの正本ファイルを同期し、PKM applicationは同期後の変更を検出して
indexへ反映する。ファイル転送そのものにPKM applicationは関与しない。

## 同期境界

同期するもの:

- `vault.yaml`
- Entity Markdown
- `assets/`
- Syncthingが生成した競合コピー

同期しないもの:

- `.pkm/index.sqlite`
- `.pkm/local-state.sqlite`
- SQLiteのWAL等、`.pkm/`以下の端末固有状態
- `.git/`

各peerのVault rootへ次の`.stignore`を置く。`.stignore`自身はSyncthingで同期されないため、
MacとLinuxの両方に個別に作成する。

```text
// PKM device-local state (managed by pkms)
/.pkm
/.git
```

受信側では、共有フォルダを承認する前に同期先ディレクトリと`.stignore`を作成する。

## Linux server

Syncthing公式APT repositoryのstable v2 channelから導入する。`apt-key`は非推奨のため、
repositoryごとのkeyringを使用する。

```sh
sudo apt-get install apt-transport-https ca-certificates curl
sudo mkdir -p /etc/apt/keyrings
sudo curl -L -o /etc/apt/keyrings/syncthing-archive-keyring.gpg \
  https://syncthing.net/release-key.gpg
echo "deb [signed-by=/etc/apt/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable-v2" \
  | sudo tee /etc/apt/sources.list.d/syncthing.list
sudo apt-get update
sudo apt-get install syncthing
```

常時稼働serverでは、ログイン状態に依存しないsystem serviceとして起動する。
`USERNAME`はVaultを所有するLinuxユーザー名へ置き換える。

```sh
sudo systemctl enable --now syncthing@USERNAME.service
sudo systemctl status syncthing@USERNAME.service
```

例えばユーザー名が`ubuntu`なら次のようになる。

```sh
sudo systemctl enable --now syncthing@ubuntu.service
```

`syncthing@USERNAME.service`、`systemctl --user`で起動する`syncthing.service`、
terminalから直接起動する`syncthing`を同時に使用しない。二重起動はGUI portや設定DBの
競合を起こす。

既定のWeb GUIはLinux上の`127.0.0.1:8384`で待ち受ける。remoteから設定する場合は、
GUIを外部公開せずSSH port forwardingを使用する。Mac自身のSyncthingが8384を使うため、
次の例ではMac側の8385へforwardする。

```sh
ssh -L 8385:127.0.0.1:8384 USERNAME@LINUX_HOST
```

SSH接続中にMacのbrowserで`http://127.0.0.1:8385`を開く。

状態とlogは次のコマンドで確認できる。

```sh
sudo systemctl status syncthing@USERNAME.service
sudo journalctl -e -u syncthing@USERNAME.service
```

## macOS

Homebrewで導入し、login時に起動するserviceとして登録する。

```sh
brew install syncthing
brew services start syncthing
```

Web GUIは`http://127.0.0.1:8384`で開く。状態確認と停止は次のとおり。

```sh
brew services list
brew services stop syncthing
```

## peerの登録

1. MacとLinuxの各Web GUIで`Actions` → `Show ID`を開く。
2. Macで`Add Remote Device`を選び、LinuxのDevice IDを登録する。
3. LinuxでMacのDevice IDを登録する。
4. 両端でdevice名を確認し、追加要求を承認する。
5. Addressは通常`dynamic`のままでよい。

GUI/APIはloopbackのまま運用し、internetへ公開しない。必要に応じてGUIのusernameと
passwordも設定する。

## Mac側でVaultを共有する

1. Mac側Vault rootへ`.stignore`を作成する。
2. repositoryをbuildし、同期境界を検証する。

```sh
cd /path/to/pkms
corepack pnpm build
corepack pnpm pkm check-sync /path/to/mac-vault
```

3. MacのSyncthing GUIで`Actions` → `Settings` → `GUI`を開き、API Keyを確認する。
4. LinuxのDevice IDを指定して、PKM CLIからfolderを登録する。

```sh
PKM_SYNCTHING_API_KEY="<mac-api-key>" \
PKM_SYNCTHING_DEVICE_IDS="<linux-device-id>" \
corepack pnpm pkm bootstrap-sync /path/to/mac-vault
```

Folder IDは`vault.yaml`の`vault_id`から`pkm-<vault-id>`として作成される。

## Linux側で共有を受け入れる

1. Linux側の同期先ディレクトリを作る。
2. そのrootへ、同期を承認する前に`.stignore`を作る。
3. LinuxのWeb GUIに表示されたfolder shareを承認する。
4. Folder Pathに作成済みディレクトリを指定する。
5. 提示されたFolder IDを変更しない。
6. Folder Typeを`Send & Receive`にする。
7. `Watch for Changes`を有効にする。

同期後、Linux側でも境界とVaultを検証する。

```sh
cd /path/to/pkms
corepack pnpm build
corepack pnpm pkm check-sync /path/to/linux-vault
corepack pnpm pkm validate /path/to/linux-vault
```

Linux側のAPI Keyを使うとSyncthingとfolderの状態も確認できる。

```sh
PKM_SYNCTHING_API_KEY="<linux-api-key>" \
corepack pnpm pkm sync-status /path/to/linux-vault
```

`sync-status`は状態を読むだけであり、再scanやfile転送は実行しない。

## 動作確認

1. Macの同期対象ディレクトリにtest fileを作り、Linuxへ届くことを確認する。
2. Linuxで同じtest fileを変更し、Macへ戻ることを確認する。
3. 両端のWeb GUIでfolderが`Up to Date`になることを確認する。
4. PKMで使う場合は、両端で`validate`が成功することも確認する。

Syncthingの動作だけを確認するtest fileは任意の形式でよい。一方、PKM UIへの反映まで
確認する場合は、schemaに適合したEntity Markdownを使用する。

## filesystem watcherと定期scan

`Watch for Changes`を有効にしても、Linuxのfilesystemやinotifyの状態によって変更通知を
取りこぼす場合がある。手動`Rescan`直後にだけ送信が始まる場合は、次を順に確認する。

1. `Watch for Changes`を一度無効化して保存し、再度有効化する。
2. Syncthing serviceを再起動する。
3. `Full Rescan Interval`を60〜300秒へ短縮する。
4. journalに`watch`、`inotify`、`overflow`関連のerrorがないか確認する。

```sh
sudo systemctl restart syncthing@USERNAME.service
sudo journalctl -u syncthing@USERNAME.service -n 300 --no-pager \
  | grep -Ei 'watch|inotify|overflow|error'
```

小規模なVaultでは、watcherを有効にしたまま定期scanを1〜5分に設定することで、通知を
取りこぼした場合も一定時間内に収束できる。

## 競合解決の実機確認

1. 両端が`Up to Date`であることを確認する。
2. 片方のfolderを一時停止する。
3. 同じEntity MarkdownをMacとLinuxの両方で異なる内容へ変更する。
4. 停止していたfolderを再開する。
5. `*.sync-conflict-*`が生成され、PKMの競合一覧へ表示されることを確認する。
6. 正本採用、競合版採用、または手動マージで解決する。
7. 両端で解決後の内容が一致し、Syncthingが`Up to Date`になることを確認する。

重要な実データではなく、test用Entityで最初の確認を行う。

## 参考資料

- [Syncthing Debian/Ubuntu repository](https://apt.syncthing.net/)
- [Syncthingを自動起動する](https://docs.syncthing.net/users/autostart)
- [Syncthing ignore patterns](https://docs.syncthing.net/users/ignoring)
- [Syncthing folder types](https://docs.syncthing.net/users/foldertypes.html)
