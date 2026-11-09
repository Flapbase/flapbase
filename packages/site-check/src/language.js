// Translate generated prose only. Evidence, URLs, rule codes, causes and IDs stay intact.
const messages = [
  ['未確認', 'unchecked'], ['確認済み', 'checked'], ['要修正', 'needs a fix'],
  ['ある', 'present'], ['ない', 'missing'], ['なし', 'none'],
  ['料金', 'Price'], ['対応地域', 'Service area'], ['予約方法', 'Booking method'],
  ['営業日', 'Opening days'], ['住所', 'Address'], ['電話', 'Phone'],
  ['ページの言語設定', 'Page language'], ['文字コード設定', 'Character encoding'],
  ['モバイル表示設定', 'Mobile viewport'], ['ページタイトル', 'Page title'],
  ['ページ説明文', 'Page description'], ['主見出し H1', 'Main heading H1'],
  ['構造化データ JSON-LD', 'Structured data JSON-LD'], ['初めのHTMLの中身', 'Initial HTML content'],
  ['検索除外設定 noindex', 'Search exclusion noindex'],
  ['このページ', 'This page'], ['検索から外す指示', 'Search exclusion'],
  ['題・説明・見出し', 'Title, description and heading'], ['言語・文字コード・スマホの表示', 'Language, encoding and mobile viewport'],
  ['こちらからの読み取り', 'Our fetch'], ['検索用のクローラー', 'Search crawlers'], ['学習用のクローラー', 'Training crawlers'],
  ['読む相手で中身が変わらないか', 'Content by reader'], ['初めの HTML の中身', 'Initial HTML text'],
  ['運営の構造化データ', 'Organization structured data'], ['全体を許している', 'allows all paths'],
  ['サイト全体を締め出している', 'blocks the whole site'], ['ない（すべて許す）', 'absent (allows all)'],
  ['読めなかった', 'could not read'], ['robots.txt で止めている', 'blocked by robots.txt'],
  ['そろっている', 'complete'], ['止められなかった', 'allowed'], ['bot 対策で止められた', 'blocked by bot protection'],
  ['止めていない', 'not blocked'], ['すべて止めている', 'all blocked'], ['一部を止めている', 'some blocked'],
  ['学習には使わせない設定', 'training blocked'], ['変わらない', 'unchanged'],
  ['文がほとんどない', 'almost no text'], ['文がある', 'text present'],
  ['言語の指定で変わる', 'changes with requested language'], ['一部未確認', 'partly unchecked'], ['同じ言語が返る', 'same language returned'],
  ['管理画面で AI のクローラーを止める設定も確かめる', 'Also check AI crawler blocking in the dashboard'],
  ['公開用フォルダに .env が混ざっています', 'The publish folder contains .env'], ['.env を公開用フォルダから外します。', 'Remove .env from the publish folder.'],
  ['公開用フォルダに .git が混ざっています', 'The publish folder contains .git'], ['.git を公開用フォルダから外します。', 'Remove .git from the publish folder.'],
  ['公開用フォルダに秘密鍵らしきファイルがあります', 'The publish folder may contain a private key'], ['鍵のファイルを公開用フォルダから外します。', 'Remove key files from the publish folder.'],
  ['HTTPS のページが HTTP の資源を読んでいます', 'An HTTPS page loads an HTTP resource'], ['資源の URL を HTTPS に直します。', 'Use HTTPS for the resource URL.'],
  ['公開するページに noindex が指定されています', 'A public page has noindex'], ['共通の head にある noindex を外します。', 'Remove noindex from the shared head.'],
  ['予約・問い合わせ・購入の宛先に問題があります', 'A booking, contact or purchase link is broken'], ['該当するリンクかフォームの宛先を、存在する公開先に直します。', 'Point the link or form to an existing public page.'],
  ['同じ対象の記載を確認し、本文・別言語のページ・JSON-LD をそろえます。', 'Use the same details in page text, translations and JSON-LD.'],
  ['title を1つにし、8〜70文字でページの内容を書きます。', 'Use one title with 8–70 characters about this page.'],
  ['meta description を1つにし、30〜160文字でページの内容を書きます。', 'Use one meta description with 30–160 characters about this page.'],
  ['h1 を1つにしてページの見出しを書きます。', 'Use one h1 for the main page heading.'], ['canonical にこのページの公開 URL を書きます。', 'Set canonical to this page’s public URL.'],
  ['JSON-LD の型と JSON の書式を直します。', 'Fix the JSON-LD type and JSON syntax.'],
  ['自動で読む相手を、bot 対策で止めています', 'Bot protection blocks automated readers'],
  ['こちらからの読み取りが止められました。検索や AI のクローラーも同じように止められている見込みがあります。', 'Our fetch was blocked. Search and AI crawlers may also be blocked.'],
  ['bot 対策・WAF の設定で、検索と AI の検索のクローラーを止めていないかを確かめます。', 'Check that bot protection and WAF settings allow search and AI search crawlers.'],
  ['robots.txt で、このページを読めないように指定しています', 'robots.txt blocks this page'],
  ['robots.txt が、自動で読む相手にこのページを読まないよう求めているため、中身を診断していません。', 'robots.txt asks automated readers not to read this page. Its content was not checked.'],
  ['検索に出したいページなら、robots.txt の Disallow を外します。', 'Remove Disallow for pages you want in search.'],
  ['検索から外す指示（noindex）が入っています', 'The page has a noindex instruction'], ['このページは検索結果に出ません。', 'This page will not appear in search results.'], ['検索に出したいページから noindex を外します。', 'Remove noindex from pages you want in search.'],
  ['robots.txt で、サイト全体を締め出しています', 'robots.txt blocks the whole site'], ['どの検索のクローラーにも、サイト全体を読まないよう求めています。', 'All search crawlers are asked not to read the site.'], ['robots.txt の「Disallow: /」を外し、見せたくない所だけを指定します。', 'Remove Disallow: / and block only private paths.'],
  ['AI の検索のクローラーを、robots.txt で止めています', 'robots.txt blocks AI search crawlers'], ['止めている名前の組から Disallow を外します。学習用のクローラー（GPTBot・ClaudeBot など）は、止めたままにできます。', 'Remove Disallow for those crawlers. Training crawlers such as GPTBot and ClaudeBot can stay blocked.'],
  ['言語を指定しない読み手を、別の言語のページへ転送しています', 'Readers without a language request are redirected to another language'], ['言語の指定がないときは転送せず、もとのページを返します。別の言語へは、読み手が言語を指定したときだけ転送します。', 'Return the original page when no language is requested. Redirect only when a reader requests another language.'],
  ['初めの HTML に、ページの文がほとんどありません', 'The initial HTML has almost no page text'], ['ブラウザで描く作りのため、検索や AI が最初に読む HTML に文がありません。', 'The page is rendered in the browser. Search and AI readers get HTML with no text.'], ['静的な HTML にするか、サーバー側で描いて、文を HTML に入れます。', 'Put the text in static or server-rendered HTML.'],
  ['初めの HTML に読める文がほとんどありません。検索や AI がそのまま読めず、反映が遅れることがあります。静的な HTML か、サーバー側で描く形にすると、毎回すべて読まれます。', 'The initial HTML has almost no readable text. Search and AI readers may miss it or find it late. Use static or server-rendered HTML to include all text.'],
  ['検索結果や共有のときに、ページの内容が正しく伝わりにくくなります。', 'Search results and shared links may not describe the page well.'], ['題は8〜70文字、説明は30〜160文字ほどで1つずつ、いちばん大きな見出しは1つ、正規の URL はそのページ自身を書きます。', 'Use one title (8–70 characters), one description (30–160 characters), one main heading and a canonical URL for this page.'],
  ['ブラウザや検索エンジンが、ページを正しく読み取れないことがあります。', 'Browsers and search engines may not read the page correctly.'], ['<!doctype html>、html の lang、charset、viewport の width=device-width を、ページの先頭に書きます。', 'Add <!doctype html>, html lang, charset and a viewport with width=device-width at the start of the page.'],
  ['構造化データが読めません', 'Structured data cannot be read'], ['JSON-LD の書き方に誤りがあり、検索エンジンや AI が読み取れません。', 'Invalid JSON-LD prevents search engines and AI from reading it.'], ['JSON として正しい形に直します。', 'Fix the JSON syntax.'],
  ['sitemap.xml が見つかりません', 'sitemap.xml is missing'], ['検索のクローラーが、サイトのページの一覧を受け取れません。', 'Search crawlers cannot get a list of pages.'], ['sitemap.xml を置き、robots.txt に Sitemap の行を書きます。', 'Add sitemap.xml and a Sitemap line in robots.txt.'],
  ['だれが運営しているかの構造化データがありません', 'Organization structured data is missing'], ['構造化データに、会社やお店（Organization・LocalBusiness）がありません。', 'Structured data has no Organization or LocalBusiness.'], ['会社名・お店の名前・所在地・連絡の方法を、ページに書いてあるのと同じ書き方で、JSON-LD に足します。', 'Add the business name, address and contact details to JSON-LD, matching the page text.'],
  ['言語の指定で、返すページの言語が変わります', 'The page language changes with the requested language'], ['言語を指定しない読み手に返すページを確認し、伝えたい内容をその HTML に入れます。', 'Check the page returned without a language request and put your content in that HTML.'],
  ['ページの題', 'title'], ['ページの説明', 'description'], ['いちばん大きな見出し', 'main heading'], ['正規の URL', 'canonical URL'], ['ページの言語', 'page language'], ['文字コード', 'encoding'], ['文書の種類の宣言', 'doctype'], ['スマホの表示', 'mobile viewport'],
  ['言語の指定なし', 'no language requested'], ['日本語の指定', 'Japanese requested'], ['英語の指定', 'English requested'],
  ['日本語', 'Japanese'], ['英語', 'English'], ['中国語', 'Chinese'], ['韓国語', 'Korean'], ['フランス語', 'French'], ['ドイツ語', 'German'], ['スペイン語', 'Spanish'], ['別の言語', 'another language'],
  ['HTML5 doctypeがありません', 'HTML5 doctype is missing'], ['html langがありません', 'html lang is missing'], ['charset指定がありません', 'charset is missing'], ['device幅のviewport指定がありません', 'A viewport with width=device-width is missing'],
  ['titleが空です', 'title is empty'], ['meta descriptionが空です', 'meta description is empty'], ['canonicalはHTTP(S)の絶対URLにします', 'Use an absolute HTTP(S) canonical URL'], ['canonicalが有効な絶対URLではありません', 'canonical is not a valid absolute URL'], ['h1が空です', 'h1 is empty'],
  ['JSON-LDがありません', 'JSON-LD is missing'], ['JSON-LDのrootはobjectまたはarrayにします', 'The JSON-LD root must be an object or array'], ['JSON-LDをJSONとして解析できません', 'JSON-LD is not valid JSON'],
  ['フォルダ外の URL', 'URL outside the folder'], ['公開用ルートの外', 'outside the publish root'], ['URL の書式', 'invalid URL'], ['フォルダ外へのシンボリックリンク', 'symlink outside the folder'], ['ページ内の宛先がない', 'page anchor is missing'], ['ファイルがない', 'file is missing'], ['宛先がないか URL の書式が不正', 'missing or invalid URL'], ['電話・メールの宛先', 'phone or email destination'], ['宛先がない', 'missing destination'], ['HTTP(S) の宛先がない', 'no HTTP(S) destination'], ['リンク点検の件数上限', 'link check limit reached'], ['HTTPS の宛先ではない', 'destination does not use HTTPS'], ['取得失敗', 'fetch failed'], ['フォームの宛先は GET に応答しない', 'form destination does not support GET'],
  ['点検する URL、HTML ファイル、フォルダを指定してください。', 'Choose a URL, HTML file or folder to check.'], ['基準の URL は認証情報やクエリのない HTTPS URL にしてください。', 'Use an HTTPS base URL without credentials or a query.'], ['前回の JSON は32 MiB 以下のファイルを指定してください。', 'Choose a baseline JSON file no larger than 32 MiB.'], ['使えないオプションです。--help で使い方を確認してください。', 'Unknown or incomplete option. See --help.'], ['--base-url は HTML ファイルかフォルダに使います。', 'Use --base-url with an HTML file or folder.'], ['指定したファイルかフォルダが見つかりません。', 'The file or folder was not found.'], ['点検を完了できませんでした。', 'Could not complete the check.'],
  ['--lang は en または ja を指定してください。', 'Use --lang en or --lang ja.'], ['--facts は price,area,booking から指定してください。', 'Choose --facts from price,area,booking.'],
  ['通常のファイルを指定してください。', 'Choose a regular file.'], ['ファイルが大きさの上限を超えました。', 'The file exceeds the size limit.'], ['シンボリックリンクは点検できません。', 'Cannot check a symlink.'], ['HTML ファイルかフォルダを指定してください。', 'Choose an HTML file or folder.'], ['フォルダの深さが上限を超えました。', 'The folder exceeds the depth limit.'], ['フォルダの項目数が上限を超えました。', 'The folder has too many entries.'], ['公開用ファイルの点検量が上限を超えました。', 'Publish files exceed the scan limit.'], ['フォルダのファイル数か大きさが上限を超えました。', 'The folder exceeds the file count or size limit.'], ['HTML ファイルが見つかりません。', 'No HTML files were found.'],
  ['robots.txt がこのページの読み取りを止めています。', 'robots.txt blocks reading this page.'], ['応答が HTML ではありません。', 'The response is not HTML.'], ['ページの HTML を取得できませんでした。', 'Could not fetch the page HTML.'], ['空の応答は HTML として点検できません。', 'Cannot check an empty response as HTML.'],
  ['公開HTTPS URLを2,048文字以内で指定してください。', 'Use a public HTTPS URL of at most 2,048 characters.'], ['有効な公開HTTPS URLを指定してください。', 'Use a valid public HTTPS URL.'], ['認証情報や独自Portを含まない公開HTTPS URLを指定してください。', 'Use a public HTTPS URL without credentials or a custom port.'], ['公開DNS名ではないURLは診断できません。', 'The URL must have a public DNS name.'], ['認証情報を示すQueryを含むURLは診断できません。', 'The URL must not contain credential query parameters.'],
  ['取得の時間上限を超えました。', 'The fetch timed out.'], ['取得が途中で終わりました。', 'The fetch ended early.'], ['応答が大きさの上限を超えました。', 'The response exceeds the size limit.'], ['圧縮しない応答で取得できませんでした。', 'Could not fetch an uncompressed response.'], ['内部の住所や私的ネットワークへの接続を拒否しました。', 'Connections to private or reserved addresses are blocked.'], ['転送先を確かめられませんでした。', 'Could not verify the redirect destination.'], ['公開 URL を取得できませんでした。', 'Could not fetch the public URL.'],
  ['前回の JSON はサイト点検の結果を指定してください。', 'Use a site check result as the baseline JSON.'], ['前回の JSON の findings が不正です。', 'The baseline JSON has invalid findings.'], ['前回と同じ入力の種類と --facts で再点検してください。', 'Use the same input type and --facts as the baseline.'],
  ['前回のファイルを JSON として読めません。', 'The baseline file is not valid JSON.'],
  ['HTML の要素数か深さが上限を超えました。', 'The HTML exceeds the element count or depth limit.'],
]

for (const [ja, en] of [['料金', 'price'], ['対応地域', 'service area'], ['予約方法', 'booking method']]) {
  messages.push([`初めの HTML に${ja}がありません`, `The initial HTML has no ${en}`], [`${ja}を本文か JSON-LD に入れます。`, `Add the ${en} to the page text or JSON-LD.`])
}

// Templates match whole generated messages, including their dynamic labels.
const templates = [
  ['html要素は1個必要です 現在{0}個', 'Expected one html element; found {0}', 'literal'],
  ['{0}は1個必要です 現在{1}個', 'Expected one {0}; found {1}', 'literal'],
  ['titleは8〜70文字を目安にします 現在{0}文字', 'Use 8–70 characters for title; found {0}', 'literal'],
  ['meta descriptionは30〜160文字を目安にします 現在{0}文字', 'Use 30–160 characters for meta description; found {0}', 'literal'],
  ['canonical originが期待値と異なります {0}', 'Unexpected canonical origin: {0}', 'literal'],
  ['canonicalがRouteと一致しません 期待値 {0}', 'canonical does not match the page URL; expected {0}', 'literal'],
  ['初めの HTML に{0}がありません', 'The initial HTML has no {0}'], ['{0}を本文か JSON-LD に入れます。', 'Add {0} to the page text or JSON-LD.'],
  ['{0}が食い違っています', '{0} details do not match'], ['共通の HTML の {0} を直します。', 'Fix {0} in the shared HTML.'],
  ['{0}を直すとよい', 'Check {0}'], ['{0}を直す', 'Fix {0}'], ['{0}の設定がありません', 'Missing settings: {0}'], ['{0}がない', 'Missing: {0}'],
  ['{0}のページへ転送', 'Redirected to {0}'],
  ['{0} を締め出しているので、AI の検索や答えを作るときに、このサイトの中身が読まれません。', '{0} are blocked, so they cannot read this site for AI search or answers.'],
  ['言語を指定しない読み手には、{0}のページが返ります。AI のクローラーの多くは言語を指定しないので、もとのページではなく{1}のページを読んでいる見込みが高いです。', 'Readers without a language request get {0}. Many AI crawlers request no language and may read {1} instead of the original page.'],
]
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const compile = template => new RegExp('^' + template.split(/\{\d\}/u).map(escape).join('([\\s\\S]*?)') + '$', 'u')
const patterns = templates.map(pair => pair.slice(0, 2).map(compile))
export function translate(message, lang = 'en') {
  if (typeof message !== 'string') return message
  const from = lang === 'en' ? 0 : 1, to = 1 - from
  const exact = messages.find(pair => pair[from] === message)
  if (exact) return exact[to]
  for (let i = 0; i < templates.length; i++) {
    const match = patterns[i][from].exec(message)
    // Counts and canonical messages contain tag names, numbers or URLs, not display labels.
    if (match) return templates[i][to].replace(/\{(\d)\}/gu, (_, n) => templates[i][2] === 'literal' ? match[Number(n) + 1] : translate(match[Number(n) + 1], lang))
  }
  const separator = from === 0 ? '・' : ', '
  if (message.includes(separator)) return message.split(separator).map(part => translate(part, lang)).join(to === 1 ? ', ' : '・')
  const profiles = from === 0 ? '、' : '; '
  if (message.includes(profiles)) return message.split(profiles).map(part => translate(part, lang)).join(to === 1 ? '; ' : '、')
  if (message.includes(': ')) return message.split(': ').map(part => translate(part, lang)).join(': ')
  return message
}

export function localizeReport(report, lang) {
  const result = structuredClone(report)
  const prose = (object, keys) => { for (const key of keys) if (typeof object[key] === 'string') object[key] = translate(object[key], lang) }
  const findings = items => { for (const item of items ?? []) {
    prose(item, ['title', 'fix'])
    for (const evidence of item.evidence ?? []) {
      if (item.code.startsWith('html.') || !item.code.includes('.')) prose(evidence, ['value'])
      else if (/^fact\..*\.missing$/u.test(item.code)) evidence.value = lang === 'en' ? 'missing' : '欠けている'
      else if (item.code === 'business-link.broken') {
        // The label and target are page evidence; only the appended reason is generated prose.
        evidence.value = evidence.value.replace(/ \(([^()]*)\)$/u, (_, reason) => ` (${translate(reason, lang)})`)
      }
    }
  } }
  findings(result.findings)
  for (const items of Object.values(result.difference ?? {})) findings(items)
  for (const page of result.reports ?? [result]) {
    findings(page.findings)
    for (const check of page.checks) {
      if (check.key !== 'canonical') prose(check, ['label'])
      for (const item of check.findings) prose(item, ['message'])
    }
    for (const issue of page.issues) prose(issue, ['title', 'why', 'fix'])
    for (const row of page.rows) prose(row, ['label', 'value'])
    for (const publication of page.publication ? [page.publication, ...(page.publication.variants ?? [])] : []) {
      findings(publication.findings)
      for (const fact of publication.facts) prose(fact, ['label'])
      for (const link of publication.links) prose(link, ['reason'])
    }
  }
  return result
}
