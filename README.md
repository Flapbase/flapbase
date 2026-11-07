# Flapbase

Flapbase は、事業のサイトと発信を作り、点検し、公開し、運用するための道具です。このリポジトリは、その道具を誰でも手元で使えるように公開したものです。

- 開発者は、自分のプロジェクトにそのまま組み込めます。
- AI エージェント（Claude Code、Codex（ChatGPT）など）から、少ない手数で使えます。
- 同じ道具を、画面から使いたい方は [Flapbase Cloud](https://flapbase.com) で使えます。結果は同じです。

道具は、毎月まとまった単位で足していきます。最初は「サイトの点検」です。

## サイトの点検

サイトが検索と AI に正しく読まれるかを、手元で点検します。公開している URL、保存した HTML、フォルダのどれでも渡せます。直す順番と理由を日本語で返します。アカウントと API キーは不要です。Node.js 22 以上で動き、外部のパッケージには依存しません。

```sh
git clone https://github.com/Flapbase/flapbase.git
cd flapbase
node bin/flap.js check examples/cosmetics/index.html
```

npm の配布名は `@flapbase/cli`、命令は `flap` です。npm に公開したあとは、次の形でも使えます。

```sh
npx --yes @flapbase/cli@0.1.0 check https://flapbase.com
npx --yes @flapbase/cli@0.1.0 check ./site --json
```

### 点検すること

- 基本の11項目：文書の宣言、言語、文字コード、スマホの表示、題、説明文、正規の URL、主見出し、構造化データ（JSON-LD）、初めの HTML の中身、検索から外す指示（noindex）。
- AI からの読まれ方：robots.txt、検索用・回答用・学習用のクローラーの区別、運営者の構造化データ、言語ごとの応答、サイトマップ。
- `--json` を付けると、同じ結果を JSON で返します。画面に出す日本語の結果も、この JSON から作っています。

```sh
node bin/flap.js check https://flapbase.com --json
node bin/flap.js check examples/apparel/index.html
node bin/flap.js check examples/travel --base-url https://example.com/travel/
```

ファイルを渡したときは同じフォルダから、フォルダを渡したときはその直下から、robots.txt とサイトマップを読みます。このときは URL の取得をしません。読み取れなかったことは「未確認」として返します。直すことが見つかっても終了コードは 0 で、入力や取得に失敗したときは 1 です。

URL の取得は、公開されている HTTPS のサイトに限ります。社内のネットワークや手元の機器には接続しません。HTML は 1 MiB・10秒、robots.txt は 64 KiB、サイトマップは 256 KiB、転送は3回までです。フォルダは HTML 100ファイル・合計 8 MiB・深さ8までです。

## AI エージェントから使う

Claude Code、Codex（ChatGPT）などで、次の1行で skill を入れられます。

```sh
npx skills add Flapbase/flapbase
```

[サイトの点検の skill](skills/flapbase-site-check/SKILL.md) が点検を動かし、結果の理由と直し方を説明します。

## Flapbase Cloud との関係

[Flapbase Cloud](https://flapbase.com) は、サイト・デザイン・発信をひとつの場所で運用するサービスです。この点検は Flapbase Cloud の無料診断と同じ規則で動き、同じ HTML なら同じ結果になることを試験で確かめています。

この道具は手元だけで動き、Flapbase の API やデータは使いません。続けての見張りや、AI の回答に実際に出るかの確認は、Flapbase Cloud で使えます。

[例](examples/README.md)・[結果の形と Cloud との対応](docs/result.md)・[規則の由来](docs/provenance.md)

## 開発する

ルートに CLI、`packages/site-check` に点検の規則と取得を置いています。ビルドや依存の追加は要りません。

```sh
pnpm test
pnpm check:release
```

Apache-2.0。著作権と由来は [LICENSE](LICENSE) と [NOTICE](NOTICE) にあります。

## English

Flapbase is a set of tools to build, check, publish and run websites and marketing for small businesses. This repository opens those tools so developers and AI agents (Claude Code, Codex and others) can use them locally; the same tools run in [Flapbase Cloud](https://flapbase.com) with the same results. The first tool checks how search engines and AI read a site: `node bin/flap.js check <URL|file|folder>` (add `--json` for structured output). Node.js 22+, no dependencies, no account. Install the agent skill with `npx skills add Flapbase/flapbase`. Apache-2.0.
