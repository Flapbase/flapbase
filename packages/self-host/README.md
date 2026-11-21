# Flapbase Self-host

Local preview for a free digital product. Start with a product definition or use your own title, copy, and file. A buyer signs in, claims the product, and downloads the file. The operator can see the order and review a reply draft prepared through MCP.

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

無料のデジタル商品を公開し、本人申込・資料受取・問い合わせ・運営の注文確認までを試せるローカル先行版です。上の手順で空の PostgreSQL を準備して起動します。最初の運営者を登録し、ログイン後の `/auth/context` に表示される `principalId` で Project を作ります。

- `/store` から案内とファイルを確認して公開します。[共通の .base](digital-product.base) を使うと下書きから始められます。
- 別のブラウザプロファイルで商品ページを開き、購入者として登録・申込・ダウンロードします。受取画面から送った問い合わせは、運営者が `/store` で確認できます。
- 持ち込みMCPから問い合わせを読み、返信案を保存できます。MCPの起動コマンドは `node`、引数は `packages/self-host/mcp.mjs` の絶対パスです。
- 同じ商品を再公開すると、新規申込には新版が適用され、既存の受付は元の版を受け取れます。

初回の対象は端末内の実行です。配信はローカルのプレビュー記録、決済は任意の Stripe テストモードです。

## Checks

With the local PostgreSQL executables on your path, run `pnpm --filter @flapbase/self-host test`. Tests start and clean up a disposable database and use the stdio MCP protocol.
