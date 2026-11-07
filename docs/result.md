# 結果の型と Cloud との対応

単一の URL・HTML は `flapbase.site-check/v1`、フォルダは `flapbase.site-check-collection/v1` を返します。型定義は `packages/site-check/src/index.d.ts` が正本です。

| 欄 | 内容 |
| --- | --- |
| `ruleSetVersion` | 基本11項目の版。`web-publication-seo/v1` |
| `crawlersVersion` | robots.txt で区別するクローラーの一覧の版 |
| `source` | 入力の種類と入力値 |
| `url` | 取得した最終 URL。ファイル入力では点検の基準 URL |
| `checkedAt` | 点検開始時の UTC 時刻 |
| `coverage` | HTML・robots.txt・サイトマップを確認できたか、言語比較を実行したか |
| `checks` | 基本11項目のキー・規則参照・判定・根拠 |
| `issues` | 修正順序。`priority` は1からの連番、`title`・`why`・`fix` に理由と直し方 |
| `rows` | 「読める」段の確認結果。`na` は未確認など判定のない項目 |
| `crawlers` | 検索用・質問への回答用・学習用ごとの robots.txt の許可。未確認は `allowed: null` |
| `profiles` | 言語指定なし・日本語・英語それぞれの URL、状態、HTML の言語、本文文字数 |

フォルダでは `reports` に各 HTML の結果がパス順に入ります。取得や入力のエラーは `flapbase.site-check-error/v1` と `error.code`・`error.message` を返し、終了コードは1です。正常に点検を終えたときは修正項目の有無にかかわらず0です。

JSON と日本語表示は同じ結果から作ります。HTML の中身や応答の値は点検のデータです。日本語表示では端末を操作する制御文字を除きます。

## Cloud と共有する範囲

基本11項目は、Cloud が使う `auditWebPublicationHtml` と `inspectInitialHtml` と同じ入力・閾値・判定です。タイトル8～70文字・説明30～160文字の目安から外れる警告も、その項目を要修正とします。初めの HTML は、本文が200字未満で空の取り付け口・実行 script の高い比率などが重なったときに要修正とします。短い静的な HTML は Cloud と同じく通します。

「読める」段の問題・理由・修正順序と robots.txt の読み方も共有します。`tests/fixtures/cloud-reference.json` は元の純粋関数を実行して作った固定の結果で、通常の `node:test` は外のソースなしで照合します。元のソースが手元にあるときは次の形で直接照合できます。この開発用スクリプトには `stripTypeScriptTypes` を備える Node.js が必要です。

```sh
node scripts/compare-cloud.mjs --source-root <照合元のルート>
```

## ローカルで追加・変更した範囲

- Cloud の「伝わる」「つながる」と登録後の案内は結果へ入れません。運営の構造化データの有無は、今回の対象である AI からの読まれ方に含めます。
- 言語比較では、言語指定なし・日本語・英語を診断用の User-Agent で実際に取得します。指定なしと日本語指定で言語が異なると修正の検討項目にします。指定なしで日本語、英語指定で英語が返る通常の切替は、観測値だけを載せます。
- ファイル入力で送信時の言語や robots.txt が分からないとき、取得が失敗したときは、確認済みの許可や変化なしとして表示しません。言語比較の一部が失敗した場合は `profiles` に null が入ります。
- 取得は Node の HTTPS 接続です。確認済みの IP に接続を固定し、転送先でも robots.txt を確認します。IPv6 の変換用・文書用アドレスも拒否します。robots.txt の401・403は読み取りを止めます。HTTP への転送は拒否します。
- 取得できた404・410は補助ファイルがないという観測です。失敗・タイムアウトは未確認です。私的な宛先や大容量は補助ファイルでも点検全体をエラーにします。

この対応表と fixture で、共通部分の一致と取得・表示の差を区別できます。

フォルダ入力では、指定したフォルダを公開用のルートとして扱います。そこに補助ファイルがないことを観測できるため、robots.txt は「ない」、サイトマップは修正項目として返します。HTML ファイルだけを指定した場合は、隣に補助ファイルがなくても公開先の状態は未確認です。API の `checkFile` では `rootIsSite: true` で同じ扱いを選べます。

robots.txt のワイルドカードは、外から受け取った文字列で正規表現を作らず、文字列として比較します。81種類の規則とパスで Cloud の結果と直接照合しています。
