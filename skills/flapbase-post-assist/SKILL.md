---
name: flapbase-post-assist
description: Flapbase Cloud の copy_assist で、AI が書いたような不自然な文を直し、同じ材料から X と Instagram の投稿の下書きを作る。渡した材料にない数字や名前が入っていないかは、Cloud 側で照合する。作るのは下書きだけで、投稿はしない。
license: Apache-2.0
business-categories: ["03", "08"]
transaction-types: ["継続サービス"]
---

# 投稿の下書きを作る

## 用意するもの

直したい元の文と、使ってよい事実の材料（サイトのページ・料金・FAQ・事例など）を用意する。

## 始める前に

投稿する媒体（X か Instagram か）と、足りない材料がないかを確かめる。クレジットの見積りを依頼主に見せて承認をもらう。

## 手順

Flapbase Cloud の MCP（https://mcp.flapbase.com/creative/mcp。ログインが要る）の `copy_assist` を使う。接続のしかたは flapbase-connect-mcp を見る。

1. 元の文を `text` に、事実の材料（サイトのページ・料金・FAQ・事例。依頼主が使ってよいと言ったものだけ）を `materials` に入れる。新しい UUID を `idempotencyKey` に付ける。
   - 文を直すだけなら `mode: "fix"`。直した文が1〜2案、AI っぽさの目印、何を替えたかが返る。
   - 投稿の下書きなら `mode: "sns"`。X と Instagram の下書きが返る。
2. 最初の呼び出しでは、クレジットの見積りだけが返る。金額を依頼主に見せ、よいと言われたら、見積りの `amount`・`quote_digest`・`tariff_revision` と `accepted: true` を `creditConsent` に付けて、同じ入力と同じ `idempotencyKey` で送り直す。
3. `questions` が返ったら、足りない材料を尋ねる質問として依頼主に聞く。推測で埋めない。
4. 投稿は、依頼主がそれぞれの SNS で行う。このスキルは投稿しない。

Flapbase に送らず、手元だけで点検したいときは flapbase-post-check を使う。

## チェックリスト

本文にある確認項目を、確認できたもの・確認できていないもの・人の判断を待つものに分けて示し、今回の対象に抜けがないかを確かめる。

## 終わりの目安

下書きと、直した点、足りない材料を人に返した。

## 次にできること

flapbase-post-check（投稿の点検）で、下書きを点検する。

## Flapbase で続ける

[Flapbase で開く](https://flapbase.com/skills/post-assist)。ページの「エージェントで使う」に、手順と使う道具が載っている。専用のワークフローや Project は自動では作られない。ここで出した結果も自動では Flapbase に送られないので、続ける範囲と持ち込む材料を、人が確かめてから進める。
