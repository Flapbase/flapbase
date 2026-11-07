const WEBSITE_SEO_RULE_SET_REF = 'web-publication-seo';
export const WEBSITE_SEO_RULE_SET_VERSION = `${WEBSITE_SEO_RULE_SET_REF}/v1`;
const rule = (id, label, meaning, evaluationCondition) => Object.freeze({
    semanticRef: `website.seo.${id}`,
    ruleRef: `${WEBSITE_SEO_RULE_SET_REF}/${id}/v1`,
    issuePrefix: `${id}.`, label, meaning, evaluationCondition,
    limitations: Object.freeze([]),
});
export const WEBSITE_SEO_RULES = Object.freeze([
    rule('doctype', 'HTML5 doctype', '文書を標準のHTMLとして解釈するための宣言です。', 'HTMLの先頭にHTML5 doctypeがあること'),
    rule('html', 'ページの言語設定', '本文の主要言語をブラウザや検索エンジンへ伝えます。', 'html要素が1個でlang属性が空でないこと'),
    rule('charset', '文字コード設定', '文字を正しく表示するための符号化方式の宣言です。', 'charsetを宣言するmeta要素があること'),
    rule('viewport', 'モバイル表示設定', '画面幅に合わせて表示するための設定です。', 'viewportのcontentにwidth=device-widthがあること'),
    rule('title', 'ページタイトル', 'ページの内容を短く伝える文書タイトルです。', '空でないtitleが1個あり、8〜70文字の目安を満たすこと'),
    rule('description', 'ページ説明文', 'ページ内容の要約として宣言する説明です。', '空でないmeta descriptionが1個あり、30〜160文字の目安を満たすこと'),
    rule('canonical', 'canonical URL', '同じ内容に複数URLがある場合の代表URLを宣言します。', 'HTTP(S)絶対URLのcanonicalが1個あり、対象URLとoriginに一致すること'),
    rule('h1', '主見出し H1', 'ページの主題を表す最上位の本文見出しです。', '空でないh1が1個あること'),
    rule('jsonld', '構造化データ JSON-LD', '機械が内容を理解しやすい形で付加する構造化情報です。', 'JSON-LDがあり、各rootをJSON objectまたはarrayとして解析できること'),
    rule('initial-html', '初めのHTMLの中身', '検索やAIが最初に読むHTMLに、ページの文があるかを確認します。', 'JavaScriptを動かさないHTMLに、見える文が200字以上あること。文が少ない場合は、空の取り付け口やscriptだけのページでないこと'),
    rule('robots', '検索除外設定 noindex', '検索結果への掲載を制限する指示を確認します。', 'robotsまたはgooglebot metaにnoindexがないこと'),
]);
export { inspectInitialHtml, readInitialHtml, INITIAL_HTML_MESSAGE } from './initial-html.js';
export function websiteRuleDefinition(semanticRef) {
    return WEBSITE_SEO_RULES.find((item) => item.semanticRef === semanticRef);
}
