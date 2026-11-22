import { readFreeProduct } from './cloud.mjs'

const escape = (value) => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]))

/** @param {{title: string, description: string, productId: string | null}} base */
export async function buildSite(base, fetchProduct = fetch) {
  if (!base || typeof base.title !== 'string' || !base.title.trim() || typeof base.description !== 'string'
    || (base.productId !== null && typeof base.productId !== 'string')) {
    throw new TypeError('Set title, description, and productId in site.base.json')
  }
  const product = base.productId === null ? null : await readFreeProduct(base.productId, fetchProduct)
  const title = escape(base.title)
  const description = escape(base.description || product?.description || '')
  const callToAction = product
    ? `<a class="action" href="${escape(product.url)}">無料で申し込む</a><p class="note">申込と受取にはFlap IDを使います</p>`
    : '<p class="note">プレビュー · 公開済みの無料資料を設定すると申込を受け付けられます</p>'
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${description}">
<title>${title}</title>
<style>
  :root { font: 16px/1.65 system-ui, sans-serif; color: #173434; background: #f5f8f6; }
  * { box-sizing: border-box; }
  body { margin: 0; }
  main { max-width: 54rem; margin: 0 auto; padding: clamp(4rem, 12vw, 9rem) clamp(1.25rem, 6vw, 5rem); }
  h1 { font-size: clamp(2rem, 6vw, 3.75rem); line-height: 1.2; letter-spacing: -.035em; margin: 0 0 1.5rem; overflow-wrap: anywhere; }
  p { max-width: 40rem; margin: 0 0 1.5rem; white-space: pre-line; }
  .action { display: inline-block; padding: .8rem 1.4rem; background: #165952; color: white; font-weight: 650; text-decoration: none; border-radius: .25rem; }
  .action:focus-visible { outline: .15rem solid #165952; outline-offset: .2rem; }
  .note { margin: .8rem 0 0; color: #435e5c; font-size: .875rem; }
</style>
</head>
<body><main>
<h1>${title}</h1>
<p>${description}</p>
${callToAction}
</main></body>
</html>
`
}
