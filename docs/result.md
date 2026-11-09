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

## v0.2 の追加欄

既存の版と基本11項目の型を保ち、単一結果・フォルダ結果の両方に以下を足しています。`buildReport` は共有の基本結果を作り、`check`・`checkFile` が追加の規則を適用します。

| 欄 | 型と内容 |
| --- | --- |
| `factsRequested` | `('price' \| 'area' \| 'booking')[]`。既定は3つすべて |
| `pagePath` | ファイル入力の公開用ルートからの相対パス |
| `publication` | 読めた HTML の事実・リンク・比較する値・ページ内の問題 |
| `findings` | 原因ごとにまとめた問題と直す順番。フォルダでは全ページと公開用ファイルをまとめる |
| `difference` | `--baseline` を指定した場合の `fixed`・`introduced`・`continuing` |

`publication` は HTML が読めたページに入り、次の欄を持ちます。

| 欄 | 内容 |
| --- | --- |
| `facts` | `key`、日本語の `label`、`found`、`evidence[]`。選んだ事実ごとに有無と場所を返す |
| `links` | `page`、`line`、`selector`、`text`、`label`、元の `target`、解決した `destination`、転送後の `finalUrl`、`status`、`httpStatus`、`reason`、`kind`。ローカル先が存在すれば `localPath` も入る |
| `values` | 料金・営業日・住所・電話の `Evidence[]`。`field`、`subject`、比較用の `normalized` を含む |
| `findings` | このページの追加規則の問題。`code`、`cause`、`title`、`fix`、`evidence[]`、順序用の `rank` |
| `htmlLocations` | 基本11項目の要素の行・selector・本文。欠けた要素は入らない |
| `variants` | URL 入力で読めた日本語・英語指定の応答。`profile`、`url` と同じ publication の欄 |

`Evidence` は `page`（相対パスか最終 URL）、`source`（`html`・`jsonld`・`file`）、1からの `line`、要素を表す `selector`、短い `text`、根拠となる `value` を持ちます。比較する値には `field`・`subject`・`normalized`、言語指定には `profile`、壊れたリンクには `destination`・`finalUrl` も入ります。秘密ファイルの根拠はパスだけです。

最上位の `findings[]` はページ内の問題の型に `id`、1からの `priority`、`pageCount`、重複を除いた `pages[]` を足します。`id` は規則の `code` と原因の `cause` の SHA-256 の先頭20桁から作ります。同じ規則と原因の問題を1件にまとめ、根拠を合流します。基本項目の題・説明なども別々の規則として扱います。共通の noindex は `html.robots.noindex` の1件です。`rank` と `priority` は直す順番で、品質の点数ではありません。

### 事実と食い違いを見つける規則

- 本文は p・li・td・dd・dt・address・見出し・末端の div/section、または `data-fact` の要素を読みます。script・style・template・noscript・コメント・hidden・aria-hidden・インラインの非表示部分を除きます。h2 以降の見出しは、続く本文の手掛かりになります。
- 料金は円記号と数、または数と「円」。JSON-LD は `price` と JPY の `priceCurrency`（省略時も対象）です。`--facts price,area,booking` はこの3つから選び、未知の名前は入力エラーです。
- 対応地域は「対応地域」「対象地域」「サービスエリア」「所在地」「住所」「アクセス」、英語の service area・area served・location・address と、その見出しの本文。JSON-LD は `areaServed`・`serviceArea`・`address` です。
- 予約方法は「予約方法」「予約は」「予約受付」「予約フォーム」、予約と電話・メール・フォームなどの方法が同じ文にある本文、予約リンク・フォームの文言、JSON-LD の `ReserveAction` です。
- 営業日は営業日・定休日などの文言と JSON-LD の `openingHours`・`dayOfWeek`、住所は住所・所在地などの文言と `address`、電話は電話などの文言と `telephone` から読みます。
- 同じ field と subject について、ページ・言語指定・本文/JSON-LD ごとに値の集合を比べます。円の区切り、電話の区切りと +81、住所の空白と郵便番号、曜日の日本語/英語と範囲をそろえます。異なる集合を見つけたら両方を返します。subject の既定は `business`。商品名は JSON-LD の Product・Service・Offer の `name`、本文は `data-subject` を使います。例: `<p data-fact="price" data-subject="化粧水">2,000円</p>`。

### リンクと公開用ファイル

予約・問い合わせ・購入と英語の book・reserve・contact・buy・purchase・checkout を文言、aria-label、画像の alt、input の value で探し、a・button・送信 input とフォームを読みます。CSS のメディアクエリで隠れるメニューも対象です。formaction・action と base URL を解決し、フォームも宛先に GET します。405・501 の応答は未確認にします。

`status` は `ok`（宛先確認済み）、`broken`（修正が必要）、`unchecked`（未確認）。公開 URL の宛先は既存の DNS・IP 固定・転送・robots の規則で読み、HTTP 状態と最終 URL を返します。時間切れと robots の拒否は未確認です。URL 入力では言語指定分を含めて宛先50件まで確認し、同じ宛先を再利用します。

フォルダではネットワークへ接続せず、公開用ルート内の相対先、HTML の拡張子補完、directory index、ページ内 id を確認します。フォルダ外の URL・電話・メールは未確認。ローカルの最終 URL は解決した URL で、`localPath` は見つかったファイルです。ページごとに宛先50件まで確認します。

公開用フォルダで `.env` と `.env.*`、`.git`、鍵の拡張子（pem・key・p12・pfx）と id_rsa などの名前を検出します。通常ファイルは先頭8 KiB の秘密鍵ヘッダーも確認します。内容は結果に含めません。シンボリックリンクの中身と .git・node_modules の中は読みません。フォルダ全体は5000項目、ヘッダーの確認は合計8 MiB、深さ8までです。例の `.env` は `EXAMPLE_ONLY=not-a-secret` の固定の1行です。公開検査で許すのは、このパスと内容の組だけです。

HTTPS のページでは script・画像（srcset を含む）・iframe・音声・動画・object・stylesheet などの URL と、HTML 内の CSS の url()/@import が HTTP かを確認します。HTML の解析は20000要素・深さ128までです。

### 再点検の差分

```sh
node bin/flap.js check ./site --json > /tmp/site-before.json
node bin/flap.js check ./site --baseline /tmp/site-before.json
node bin/flap.js check ./site --baseline /tmp/site-before.json --json
```

前回の JSON は点検対象の外に置きます。入力の種類と `--facts` が同じ結果を比較し、問題の id とページごとに差を出します。`fixed` は前回だけ、`introduced` は今回だけ、`continuing` は両方にある組です。同じ原因で3ページのうち1ページを直せば、そのページだけが `fixed` に入ります。前回の問題の根拠は `fixed` にそのまま残ります。v0.1 の JSON に findings がない場合は既存の checks/issues から作ります。CLI は32 MiB 以下の前回 JSON を受け取ります。

規則のコードは `html.*`、`fact.*.missing`、`business-link.broken`、`consistency.price/days/address/phone`、`publication.env/git/private-key/mixed-content` です。既存の基本11項目以外の読まれ方の問題は、既存の issue key を保ちます。
