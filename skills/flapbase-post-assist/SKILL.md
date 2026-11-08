---
name: flapbase-post-assist
description: Flapbase Cloud の copy_assist で、AI が書いたような文を直し、同じ材料から X と Instagram の投稿の下書きを作る。材料にない数・名前を Cloud 側で照合する。下書きを作るだけで、投稿はしない。
license: Apache-2.0
---

# 投稿の下書きを作る

Flapbase Cloud の MCP（https://mcp.flapbase.com/creative/mcp、ログインが要る）の `copy_assist` を使う。つなぎ方は flapbase-connect-mcp を見る。

1. 元の文を `text` に、事実の出どころ（サイトの頁・料金・FAQ・事例。依頼主が使ってよいと言った物だけ）を `materials` に入れる。新しい UUID を `idempotencyKey` に付ける。
   - 直すだけなら `mode: "fix"`。直した文が1〜2案、印、何を替えたかが返る。
   - 投稿の下書きなら `mode: "sns"`。X と Instagram の下書きが返る。
2. 初回はクレジットの見積りだけが返る。金額を依頼主に見せ、よいと言われたら、見積りの `amount`・`quote_digest`・`tariff_revision` と `accepted: true` を `creditConsent` に付け、同じ入力と同じ `idempotencyKey` で送り直す。
3. `questions` が返ったら、足りない材料として依頼主に聞く。推測で埋めない。
4. 投稿は依頼主が各 SNS で行う。この skill は投稿しない。

手元だけで点検したいときは flapbase-post-check を使う。
