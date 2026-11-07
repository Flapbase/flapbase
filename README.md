# Flapbase

Flapbase is a set of tools to build, check, publish and run websites and marketing for small businesses. This repository opens those tools so anyone can use them locally.

- Developers can use them directly in their own projects.
- AI agents such as Claude Code and Codex (ChatGPT) can use them in a few steps.
- Prefer a visual interface? Use the same tools in [Flapbase Cloud](https://flapbase.com), a workspace for growing your business. The results are the same.

New tools are added every month. The first one is the site check.

[日本語](#日本語)

## Site check

Check locally how search engines and AI read a site. Pass a public URL, a saved HTML file or a folder; you get what to fix, in order, with the reason. No account or API key. Node.js 22+, no external dependencies.

```sh
git clone https://github.com/Flapbase/flapbase.git
cd flapbase
node bin/flap.js check examples/cosmetics/index.html
```

The npm package is `@flapbase/cli` and the command is `flap`. Once published to npm:

```sh
npx --yes @flapbase/cli@0.1.0 check https://flapbase.com
npx --yes @flapbase/cli@0.1.0 check ./site --json
```

### What it checks

- The 11 basics: doctype, language, charset, mobile viewport, title, description, canonical URL, main heading, structured data (JSON-LD), content in the initial HTML, noindex.
- How AI reads the site: robots.txt, search, answer and training crawlers, organization structured data, responses per language, sitemap.
- `--json` returns the same result as JSON. The text output is built from it.

```sh
node bin/flap.js check https://flapbase.com --json
node bin/flap.js check examples/apparel/index.html
node bin/flap.js check examples/travel --base-url https://example.com/travel/
```

For a file, robots.txt and the sitemap are read from the same folder; for a folder, from its root. No URL is fetched in that case. Anything that could not be read is reported as "unchecked". The exit code is 0 even when fixes are found, and 1 when the input or a fetch fails.

URL fetching is limited to public HTTPS sites; private networks and local devices are refused. Limits: HTML 1 MiB and 10 s, robots.txt 64 KiB, sitemap 256 KiB, 3 redirects. Folders: up to 100 HTML files, 8 MiB in total, depth 8.

## Use from AI agents

Install the skills in Claude Code, Codex (ChatGPT) and other agents with one line:

```sh
npx skills add Flapbase/flapbase
```

| Skill | What it does |
| --- | --- |
| [flapbase-site-check](skills/flapbase-site-check/SKILL.md) | Runs the site check locally and explains the fixes |
| [flapbase-site-migrate](skills/flapbase-site-migrate/SKILL.md) | Moves an existing site (HTML, React, Astro, WordPress export) into Flap Site |
| [flapbase-site-diagnosis](skills/flapbase-site-diagnosis/SKILL.md) | Checks whether a site is recommended by AI, with Flapbase Cloud |
| [flapbase-publish-work](skills/flapbase-publish-work/SKILL.md) | Publishes work from Site and Design |
| [flapbase-projects-tasks](skills/flapbase-projects-tasks/SKILL.md) | Works with Projects and tasks |
| [flapbase-workflow](skills/flapbase-workflow/SKILL.md) | Runs workflows |
| [flapbase-connect-mcp](skills/flapbase-connect-mcp/SKILL.md) | Connects to Flapbase Cloud over MCP |
| [flapbase-join](skills/flapbase-join/SKILL.md) | Signs up to Flapbase Cloud, with the owner's confirmation |
| [flapbase-handoff](skills/flapbase-handoff/SKILL.md) | Leaves a handoff note |
| [flapbase-guardrails](skills/flapbase-guardrails/SKILL.md) | Rules to keep: personal data and what people decide |

The site check runs locally. The other skills use Flapbase Cloud through MCP.

## Flapbase Cloud

[Flapbase Cloud](https://flapbase.com) is a workspace for growing your business. The site check uses the same rules as its free diagnosis, and tests confirm that the same HTML gives the same result. This tool runs only on your machine and does not call Flapbase APIs or send your data. Continuous monitoring and checking whether you appear in AI answers are available in Flapbase Cloud.

[Examples](examples/README.md) · [Result format and Cloud mapping](docs/result.md) · [Where the rules come from](docs/provenance.md)

## Development

The CLI is at the root and the rules and fetching are in `packages/site-check`. No build step or added dependencies.

```sh
pnpm test
pnpm check:release
```

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

## 日本語

Flapbase は、事業のサイトと発信を作り、点検し、公開し、運用するための道具です。このリポジトリは、その道具を誰でも手元で使えるように公開したものです。

- 開発者は、自分のプロジェクトにそのまま組み込めます。
- AI エージェント（Claude Code、Codex（ChatGPT）など）から、少ない手数で使えます。
- 画面から使いたい方は、事業を伸ばすためのワークスペース [Flapbase Cloud](https://flapbase.com) で、同じ道具を使えます。結果は同じです。

道具は、毎月まとまった単位で足していきます。最初は「サイトの点検」です。

### サイトの点検

サイトが検索と AI に正しく読まれるかを、手元で点検します。公開している URL、保存した HTML、フォルダのどれでも渡せます。直す順番と理由を日本語で返します。アカウントと API キーは不要です。Node.js 22 以上で動き、外部のパッケージには依存しません。

```sh
node bin/flap.js check examples/cosmetics/index.html
node bin/flap.js check https://flapbase.com --json
```

点検するのは、基本の11項目と、AI からの読まれ方（robots.txt、検索用・回答用・学習用のクローラーの区別、運営者の構造化データ、言語ごとの応答、サイトマップ）です。URL の取得は、公開されている HTTPS のサイトに限ります。

### AI エージェントから使う

```sh
npx skills add Flapbase/flapbase
```

サイトの点検は手元で動きます。ほかの skill は、MCP で Flapbase Cloud を使います。一覧は上の表のとおりです。
