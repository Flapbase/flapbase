import { randomUUID } from 'node:crypto'
import { link, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bookingMailText } from '../booking-slots/src/notices.js'
import { transaction } from './setup.mjs'

const immediateKinds = ['booking.confirmed', 'booking.rescheduled', 'booking.cancelled']

export function createBookingNoticePreview({ pool, projectId, directory, origin }) {
  const inbox = join(directory, projectId, 'booking-notice-preview')

  async function preview(row) {
    const file = join(inbox, row.notice_id + '.json')
    const staging = file + '.' + randomUUID() + '.tmp'
    const receipt = row.recipient_kind === 'customer' ? origin + '/booking/receipts/' + row.booking_id : null
    const mail = { kind: row.kind, bookingId: row.booking_id, recipient: row.recipient_kind,
      to: row.recipient, ...bookingMailText(row, receipt) }
    await mkdir(inbox, { recursive: true, mode: 0o700 })
    try {
      await writeFile(staging, JSON.stringify(mail, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      await link(staging, file).catch(error => { if (error.code !== 'EEXIST') throw error })
    } finally {
      await rm(staging, { force: true })
    }
  }

  return async bookingId => {
    if (!bookingId) return
    const notices = await transaction(pool, async db => {
      const { rows } = await db.query(`
        SELECT n.notice_id FROM platform.booking_notices n JOIN platform.bookings b USING(booking_id)
        WHERE n.booking_id=$1 AND b.project_id=$2 AND b.amount=0 AND n.workspace_id=b.workspace_id
          AND n.kind=ANY($3::text[]) AND n.due_at<=clock_timestamp()
          AND (n.state='pending' OR (n.state='sending' AND n.claimed_at<clock_timestamp()-interval '10 minutes'))
        ORDER BY n.due_at,n.notice_id LIMIT 20
      `, [bookingId, projectId, immediateKinds])
      if (rows.length === 0) return []
      return (await db.query('SELECT * FROM platform.booking_notice_claim($1,20)', [rows.map(row => row.notice_id)])).rows
    })
    if (!notices.length) return
    const outcomes = await Promise.all(notices.map(async row => {
      const id = row.notice_id
      if (row.kind !== 'booking.cancelled' && row.status !== 'confirmed') return [id, 'held', 'stale']
      if (!row.recipient) return [id, 'held', 'recipient_missing']
      try {
        await preview(row)
        return [id, 'sent', null]
      } catch {
        return [id, 'retry', null]
      }
    }))
    await transaction(pool, async db => {
      for (const outcome of outcomes) {
        await db.query('SELECT platform.booking_notice_finish($1,$2,$3)', outcome)
      }
    })
  }
}
