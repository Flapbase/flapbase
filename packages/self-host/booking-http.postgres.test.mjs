import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createBetterAuthAdapter, createSelfHostedAuthPool } from './auth.mjs'
import { createBooking } from './booking.mjs'
import { sha } from './free-download.mjs'
import { startArtifactTestPostgres } from './postgres-fixture.mjs'
import { createSelfHostedServer } from './server.mjs'
import { setupBookingSchema, setupProject } from './setup.mjs'

async function listen(server, port = 0) {
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}
const close = server => new Promise(resolve => {
  server.close(resolve)
  server.closeAllConnections?.()
})
const day = 86_400_000
const date = offset => new Date(Date.now() + offset * day).toISOString().slice(0, 10)

test('verified applicants can book a recurring slot or fixed event and operators can use MCP', { timeout: 30_000 }, async () => {
  const fixture = await startArtifactTestPostgres()
  const pool = createSelfHostedAuthPool(fixture.connection)
  const directory = await mkdtemp(join(tmpdir(), 'flap-bookings-http-'))
  let server, client
  try {
    await setupBookingSchema(pool)
    const probe = createServer()
    const port = await listen(probe)
    await close(probe)
    const origin = 'http://127.0.0.1:' + port
    const projectId = randomUUID()
    const token = randomUUID() + randomUUID()
    const bookingDelegation = { tokenDigest: sha('Bearer ' + token) }
    const previews = new Map()
    const adapter = createBetterAuthAdapter(pool, {
      origin, issuer: 'urn:flapbase:local:booking-test', secret: randomUUID(),
      sendVerificationEmail: async ({ user, url }) => { previews.set(user.email, url) },
    })
    const start = async () => {
      server = createSelfHostedServer({
        origin, pool, adapter, booking: createBooking({ pool, projectId, directory, noticeOrigin: origin }), bookingDelegation,
      })
      await listen(server, port)
    }
    await start()
    const request = (path, init) => fetch(new URL(path, origin), init).catch(error => {
      throw new Error('Request failed at ' + new URL(path, origin).pathname, { cause: error })
    })
    const get = (path, cookie) => request(path, { headers: { connection: 'close', ...(cookie ? { cookie } : {}) } })
    const post = (path, fields, cookie) => request(path, {
      method: 'POST', headers: { origin, connection: 'close', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(fields),
    })
    const json = async response => {
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }
    async function register(name) {
      const email = name + '@example.test'
      const response = await post('/api/auth/sign-up/email', { name, email, password: randomUUID() })
      assert.equal(response.status, 204)
      const cookie = response.headers.getSetCookie().find(value => value.startsWith('better-auth.session_token=')).split(';')[0]
      return { email, cookie, ...await json(await get('/auth/context', cookie)) }
    }
    const owner = await register('booking-owner')
    const first = await register('participant-one')
    const other = await register('participant-two')
    await setupProject(pool, { ownerId: owner.principalId, projectId, name: 'イベントと予約' })
    bookingDelegation.principalId = owner.principalId
    const platform = await get('/booking', owner.cookie)
    assert.equal(platform.status, 200)
    assert.match(await platform.text(), /受付を公開/)
    const publish = schedule => post('/api/booking/offer', {
      title: schedule === 'weekly' ? '相談枠' : '説明会', description: '無料で参加できます', displayName: '運営',
      date: date(3), from: '10:00', to: '12:00', durationMinutes: 30, capacity: schedule === 'weekly' ? 1 : 2,
      idempotencyKey: randomUUID(), schedule,
    }, owner.cookie)
    const event = await json(await publish('single'))
    const consultation = await json(await publish('weekly'))
    const publicPath = '/booking/offers/' + event.offerId
    const page = await get(publicPath)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /説明会/)
    const listSlots = async (id, offset) => {
      const from = new Date(date(offset) + 'T00:00:00+09:00')
      const query = new URLSearchParams({ offerId: id, from: from.toISOString(), to: new Date(+from + day).toISOString() })
      return (await json(await get('/api/booking/slots?' + query))).available
    }
    const [firstSlot, secondSlot] = await listSlots(event.offerId, 3)
    assert.ok(secondSlot)
    assert.deepEqual(await listSlots(event.offerId, 10), [])
    assert.ok((await listSlots(consultation.offerId, 10)).length)
    const claim = (person, id, startsAt) => post('/api/booking/reserve', { offerId: id, startsAt, idempotencyKey: randomUUID() }, person.cookie)
    assert.equal((await claim(first, event.offerId, firstSlot)).status, 403)
    for (const person of [owner, first, other]) {
      const sent = await post('/api/auth/send-verification-email', { email: person.email, callbackURL: publicPath }, person.cookie)
      assert.equal(sent.status, 204, await sent.text())
      const link = new URL(previews.get(person.email))
      assert.equal(link.origin, origin)
      assert.equal((await request(link, { headers: { connection: 'close', cookie: person.cookie }, redirect: 'manual' })).status, 302)
      assert.equal((await get('/auth/context', person.cookie)).status, 200)
    }
    const firstInput = { offerId: event.offerId, startsAt: firstSlot, idempotencyKey: randomUUID() }
    const reserve = () => post('/api/booking/reserve', firstInput, first.cookie)
    const firstBooking = await json(await reserve())
    const inbox = join(directory, projectId, 'booking-notice-preview')
    const received = async () => Promise.all((await readdir(inbox)).map(async name => JSON.parse(await readFile(join(inbox, name), 'utf8'))))
    const initialNotices = await received()
    assert.equal(initialNotices.length, 2)
    assert.equal(initialNotices.find(item => item.kind === 'booking.confirmed' && item.recipient === 'host').to, owner.email)
    const customerNotice = initialNotices.find(item => item.kind === 'booking.confirmed' && item.recipient === 'customer')
    assert.equal(customerNotice.to, first.email)
    assert.match(customerNotice.subject, /ご予約を承りました/)
    assert.match(customerNotice.text, new RegExp('/booking/receipts/' + firstBooking.bookingId))
    assert.match(customerNotice.text, /説明会/)
    assert.deepEqual(await json(await reserve()), firstBooking)
    assert.deepEqual(await received(), initialNotices)
    await json(await claim(other, event.offerId, firstSlot))
    assert.ok(!(await listSlots(event.offerId, 3)).includes(firstSlot))
    assert.equal((await claim(first, event.offerId, new Date(Date.parse(firstSlot) + 7 * day).toISOString())).status, 409)
    const receiptPath = '/booking/receipts/' + firstBooking.bookingId
    assert.equal((await get(receiptPath, other.cookie)).status, 404)
    assert.match(await (await get(receiptPath, first.cookie)).text(), /説明会 · 確定/)
    await json(await post('/api/booking/reschedule', { bookingId: firstBooking.bookingId, startsAt: secondSlot }, first.cookie))
    const [consultationTime] = await listSlots(consultation.offerId, 10)
    const weekly = await json(await claim(first, consultation.offerId, consultationTime))
    await json(await post('/api/booking/cancel', { bookingId: weekly.bookingId }, first.cookie))
    assert.match(await (await get('/booking/receipts/' + weekly.bookingId, first.cookie)).text(), /取消済み/)
    const delivered = await received()
    const changeNotice = delivered.find(item => item.kind === 'booking.rescheduled' && item.recipient === 'customer')
    assert.equal(changeNotice.bookingId, firstBooking.bookingId)
    assert.match(changeNotice.text, /新しい日時/)
    assert.equal(delivered.filter(item => item.kind === 'booking.cancelled' && item.bookingId === weekly.bookingId).length, 2)
    assert.equal(delivered.length, 10)
    assert.deepEqual((await fixture.sql.query(`
      SELECT state,count(*)::int AS count FROM platform.booking_notices WHERE booking_id=ANY($1::uuid[])
        AND kind IN ('booking.confirmed','booking.rescheduled','booking.cancelled') GROUP BY state
    `, [[firstBooking.bookingId, weekly.bookingId]])).map(row=>[row.state,row.count]), [['sent',8]])

    client = new Client({ name: 'booking-local-test', version: '1.0.0' })
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [fileURLToPath(new URL('./mcp.mjs', import.meta.url))],
      env: { FLAP_ORIGIN: origin, FLAP_BOOKING_AGENT_TOKEN: token },
    }))
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['booking_offers_list', 'booking_records_list', 'booking_outcome_record'])
    const invoke = async (name, arguments_) => {
      const reply = await client.callTool({ name, arguments: { projectId, ...arguments_ } })
      assert.ok(!reply.isError, reply.content[0]?.text)
      return JSON.parse(reply.content[0].text)
    }
    assert.equal((await invoke('booking_offers_list', {})).offers.length, 2)
    const list = await invoke('booking_records_list', { bookingId: firstBooking.bookingId })
    assert.equal(list.bookings[0].id, firstBooking.bookingId)
    assert.ok(!Object.hasOwn(list.bookings[0], 'customerEmail'))
    assert.equal((await client.callTool({ name: 'booking_offers_list', arguments: { projectId: randomUUID() } })).isError, true)
    const attendance = { projectId, bookingId: firstBooking.bookingId, outcome: 'attended', idempotencyKey: randomUUID() }
    assert.equal((await client.callTool({ name: 'booking_outcome_record', arguments: attendance })).isError, true)
    await fixture.sql.query("UPDATE platform.bookings SET starts_at=now()-interval '1 hour', ends_at=now()-interval '30 minutes', block_start=now()-interval '1 hour', block_end=now()-interval '30 minutes' WHERE booking_id=$1", [firstBooking.bookingId])
    const outcome = await invoke('booking_outcome_record', attendance)
    assert.deepEqual(await invoke('booking_outcome_record', attendance), outcome)
    await client.close()
    client = null
    await close(server)
    server = null
    await start()
    assert.match(await (await get(publicPath)).text(), /説明会/)
    assert.match(await (await get(receiptPath, first.cookie)).text(), /説明会 · 参加/)
    assert.equal((await received()).length, 10)
  } finally {
    await client?.close()
    if (server?.listening) await close(server)
    await pool.end()
    await fixture.close()
    await rm(directory, { recursive: true, force: true })
  }
})
