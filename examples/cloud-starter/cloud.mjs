const api = 'https://api.flapbase.com/api/commerce/own-site/v1/products/'
const storefront = 'https://flap.page/products/'
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

/** @param {string} productId */
export function productPageUrl(productId) {
  if (typeof productId !== 'string' || !idPattern.test(productId)) throw new TypeError('Invalid product ID')
  return storefront + productId.toLowerCase()
}

/**
 * Read only public product information. Buyer data and credentials stay in Cloud.
 * @param {string} productId
 * @param {typeof fetch} [fetchProduct]
 * @returns {Promise<{title: string, description: string, url: string}>}
 */
export async function readFreeProduct(productId, fetchProduct = fetch) {
  const url = productPageUrl(productId)
  const id = productId.toLowerCase()
  const signal = AbortSignal.timeout(8_000)
  const response = await fetchProduct(api + id, {
    headers: { accept: 'application/json' },
    redirect: 'manual',
    signal,
  })
  if (!response.ok) throw new Error('Flapbase Cloud product lookup failed (' + response.status + ')')
  const item = await response.json()
  if (item?.listingId !== id || item.kind !== 'download' || item.priceYen !== 0
    || typeof item.title !== 'string' || !item.title.trim() || typeof item.description !== 'string') {
    throw new Error('Choose a published free download in Flapbase Cloud')
  }
  const page = await fetchProduct(url, { method: 'HEAD', redirect: 'manual', signal })
  if (!page.ok || !page.headers.get('content-type')?.startsWith('text/html')) {
    throw new Error('Publish the product page on flap.page in Flapbase Cloud (' + page.status + ')')
  }
  return { title: item.title, description: item.description, url }
}
