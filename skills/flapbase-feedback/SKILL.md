---
name: flapbase-feedback
description: Flapbase の道具・skill・Cloud への改善の提案、不具合、そのほかの意見を、依頼主の確認のうえで Flapbase に送る。送ることだけを行う skill。
license: Apache-2.0
---

# Flapbase に意見を送る

依頼主が Flapbase に伝えたいことを送る。Flapbase Cloud にログインしている人が使う（つなぎ方は flapbase-connect-mcp）。ほかの Flapbase の skill と CLI は何も送らない。送るのはこの skill を使ったときだけ。

1. 依頼主から、何について（道具・skill の名前、Cloud の画面）、何が起きたか・どうしてほしいかを聞く。
2. 種類を選ぶ：改善の提案（suggestion）・不具合（bug）・そのほか（other）。
3. 送る文をそのまま見せ、送ってよいか聞く。よいと言われたときだけ送る。依頼主が書いていない事情を足さない。サイトの URL・顧客の名前・連絡先は、依頼主が入れると言ったときだけ入れる。
4. Flapbase Cloud にログインして MCP（https://mcp.flapbase.com/creative/mcp）につなぎ、`feedback_send` に `kind`・`body`・`about`（例 flapbase-site-check）と、新しい UUID の `idempotencyKey` を渡す。送り直すときは同じ値を使う。返事はワークスペースで受け取れる。

送った意見は Flapbase の運営が読み、改善に使う。
