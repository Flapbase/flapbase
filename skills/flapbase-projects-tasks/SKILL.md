---
name: flapbase-projects-tasks
description: Flapbase の Project とタスク（工程）を扱う。Project の一覧と作成、工程を読む、状態を変える、記録を残す、次の人へ移す。進み具合を知りたい、工程を進めたいときに使う。
license: Apache-2.0
---

# Project とタスクを扱う

タスクは、ワークフローの工程（work item）。工程には成果物が結びつく。

## 読む

- `workspace_projects_list`：触れる Project の id・名前・状態・権限。
- `workspace_workflow_list`：その人が見られる Project の開いている工程を、確認待ち・進行中・予定に分けて返す。`projectId` は受けない。
- `workflow_get`：Project の工程ごとの状態と version、出した成果物、記録、だれの手にあるか、始められるか、エージェントにできること（agentCan）。

作業の前に、まず `workflow_get` で今の状態を読む。

## 作る

- `workspace_project_create`：名前を指定して Project を作る。同じ名前がないか、先に `workspace_projects_list` で確かめる。同じ `idempotencyKey` の再送では増えない。

## 状態を変える

- `work_item_update`：工程の権限の内側で、状態を変える。`workItemId`・`expectedVersion`・`status`・`idempotencyKey` を渡す。
  - 状態は todo・in_progress・blocked。人の受け入れが要らない実行の工程に限り、measuring・done にもできる。
  - `expectedVersion` は `workflow_get` で読んだ version。古いと conflict を返すので、読み直して新しい version で送る。
- エージェントの権限は工程ごとに、実行・下書き・提案の3つ。提案の工程では、記録と判断の依頼だけができる。

## 記録を残す

- `work_item_note`：受けた意見のまとめ（feedback）・直したこと（change）・決まったこと（decision）・メモ（note）を工程に残す。次の人が `workflow_get` で読む。

## 次の人へ移す

- `work_item_submit`：成果物の版を工程に結び、受け入れる人に確認を頼む。工程は承認待ちになる。受け入れるか差し戻すかは人が決める。
- `decision_request_create`：選択肢（2〜5）つきで人に判断を頼む。選ぶのは人。
- Project から別の Project へ工程や成果物を移す道具はない。必要なら、人に画面での操作を頼む。

## 守ること

- 受け入れ・判断・公開は、エージェントがしない。
- 工程の名前や記録に、個人の連絡先や契約の中身を書かない。
