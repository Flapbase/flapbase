const decodeHtml = (value) => value
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&amp;', '&')

const plainText = (value) => decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())

const attributesOf = (tag) => {
  const attributes = new Map()
  const source = tag.replace(/^<\/?[a-z][^\s/>]*/i, '').replace(/\/?>$/, '')
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''))
  }
  return attributes
}

export const createAuditIssue = (severity, code, message) => ({ severity, code, message })

export function auditWebPublicationHtml({ html, label, expectedCanonical, expectedOrigin, allowNoindex = false }) {
  const issues = []
  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map((match) => plainText(match[1]))
  const htmlTags = [...html.matchAll(/<html\b[^>]*>/gi)].map((match) => attributesOf(match[0]))
  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => attributesOf(match[0]))
  const linkTags = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => attributesOf(match[0]))
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => plainText(match[1]))
  const jsonLdScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => attributesOf(`<script ${match[1]}>`).get('type')?.toLowerCase() === 'application/ld+json')
  const descriptions = metaTags.filter((attrs) => attrs.get('name')?.toLowerCase() === 'description').map((attrs) => attrs.get('content')?.trim() ?? '')
  const canonicals = linkTags.filter((attrs) => (attrs.get('rel') ?? '').toLowerCase().split(/\s+/).includes('canonical')).map((attrs) => attrs.get('href')?.trim() ?? '')
  const robots = metaTags.filter((attrs) => ['robots', 'googlebot'].includes(attrs.get('name')?.toLowerCase() ?? '')).flatMap((attrs) => (attrs.get('content') ?? '').toLowerCase().split(/[\s,]+/))
  const metaValues = (attribute, name) => metaTags.filter((attrs) => attrs.get(attribute)?.toLowerCase() === name).map((attrs) => attrs.get('content')?.trim() ?? '')
  const social = {
    title: metaValues('property', 'og:title'), description: metaValues('property', 'og:description'), url: metaValues('property', 'og:url'), type: metaValues('property', 'og:type'),
    image: metaValues('property', 'og:image'), imageAlt: metaValues('property', 'og:image:alt'), imageType: metaValues('property', 'og:image:type'), imageWidth: metaValues('property', 'og:image:width'), imageHeight: metaValues('property', 'og:image:height'),
    siteName: metaValues('property', 'og:site_name'), locale: metaValues('property', 'og:locale'), twitterCard: metaValues('name', 'twitter:card'), twitterTitle: metaValues('name', 'twitter:title'), twitterDescription: metaValues('name', 'twitter:description'), twitterImage: metaValues('name', 'twitter:image'), twitterImageAlt: metaValues('name', 'twitter:image:alt'),
  }
  const icons = linkTags.filter((attrs) => ['icon', 'apple-touch-icon'].includes((attrs.get('rel') ?? '').toLowerCase())).map((attrs) => ({ rel: attrs.get('rel')?.toLowerCase() ?? '', href: attrs.get('href')?.trim() ?? '', type: attrs.get('type')?.trim() ?? '', sizes: attrs.get('sizes')?.trim() ?? '' }))
  const issue = createAuditIssue

  if (!/^\s*<!doctype html>/i.test(html)) issues.push(issue('error', 'doctype.missing', 'HTML5 doctypeがありません'))
  if (htmlTags.length !== 1) issues.push(issue('error', 'html.count', `html要素は1個必要です 現在${htmlTags.length}個`))
  const language = htmlTags[0]?.get('lang')?.trim()
  if (!language) issues.push(issue('error', 'html.lang.missing', 'html langがありません'))
  if (!metaTags.some((attrs) => attrs.has('charset'))) issues.push(issue('error', 'charset.missing', 'charset指定がありません'))
  if (!metaTags.some((attrs) => attrs.get('name')?.toLowerCase() === 'viewport' && attrs.get('content')?.includes('width=device-width'))) issues.push(issue('error', 'viewport.missing', 'device幅のviewport指定がありません'))
  if (titles.length !== 1) issues.push(issue('error', 'title.count', `titleは1個必要です 現在${titles.length}個`))
  if (titles.length === 1 && !titles[0]) issues.push(issue('error', 'title.empty', 'titleが空です'))
  if (titles[0] && (titles[0].length < 8 || titles[0].length > 70)) issues.push(issue('warning', 'title.length', `titleは8〜70文字を目安にします 現在${titles[0].length}文字`))
  if (descriptions.length !== 1) issues.push(issue('error', 'description.count', `meta descriptionは1個必要です 現在${descriptions.length}個`))
  if (descriptions.length === 1 && !descriptions[0]) issues.push(issue('error', 'description.empty', 'meta descriptionが空です'))
  if (descriptions[0] && (descriptions[0].length < 30 || descriptions[0].length > 160)) issues.push(issue('warning', 'description.length', `meta descriptionは30〜160文字を目安にします 現在${descriptions[0].length}文字`))
  if (canonicals.length !== 1) issues.push(issue('error', 'canonical.count', `canonicalは1個必要です 現在${canonicals.length}個`))
  if (canonicals.length === 1) {
    try {
      const canonical = new URL(canonicals[0])
      if (!['http:', 'https:'].includes(canonical.protocol)) issues.push(issue('error', 'canonical.protocol', 'canonicalはHTTP(S)の絶対URLにします'))
      if (expectedOrigin && canonical.origin !== expectedOrigin) issues.push(issue('error', 'canonical.origin', `canonical originが期待値と異なります ${canonical.origin}`))
      if (expectedCanonical && canonical.href !== expectedCanonical) issues.push(issue('error', 'canonical.route', `canonicalがRouteと一致しません 期待値 ${expectedCanonical}`))
    } catch { issues.push(issue('error', 'canonical.invalid', 'canonicalが有効な絶対URLではありません')) }
  }
  if (headings.length !== 1) issues.push(issue('error', 'h1.count', `h1は1個必要です 現在${headings.length}個`))
  if (headings.length === 1 && !headings[0]) issues.push(issue('error', 'h1.empty', 'h1が空です'))
  if (jsonLdScripts.length === 0) issues.push(issue('error', 'jsonld.missing', 'JSON-LDがありません'))
  for (const [, , body] of jsonLdScripts) {
    try { const parsed = JSON.parse(body); if (parsed === null || typeof parsed !== 'object') issues.push(issue('error', 'jsonld.shape', 'JSON-LDのrootはobjectまたはarrayにします')) } catch { issues.push(issue('error', 'jsonld.invalid', 'JSON-LDをJSONとして解析できません')) }
  }
  if (robots.includes('noindex') && !allowNoindex) issues.push(issue('error', 'robots.noindex', '公開成果物にnoindexが指定されています'))
  if (!robots.includes('noindex') && allowNoindex) issues.push(issue('error', 'robots.noindex-expected', 'noindex許可Routeなのにnoindexが指定されていません'))
  for (const [field, values] of Object.entries(social)) {
    if (values.length !== 1) issues.push(issue('error', `social.${field}.count`, `${field}は1個必要です 現在${values.length}個`))
    else if (!values[0]) issues.push(issue('error', `social.${field}.empty`, `${field}が空です`))
  }
  if (social.url[0] && canonicals[0] && social.url[0] !== canonicals[0]) issues.push(issue('error', 'og.url.mismatch', 'og:urlはcanonicalと一致させます'))
  if (social.type[0] && !['website', 'article', 'product', 'profile'].includes(social.type[0])) issues.push(issue('error', 'og.type.invalid', `未対応のog:typeです ${social.type[0]}`))
  if (social.image[0]) { try { const imageUrl = new URL(social.image[0]); if (imageUrl.protocol !== 'https:') issues.push(issue('error', 'og.image.protocol', 'og:imageはHTTPSの絶対URLにします')) } catch { issues.push(issue('error', 'og.image.invalid', 'og:imageが有効な絶対URLではありません')) } }
  if (social.imageType[0] && !['image/png', 'image/jpeg', 'image/webp'].includes(social.imageType[0].toLowerCase())) issues.push(issue('error', 'og.image.type', `og:image:typeはPNG、JPEG、WebPを使います ${social.imageType[0]}`))
  if (social.imageWidth[0] && social.imageWidth[0] !== '1200') issues.push(issue('warning', 'og.image.width', `共有画像は1200px幅を標準とします 現在${social.imageWidth[0]}px`))
  if (social.imageHeight[0] && social.imageHeight[0] !== '630') issues.push(issue('warning', 'og.image.height', `共有画像は630px高を標準とします 現在${social.imageHeight[0]}px`))
  if (social.twitterCard[0] && social.twitterCard[0] !== 'summary_large_image') issues.push(issue('warning', 'twitter.card', `標準公開ページはsummary_large_imageを推奨します 現在${social.twitterCard[0]}`))
  if (social.twitterImage[0] && social.image[0] && social.twitterImage[0] !== social.image[0]) issues.push(issue('warning', 'twitter.image.mismatch', 'twitter:imageがog:imageと異なります'))
  const favicon = icons.filter((icon) => icon.rel === 'icon'); const appleTouchIcon = icons.filter((icon) => icon.rel === 'apple-touch-icon')
  if (favicon.length !== 1 || !favicon[0]?.href) issues.push(issue('error', 'favicon.count', `rel=iconは1個必要です 現在${favicon.length}個`))
  if (appleTouchIcon.length !== 1 || !appleTouchIcon[0]?.href) issues.push(issue('error', 'apple-touch-icon.count', `apple-touch-iconは1個必要です 現在${appleTouchIcon.length}個`))
  if (favicon[0] && !['image/svg+xml', 'image/png', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(favicon[0].type)) issues.push(issue('error', 'favicon.type', `faviconのtypeが未対応です ${favicon[0].type || '(未指定)'}`))
  if (appleTouchIcon[0] && appleTouchIcon[0].type !== 'image/png') issues.push(issue('error', 'apple-touch-icon.type', `apple-touch-iconはimage/pngにします ${appleTouchIcon[0].type || '(未指定)'}`))
  if (appleTouchIcon[0] && appleTouchIcon[0].sizes !== '180x180') issues.push(issue('warning', 'apple-touch-icon.sizes', `apple-touch-iconは180x180を標準とします 現在${appleTouchIcon[0].sizes || '(未指定)'}`))
  return { label, title: titles[0] ?? '', description: descriptions[0] ?? '', canonical: canonicals[0] ?? '', language: language ?? '', socialImage: social.image[0] ?? '', icons, issues }
}
