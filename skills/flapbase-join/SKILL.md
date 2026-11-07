---
name: flapbase-join
description: Flapbase に参加する。AI エージェントを持つ人（オーナー）が、クリエイターのプロフィールや /agents から確かめて、サインアップするまでの手順。参加したい、登録したい、クリエイターとして登録したいと頼まれたときに使う。
license: Apache-2.0
---

# Flapbase に参加する

この skill の仕事は、オーナー（エージェントを持つ人）が Flapbase に参加するまでを手伝うこと。参加の最後の同意は、必ずオーナー本人がする。

## 先に読む

ログインなしで読める。

1. https://flapbase.com/llms.txt（短い案内）。詳しくは https://flapbase.com/llms-full.txt
2. https://flapbase.com/agents（人も読める案内。サインアップの道はここに出る）
3. クリエイターとして登録するなら https://flapbase.com/creators（得意な分野を自分で選び、テンプレートと素材を出品できる）

読み取りの MCP（https://mcp.flapbase.com/flapbase/mcp、ログイン不要）でも、同じ内容を `flapbase_about_get`、`flapbase_usecases_list`、`flapbase_plans_get` で読める。

## 手順

1. 上の案内を読み、オーナーに「何のために使うか」を一言で聞く。
2. エージェントから Flapbase を使う参加（Free）は、/agents に書かれた道に従う。オーナーである人が確かめるところは、エージェントが代わりにしない。この skill に書かれていない手順を作らない。
3. 参加の申請は、参加の MCP（https://mcp.flapbase.com/partners/mcp、ログイン不要）を使う。
   - `agent_signup_get` で手順と決まりを読み、オーナーに伝える。
   - `agent_signup_request` は、オーナーが内容を確かめて「送ってよい」と言ってから呼ぶ。オーナーのメールに確認のリンクが届き、オーナーがログインして承認するまで、ワークスペースは作られない。
   - クリエイターのページ（anotherbase.app/@名前）から来たときは、その名前を `partner` に渡す。
   - クリエイターとして登録するなら、参加のあとで、オーナーがプロフィールで得意な分野を選ぶ。
4. 参加できたら、つなぎ方は `flapbase-connect-mcp` に進む。

## 守ること

- 氏名・メールアドレスなどは、オーナーが渡したものだけを使う。推測で埋めない。
- 契約・同意・決済は、オーナー本人が画面かメールのリンクで行う。エージェントは代わりに押さない。
- パスワード・鍵・トークンを会話や記録に書かない。
