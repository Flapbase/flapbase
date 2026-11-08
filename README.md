# Flapbase

A workspace for growing your business.

Open source. Use it with your AI agents, from your own code, or in Flapbase Cloud. It grows every week.

[日本語](#日本語)

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

## Flapbase

Flapbase is a workspace for growing your business. This repository opens it so anyone can run it locally.

- Developers can use it directly in their own projects.
- AI agents such as Claude Code and Codex (ChatGPT) can use it in a few steps.
- Prefer a visual interface? Use [Flapbase Cloud](https://flapbase.com). The results are the same.

## Use from AI agents

Install the skills in Claude Code, Codex (ChatGPT) and other agents with one line:

```sh
npx skills add Flapbase/flapbase
```

| Skill | What it does |
| --- | --- |
| [flapbase-site-check](skills/flapbase-site-check/SKILL.md) | Runs the site check locally and explains the fixes |
| [flapbase-site-migrate](skills/flapbase-site-migrate/SKILL.md) | Moves an existing site (HTML, React, Astro, WordPress export) into Flap Site |
| [flapbase-post-check](skills/flapbase-post-check/SKILL.md) | Checks social posts locally before they go out: AI-sounding lines, facts not in your materials, missing next steps, format per channel |
| [flapbase-post-assist](skills/flapbase-post-assist/SKILL.md) | Rewrites copy and drafts X and Instagram posts from the same materials, with Flapbase Cloud |
| [flapbase-site-diagnosis](skills/flapbase-site-diagnosis/SKILL.md) | Checks whether a site is recommended by AI, with Flapbase Cloud |
| [flapbase-publish-work](skills/flapbase-publish-work/SKILL.md) | Publishes work from Site and Design |
| [flapbase-projects-tasks](skills/flapbase-projects-tasks/SKILL.md) | Works with Projects and tasks |
| [flapbase-workflow](skills/flapbase-workflow/SKILL.md) | Runs workflows |
| [flapbase-connect-mcp](skills/flapbase-connect-mcp/SKILL.md) | Connects to Flapbase Cloud over MCP |
| [flapbase-join](skills/flapbase-join/SKILL.md) | Signs up to Flapbase Cloud, with the owner's confirmation |
| [flapbase-handoff](skills/flapbase-handoff/SKILL.md) | Leaves a handoff note |
| [flapbase-feedback](skills/flapbase-feedback/SKILL.md) | Sends feedback to Flapbase from Flapbase Cloud, after the owner confirms |
| [flapbase-guardrails](skills/flapbase-guardrails/SKILL.md) | Rules to keep: personal data and what people decide |

The site check and the post check run locally and send nothing. The other skills use Flapbase Cloud through MCP.

## Flapbase Cloud

[Flapbase Cloud](https://flapbase.com) is a workspace for growing your business. The site check uses the same rules as its free diagnosis, and tests confirm that the same HTML gives the same result. This tool runs only on your machine and does not call Flapbase APIs or send your data. Continuous monitoring and checking whether you appear in AI answers are available in Flapbase Cloud.

[Examples](examples/README.md) · [Result format and Cloud mapping](docs/result.md) · [Where the rules come from](docs/provenance.md) · [Architecture](docs/architecture.md)

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

事業を伸ばすためのワークスペース。

オープンソースです。AI エージェントから、自分のコードから、または Flapbase Cloud で使えます。毎週広がります。

### サイトの点検

サイトが検索と AI に正しく読まれるかを、手元で点検します。公開している URL、保存した HTML、フォルダのどれでも渡せます。直す順番と理由を日本語で返します。アカウントと API キーは不要です。Node.js 22 以上で動き、外部のパッケージには依存しません。

```text
公開前に直すべき問題が 7 件
1. 公開用フォルダに .env が混ざっています（1頁: .env）。直す所: .env を公開用フォルダから外します。
2. HTTPS の頁が HTTP の資源を読んでいます（1頁: index.html）。直す所: 資源の URL を HTTPS に直します。
```

```sh
node bin/flap.js check examples/cosmetics/index.html
node bin/flap.js check https://flapbase.com --json
```

基本の11項目と AI からの読まれ方に加え、料金・対応地域・予約方法が初めの HTML のどこにあるか、予約・問い合わせ・購入のリンクの宛先、頁・言語・構造化データの食い違い、公開用ファイルへの .env・.git・秘密鍵の混入と HTTP 資源を調べます。同じ原因は頁の数と一覧を付けて1件にまとめます。`--baseline` に前回の JSON を渡すと、直った所・新しく壊れた所・続いている所を表示します。URL の取得は、公開されている HTTPS のサイトに限ります。

### Flapbase

Flapbase は、事業を伸ばすためのワークスペースです。このリポジトリは、それを誰でも手元で使えるように公開したものです。

- 開発者は、自分のプロジェクトにそのまま組み込めます。
- AI エージェント（Claude Code、Codex（ChatGPT）など）から、少ない手数で使えます。
- 画面から使いたい方は、[Flapbase Cloud](https://flapbase.com) で使えます。結果は同じです。

### AI エージェントから使う

```sh
npx skills add Flapbase/flapbase
```

サイトの点検と投稿の点検は手元で動き、何も送りません。ほかの skill は、MCP で Flapbase Cloud を使います。一覧は上の表のとおりです。

### 意見と貢献

Issues と Pull Request は受け付けていません。意見は Flapbase Cloud のアプリのフィードバック、または MCP でつないだ AI エージェントから送ってください。セキュリティの問題は [SECURITY.md](SECURITY.md) を見てください。
