/** 2026年11月10日（火）14:00〜14:30 in the host's time zone, with the zone when it is not Japan. */
export function bookingTimeLabel(start, end, timeZone) {
  const day = new Intl.DateTimeFormat('ja-JP', { timeZone, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(start).replace(/\((.)\)/u, '（$1）')
  const time = (at) => new Intl.DateTimeFormat('ja-JP', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  return `${day}${time(start)}〜${time(end)}${timeZone === 'Asia/Tokyo' ? '' : `（${timeZone}）`}`
}

const yen = (v) => `${Number(v).toLocaleString('ja-JP')}円`

/** The text of one notice. myUrl is where the customer changes or cancels (the product's page). */
export function bookingMailText(n, myUrl) {
  const what = `「${n.offer_title.trim().slice(0, 80)}」`, when = bookingTimeLabel(new Date(n.starts_at), new Date(n.ends_at), n.time_zone)
  const host = n.host_name.trim().slice(0, 80) || 'ご担当', meet = n.meet_url ? `\n参加のリンク: ${n.meet_url}\n` : ''
  const manage = myUrl ? `\n予約の確認・変更・取消し: ${myUrl}\n` : ''
  const deadline = `取消しの期限: ${bookingTimeLabel(new Date(n.cancel_deadline), new Date(n.cancel_deadline), n.time_zone).replace(/〜.*$/u, '')}`
  const customer = n.recipient_kind === 'customer'
  switch (n.kind) {
    case 'booking.series_stopped': return {subject:'繰り返しの予約が停止しました',text:`${what}の繰り返しの予約が停止しました。これからの回は空きに戻ります。\n`}

    case 'booking.trial_follow_up': return { subject: '体験のご参加ありがとうございました', text: `${host}の体験をご利用いただき、ありがとうございました。通常のメニューはこちらです。\n${n.nextOfferUrl ?? myUrl ?? ''}\n` }
    case 'booking.after_session': return { subject: 'ご参加ありがとうございました', text: `${host}の${what}にご参加いただき、ありがとうございました。次の回もお待ちしています。\n${n.nextOfferUrl ?? myUrl ?? ''}\n` }
    case 'booking.review_submitted': return { subject: 'レビューの提出物が届きました', text: `${what}の提出物が届きました。${n.reviewDueAt ? `返す期限: ${new Intl.DateTimeFormat('ja-JP', { timeZone: n.time_zone, dateStyle: 'long' }).format(new Date(n.reviewDueAt))}` : ''}\n予約の一覧から確認してください。\n` }
    case 'booking.review_returned': return { subject: '講評が届きました', text: `${host}の${what}の講評が届きました。内容を確認し、受け取るか、条件の範囲でやり直しを頼むかを選べます。\n${myUrl ?? ''}\n` }
    case 'booking.review_due': return { subject: '講評を返す期限が近づいています', text: `${what}の講評を返す期限が近づいています。予約の一覧から確認してください。\n` }

    case 'booking.confirmed': return customer
      ? { subject: `ご予約を承りました：${when}`, text: `${host}の${what}のご予約を承りました。\n\n日時: ${when}\n${meet}${Number(n.amount) > 0 ? `お支払い: ${yen(n.amount)}\n` : ''}${deadline}\n${manage}` }
      : { subject: `予約が入りました：${when}`, text: `${what}に予約が入りました。\n\n日時: ${when}\n${meet}` }
    case 'booking.rescheduled': return { subject: `日程が変わりました：${when}`, text: `${customer ? `${host}の` : ''}${what}の日程が変わりました。\n\n新しい日時: ${when}\n${meet}${customer ? manage : ''}` }
    case 'booking.cancelled': return customer
      ? { subject: `ご予約が取り消されました：${when}`, text: `${host}の${what}（${when}）のご予約は取り消されました。\n${Number(n.refund_amount) > 0 ? `\n${yen(n.refund_amount)}をお支払いのカードへ返金します。\n` : ''}${n.cancelled_by === 'system' ? '\nお支払いの間に日程が埋まったため、確保できませんでした。\n' : ''}` }
      : { subject: `予約が取り消されました：${when}`, text: `${what}（${when}）の予約が取り消されました。\n` }
    case 'booking.reminder': return { subject: `まもなくご予約の時間です：${when}`, text: `${host}の${what}のご予約のお知らせです。\n\n日時: ${when}\n${meet}${manage}` }
    case 'booking.payment_due': return { subject: `お支払いのお願い：${when}`, text: `${host}の${what}（${when}）は、お支払いで確定します。\n${n.hold_expires_at ? `お支払いの期限: ${bookingTimeLabel(new Date(n.hold_expires_at), new Date(n.hold_expires_at), n.time_zone).replace(/〜.*$/u, '')}\n` : ''}${manage}` }
    case 'booking.released': return customer
      ? { subject: `お支払いがなかったため、枠を解放しました：${when}`, text: `${host}の${what}（${when}）は、お支払いの期限を過ぎたため取り消しました。\n${manage}` }
      : { subject: `お支払いのない予約を解放しました：${when}`, text: `${what}（${when}）は、お支払いがなかったため解放しました。\n` }
    case 'booking.disputed': return n.dispute_state === 'won' || n.dispute_state === 'lost' || n.dispute_state === 'warning_closed' || n.dispute_state === 'prevented'
      ? { subject: `不審請求の申し立ての結果が出ました：${when}`, text: `${what}（${when}）のお支払いへの申し立ては、${n.dispute_state === 'won' ? '提供者の側の主張が認められました' : n.dispute_state === 'lost' ? 'カードの利用者の側の主張が認められました' : '終了しました'}。\n詳しくは Stripe のダッシュボードで確かめてください。\n` }
      : { subject: `お支払いに不審請求の申し立てがありました：${when}`, text: `${what}（${when}）のお支払いに、カードの利用者から申し立てがありました。\n${n.dispute_due_by ? `回答の期限: ${bookingTimeLabel(new Date(n.dispute_due_by), new Date(n.dispute_due_by), n.time_zone).replace(/〜.*$/u, '')}\n` : ''}Stripe のダッシュボードで、予約と実施の記録を証拠として出してください。予約の記録は予約の一覧で見られます。\n` }
    case 'booking.calendar_failed': return { subject: `カレンダーに予定を作れませんでした：${when}`, text: `${what}（${when}）の予約は確定していますが、Google カレンダーに予定を作れませんでした。カレンダーの接続を確かめてください。\n` }
    default: { throw new Error(`booking_notice_kind_unknown:${String(n.kind)}`) }
  }
}
