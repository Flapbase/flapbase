# Run Flapbase locally

This quickstart runs Flapbase locally with a free digital product. Start with a product definition or use your own title, copy, and file. A buyer signs in, claims the product, and downloads the file. The operator can see the order and review a reply draft prepared through MCP.

## Start locally

Use Node.js 22+, pnpm, and a dedicated empty PostgreSQL database. These commands run from the repository root.

```sh
pnpm install --frozen-lockfile
createdb flapbase_local
export FLAP_AUTH_DATABASE_URL='postgresql:///flapbase_local?host=/tmp'
export FLAP_AUTH_ISSUER='urn:flapbase:self-host:local'
export FLAP_AUTH_SECRET="$(openssl rand -hex 32)"
pnpm --filter @flapbase/self-host setup
pnpm --filter @flapbase/self-host start
```

Use your PostgreSQL connection string if your socket or database user differs. Open [the local sign-in page](http://127.0.0.1:5264/), register an operator, and copy `principalId` from [/auth/context](http://127.0.0.1:5264/auth/context). Stop the server with Ctrl+C and use the same shell to enable the store.

```sh
export FLAP_STORE_OWNER_ID='<principalId>'
export FLAP_STORE_PROJECT_ID="$(node -p 'crypto.randomUUID()')"
export FLAP_STORE_DATA_DIR="$HOME/.flapbase/self-host-data"
pnpm --filter @flapbase/self-host setup project
node packages/self-host/install-base.mjs packages/self-host/digital-product.base
pnpm --filter @flapbase/self-host start
```

1. Open [the operator screen](http://127.0.0.1:5264/store). Choose a file up to 5 MiB and publish the product.
2. Open the product link in a separate browser profile. Create a buyer account, claim the product, and download the file.
3. Send a question from the receipt. The operator sees the order and the question at `/store`.
4. Publish another version using the same listing. Open the old receipt to check that it still delivers the original file.

Keep the issuer, signing secret, Project ID, and data directory on restart. Back up PostgreSQL and the data directory together.

## Connect a local MCP client

Set `FLAP_STORE_AGENT_PRINCIPAL_ID` to the store owner's ID and generate a local token with `openssl rand -hex 32`. Set `FLAP_STORE_AGENT_TOKEN` to that value in both the server and the MCP client, then restart the server. Run `node packages/self-host/mcp.mjs` as a stdio MCP server with `FLAP_ORIGIN=http://127.0.0.1:5264`. In the client's configuration use the absolute path to `mcp.mjs`. An agent can prepare product and follow-up drafts, read order support, and save a reply draft for operator review.

The server binds to loopback. Local email follow-up can write a preview file when `FLAP_STORE_EMAIL_PREVIEW=1`. Optional Stripe integration accepts test-mode credentials. Public hosting and live payment require a separate deployment.

## 日本語

Flapbaseを手元で起動し、無料のデジタル商品の公開・本人申込・資料受取・問い合わせ・注文確認を試します。上の手順で空のPostgreSQLデータベースを準備します。最初の運営者を登録し、ログイン後の `/auth/context` に表示される `principalId` で Project を作ります。

- `/store` から案内とファイルを確認して公開します。[共通の .base](digital-product.base) を使うと下書きから始められます。
- 別のブラウザプロファイルで商品ページを開き、購入者として登録・申込・ダウンロードします。受取画面から送った問い合わせは、運営者が `/store` で確認できます。
- 持ち込みMCPから問い合わせを読み、返信案を保存できます。MCPの起動コマンドは `node`、引数は `packages/self-host/mcp.mjs` の絶対パスです。
- 同じ商品を再公開すると、新規申込には新版が適用され、既存の受付は元の版を受け取れます。

初回の対象は端末内の実行です。配信はローカルのプレビュー記録、決済は任意の Stripe テストモードです。

## Checks

With the local PostgreSQL executables on your path, run `pnpm --filter @flapbase/self-host test`. Tests start and clean up a disposable database and use the stdio MCP protocol.

## 採用・応募管理

同じサーバーで、求人の公開、本人応募、運営者による選考、応募者本人への結果表示を試せます。既存のPostgreSQLを使う場合も `node packages/self-host/setup.mjs` を実行して追加テーブルを作ります。

1. 上の認証手順で運営者としてログインし、`/auth/context` の `principalId` を取得します。
2. `FLAP_RECRUITMENT_PROJECT_ID` にProjectのUUID、`FLAP_RECRUITMENT_DATA_DIR` に永続ディレクトリを設定します。新規Projectには `FLAP_STORE_OWNER_ID` に運営者ID、必要なら `FLAP_PROJECT_NAME` に事業名を入れ、`node packages/self-host/setup.mjs project` を実行します。商品と採用を同じプロセスで有効化した場合、この初期化コマンドは `FLAP_STORE_PROJECT_ID` を優先します。
3. サーバーを起動し、`/recruitment` で「採用を始める」を押します。求人原稿を保存・検証し、運営者が承認した版を公開します。公開リンクから別アカウントで応募し、運営画面で選考を進めます。応募者は同じリンクから応募状況を確認できます。
4. 持ち込みAIから導入する場合は、サーバーに `FLAP_RECRUITMENT_AGENT_PRINCIPAL_ID` と `FLAP_RECRUITMENT_AGENT_TOKEN` を設定します。前者は対象Projectの運営権限を持つHuman Principalです。MCPクライアントは `node packages/self-host/mcp.mjs` を起動し、環境変数で同じトークンを受け取ります。標準事業定義の `app_add_recruitment` と `recruitment_applications_list` を使えます。後者が返すのは応募ID・求人名・状態・版です。

公開求人はデータディレクトリから配信し、閲覧時にPostgreSQLへ接続しません。1プロセスで稼働させ、復旧時はPostgreSQLとデータディレクトリを同じバックアップから戻してください。選考結果は応募者の画面に表示します。

## 予約サービスとイベント受付

通常のセットアップ後に `pnpm --filter @flapbase/self-host setup booking` を実行します。予約用のPostgreSQL操作は、既存の予約SQLから生成しています。

1. `FLAP_BOOKING_PROJECT_ID` にProjectのUUID、`FLAP_BOOKING_DATA_DIR` に永続ディレクトリを設定します。新規Projectの場合は運営者の `FLAP_STORE_OWNER_ID` を設定し、`node packages/self-host/setup.mjs project` を実行します。複数事業の環境変数を同時に設定した場合は、商品、採用、予約の順で初期化対象を選びます。
2. 起動後、運営者として `/booking` を開きます。「毎週の予約」または「指定日のイベント」を選び、受付時間と定員を設定して公開します。
3. 公開ページから別のアカウントでログインし、確認用リンクを発行します。ローカル運用者は `FLAP_BOOKING_DATA_DIR/<ProjectのUUID>/verification-preview/` の確認メールを扱います。リンクには短い有効期限があります。送信先本人がリンクを開いた後、空き枠から申し込めます。
4. 受付完了ページで本人の予約・振替・取消を確認できます。運営者は `/booking` で申込を確認し、開始時刻以降に出欠を記録できます。

MCPを使う場合、`FLAP_BOOKING_AGENT_PRINCIPAL_ID` に対象Projectの運営権限を持つHuman Principalを設定し、サーバーとMCPクライアントに同じ `FLAP_BOOKING_AGENT_TOKEN` を設定します。既存の `mcp.mjs` から `booking_offers_list`、`booking_records_list`、`booking_outcome_record` を利用できます。

受付ページは保存した公開版を配信します。空き枠と申込はPostgreSQLで照合し、決済や外部カレンダー・メールへの送信は行いません。確認メールはローカル試験向けで、確認用ディレクトリをWeb公開しないでください。受入は `booking-http.postgres.test.mjs` を実行すると再現できます。

## 定型サービスと顧客・商談管理

通常のセットアップ後に `pnpm --filter @flapbase/self-host setup cases` を実行します。既存の案件・見積・納品SQLと、固定版の事業定義を使います。

1. `FLAP_CASES_PROJECT_ID` と `FLAP_CASES_DATA_DIR` を設定します。新規Projectの場合は `FLAP_STORE_OWNER_ID` に運営者IDを指定し、`node packages/self-host/setup.mjs project` を実行します。既存Projectに作成者の会員行がなければ、同じコマンドで追加できます。
2. `FLAP_CASES_BUSINESS` に `standard-service` または `customer-sales` を設定します。運営者が `/cases` で受付の下書きを確認して公開すると、`/service` から問い合わせを送れます。
3. 運営画面で問い合わせを案件にし、担当と期限・次の対応・成約や失注を記録します。定型サービスでは見積を送付し、追加情報を依頼し、納品内容を顧客用リンクに公開できます。顧客は問い合わせ時のメールを確認した後に、見積への回答や納品の受領を行えます。
4. メール確認リンクは `FLAP_CASES_DATA_DIR/<ProjectのUUID>/verification-preview/` に書き出されます。外部には送信しません。このローカルプレビューをWeb公開しないでください。

持ち込みAIは `FLAP_CASES_AGENT_PRINCIPAL_ID` に運営権限を持つHuman Principalを設定し、サーバーとクライアントに同じ `FLAP_CASES_AGENT_TOKEN` を渡して `mcp.mjs` に接続します。標準の `inbox_list`、`customer_get`、`deal_create_from_inquiry`、`deal_get`、`deal_status_update` を利用できます。問い合わせの本文や連絡先をツール応答に含めません。

初期の納品内容は文面です。ローカルの受付は運営画面で公開し、Cloudの汎用サイト・アプリ編集ツールは別の接続経路です。

### 法人研修のローカル画面とAPI

既存のローカルDBで `pnpm --filter @flapbase/self-host setup` を再実行すると教材の保存先が追加されます。
`FLAP_COURSE_PROJECT_ID` に非公開ProjectのID、`FLAP_COURSE_DATA_DIR` にサーバーのローカルデータ用フォルダを指定します。
OwnerまたはEditorは `/training` から教材を公開し、招待リンクを発行できます。リンクを受け取った人は
招待先のメールアドレスを登録・確認して参加します。ローカルのメール確認リンクは
`<FLAP_COURSE_DATA_DIR>/<Project ID>/verification-preview/` に書き出されます。

参加後の受講者に教材を割り当てると、本人の `/training/my` に表示されます。受講者は教材を読んで
受講済みにでき、担当者は `/training` で進捗を確認できます。

| 操作 | API |
| --- | --- |
| 教材の公開 | `POST /api/courses/v1/releases` に `course-document/v1` を送信 |
| 受講割当 | `POST /api/courses/v1/assignments` に `assignmentId`、`learnerId`、`artifactRevisionId` を送信 |
| 進捗一覧 | `GET /api/courses/v1/assignments` |
| 本人の教材と進捗 | `GET /api/courses/v1/assignments/{assignmentId}` |
| 進捗更新 | `POST /api/courses/v1/assignments/{assignmentId}/progress` に `lessonId`、`expectedVersion`、`completed` と `Idempotency-Key` ヘッダーを送信 |

受講者にはProjectの有効なメンバー資格が必要です。割当ごとに教材の公開版が固定されます。


### 持ち込みAIから教材の下書きを作る

サーバーに `FLAP_COURSE_AGENT_PRINCIPAL_ID`（同じProjectのOwnerまたはEditor）と
`FLAP_COURSE_AGENT_TOKEN`（ローカル接続用の32文字以上の秘密値）を設定します。
持ち込みAIには `node packages/self-host/mcp.mjs` を標準入出力のMCPサーバーとして登録し、
同じ `FLAP_ORIGIN` と `FLAP_COURSE_AGENT_TOKEN` を環境変数で渡します。

- `course_draft_save` に `projectId`、`artifactRef`、`course-document/v1` の `document`、
  `idempotencyKey` を指定します。初回の版は1、講座の公開状態は `draft` とします。更新時は前の `course.pin` を
  `prior` に指定して版番号を1つ進めます。
- `course_draft_get` で版履歴を取得できます。版番号とダイジェストを一緒に指定すると、その固定版を取得できます。
- 担当者は返された `openUrl` または `/training` の「公開前の教材」から内容を確認し、画面で公開します。
  公開版が確定すると、研修の割当候補に表示されます。


### 公開した教材を購入者に提供する

`flap business inspect member-ai-course` に表示される `/training` が管理画面です。
`FLAP_COURSE_PROJECT_ID` と `FLAP_STORE_PROJECT_ID` に同じProjectを指定し、教材と商品それぞれの
ローカルデータ用フォルダを設定します。`FLAP_STORE_STRIPE_KEY` と `FLAP_STORE_STRIPE_WEBHOOK_SECRET` は
テスト決済用の値を使います。

1. 教材を公開し、`/training` の「講座を販売する」で教材の版、商品名、紹介文、価格を確認して販売ページを公開します。
2. 販売ページからログインして購入手続きに進みます。決済後、注文ページの「講座を受講する」から教材を開きます。
3. 受講者の進捗は注文ごとに保存されます。販売ページを新しい教材で再公開しても、以前の購入者は注文時の版を受講できます。
   決済設定を外した場合も受講は継続できます。

APIで出品を更新する場合は `POST /api/courses/v1/offers` に既存の `listingId` と新しい公開版の
`artifactRevisionId` を含めます。決済後に使用する受講APIは `/api/courses/v1/orders/{orderId}` と
`/api/courses/v1/orders/{orderId}/progress` です。

### 購入者向けの教材対話

`pnpm --filter @flapbase/self-host setup` を再実行して実行履歴の保存先を追加します。
`FLAP_COURSE_AI_ENDPOINT` に `http://127.0.0.1:11434/v1/chat/completions` のようなローカルの
OpenAI互換エンドポイントを、`FLAP_COURSE_AI_MODEL` にそこで実行できるローカルモデル名を設定します。
設定後、購入済み教材のページから質問できます。モデルの運用と選択はセルフホスト側が担当します。

購入時の版で閲覧できる教材を根拠に回答し、参照したレッスンを表示します。根拠が見つからない質問は
運営画面の「教材で答えられなかった質問」に表示されます。持ち込みAIの `member_ai_reviews_list` では
記録ID、理由、受付日時を取得できます。質問と参照箇所は連絡先などをマスクします。
ローカル試験用の上限は購入者1人につきUTC日付で20件です。
