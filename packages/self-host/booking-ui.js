const errors = {
  sign_in_required: 'ログインしてからお申し込みください。',
  booking_email_unverified: 'メールアドレスの確認が必要です。',
  booking_conflict: 'その日時は受付できません。空き枠を確認してください。',
}
const reservation = document.querySelector('form[data-booking="reserve"]')
const at = value => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })
const dateInput = document.querySelector('input[name="date"]')
if (dateInput && dateInput.dataset.fixedDate) dateInput.value = dateInput.dataset.fixedDate

for (const form of document.querySelectorAll('form[data-booking]')) {
  const action = form.dataset.booking
  const button = form.querySelector('button')
  const status = form.querySelector('[role="status"]')
  const idempotencyKey = crypto.randomUUID()
  form.addEventListener('submit', async event => {
    event.preventDefault()
    button.disabled = true
    const fields = Object.fromEntries(new FormData(form))
    try {
      if (action === 'slots') {
        const from = new Date(fields.date + 'T00:00:00+09:00')
        const query = new URLSearchParams({ offerId: fields.offerId, from: from.toISOString(), to: new Date(+from + 86_400_000).toISOString() })
        const response = await fetch('/api/booking/slots?' + query)
        if (!response.ok) throw Error('slots')
        const data = await response.json()
        reservation.elements.startsAt.replaceChildren(...data.available.map(value => new Option(at(value), value)))
        status.textContent = data.available.length ? '開始時刻を選んでお申し込みください。' : '空き枠がありません。'
        return
      }
      if (action === 'offer') {
        fields.durationMinutes = Number(fields.durationMinutes)
        fields.capacity = Number(fields.capacity)
      }
      if (action === 'reserve' || action === 'outcome') fields.idempotencyKey = idempotencyKey
      if (action === 'reschedule') fields.startsAt = new Date(fields.startsAt + '+09:00').toISOString()
      let path = '/api/booking/' + action
      if (action === 'verify-email') {
        path = '/api/auth/send-verification-email'
        fields.callbackURL = '/booking/offers/' + fields.offerId
        delete fields.offerId
      }
      const response = await fetch(path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        status.textContent = errors[body.error] ?? '操作を完了できませんでした。'
      } else if (action === 'reserve') {
        const result = await response.json()
        location.assign('/booking/receipts/' + result.bookingId)
      } else if (action === 'verify-email') {
        status.textContent = '確認用リンクを発行しました。ローカルの確認メールを開いてください。'
      } else {
        location.reload()
      }
    } catch {
      status.textContent = '接続を確認してから、再度お試しください。'
    } finally {
      button.disabled = false
    }
  })
}
