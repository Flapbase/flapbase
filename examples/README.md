# 点検の例

コスメ・アパレル・旅の HTML は架空のサイトです。robots.txt は検索用を許可し、学習用の GPTBot を拒否する例です。

```sh
node bin/flap.js check examples/cosmetics/index.html
node bin/flap.js check examples/apparel --json
node bin/flap.js check examples/travel --json
```

`flapbase.com-20261107.json` は公開 URL をこの CLI で点検した実測の結果です。基本11項目が通り、言語指定なしと日本語指定で日本語、英語指定で英語が返りました。運営の構造化データとサイトマップを確認しています。点検の日時と本文の文字数は JSON に記録しています。

`flapbase.com-before-20261107.json` は改善前の記事記録から選んだ事実です。基本11項目は通っていましたが、言語指定なしでは英語の短い本文が返り、構造化データは WebSite だけでした。このファイルは当時の要約で、現在の CLI が改善前のサイトを再取得した結果とは区別しています。
