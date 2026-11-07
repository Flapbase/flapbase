---
name: flapbase-workflow
description: Flapbase のワークフローを動かす。テンプレートから始める、工程を進める、案を選ぶのは人、承認、再実行。成果物を中心にプロジェクトを進めるときに使う。
license: Apache-2.0
---

# ワークフローを動かす

ワークフローは、作業の一覧ではなく、工程ごとに成果物を置き、出す・見る・直す・受け入れる、で進める。進み具合は成果物の状態で測る。

## 始める

1. `workspace_projects_list` で Project を選ぶ。
2. `workflow_templates_list`（`projectId` を渡す）で、Flapbase のテンプレートと、ワークスペースで保存したテンプレートを読む。工程の題・種類・受け入れの決め方・成果物の種類・担い手の目安が返る。
3. 依頼に合うテンプレートを、依頼主に示して選んでもらう。決めるのは人。
4. `workflow_create`：テンプレートからワークフロー・工程・つながりを1回で作る。日付は `start` と日数の目安から決まる。同じ `idempotencyKey` の再送では増えない。

## 進める

1. `workflow_get` で工程の状態、始められる工程（ready）、エージェントにできること（agentCan）を読む。
2. 始める工程を `work_item_update` で in_progress にする。
3. 成果物は、Site と Design の道具で作る（`flapbase-publish-work`）。
4. できたら `work_item_submit` で、成果物の版を出して確認を頼む。

## 案を選ぶのは人

- 選択肢がある判断は `decision_request_create`（選択肢は2〜5）で頼む。エージェントが代わりに選ばない。
- 候補を並べるときは、勧める案があれば `recommendation` に書いてよいが、決めるのは人。

## 承認と再実行

- 受け入れるか、差し戻すかは人が決める。差し戻されたら、`work_item_note` に受けた意見と直したことを残し、成果物を直して、もう一度 `work_item_submit` する。
- 版が古いと conflict を返す。`workflow_get` で読み直し、新しい version を渡して再実行する。
- 通信が切れて送り直すときは、同じ `idempotencyKey` を使う。結果が二重にならない。

## 次に使えるようにする

- 回したワークフローは `workflow_template_save` で、構造だけのテンプレートとして保存できる。日付は日数の目安に、担当は担い手の目安に、成果物は種類に置き換わる。
