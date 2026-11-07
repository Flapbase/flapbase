---
name: flapbase-handoff
description: Flapbase で、成果物・決めたこと・履歴を、次の人やエージェントへ残す。作業の区切り、交代、中断の前に使う。
license: Apache-2.0
---

# 引き継ぎを残す

次に読む人（またはエージェント）は、会話を見ていない。Flapbase の中に残したものだけが引き継がれる。

## 残す場所

| 残すもの | 場所 | 道具 |
| --- | --- | --- |
| 成果物 | Project に保存した下書きの版 | `site_create`・`site_apply`・`design_save` など |
| 成果物の確認 | 工程に結んだ版 | `work_item_submit` |
| 決めたこと・直したこと・受けた意見 | 工程の記録 | `work_item_note` |
| 人に決めてほしいこと | 判断の依頼 | `decision_request_create` |
| 回した流れそのもの | テンプレート | `workflow_template_save` |

## 区切りでやること

1. 保存していない案や直しを、`site_apply` か `design_save` で下書きとして保存する。
2. 工程の状態を `work_item_update` で今に合わせる。止まっているなら blocked にして、理由を `work_item_note` に書く。
3. `work_item_note` に、次のことを短く残す。
   - 何を作ったか（Project の中の成果物と版）。
   - 何を決めたか、だれが決めたか（`decision` の種類）。
   - 直したこと（`change`）と、受けた意見（`feedback`）。
   - 次にやること、人の判断を待っていること。
4. `workflow_get` を読み直し、残した内容が見えることを確かめる。

## 読む側のとき

- 最初に `workflow_get` を読む。工程の状態、記録、だれの手にあるか、始められる工程を見てから動く。
- 記録にない前提を、推測で足さない。分からないことは `decision_request_create` で人に聞く。

## 書かないこと

- 個人の連絡先・契約の金額・鍵やトークンを、記録に書かない。
