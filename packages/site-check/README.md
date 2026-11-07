# サイトの点検

基本11項目と AI からの読まれ方を、外部パッケージへの依存なしで点検します。Node.js 22 以上で動きます。

```js
import { check, inspectChecks, formatReport } from '@flapbase/site-check'
const report = await check('./site/index.html')
console.log(formatReport(report))
const checks = inspectChecks('<!doctype html><html lang="ja"></html>', 'https://example.com/')
```

`check` は公開 URL、HTML ファイル、フォルダを読みます。`inspectChecks` と `buildReport` は通信・保存をしない関数です。公開 URL は確認した公開 IP に接続を固定します。HTML は 1 MiB、robots.txt は 64 KiB、サイトマップは 256 KiB、転送は3回までです。フォルダは HTML 100ファイル・合計8 MiB・深さ8までです。

Apache-2.0。由来と著作権は NOTICE に記載しています。
