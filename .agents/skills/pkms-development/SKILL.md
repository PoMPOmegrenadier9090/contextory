---
name: pkms-development
description: Contextoryリポジトリの機能追加・修正・開発設定変更を、実装と実行検証から配布まで完了する。既定はmainへ直接pushし、Desktopの実装変更ではローカルアプリも更新する。ユーザーがブランチ作業を指定した場合はpushとPR作成まで行う。
---

# Contextory開発

対象は `PoMPOmegrenadier9090/contextory`。まず `git remote get-url origin` とリポジトリrootを確認する。他のプロジェクトにこの配布方針を適用しない。

## 作業モードと継続的な承認

- ユーザーの指定がなければ **mainで作業し、origin/mainへ直接pushする**。実装、実行確認、ローカルDesktop更新、pushまでが一つの開発作業であり、実装だけで終了しない。
- ユーザーがブランチ作業を指定した場合、そのブランチを作成・使用して実装、検証、リモートpush、main向けPR作成まで進める。指定されたブランチ名を優先し、名前未指定なら `codex/` を使う。**このモードではインストール済みアプリを置き換えず、PRを自動mergeしない。**
- 同じ作業中のブランチ指定・置換不要・push保留などの指示は引き続き有効。すでに明示されたモードを勝手にmainへ戻さない。
- 上記はこのプロジェクトについてユーザーから与えられた承認。通常のcommit・push・PR作成・mainモードのアプリ置換に再確認を挟まない。ツールの権限境界は守り、必要なsandbox昇格を使う。拒否された操作を迂回しない。

## Gitと実装

1. 現在のブランチ、変更済み・未追跡ファイル、originの最新状態を確認する。安全に取り込める更新は実装前に取り込む。
2. 既存の未コミット変更を消さない。ユーザーがそれらを今回の対象として承認した場合はcommitで保存して統合する。関係が不明な変更は保持し、今回のcommitへ勝手に混ぜない。
3. 通常は現在のcheckoutで作業する。ブランチ切替を妨げる他の作業がある場合は、保護したうえで必要に応じてworktreeを使う。別checkoutからpushした場合、元のcheckoutも確認し、ローカルmainが古いままならその状態を明示する。
4. `packages/ui` はWeb / Desktop共通、`contracts` は入出力契約、`core` は解析・検証、`storage-node` はVault・SQLite、`apps/web` / `apps/desktop` は接続と画面を担当する。既存の共通実装と `docs/architecture.md` を手掛かりに変更する。
5. 正本Vault、draft、hash競合保護を保持し、動作確認にはfixtureや一時Vaultを使う。利用中のVault・端末設定をテストデータとして書き換えない。

## 検証と完了

コード・依存関係・ビルド設定の変更では [検証手順](references/verification.md) を読む。UI操作やElectron固有の挙動は実際のElectronで確認する。成功するまで関連する不具合を修正する。

- **mainモード**: 検証を通し、今回の変更をcommitする。Desktopの実行コード・共有コード・依存関係・配布設定を変更した場合は、[Desktopのビルド・置換](references/desktop.md) に従って新しいアプリを生成し、ローカルの `Contextory.app` を置換して起動確認する。その後 `git push origin main` を行う。失敗した段階を成功として扱わない。
- **ブランチモード**: 検証後にcommitし、`git push -u origin BRANCH`、続いて `gh pr create --base main --head BRANCH --title ... --body-file ...` またはGitHubの接続ツールでPRを作成する。説明には最終的な変更内容と実行した検証を書く。Codexの `attach_artifact` が利用可能なら作成したPRのURLを必ず添付する。アプリ置換は実行しない。
- ドキュメント・skillsだけの変更では内容、参照先、skill構造を検証してcommit/pushする。実行コードが変わらないため、Desktopの再ビルド・置換は不要。

push直前にoriginの更新を確認する。追加入力やリモート更新で実装が変わった場合、その差分を検証し直す。アプリ更新後に実行コードを変更したなら再ビルド・再置換して、配布物とpushするコードを揃える。競合解消にforce-pushを使わない。

完了時は変更の要点、検証結果、アプリ置換先と起動確認結果（mainの実装変更時）、commitまたはPRのリンク、残作業があればその具体的な理由を短く報告する。
