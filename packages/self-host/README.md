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

## 予約サービスとイベント受付のローカルDB

`pnpm --filter @flapbase/self-host setup booking` で、既存の予約SQLとProjectへの紐づけを導入できます。個別予約と定員付きイベントは同じ `booking.mjs` を使います。空き枠計算・確定・振替・取消・出欠は使い捨てPostgreSQLのテストで確認できます。

この段階の入口はNodeモジュールです。ローカルの公開受付・運営画面・MCPの起動設定は接続前です。予約の確定には既存SQLと同じくメールを確認済みのHuman Principalが必要です。通知はDBに記録し、外部へ送信しません。
