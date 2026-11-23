# Flapbase business workflows

[Standard definitions](.base/business-workflows.json) describe eleven businesses, their reusable workflows, expected outcomes, and parameter bindings for registered actions. A project supplies its own settings and resource IDs. Select definitions by catalog key and version. Directory names do not determine which definitions can be installed. Keep the selected definition version fixed when resuming work.

Flapbase Cloud executes available actions through the authenticated MCP connection. Use `app_template_get` with `business-app` to discover current operations and `business_workflow_step_run` to run one stage. A listed business can still have individual operations pending. Publication, delivery, and payments follow the project's permissions and approvals.

## Start from the CLI

```sh
node bin/flap.js business list
node bin/flap.js business inspect booking-service
node bin/flap.js business prepare booking-service booking-offers input.json
```

The last command returns a pinned MCP request that you can hand to an OAuth-connected agent. For a direct CLI call, make a short-lived, authorized Cloud MCP access token available as `FLAPBASE_MCP_ACCESS_TOKEN`. Run `business check-cloud` to confirm that Cloud exposes the same 11 definitions, then use `business run` with the same arguments as `business prepare`. Each run performs one registered step. For another step, use the returned `nextStepKey` and put the preceding `result` under its step key in `results`.

## 日本語

[標準定義](.base/business-workflows.json)には、11事業の工程、完了条件と既存操作への結線を収録しています。屋号や商品IDなどは導入先のProjectで設定し、利用する定義の版を固定します。実行はFlapbase Cloudの認証済みMCPに接続します。`app_template_get` の `business-app` で現在使える操作を取得し、`business_workflow_step_run` で一工程ずつ実行します。事業ごとの提供状況はカタログに記載しています。

導入する定義はカタログ上のキーと版で選びます。リポジトリ直下で `node bin/flap.js business list` を実行すると11事業が出ます。`business inspect <事業キー>` で人が行う手順、実行キー、入力の対応を確認できます。

- `business prepare <事業キー> <実行キー> <入力JSON>` は、版とダイジェスト付きのMCP入力を作ります。入力は `projectId`、`parameters`、必要に応じて `stepKey` と `results` です。認可済みの持ち込みエージェントに渡せます。
- 認可済みのCloud MCPアクセストークンを `FLAPBASE_MCP_ACCESS_TOKEN` に渡せる環境では、`business check-cloud` でCloudが同じ定義と実行キーを提供するか確認できます。`business run` は `prepare` と同じ引数を取り、一工程を実行します。書き込みの再送では入力内の冪等キーを維持します。
### セルフホストの入口

[ローカル起動手順](../self-host/README.md)でPostgreSQLとProjectを準備します。
`business inspect <事業キー>` の `localLaunch` または `localWorkflow` で起動後の入口を確認できます。

| 事業キー | 入口 | ローカルで行える主な仕事 |
| --- | --- | --- |
| `free-resource` | `local-base`、`/store` | 無料の資料公開、本人申込と受取 |
| `digital-product-sales` | `local-base`、`/store` | デジタル商品の公開、テスト決済、提供、フォロー |
| `customer-support` | `local-base`、`/store` | 本人の注文への問い合わせ、担当割当、MCPの返信案、確認後の本人向け公開 |
| `recruitment` | `/recruitment` | 求人公開、応募、選考、本人への結果表示 |
| `booking-service` | `/booking` | 受付枠の公開、予約、確定・変更・取消の通知プレビュー、出欠 |
| `event-registration` | `/booking` | 開催日時の公開、定員付き申込、確定通知プレビュー、参加結果 |
| `standard-service` | `/cases` | 問い合わせ、案件化、見積、顧客の回答、納品 |
| `customer-sales` | `/cases` | 問い合わせ、案件化、顧客と営業の進捗管理 |
| `member-ai-course` | `/training` | MCPの教材下書き、販売、本人受講、版固定の教材対話と未回答 |
| `organization-training` | `/training` | MCPの教材下書き、招待、割当、本人受講、進捗 |
| `paid-membership` | `/membership` | MCPの本文下書き、募集公開、入会・更新・退会、期間内の閲覧 |

決済にはテスト環境、教材対話にはローカルのモデル接続を使います。Cloudの実行キーは上記の認証済みMCPから実行します。

予約・イベントで使う[予約枠計算](../booking-slots/README.md)と、業務横断の[ステップ配信エンジン](../step-delivery/README.md)は、単独で組み込めます。予約の確定や配信は、保存・認可・外部接続を担当するHostが行います。

### 購入者サポート

`customer-support` を選ぶと、無料資料の公開から購入者の問い合わせ対応までを導入できます。Workspace単位で接続し、配布用の[デジタル商品定義](../self-host/digital-product.base)の `settings.workflow` を `flapbase:customer-support` にして `base` に渡します。`prepare-free-resource` は資料の固定版を基に、下書き・受取画面・サポートの工程を作ります。既存Projectを使う場合は `projectId` を指定し、新しく始める場合は省きます。運営者が提供条件と画面を確認して公開します。購入者本人が受取画面から問い合わせを送り、運営者は注文詳細で担当者を割り当てます。`order-support` で対象の問い合わせと現在の版を取得し、`reply-draft` で返信案を保存します。運営者が確認して公開すると、購入者が同じ注文の問い合わせ履歴で返信を読めます。

### 採用・応募管理

採用プレビューが有効な環境で `recruitment` を選びます。`recruitment-install` に対象の `projectId` を渡し、求人の固定版を導入します。同じProjectで再実行すると同じ導入を開けます。運営者が事業管理で原稿を保存し、検証・承認した版を公開します。応募者はログインして応募し、同じ求人から選考状況を確認できます。`recruitment-applications` は委任先Projectの応募の状態と版を返します。運営者が選考中の応募を採用または見送りで確定すると、応募者本人の応募履歴に結果の通知が出ます。

### 定型サービス

`standard-service` の `settings["standard-service"].appBase` を `portal-draft` に渡し、顧客ポータルの候補版を保存します。運営者が公開した受付から問い合わせが入り、`intake-to-case` で案件につなぎます。運営者が見積を送り、顧客本人がポータルで回答します。`deal-status` と `update-deal-status` で案件の状態を扱います。納品物は運営者が案件から送り、顧客本人がポータルで受け取ります。

### 有料会員の運営

`paid-membership` の標準工程は、プランと公開記事の準備、本人の加入、閲覧権の確認、更新、解約後の満了を扱います。Site候補版と会員照会は共通の実行キーを参照します。プランの価格設定と公開は運営者、申込と解約は会員本人が既存画面から行います。エージェントは `app_template_get` の `business-app` から事業キー、共通業務、実行キー、固定版を取得します。

### 予約サービスとイベント受付

`booking-service` と `event-registration` は、受付条件の設定後に同じ公開・運営工程を使います。対象Projectのメニューを `booking-offers` で取得し、`site-draft` の `site_apply` に `set-booking` を渡します。人が公開した後は既存の予約受付から確定・変更・取消しを行い、`booking-records` と `booking-outcome` で実施結果を確認します。固定開催日は開催専用の担当者の日付別受付時間を使います。

### 顧客と商談の管理

`customer-sales` は、受付フォームの候補版と公開から、顧客照会、案件化、担当と期限、成約・失注までを扱います。共通の `site-draft`、`intake-to-case`、`deal-status`、`update-deal-status`、`customer-history` を使います。担当と期限は運営者が既存の案件画面で設定します。

### デジタル商品販売

`digital-product-sales` は出品から公開Siteの購入導線、決済確定、購入者本人の再受取、注文サポートまでを扱います。商品管理と決済は既存の運営経路を使い、外部エージェントは共通の `site-draft`、`order-status`、`order-support`、`reply-draft` を選びます。出品と公開、購入者への返信は人の工程です。
