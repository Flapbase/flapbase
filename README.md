# Flapbase

サイトの基本と、AI からの読まれ方を手元で点検します。公開 URL、保存した HTML、フォルダを渡すと、直す順番と理由を日本語で返します。アカウントと API キーは不要です。Node.js 22 以上で動き、実行時・開発時とも外部パッケージへの依存はありません。

まず3行で実行できます。

```sh
git clone https://github.com/Flapbase/flapbase.git
cd flapbase
node bin/flap.js check examples/cosmetics/index.html
```

npm の配布名は `@flapbase/cli`、命令は `flap` です。npm 公開後は次の形で実行できます。

```sh
npx --yes @flapbase/cli@0.1.0 check https://flapbase.com
npx --yes @flapbase/cli@0.1.0 check ./site --json
```

## 点検できること

- 基本11項目：文書の宣言、言語、文字コード、スマホ表示、タイトル、説明文、正規 URL、主見出し、JSON-LD、初めの HTML、noindex。
- AI からの読まれ方：robots.txt、検索用・質問への回答用・学習用クローラーの区別、運営の構造化データ、言語ごとの応答、サイトマップ。
- `--json` で同じ事実・修正順序を JSON に出力。人向け表示もこの結果から作ります。

```sh
node bin/flap.js check https://flapbase.com --json
node bin/flap.js check examples/apparel/index.html
node bin/flap.js check examples/travel --base-url https://example.com/travel/
```

ファイル入力では同じフォルダ、フォルダ入力では指定したルートから robots.txt とサイトマップを読みます。URL の取得は行いません。正規 URL を基準にし、`--base-url` を指定したときはそこから各 HTML の URL を決めます。取得できない情報は `coverage` と「未確認」で表します。点検で修正項目が見つかっても終了コードは 0、入力や取得の失敗は 1 です。

URL は公開 DNS 名の HTTPS に限ります。DNS で返ったすべての IP を確認し、確認した IP に接続を固定します。Host・TLS の名前と証明書の検証には元の DNS 名を使います。転送先も同じ検証と robots.txt の確認を行います。HTML は 1 MiB、robots.txt は 64 KiB、サイトマップは 256 KiB、転送は3回までです。HTML の取得は DNS と転送を含め10秒、補助ファイルは5秒で打ち切ります。フォルダは HTML 100ファイル・合計8 MiB・深さ8までです。

言語の比較は、診断用の User-Agent で、言語指定なし・日本語・英語を順に取得します。AI のクローラーごとの許可は robots.txt の規則から読みます。

## エージェントから使う

```sh
npx skills add Flapbase/flapbase
```

[サイト点検の skill](skills/flapbase-site-check/SKILL.md) が CLI の結果を読み、理由と修正案を説明します。

## Flapbase Cloud との関係

[Flapbase Cloud](https://flapbase.com) の無料診断と、基本11項目の規則と「読める」段の修正順序を共有します。同じ HTML の判定を固定した例で照合します。この CLI は手元で実行し、Flapbase の API・モデル・保存先を呼びません。Cloud は継続の見張りや AI の回答の観測を提供します。

[例](examples/README.md)・[結果の型と Cloud との対応](docs/result.md)・[抽出の由来](docs/provenance.md)を参照できます。

## 開発する

pnpm workspace のルートに CLI、`packages/site-check` に点検の規則と取得を置いています。CLI の配布には同じソースを同梱し、workspace 外でも動きます。`@flapbase/site-check` は単独でも配布できる構成です。ビルドと依存の追加は不要です。

```sh
pnpm test
pnpm check:release
```

Apache-2.0。著作権と由来は [LICENSE](LICENSE) と [NOTICE](NOTICE) に記載しています。

## English

Flapbase checks public websites and local HTML with Node.js 22+, without dependencies or an account. Run `node bin/flap.js check <URL|file|folder>`; add `--json` for structured results and ordered fixes. It shares deterministic checks with Flapbase Cloud and runs locally. Install the agent skill with `npx skills add Flapbase/flapbase`. Apache-2.0.
