# 抽出の由来

Flapbase contributors の既存コードから、通信・保存をしない点検だけを選び、Apache-2.0 でこの repo に収録しています。最初の公開対象はこの repo の新しい履歴です。

抽出時のリビジョン：`ec07417bcaca8bbef912e87fcfd14f13d53f33b7`。

| 収録先 | 抽出元 | 変更 |
| --- | --- | --- |
| `packages/site-check/src/seo.js` | `web-publication-seo-audit/src/index.js` | 同じ JS。基本11項目に対応する結果を選ぶ |
| `initial-html.js`・`rules.js` | `website-diagnosis-contract/src/initial-html.ts`・`rules.ts` | JS として収録。規則の固定値と判定を保持 |
| `robots.js` | `website-diagnosis-contract/src/robots.ts` | JS として収録。ワイルドカードは正規表現を組み立てずに比較 |
| `public-read.js` | `website-diagnosis-contract/src/public-diagnosis.ts` | 「読める」段、クローラー一覧、組織と言語の読み取りだけを選定 |
| `public-url.js` | `public-url-contract/src/index.ts` | URL と IP の純粋な検証を JS として収録 |
| `checks.js` | 既存の SEO 検査 adapter の純粋な判定対応 | 同じ prefix・規則参照で11項目へ変換 |

TypeScript の型を取り除く処理と JS の整形は抽出時だけに使いました。利用・開発・配布にコンパイラは不要です。公開 API の型は `index.d.ts` に収録しています。

`fetch.js` はこの repo 用に実装した Node adapter です。DNS の A・AAAA を検証して取得先を固定し、元のホスト名で TLS を検証します。DNS の問い合わせも時間上限で中止します。Node の接続では IPv6 の変換用・文書用アドレスも拒否します。`input.js`・`report.js` と CLI はローカルの入力と結果の表示を担当します。

生成モデルを呼ぶ処理、認証、課金、データベース、事業情報の保存を含みません。静的な HTML と robots.txt とサイトマップだけで点検します。依存パッケージは0です。

比較元6ファイルの SHA-256 と固定入力11種類・robots.txt 81種類の結果を `tests/fixtures/cloud-reference.json` に記録しています。公開前検査は `scripts/check-release.mjs` で行い、選定したファイル、依存、秘密の形式、内部の名前、外部や repo 外への import を調べます。危険な URL を拒否する試験内の内部ホスト文字列だけは、明示した fixture として報告します。検査結果は `docs/release-scan.json` に保存します。

Node の接続設定は公式の [net の接続オプション](https://nodejs.org/docs/latest-v22.x/api/net.html#socketconnectoptions-connectlistener) に対応しています。
