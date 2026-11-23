import { randomUUID } from 'node:crypto'
import { BOOKING_TOOLS } from './mcp.mjs'
import { canCallAgent, escape, html, input, send } from './store-http.mjs'
import { forbidden, invalid, StoreError, storeId } from './free-download.mjs'

const view = (title, content) => html(title, '<h1>' + escape(title) + '</h1>' + content, '/booking-ui.js')
const loginLink = path => '<a href="/?next=' + encodeURIComponent(path) + '">ログイン・登録</a>'
const hidden = (name, value) => '<input type="hidden" name="' + name + '" value="' + escape(value) + '">'
const form = (action, content, label) => `<form data-booking="${action}">${content}<button>${label}</button><p role="status"></p></form>`
const outcomes = new Map([['attended', '参加'], ['no_show', '欠席'], ['host_issue', '主催者都合']])
const stage = row => row.status === 'cancelled' ? '取消済み' : outcomes.get(row.outcome) ?? '確定'
const format = instant => new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(instant))

function manage(offers, records) {
  const items = offers.map(offer => `<li><a href="/booking/offers/${offer.id}">${escape(offer.title)}</a> · 定員 ${offer.capacity}人</li>`).join('')
  const rows = records.map(row => `<li>${escape(format(row.startsAt))} · ${stage(row)}
${row.status === 'confirmed' && +new Date(row.startsAt) <= Date.now() ? form('outcome', hidden('bookingId', row.id) +
  '<label>出欠 <select name="outcome"><option value="attended">参加</option><option value="no_show">欠席</option><option value="host_issue">主催者都合</option></select></label>', '記録する') : ''}</li>`).join('')
  return view('予約・イベント受付', form('offer', hidden('idempotencyKey', randomUUID()) + `
<label>受付名 <input name="title" required maxlength="120"></label>
<label>説明 <textarea name="description" maxlength="2000"></textarea></label>
<label>受付担当 <input name="displayName" required maxlength="80"></label>
<label>受付方式 <select name="schedule"><option value="weekly">毎週の予約</option><option value="single">指定日のイベント</option></select></label>
<label>受付日（日本時間） <input type="date" name="date" required></label>
<label>開始 <input type="time" name="from" required value="10:00"></label>
<label>終了 <input type="time" name="to" required value="12:00"></label>
<label>所要時間（分） <input type="number" name="durationMinutes" min="5" max="240" value="30" required></label>
<label>定員 <input type="number" name="capacity" min="1" max="1000" value="1" required></label>`, '受付を公開') +
    '<h2>公開済みの受付</h2>' + (items ? '<ul>' + items + '</ul>' : '<p>公開済みの受付はありません。</p>') +
    '<h2>予約・出欠</h2>' + (rows ? '<ul>' + rows + '</ul>' : '<p>申込はまだありません。</p>'))
}

function offerPage(offer) {
  const fields = hidden('offerId', offer.id)
  return view(offer.title, `<p class="description">${escape(offer.description)}</p><p>無料 · 定員 ${offer.capacity}人</p>
<p>${loginLink('/booking/offers/' + offer.id)}</p>
${form('slots', fields + `<label>日付（日本時間） <input type="date" name="date" data-fixed-date="${escape(offer.date ?? '')}" required></label>`, '空き枠を確認')}
${form('reserve', fields + '<label>開始時刻 <select name="startsAt" required></select></label>', '申し込む')}
${form('verify-email', fields + '<label>ログインに使ったメールアドレス <input type="email" name="email" required></label>', '確認用リンクを発行')}`)
}

function receipt(booking) {
  const fields = hidden('bookingId', booking.id)
  return view('予約の確認', `<p>${escape(booking.offerTitle)} · ${stage(booking)}</p>
<p>${escape(format(booking.startsAt))}</p>
<p><a href="/booking/offers/${booking.offerId}">受付ページへ</a></p>
${booking.status === 'confirmed' ? form('cancel', fields, '予約を取り消す') +
  form('reschedule', fields + '<label>振替日時（日本時間） <input type="datetime-local" name="startsAt" step="60" required></label>', '日時を変更する') : ''}`)
}

function offerSettings(fields) {
  const { date, from, to } = fields
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to) || from >= to) throw invalid()
  const calendarDate = new Date(date+'T00:00:00Z')
  if (!Number.isFinite(+calendarDate) || calendarDate.toISOString().slice(0, 10) !== date) throw invalid()
  if (!Number.isInteger(fields.durationMinutes) || !Number.isInteger(fields.capacity)) throw invalid()
  return {
    idempotencyKey: fields.idempotencyKey,
    host: { displayName: fields.displayName, timeZone: 'Asia/Tokyo' },
    offer: {
      title: fields.title, description: fields.description, durationMinutes: fields.durationMinutes, startStepMinutes: Math.min(fields.durationMinutes,240),
      capacity: fields.capacity, minNoticeMinutes: 0,
      weeklyHours: { [calendarDate.getUTCDay() || 7]: [[from,to]] },
      ...(fields.schedule !== 'weekly' && { date }),
    },
  }
}

export async function handleBooking(req, res, { route, origin, booking, delegation, resolveHuman }) {
  const { pathname } = route
  const publicOffer = /^\/booking\/offers\/([0-9a-f-]{36})$/.exec(pathname)?.[1]
  const privateBooking = /^\/booking\/receipts\/([0-9a-f-]{36})$/.exec(pathname)?.[1]
  if (req.method === 'GET' && publicOffer) {
    send(res, 200, offerPage(await booking.publicPage(publicOffer)))
    return true
  }
  if (req.method === 'GET' && pathname === '/api/booking/slots') {
    const from = route.searchParams.get('from')
    const slots = await booking.slots(route.searchParams.get('offerId'), from, route.searchParams.get('to'))
    send(res, 200, { available: slots.available })
    return true
  }
  if (req.method === 'POST' && pathname === '/api/booking/agent') {
    if (!canCallAgent(req, delegation)) throw new StoreError(401, 'agent_unauthorized')
    const rpc = await input(req, 4096)
    if (rpc.arguments?.projectId !== booking.projectId) throw forbidden()
    const actor = delegation.principalId
    const args = rpc.arguments
    const handlers = {
      booking_offers_list: async () => ({ offers: await booking.offers(actor, args.limit) }),
      booking_records_list: async () => ({ bookings: await booking.records(actor, args.bookingId ?? null, args.limit) }),
      booking_outcome_record: () => booking.recordOutcome(actor, args.bookingId, args.outcome, args.idempotencyKey),
    }
    if (!BOOKING_TOOLS.some(tool => tool.name === rpc.name) || !Object.hasOwn(handlers, rpc.name)) throw forbidden()
    if (rpc.name === 'booking_outcome_record' && !storeId(args.idempotencyKey)) throw invalid()
    send(res, 200, await handlers[rpc.name]())
    return true
  }
  const management = req.method === 'GET' && pathname === '/booking'
  const operation = req.method === 'POST' && /^\/api\/booking\/(offer|reserve|reschedule|cancel|outcome)$/.exec(pathname)?.[1]
  if (!management && !(privateBooking && req.method === 'GET') && !operation) return false
  if (operation && req.headers.origin !== origin) throw forbidden()
  const human = await resolveHuman()
  if (!human) {
    if (operation) throw new StoreError(401, 'sign_in_required')
    send(res, 401, view('ログインが必要です', '<p>' + loginLink(pathname) + '</p>'))
    return true
  }
  const actor = human.principalId
  if (management) {
    send(res, 200, manage(await booking.offers(actor), await booking.records(actor)))
  } else if (privateBooking) {
    send(res, 200, receipt(await booking.customerBooking(actor, privateBooking)))
  } else {
    const fields = await input(req, 16_384)
    const operations = {
      offer: () => booking.saveOffer(actor, offerSettings(fields)),
      reserve: () => booking.reserve(actor, fields.offerId, fields),
      reschedule: () => booking.reschedule(actor, fields.bookingId, fields.startsAt),
      cancel: () => booking.cancel(actor, fields.bookingId),
      outcome: () => booking.recordOutcome(actor, fields.bookingId, fields.outcome, fields.idempotencyKey),
    }
    send(res, 200, await operations[operation]())
  }
  return true
}
