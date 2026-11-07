---
name: flapbase-connect-mcp
description: Flapbase の MCP につなぐ。接続の入口、OAuth の許可、権限、クレジットの承認（creditConsent）と人の承認の決まり。Flapbase の道具を初めて使うとき、接続が切れたときに使う。
license: Apache-2.0
---

# MCP でつなぐ

## 入口

| 名前 | URL | ログイン |
| --- | --- | --- |
| 本体 | https://mcp.flapbase.com/creative/mcp | 要る（OAuth） |
| 読み取り | https://mcp.flapbase.com/flapbase/mcp | 要らない |
| 参加 | https://mcp.flapbase.com/partners/mcp | 要らない |

依頼主のワークスペースで作るのは本体。読み取りは公開の情報だけ。参加は、オーナーが Flapbase に参加する申請を作るだけ。入口の URL は変わることがある。最新は https://flapbase.com/llms.txt の「つなぎ方」を読む。

## 本体につなぐ

1. Streamable HTTP の MCP として本体の URL を登録する。
2. 認可の情報は `/.well-known/oauth-protected-resource/creative/mcp`（本体と同じ origin）にある。client_id は Client ID Metadata Document の HTTPS の URL。動的なクライアント登録はない。
3. 依頼主が Flapbase にログインし、許可の画面でワークスペースを1つ選ぶ。ログインと許可は依頼主がする。
4. 許可の範囲は、読む（`app.read`）と作る・保存する（`skill.invoke`）。読むだけの許可では、書き込む道具は一覧に出ない。
5. 許可は30日で切れる。切れたら、依頼主にもう一度許可を頼む。

## つないだら

- 最初に `workspace_projects_list` を呼ぶ。許可したワークスペースで、その人が触れる Project の id・名前・権限が返る。Project を対象にする道具には、その id を `projectId` に渡す。
- 道具は、許可した人がそのワークスペースで持つ権限の範囲で動き、呼ぶたびに確かめる。権限がなければ断られる。

## 人の承認

- クレジットを使う生成は、最初は見積りだけを返す。人が金額と文を承認してから、`creditConsent` を付けて、同じ入力と同じ `idempotencyKey` で送り直す。承認の前に勝手に付けない。
- `design_preview` と `design_review` は、呼ぶたびにクレジットを使う。呼ぶ前に依頼主に確かめる。
- 削除の承認：削除は、人が Flapbase の画面で承認してから行われる。エージェントの道具に削除はない。消したいと頼まれたら、人に画面での操作を頼む。
- 公開・受け入れ・判断・プランの変更は人が決める。くわしくは `flapbase-guardrails`。

## 書き込みの決まり

- 書き込むたびに新しい UUID を `idempotencyKey` に付ける。送り直すときは同じ値を使う。
- 版が衝突したら読み直し、最新の版の id を `expectedRevisionId` に渡す。
