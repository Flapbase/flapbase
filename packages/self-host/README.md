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

## 定型サービスと顧客・商談管理のローカルDB

通常のセットアップ後に `pnpm --filter @flapbase/self-host setup cases` を実行すると、既存のCRM・案件・見積・納品SQLを導入できます。初期化済みProjectで案件操作が拒否される場合は、運営者IDで `setup project` を再実行すると作成者の会員行を補えます。

`cases.mjs` の共通処理で、問い合わせの再送、顧客への集約、案件化、担当と期限、成約・失注、見積の送付と本人回答、納品の受領を扱います。通知はローカルDBに記録します。公開フォーム、運営・顧客ポータル、MCPへの接続はこの段階の対象外です。動作は `cases.postgres.test.mjs` で確認できます。
