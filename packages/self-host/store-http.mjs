import { open } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { timingSafeEqual } from 'node:crypto'
import { DIGITAL_PRODUCT_TOOLS } from './mcp.mjs'
import { sha, StoreError } from './free-download.mjs'

export const escape = value => String(value).replace(/[&<>"']/g, char => '&#' + char.charCodeAt(0) + ';')
const orderTime = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' })
export const html = (title, content, script = '/store-ui.js') => `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} | Flapbase</title>
<link rel="stylesheet" href="/store.css"><script type="module" src="${script}"></script></head>
<body><header><a href="/">Flapbase</a></header><main>${content}</main></body></html>`

export const renderProduct = ({ listingId, revisionId, title, description, amountMinor = 0, leadEnabled = false }) => html(title, `
<h1>${escape(title)}</h1><p>${amountMinor ? amountMinor.toLocaleString('ja-JP') + '円' : '無料'}</p><p class="description">${escape(description)}</p>
<form id="claim" data-listing="${listingId}" data-revision="${revisionId}"><button>${amountMinor ? '購入する' : '無料で申し込む'}</button></form>
<p id="result" role="status"></p><a href="/?next=%2Fproducts%2F${listingId}" id="login" hidden>ログインまたは登録</a>
${leadEnabled ? `<section><h2>案内を受け取る</h2><form data-operation="lead" data-listing="${listingId}">
<label>メールアドレス <input type="email" name="email" required maxlength="254"></label>
<label><span><input type="checkbox" name="consent" required> この商品に関する案内を受け取る</span></label>
<button>登録する</button><p role="status"></p></form></section>` : ''}`)

function renderDashboard({ orders, products }, operation, paymentAvailable) {
  const options = products.filter(product => !product.isCourse).map(product => `<option value="${product.listing_id}">${escape(product.title)}</option>`).join('')
  const productLinks = products.map(product => `<li><a href="/products/${encodeURIComponent(product.listing_id)}">${escape(product.title)}</a></li>`).join('')
  const rows = orders.map(order => {
    const createdAt = new Date(order.created_at)
    return `<tr><th scope="row">${escape(order.title)}</th><td>${order.status === 'pending' ? '決済確認待ち' : Number(order.amount_minor) ? '購入済み' : '無料申込'}</td><td><time datetime="${createdAt.toISOString()}">${orderTime.format(createdAt)}</time></td></tr>`
  }).join('')
  return html('資料配布', `
<h1>資料配布</h1><form id="publish">
${options ? `<label>公開先 <select name="listingId"><option value="">新しい商品</option>${options}</select></label>` : ''}
<label>資料名 <input name="title" required maxlength="160" value="${escape(operation?.productDraft?.title ?? '')}"></label>
<label>説明 <textarea name="description" maxlength="3000">${escape(operation?.productDraft?.description ?? '')}</textarea></label>
${paymentAvailable ? '<label>価格（円） <input name="amountMinor" type="number" min="0" max="10000000" value="0" required></label>' : ''}
<label>配布ファイル <input name="file" type="file" required></label>
<button>公開する</button></form><p id="result" role="status"></p>
${productLinks ? `<section><h2>公開済みの商品</h2><ul>${productLinks}</ul></section>` : ''}
<section><h2>注文</h2>${rows ? `<table><thead><tr><th scope="col">商品</th><th scope="col">種類</th><th scope="col">受付日時</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>注文はまだありません</p>'}</section>${operation ? renderOperations(operation) : ''}`)
}

function renderOperations({ leads, requests, counts, followUpDraft, emailPreviewEnabled }) {
  return `<section><h2>見込客とフォロー</h2><p>登録 ${counts.leads}件・案内プレビュー ${counts.followUps}件</p>
${emailPreviewEnabled ? '<p>案内はプレビューに記録します。</p>' : '<p>案内プレビューは設定されていません。</p>'}
${leads.map(lead => `<form data-operation="follow-up" data-lead="${lead.id}">
<p>${escape(lead.email)}</p><label>件名 <input name="subject" required maxlength="160" value="${escape(followUpDraft?.subject ?? '')}"></label>
<label>案内文 <textarea name="body" required maxlength="3000">${escape(followUpDraft?.body ?? '')}</textarea></label>
<button${emailPreviewEnabled ? '' : ' disabled'}>この内容で案内する</button><p role="status"></p></form>`).join('')}</section>
<section><h2>購入者サポート</h2>${requests.length ? requests.map(request => `<article><p>${escape(request.body)}</p>
<p>注文 ${request.orderId}</p>${request.reply ? `<p>返信の下書き</p><p class="description">${escape(request.reply)}</p>` : ''}</article>`).join('') : '<p>問い合わせはまだありません</p>'}</section>`
}

function renderReceipt(orderId, release, lifecycle) {
  return html('資料の受取', `<h1>お申し込みを受け付けました</h1><p>${escape(release.title)}</p>
<p>${release.coursePin ? `<a href="/training/orders/${orderId}">講座を受講する</a>`
  : `<a href="/receive/orders/${orderId}/download">資料をダウンロード</a>`}</p>
${lifecycle ? `<section><h2>問い合わせる</h2><form data-operation="support" data-order="${orderId}">
<label>問い合わせ内容 <textarea name="body" required maxlength="3000"></textarea></label>
<button>問い合わせを送る</button><p role="status"></p></form></section>` : ''}`)
}

export function send(res, status, value) {
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(value))
    return
  }
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  }).end(value)
}

async function readBody(req, maxBytes) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new StoreError(413, 'payload_too_large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function input(req, maxBytes) {
  const raw = await readBody(req, maxBytes)
  try {
    const value = JSON.parse(raw.toString())
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  } catch { /* Input parsing has the same bounded error response. */ }
  throw new StoreError(400, 'invalid_request')
}

export function canCallAgent(req, delegation) {
  return delegation && !req.headers.origin && timingSafeEqual(
    Buffer.from(sha(req.headers.authorization ?? '')), Buffer.from(delegation.tokenDigest),
  )
}

export async function handleStore(req, res, { route, origin, store, lifecycle, payment, delegation, resolveHuman }) {
  const path = route.pathname
  if (payment && path === '/api/store/payment/webhook' && req.method === 'POST') {
    const event = payment.verifyWebhook(await readBody(req, 128_000), req.headers['stripe-signature'])
    if (event) await store.confirmPayment(event)
    send(res, 200, { received: true })
    return true
  }
  if (lifecycle && path === '/api/store/agent' && req.method === 'POST') {
    if (!canCallAgent(req, delegation)) {
      throw new StoreError(401, 'agent_unauthorized')
    }
    const body = await input(req, 16_000)
    if (!DIGITAL_PRODUCT_TOOLS.some(tool => tool.name === body.name) || !body.arguments ||
        typeof body.arguments !== 'object' || Array.isArray(body.arguments)) throw new StoreError(403, 'agent_action_denied')
    send(res, 200, await lifecycle.call(delegation.principalId, body.name, body.arguments))
    return true
  }
  if (lifecycle && path === '/api/store/lead' && req.method === 'POST') {
    if (req.headers.origin !== origin) throw new StoreError(403, 'forbidden')
    await lifecycle.registerLead(await input(req, 4096), (await resolveHuman())?.principalId)
    send(res, 201, { registered: true })
    return true
  }
  if (lifecycle && path === '/unsubscribe') {
    const lead = route.searchParams.get('lead')
    if (req.method === 'GET') {
      send(res, 200, html('配信停止', `<h1>配信停止</h1><form data-operation="unsubscribe" data-lead="${escape(lead ?? '')}">
        <button>この商品の案内を停止する</button><p role="status"></p></form>`))
      return true
    }
    if (req.method === 'POST') {
      if (req.headers.origin !== origin) throw new StoreError(403, 'forbidden')
      await lifecycle.stopFollowUp((await input(req, 4096)).leadId)
      send(res, 200, { stopped: true })
      return true
    }
  }
  const followUp = lifecycle && path === '/api/store/follow-up' && req.method === 'POST'
  const support = lifecycle && path === '/api/store/support' && req.method === 'POST'
  const product = /^\/products\/([0-9a-f-]{36})$/.exec(path)
  const receipt = /^\/receive\/orders\/([0-9a-f-]{36})(\/download)?$/.exec(path)
  const checkout = path === '/api/commerce/own-site/v1/checkout' && req.method === 'POST'
  const publish = path === '/api/store/publish' && req.method === 'POST'
  const manage = path === '/store' && req.method === 'GET'
  if (product && req.method === 'GET') {
    send(res, 200, await store.page(product[1]))
    return true
  }
  if (!checkout && !publish && !manage && !followUp && !support && !(receipt && req.method === 'GET')) return false
  if ((checkout || publish || followUp || support) && req.headers.origin !== origin) throw new StoreError(403, 'forbidden')
  const human = await resolveHuman()
  if (!human) {
    if (manage || receipt && !receipt[2]) {
      send(res, 401, html('ログイン', `<h1>ログインが必要です</h1><p><a href="/?next=${encodeURIComponent(path)}">ログインまたは登録</a></p>`))
    } else send(res, 401, { error: 'sign_in_required' })
    return true
  }

  if (manage) {
    send(res, 200, renderDashboard(await store.dashboard(human.principalId), await lifecycle?.operatorSnapshot(human.principalId, true), !!payment))
  } else if (checkout) {
    const body = await input(req, 4096)
    const order = await store.checkout(human.principalId, body.listingId, body.revisionId, !!payment)
    const receiptUrl = '/receive/orders/' + order.orderId
    if (order.paid) send(res, 201, { orderId: order.orderId, receiptUrl })
    else {
      const { sessionId, url } = await payment.startCheckout(order)
      await store.attachSession(human.principalId, order.orderId, sessionId)
      send(res, 201, { orderId: order.orderId, checkoutUrl: url, receiptUrl })
    }
  } else if (publish) {
    // Bound the base64 transport before allocation; the store separately limits the decoded file size.
    const { listingId, title, description, fileName, content, amountMinor } = await input(req, 7_005_000)
    if (typeof content !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(content) || content.length % 4 !== 0) {
      throw new StoreError(400, 'invalid_request')
    }
    if (amountMinor && !payment) throw new StoreError(503, 'payment_unavailable')
    send(res, 201, await store.publish(human.principalId, { listingId, title, description, fileName, amountMinor, bytes: Buffer.from(content, 'base64') }))
  } else if (followUp) {
    send(res, 200, await lifecycle.sendFollowUp(human.principalId, await input(req, 16_000)))
  } else if (support) {
    send(res, 201, await lifecycle.openSupport(human.principalId, await input(req, 16_000)))
  } else if (receipt) {
    let release
    try { release = await store.receive(human.principalId, receipt[1], !!receipt[2]) }
    catch (error) {
      if (!receipt[2] && error instanceof StoreError && error.message === 'payment_pending') {
        send(res, 409, html('決済確認', '<h1>決済を確認しています</h1><p>しばらくしてからこのページを読み込み直してください。</p>'))
        return true
      }
      throw error
    }
    if (receipt[2]) {
      // Opening the file before the headers are sent keeps missing-file errors out of a partial response.
      const file = await open(release.path, 'r')
      const name = encodeURIComponent(release.fileName).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))
      res.writeHead(200, {
        'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''" + name,
        'x-content-type-options': 'nosniff',
      })
      await pipeline(file.createReadStream(), res)
    } else send(res, 200, renderReceipt(receipt[1], release, lifecycle))
  }
  return true
}

export function sendStoreError(res, error) {
  send(res, error.status, { error: error.message })
}
