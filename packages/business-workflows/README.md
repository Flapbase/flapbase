# Flapbase business workflows

[Standard definitions](.base/business-workflows.json) describe eleven businesses, their reusable workflows, expected outcomes, and parameter bindings for registered actions. A project supplies its own settings and resource IDs. Select definitions by catalog key and version. Directory names do not determine which definitions can be installed. Keep the selected definition version fixed when resuming work.

Flapbase Cloud executes available actions through the authenticated MCP connection. Use `app_template_get` with `business-app` to discover current operations and `business_workflow_step_run` to run one stage. A listed business can still have individual operations pending. Publication, delivery, and payments follow the project's permissions and approvals.

## 日本語

[標準定義](.base/business-workflows.json)には、11事業の工程、完了条件と既存操作への結線を収録しています。屋号や商品IDなどは導入先のProjectで設定し、利用する定義の版を固定します。実行はFlapbase Cloudの認証済みMCPに接続します。`app_template_get` の `business-app` で現在使える操作を取得し、`business_workflow_step_run` で一工程ずつ実行します。事業ごとの提供状況はカタログに記載しています。

導入する定義はカタログ上のキーと版で選びます。ディレクトリ名は導入可否を決めません。

### 購入者サポート

`customer-support` を選ぶと、無料資料の公開から購入者の問い合わせ対応までを導入できます。Workspace単位で接続し、配布用の[デジタル商品定義](../self-host/digital-product.base)の `settings.workflow` を `flapbase:customer-support` にして `base` に渡します。`prepare-free-resource` は資料の固定版を基に、下書き・受取画面・サポートの工程を作ります。既存Projectを使う場合は `projectId` を指定し、新しく始める場合は省きます。運営者が提供条件と画面を確認して公開します。購入者本人が受取画面から問い合わせを送り、運営者は注文詳細で担当者を割り当てます。`order-support` で対象の問い合わせと現在の版を取得し、`reply-draft` で返信案を保存します。運営者が確認して公開すると、購入者が同じ注文の問い合わせ履歴で返信を読めます。
