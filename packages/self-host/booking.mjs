import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { computeSlots, localDate } from '../booking-slots/src/slots.js'
import { forbidden, invalid, missing, sha, StoreError, storeId } from './free-download.mjs'
import { createBookingNoticePreview } from './booking-notices.mjs'
import { transaction } from './setup.mjs'

const day = 86_400_000
const scheduleBlueprint = 'booking.fixed-date'
const scheduleDigest = sha(JSON.stringify({ fields: ['date'], access: 'project' }))
const conflict = () => new StoreError(409, 'booking_conflict')

function instant(value) {
  const date = typeof value === 'string' ? new Date(value) : new Date(NaN)
  if (!Number.isFinite(date.getTime())) throw invalid()
  return date
}

function requiredId(value) {
  if (!storeId(value)) throw invalid()
  return value
}

const scopedKey = values => sha(JSON.stringify(values))
const result = async (db, sql, values) => (await db.query(sql, values)).rows[0]?.result
const evaluatedErrors = new Map([
  ['BOOKING_NOT_FOUND', missing],
  ['BOOKING_FORBIDDEN', forbidden],
  ['BOOKING_SLOT_TAKEN', conflict],
  ['BOOKING_SLOT_UNAVAILABLE', conflict],
  ['BOOKING_STATE_INVALID', conflict],
  ['BOOKING_INPUT_INVALID', invalid],
  ['BOOKING_HOST_REQUIRED', invalid],
  ['BOOKING_PAYMENT_UNAVAILABLE', invalid],
])

export function createBooking({ pool, projectId, directory, noticeOrigin }) {
  requiredId(projectId)
  const pages = directory && join(directory, projectId, 'public-bookings')
  const notify = directory && noticeOrigin ? createBookingNoticePreview({ pool, projectId, directory, origin: noticeOrigin }) : null
  let publication = Promise.resolve()

  async function afterChange(change, bookingId) {
    const booking = await change
    if (notify) await notify(bookingId ?? booking.bookingId).catch(() => console.error('booking_notice_preview_unavailable'))
    return booking
  }

  const run = fn => transaction(pool, fn).catch(error => {
    const translated = evaluatedErrors.get(error.message)
    throw translated ? translated() : error
  })

  async function operator(client, actor) {
    const { rows: [project] } = await client.query(`
      SELECT p.workspace_id
      FROM platform.projects p
      WHERE p.project_id = $1 AND p.status = 'active' AND platform.booking_member($2,p.workspace_id)
        AND (p.created_by_principal_id = $2 OR EXISTS (
          SELECT 1 FROM platform.project_memberships m WHERE m.project_id=p.project_id AND m.principal_id = $2
            AND m.status='active' AND m.revoked_at IS NULL AND m.member_role IN ('owner','editor')
        ))
    `, [projectId, actor])
    if (!project) throw forbidden()
    return project.workspace_id
  }

  async function offerInProject(client, offerId) {
    const { rows: [scope] } = await client.query(`
      SELECT o.workspace_id,o.revision FROM platform.booking_offers o JOIN platform.projects p ON p.project_id=o.project_id
      JOIN platform.booking_offer_revisions r ON r.offer_id=o.offer_id AND r.revision=o.revision
      WHERE o.offer_id=$1 AND o.project_id=$2 AND p.status='active' AND r.price_amount=0 AND o.status='active'
      FOR SHARE OF o
    `, [requiredId(offerId), projectId])
    if (!scope) throw missing()
    return scope
  }

  async function customer(client, actor, requiresEmail = false) {
    const { rowCount } = await client.query(`
      SELECT 1 FROM identity.principals WHERE principal_id=$1 AND principal_kind='human' AND status='active'
        AND (NOT $2::boolean OR email IS NOT NULL)
    `, [actor, requiresEmail])
    if (!rowCount) throw requiresEmail ? new StoreError(403, 'booking_email_unverified') : forbidden()
  }

  async function bookingInProject(client, bookingId) {
    const { rowCount } = await client.query(`
      SELECT 1 FROM platform.bookings b JOIN platform.projects p USING (project_id)
      WHERE booking_id=$1 AND b.project_id=$2 AND p.status='active' AND b.amount=0
    `, [requiredId(bookingId), projectId])
    if (!rowCount) throw missing()
  }

  const scheduleKey = (offerId, revision) => scopedKey([offerId, revision])
  async function fixedDate(client, offerId, revision) {
    const { rows: [row] } = await client.query(`
      SELECT r.data->>'date' AS date FROM vdb.records r JOIN vdb.schemas s USING (schema_id)
      WHERE r.project_id=$1 AND r.record_key=$2 AND s.blueprint_ref=$3 AND s.blueprint_revision='1' AND s.blueprint_digest=$4
    `, [projectId, scheduleKey(offerId, revision), scheduleBlueprint, scheduleDigest])
    return row?.date
  }

  async function saveOffer(actor, input) {
    // Use the shared booking operations. The local host accepts free reservations.
    const saved = await run(async client => {
      const workspaceId = await operator(client, actor)
      const { host, offer, idempotencyKey } = input
      if (!host || !offer || !storeId(idempotencyKey)) throw invalid()
      await result(client, 'SELECT platform.booking_host_save($1,$2,$3::jsonb) AS result', [actor, workspaceId, {
        displayName: host.displayName, timeZone: host.timeZone, weeklyHours: host.weeklyHours, exceptions: host.exceptions,
        calendarCheck: 'best_effort',
      }])
      if (offer.offerId) await offerInProject(client, offer.offerId)
      const saved = await result(client, 'SELECT platform.booking_offer_save($1,$2,$3::jsonb) AS result', [actor, workspaceId, {
        offerId: offer.offerId, title: offer.title, description: offer.description, priceAmount: 0, status: 'active',
        durationMinutes: offer.durationMinutes, startStepMinutes: offer.startStepMinutes, minNoticeMinutes: offer.minNoticeMinutes,
        capacity: offer.capacity, weeklyHours: offer.weeklyHours, meetingKind: 'none', sendCalendarInvite: false,
        idempotencyKey: scopedKey([projectId, actor, idempotencyKey]),
      }])
      await client.query('SELECT platform.booking_offer_project_set($1,$2,$3,$4)', [actor, workspaceId, saved.offerId, projectId])
      if (offer.date) {
        if (offer.offerId || !/^\d{4}-\d{2}-\d{2}$/.test(offer.date)) throw invalid()
        await client.query(`
          INSERT INTO vdb.schemas(workspace_id,blueprint_ref,blueprint_revision,blueprint_digest,allowed_access,default_access,projection_version)
          VALUES($1,$2,'1',$3,ARRAY['project'],'project','1') ON CONFLICT(workspace_id,blueprint_ref,blueprint_revision) DO NOTHING
        `, [workspaceId, scheduleBlueprint, scheduleDigest])
        await client.query(`
          INSERT INTO vdb.records (schema_id,project_id,access,record_key,data)
          SELECT schema_id,$1,'project',$2,$3 FROM vdb.schemas
          WHERE workspace_id=$4 AND blueprint_ref=$5 AND blueprint_revision='1' AND blueprint_digest=$6
          ON CONFLICT(schema_id,record_key) DO NOTHING
        `, [projectId, scheduleKey(saved.offerId, saved.revision), { date: offer.date }, workspaceId, scheduleBlueprint, scheduleDigest])
        if (await fixedDate(client, saved.offerId, saved.revision) !== offer.date) throw conflict()
      }
      const page = await result(client, `
        SELECT platform.booking_offer_json(o,r) AS result FROM platform.booking_offers o
        JOIN platform.booking_offer_revisions r ON r.offer_id=o.offer_id AND r.revision=o.revision
        WHERE o.offer_id=$1
      `, [saved.offerId])
      return { ...saved, page: { ...page, ...(offer.date && { date: offer.date }) } }
    })
    if (pages) {
      const write = publication.then(async () => {
        await mkdir(pages, { recursive: true, mode: 0o700 })
        const target = join(pages, saved.offerId + '.json')
        const staging = target + '.' + randomUUID() + '.tmp'
        try {
          await writeFile(staging, JSON.stringify(saved.page), { mode: 0o600, flag: 'wx' })
          await rename(staging, target)
        } finally {
          await rm(staging, { force: true })
        }
      })
      publication = write.catch(() => {})
      await write
    }
    return { offerId: saved.offerId, revision: saved.revision, created: saved.created }
  }

  async function publicPage(offerId) {
    if (!pages) throw missing()
    try {
      return JSON.parse(await readFile(join(pages, requiredId(offerId) + '.json'), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') throw missing()
      throw error
    }
  }

  function offers(actor, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid()
    return run(async client => {
      const workspaceId = await operator(client, actor)
      const { rows } = await client.query(`
        SELECT platform.booking_offer_json(o,r) AS offer
        FROM platform.booking_offers o JOIN platform.booking_offer_revisions r ON r.offer_id=o.offer_id AND r.revision=o.revision
        WHERE o.workspace_id=$1 AND o.project_id=$2 AND o.status='active' AND r.price_amount=0
        ORDER BY o.created_at DESC LIMIT $3
      `, [workspaceId, projectId, limit])
      return rows.map(row => row.offer)
    })
  }

  function slots(offerId, fromDate, toDate) {
    const from = instant(fromDate)
    const to = instant(toDate)
    if (to <= from || to - from > 31 * day) throw invalid()
    return run(async client => {
      const scope = await offerInProject(client, offerId)
      const data = await result(client, 'SELECT platform.booking_offer_public($1,$2,$3) AS result', [offerId, from, to])
      if (!data) throw missing()
      const { offer, host, occupied } = data
      const available = computeSlots({
        ...offer, timeZone: host.timeZone, weeklyHours: offer.weeklyHours ?? host.weeklyHours, exceptions: host.exceptions,
      }, { from: from.getTime(), to: to.getTime(), now: Date.now(), occupied: occupied.map(item => item.map(Date.parse)), busy: [] })
      const date = await fixedDate(client, offerId, scope.revision)
      return { offer, timeZone: host.timeZone,
        available: date ? available.filter(value => localDate(Date.parse(value), host.timeZone) === date) : available,
      }
    })
  }

  function reserve(actor, offerId, { startsAt, idempotencyKey }) {
    const start = instant(startsAt).toISOString()
    requiredId(idempotencyKey)
    return afterChange(run(async client => {
      await customer(client, actor, true)
      const { workspace_id: workspaceId, revision } = await offerInProject(client, offerId)
      const key = scopedKey(['booking.hold', projectId, actor, idempotencyKey])
      const fingerprint = scopedKey([offerId, start])
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key])
      const { rows: [prior] } = await client.query(`
        SELECT request_digest,response FROM runtime.idempotency_keys WHERE workspace_id=$1 AND idempotency_key=$2
      `, [workspaceId, key])
      if (prior) {
        if (prior.request_digest !== fingerprint) throw conflict()
        return prior.response
      }
      const date = await fixedDate(client, offerId, revision)
      if (date && localDate(Date.parse(start), 'Asia/Tokyo') !== date) throw conflict()
      const booking = await result(client, 'SELECT platform.booking_hold($1,$2,$3::jsonb,0) AS result', [actor, offerId, {
        startsAt: start, idempotencyKey: key,
      }])
      await client.query(`
        INSERT INTO runtime.idempotency_keys(workspace_id,idempotency_key,request_digest,response_digest,response)
        VALUES($1,$2,$3,$4,$5)
      `, [workspaceId, key, fingerprint, scopedKey(booking), booking])
      return booking
    }))
  }

  function customerBooking(actor, bookingId) {
    return run(async client => {
      await customer(client, actor)
      await bookingInProject(client, bookingId)
      const booking = await result(client, 'SELECT platform.my_booking($1,$2) AS result', [actor, bookingId])
      if (!booking) throw missing()
      return booking
    })
  }

  function cancel(actor, bookingId) {
    return afterChange(run(async client => {
      await customer(client, actor)
      await bookingInProject(client, bookingId)
      return result(client, "SELECT platform.booking_cancel($1,$2,'customer') AS result", [actor, bookingId])
    }), bookingId)
  }

  function reschedule(actor, bookingId, startsAt) {
    return afterChange(run(async client => {
      await customer(client, actor)
      await bookingInProject(client, bookingId)
      const start = instant(startsAt)
      const original = await result(client, 'SELECT platform.my_booking($1,$2) AS result', [actor, bookingId])
      if (!original) throw missing()
      const date = await fixedDate(client, original.offerId, original.offerRevision)
      if (date && localDate(+start, 'Asia/Tokyo') !== date) throw conflict()
      return result(client, "SELECT platform.booking_reschedule($1,$2,'customer',$3) AS result", [actor, bookingId, start])
    }), bookingId)
  }

  function records(actor, bookingId = null, limit = 50) {
    if (bookingId !== null) requiredId(bookingId)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid()
    return run(async client => {
      const workspaceId = await operator(client, actor)
      const { rows } = await client.query(`
        SELECT booking_id AS id, offer_id AS "offerId", starts_at AS "startsAt", ends_at AS "endsAt", status, outcome
        FROM platform.bookings WHERE workspace_id=$1 AND project_id=$2 AND status IN ('confirmed','cancelled')
          AND ($3::uuid IS NULL OR booking_id=$3)
        ORDER BY starts_at,booking_id LIMIT $4
      `, [workspaceId, projectId, bookingId, limit])
      return rows
    })
  }

  function recordOutcome(actor, bookingId, outcome, idempotencyKey) {
    if (!['attended', 'no_show', 'host_issue'].includes(outcome)) throw invalid()
    return run(async client => {
      const workspaceId = await operator(client, actor)
      await bookingInProject(client, bookingId)
      const execute = () => result(client, 'SELECT platform.booking_set_outcome($1,$2,$3) AS result', [actor, bookingId, outcome])
      if (idempotencyKey === undefined) return execute()
      requiredId(idempotencyKey)
      const key = scopedKey(['booking.outcome', projectId, actor, idempotencyKey])
      const fingerprint = scopedKey([bookingId, outcome])
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key])
      const { rows: [prior] } = await client.query(`
        SELECT request_digest,response FROM runtime.idempotency_keys WHERE workspace_id=$1 AND idempotency_key=$2
      `, [workspaceId, key])
      if (prior) {
        if (prior.request_digest !== fingerprint) throw conflict()
        return prior.response
      }
      const output = await execute()
      await client.query(`
        INSERT INTO runtime.idempotency_keys(workspace_id,idempotency_key,request_digest,response_digest,response)
        VALUES($1,$2,$3,$4,$5)
      `, [workspaceId, key, fingerprint, scopedKey(output), output])
      return output
    })
  }

  return { projectId, saveOffer, publicPage, offers, slots, reserve, customerBooking, cancel, reschedule, records, recordOutcome }
}
