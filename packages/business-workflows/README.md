# Flapbase business workflows

[Standard definitions](.base/business-workflows.json) describe eleven businesses, their reusable workflows, expected outcomes, and parameter bindings for registered actions. A project supplies its own settings and resource IDs. Keep the selected definition version fixed when resuming work.

Flapbase Cloud executes available actions through the authenticated MCP connection. Use `app_template_get` with `business-app` to discover current operations and `business_workflow_step_run` to run one stage. A listed business can still have individual operations pending. Publication, delivery, and payments follow the project's permissions and approvals.

## 日本語

[標準定義](.base/business-workflows.json)には、11事業の工程、完了条件と既存操作への結線を収録しています。屋号や商品IDなどは導入先のProjectで設定し、利用する定義の版を固定します。実行はFlapbase Cloudの認証済みMCPに接続します。`app_template_get` の `business-app` で現在使える操作を取得し、`business_workflow_step_run` で一工程ずつ実行します。事業ごとの提供状況はカタログに記載しています。
