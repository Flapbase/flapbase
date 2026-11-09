---
name: flapbase-connect-mcp
description: Flapbase の MCP に接続する。接続先の URL、OAuth の許可、権限、クレジットの承認（creditConsent）と、人が承認するときの決まり。Flapbase の道具を初めて使うとき、接続が切れたときに使う。
license: Apache-2.0
business-categories: ["09"]
transaction-types: ["なし"]
---

# MCP で接続する

## 用意するもの

使うエージェントと、接続を許可された Flapbase Cloud の接続先を用意してください。

## 始める前に

今の接続の状態と権限を確かめ、クレジットの承認が必要かどうかも確かめてください。

## 手順

### 接続先

| 種類 | URL | ログイン |
| --- | --- | --- |
| 本体 | https://mcp.flapbase.com/creative/mcp | 必要（OAuth） |
| 読み取り | https://mcp.flapbase.com/flapbase/mcp | 不要 |
| 参加 | https://mcp.flapbase.com/partners/mcp | 不要 |

依頼主のワークスペースで制作するときは「本体」を使います。「読み取り」で見られるのは、公開されている情報だけです。「参加」でできるのは、オーナーが Flapbase に参加する申請を作ることだけです。接続先の URL は変わることがあるので、最新のものは https://flapbase.com/llms.txt の接続方法の説明で確かめてください。

### 本体に接続する手順

1. 本体の URL を、Streamable HTTP の MCP として登録します。
2. 認可に必要な情報は、本体と同じ origin の `/.well-known/oauth-protected-resource/creative/mcp` にあります。client_id には、Client ID Metadata Document の HTTPS の URL を使います。動的なクライアント登録には対応していません。
3. 依頼主が Flapbase にログインし、許可の画面でワークスペースを1つ選びます。ログインと許可は、依頼主本人が行います。
4. 許可の範囲は、読む（`app.read`）と、作って保存する（`skill.invoke`）の2つです。読むだけを許可した場合、書き込む道具は一覧に表示されません。
5. 許可は30日で切れます。切れたら、依頼主にもう一度許可を頼んでください。

### 接続できたら

- 最初に `workspace_projects_list` を呼びます。許可したワークスペースのうち、その人が操作できる Project の id・名前・権限が返ります。Project を対象にする道具には、その id を `projectId` として渡してください。
- 道具は、許可した人がそのワークスペースで持っている権限の範囲で動き、呼ぶたびに権限が確かめられます。権限がなければ、操作は断られます。

### 人の承認

- クレジットを使う生成は、最初は見積りだけが返ります。人が金額と文面を承認してから、`creditConsent` を付けて、同じ入力と同じ `idempotencyKey` で送り直してください。承認を得る前に、エージェントが勝手に付けてはいけません。
- `design_preview` と `design_review` は、呼ぶたびにクレジットを使います。呼ぶ前に、依頼主に確かめてください。
- 削除の承認：削除は、人が Flapbase の画面で承認してから行われます。エージェントの道具には削除がありません。消したいと頼まれたら、人に画面で操作してもらうよう頼んでください。
- 公開、成果物の受け入れ、判断、プランの変更は、人が決めます。くわしくは `flapbase-guardrails` を見てください。

### 書き込みの決まり

- 書き込むたびに、新しい UUID を `idempotencyKey` に付けます。送り直すときは、同じ値を使います。
- 版が衝突したら、読み直して、最新の版の id を `expectedRevisionId` に渡します。

## チェックリスト

手順で確かめた項目を「確認済み」「未確認」「持ち主の判断待ち」に分けて書き出し、抜けがないかを確かめてください。

## 終わりの目安

必要な権限で接続でき、人の承認が必要な操作とそうでない操作を区別できている。

## 次にできること

flapbase-projects-tasks で、作業の対象にする Project を選びます。

## Flapbase で続ける

[Flapbase で開く](https://flapbase.com/skills/connect-mcp)。公開のスキルページの「エージェントで使う」で、手順と使う道具を確かめてから続けてください。このスキルには専用のワークフローはなく、Project も自動では作られません。手元の結果も自動では送られないので、続ける範囲と持ち込む材料は、人が確かめてから決めてください。
