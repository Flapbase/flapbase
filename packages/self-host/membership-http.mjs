import { readFile } from 'node:fs/promises'
import { invalid, missing, StoreError, storeId } from './free-download.mjs'
import { escape, html, input, send } from './store-http.mjs'

const statusLabel = { pending: '入金待ち', active: '有効', ending: '期間末で退会', expired: '期間満了', cancelled: '終了' }
const date = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' })
const form = (action, fields, label) => `<form data-membership="${action}">${fields}<button>${label}</button><p role="status"></p></form>`
const page = (title, content) => html(title, '<h1>' + escape(title) + '</h1>' + content, '/membership-ui.js')

function manage({ items, draft }, payment) {
  const rows = items.map(item => `<tr><th scope="row">${escape(item.planName)}</th>
    <td>${statusLabel[item.status]}</td><td>${item.periodEnd ? date.format(new Date(item.periodEnd)) : '—'}</td></tr>`).join('')
  return page('有料会員', `
    <nav aria-label="運営"><a href="/store">商品と注文へ</a></nav>
    <section><h2>会員プランを公開</h2>
    ${payment ? form('publish', `<label>プラン名 <input name="title" required maxlength="160" value="${escape(draft?.title ?? '')}"></label>
      <label>募集ページの紹介文 <textarea name="description" required maxlength="3000">${escape(draft?.description ?? '')}</textarea></label>
      <label>会員限定の本文 <textarea name="content" required maxlength="50000" rows="6">${escape(draft?.content ?? '')}</textarea></label>
      <label>月額（円） <input name="amountMinor" type="number" min="50" max="10000000" step="1" required></label>`, '確認したプランを公開')
      : '<p>公開にはテスト決済の設定が必要です。</p>'}</section>
    <section><h2>会員の状況</h2>${rows ? '<table><thead><tr><th scope="col">プラン</th><th scope="col">状態</th><th scope="col">支払済み期間の終了</th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '<p>申込はまだありません。</p>'}</section>`)
}

async function memberPage(orderId, details, payment) {
  const body = details.path ? await readFile(details.path, 'utf8') : null
  return page(details.title, `<p>${statusLabel[details.state]}${details.periodEnd ? ' · ' + date.format(details.periodEnd) + ' まで' : ''}</p>
    ${body === null ? '<p>支払いが完了して有効になると、会員限定の本文を表示します。</p>'
      : '<section><h2>会員限定コンテンツ</h2><p class="description">' + escape(body) + '</p></section><p><a href="/receive/orders/' + orderId + '">注文の確認と問い合わせ</a></p>'}
    ${payment && details.state === 'active' && details.subscriptionId
      ? form('cancel', '<input type="hidden" name="orderId" value="' + orderId + '">', '次回の更新を停止') : ''}`)
}

export async function handleMembership(req, res, { route, origin, store, lifecycle, payment, resolveHuman }) {
  const path = route.pathname
  const publishPlan = path === '/api/membership/v1/offers'
  const cancel = /^\/api\/membership\/v1\/orders\/([^/]+)\/cancel$/.exec(path)
  const order = /^\/membership\/orders\/([^/]+)$/.exec(path)
  const dashboard = path === '/membership'
  if (!publishPlan && !cancel && !order && !dashboard) return false
  if (req.method !== (publishPlan || cancel ? 'POST' : 'GET')) { send(res, 405, { error: 'method_not_allowed' }); return true }
  if (route.search || ((order || cancel) && !storeId((order ?? cancel)[1]))) throw invalid()
  const human = await resolveHuman()
  if (!human) {
    if (order || dashboard) res.writeHead(303, { location: '/?next=' + encodeURIComponent(path) }).end()
    else send(res, 401, { error: 'sign_in_required' })
    return true
  }
  if ((publishPlan || cancel) && req.headers.origin !== origin) throw new StoreError(403, 'forbidden')
  if ((publishPlan || cancel) && !payment) throw new StoreError(503, 'payment_unavailable')
  const actor = human.principalId
  if (publishPlan) {
    const { content, title, description, amountMinor, listingId } = await input(req, 220_000)
    if (typeof content !== 'string' || !content.trim() || content.length > 50_000 || content.includes('\0') || !amountMinor) throw invalid()
    send(res, 201, await store.publish(actor, { title, description, amountMinor, ...(listingId !== undefined && { listingId }),
      membership: true, fileName: 'members.txt', bytes: Buffer.from(content) }))
  } else if (cancel) {
    const orderId = cancel[1]
    const details = await store.membershipOrder(actor, orderId)
    if (details.state !== 'active' && details.state !== 'ending') throw missing()
    if (!details.cancelAtPeriodEnd) {
      await payment.cancelMembership(details.subscriptionId, orderId)
      await store.recordMembershipCancellation(actor, orderId, details.subscriptionId)
    }
    send(res, 200, { cancelAtPeriodEnd: true, periodEnd: details.periodEnd })
  } else if (dashboard) send(res, 200, manage(await store.membershipRoster(actor, undefined, lifecycle?.membershipDraft), payment))
  else send(res, 200, await memberPage(order[1], await store.membershipOrder(actor, order[1]), payment))
  return true
}
