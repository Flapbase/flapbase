# Flapbase - Agentic Business Framework

Build, publish, and run digital products with your AI agent.

Flapbase is open source. Run it on your own infrastructure or build your own frontend with the [Flapbase Cloud API](#using-the-managed-service).

[日本語](#日本語)

## Quickstart

Run Flapbase locally with Node.js and PostgreSQL. Publish a free digital product, let signed-in buyers claim and download it, review orders, and save reply drafts through MCP. [Get started](packages/self-host/README.md).

## Site check

Check locally how search engines and AI read a site. Pass a public URL, a saved HTML file or a folder; you get what to fix, in order, with the reason. No account or API key. Node.js 22+, no external dependencies.

```text
Problems to fix before publishing: 7
1. The publish folder contains .env (1 page: .env). Fix: Remove .env from the publish folder.
2. An HTTPS page loads an HTTP resource (1 page: index.html). Fix: Use HTTPS for the resource URL.
```

```sh
git clone https://github.com/Flapbase/flapbase.git
cd flapbase
node bin/flap.js check examples/travel-broken
```

The npm package is `@flapbase/cli` and the command is `flap`. Once published to npm:

```sh
npx --yes @flapbase/cli@0.1.0 check https://flapbase.com
npx --yes @flapbase/cli@0.1.0 check ./site --json
```

### What it checks

- The 11 basics: doctype, language, charset, mobile viewport, title, description, canonical URL, main heading, structured data (JSON-LD), content in the initial HTML, noindex.
- How AI reads the site: robots.txt, search, answer and training crawlers, organization structured data, responses per language, sitemap.
- Facts in the initial HTML: price, service area and booking method, from text, headings and JSON-LD. Choose them with `--facts price,area,booking`.
- Booking, contact and purchase links and forms, including mobile menus: source, label and final destination. URL checks follow redirects; folder checks resolve local files.
- Prices in yen, opening days, addresses and phone numbers across pages, languages and JSON-LD.
- Publication accidents: `.env`, `.git`, private key files and HTTP resources on HTTPS pages.
- Problems grouped by rule and cause, with affected pages, evidence and where to fix them. `--baseline` separates fixed, new and continuing problems.
- `--json` returns the same result as JSON. The text output is built from it.

```sh
node bin/flap.js check https://flapbase.com --json
node bin/flap.js check examples/apparel/index.html
node bin/flap.js check examples/travel --base-url https://example.com/travel/
```

Save a result, make changes and check again:

```sh
node bin/flap.js check ./site --json > /tmp/site-before.json
node bin/flap.js check ./site --baseline /tmp/site-before.json
node bin/flap.js check ./site --facts price,booking --json
```

For a file, robots.txt and the sitemap are read from the same folder; for a folder, from its root. No URL is fetched in that case. Anything that could not be read is reported as "unchecked". The exit code is 0 even when fixes are found, and 1 when the input or a fetch fails.

URL fetching is limited to public HTTPS sites; private networks and local devices are refused. Limits: HTML 1 MiB and 10 s, robots.txt 64 KiB, sitemap 256 KiB, 3 redirects. Folders: up to 100 HTML files, 8 MiB in total, depth 8.

## Using the managed service

Use the Cloud API as a managed backend for your own frontend, or use the hosted interface to build and run your business in Flapbase Cloud.

[Flapbase Cloud](https://flapbase.com) is a workspace for growing your business. The site check uses the same rules as its free diagnosis, and tests confirm that the same HTML gives the same result. This tool runs only on your machine and does not call Flapbase APIs or send your data. Continuous monitoring and checking whether you appear in AI answers are available in Flapbase Cloud.

[Examples](examples/README.md) · [Result format and Cloud mapping](docs/result.md) · [Where the rules come from](docs/provenance.md) · [Architecture](docs/architecture.md)

[Skills documentation](docs/skills.md)

## Feedback and contributions

Issues and pull requests are closed. Send feedback from Flapbase Cloud: use the feedback button in the app, or ask your AI agent connected over MCP. To report a security issue, see [SECURITY.md](SECURITY.md).

## Development

The CLI is at the root and the rules and fetching are in `packages/site-check`. No build step or added dependencies.

```sh
pnpm test
pnpm check:release
```

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

## 日本語

**AIエージェントとデジタル商品を作り 公開し 運営する**

Flapbaseはオープンソースです。自分の環境で動かすことも、[Flapbase Cloud API](#using-the-managed-service)をバックエンドにして独自の画面を作ることもできます。

### はじめる

Node.jsとPostgreSQLでFlapbaseをローカル起動し、無料商品の公開・申込・本人受取・注文確認・MCPでの返信案保存を試せます。 [セットアップ手順](packages/self-host/README.md#日本語)

### サイトの点検

サイトが検索と AI に正しく読まれるかを、手元で点検します。公開している URL、保存した HTML、フォルダのどれでも渡せます。直す順番と理由を日本語で返します。アカウントと API キーは不要です。Node.js 22 以上で動き、外部のパッケージには依存しません。

```text
公開前に直すべき問題が 7 件
1. 公開用フォルダに .env が混ざっています（1ページ: .env）。直す所: .env を公開用フォルダから外します。
2. HTTPS のページが HTTP の資源を読んでいます（1ページ: index.html）。直す所: 資源の URL を HTTPS に直します。
```

```sh
node bin/flap.js check examples/cosmetics/index.html
node bin/flap.js check https://flapbase.com --json
```

基本の11項目と AI からの読まれ方に加え、料金・対応地域・予約方法が初めの HTML のどこにあるか、予約・問い合わせ・購入のリンクの宛先、ページ・言語・構造化データの食い違い、公開用ファイルへの .env・.git・秘密鍵の混入と HTTP 資源を調べます。同じ原因はページの数と一覧を付けて1件にまとめます。`--baseline` に前回の JSON を渡すと、直った所・新しく壊れた所・続いている所を表示します。URL の取得は、公開されている HTTPS のサイトに限ります。

[Skills のドキュメント](docs/skills.md#日本語)

### 意見と貢献

Issues と Pull Request は受け付けていません。意見は Flapbase Cloud のアプリのフィードバック、または MCP でつないだ AI エージェントから送ってください。セキュリティの問題は [SECURITY.md](SECURITY.md) を見てください。
