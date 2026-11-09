---
name: flapbase-projects-tasks
description: Flapbase の Project とタスク（工程）を扱う。Project の一覧の確認と作成、工程の読み取り、状態の変更、記録の追加、次の担当者への引き渡しができる。仕事の進み具合を知りたいときや、工程を進めたいときに使う。
license: Apache-2.0
business-categories: ["05", "09"]
transaction-types: ["相談・受託", "継続サービス"]
---

# Project とタスクを扱う

## 用意するもの

対象の Project、または新しく始める仕事の目的を用意する。

## 始める前に

すでにある Project・工程・担当者・状態を読み、同じものを重ねて作らないようにする。

## 手順

タスクとは、ワークフローの中の1つ1つの工程（work item）のこと。工程ごとに、その成果物が対応づけられる。

### 読む

- `workspace_projects_list`：操作できる Project の id・名前・状態・権限を返す。
- `workspace_workflow_list`：その人が見られる Project の、まだ終わっていない工程を、確認待ち・進行中・予定に分けて返す。`projectId` は受け付けない。
- `workflow_get`：Project の工程ごとに、状態と version、提出した成果物、記録、今の担当者、始められる状態か、エージェントにできること（agentCan）を返す。

作業を始める前に、まず `workflow_get` で今の状態を読む。

### 作る

- `workspace_project_create`：名前を指定して Project を作る。同じ名前の Project がすでにないか、先に `workspace_projects_list` で確かめる。同じ `idempotencyKey` で送り直しても、Project は増えない。

### 状態を変える

- `work_item_update`：その工程でエージェントに許されている範囲で、状態を変える。`workItemId`・`expectedVersion`・`status`・`idempotencyKey` を渡す。
  - 状態は todo・in_progress・blocked。人の受け入れが要らない「実行」の工程に限り、measuring・done にもできる。
  - `expectedVersion` には、`workflow_get` で読んだ version を渡す。version が古いと conflict が返るので、読み直して、新しい version で送り直す。
- エージェントの権限は工程ごとに、実行・下書き・提案の3つのどれか。「提案」の工程では、記録を残すことと、人に判断を頼むことだけができる。

### 記録を残す

- `work_item_note`：受けた意見のまとめ（feedback）・直したこと（change）・決まったこと（decision）・メモ（note）を工程に残す。次の担当者は `workflow_get` で読める。

### 次の担当者へ引き渡す

- `work_item_submit`：成果物の版を工程に対応づけ、受け入れる人に確認を頼む。工程は承認待ちになる。受け入れるか差し戻すかは、人が決める。
- `decision_request_create`：2〜5個の選択肢を付けて、人に判断を頼む。選ぶのは人。
- ある Project から別の Project へ、工程や成果物を移す道具はない。必要なときは、人に画面での操作を頼む。

### 守ること

- 成果物の受け入れ、判断の決定、公開は、エージェントがしない。
- 工程の名前や記録に、個人の連絡先や契約の内容を書かない。

## チェックリスト

本文にある確認項目を、確認できたもの・確認できていないもの・人の判断を待つものに分けて示し、今回の対象に抜けがないかを確かめる。

## 終わりの目安

対象の工程の状態と記録が食い違っておらず、次はだれの番かが分かる。

## 次にできること

flapbase-workflow（ワークフロー）で、工程と成果物を扱う。

## Flapbase で続ける

[Flapbase で開く](https://flapbase.com/skills/projects-tasks)。ページの「エージェントで使う」に、手順と使う道具が載っている。専用のワークフローや Project は自動では作られない。ここで出した結果も自動では Flapbase に送られないので、続ける範囲と持ち込む材料を、人が確かめてから進める。
