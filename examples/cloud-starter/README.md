# 無料資料のスターター

告知ページを手元で作り、申込・受取・注文管理をFlapbase Cloudにつなげます。告知ページにはAPIキーやログイン情報を置きません。

## プレビュー

Node.js 22以上で、リポジトリのルートから実行します。

```sh
node examples/cloud-starter/run.mjs
```

[http://127.0.0.1:5264/](http://127.0.0.1:5264/) を開きます。内容は [site.base.json](site.base.json) の `title` と `description` を編集します。

## 実際の申込につなぐ

1. [Flapbase Cloud](https://app.flapbase.com) にFlap IDで入り、Projectに資料を登録します。持ち込みAIで準備する場合は、そのWorkspaceへMCPを接続し `app_resources_prepare` に資料の固定版と元のProject IDを渡します。
2. Cloudの画面で案内・申込・受取の内容を確認し、無料商品を公開します。「商品・教材」で商品を開き、「共有リンクを用意」で `https://flap.page/products/<商品ID>` を発行します。
3. `site.base.json` の `productId` に商品IDを設定します。プレビューを再読込すると申込リンクが表示されます。Cloud APIから商品の公開情報を取得し、無料のダウンロード商品であることと、共有リンクから公開ページを開けることを確認します。
4. 申込ボタンから公開商品ページを開き、Flap IDでログインして申し込みます。受付完了後、ログイン中の本人がCloudの受取画面でダウンロードできます。
5. 運営者はCloudで同じProjectを選び、「注文」で申込を確認します。購入者から問い合わせがあれば、Projectに限定したMCP接続で `support_requests_list` と `support_reply_draft_save` を使えます。保存した返信案は注文の詳細で確認します。

## フロントを公開する

公開するファイルにHTMLを書き出します。出力先のディレクトリは先に用意してください。

```sh
mkdir -p dist
node examples/cloud-starter/run.mjs build dist/index.html
```

`dist/` を任意の静的ホストへ配備します。公開後も申込・本人受取・運営はCloudの経路を使います。
