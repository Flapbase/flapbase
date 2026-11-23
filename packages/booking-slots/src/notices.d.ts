export type BookingNoticeKind = 'booking.series_stopped' | 'booking.confirmed' | 'booking.cancelled' | 'booking.rescheduled' | 'booking.reminder' | 'booking.payment_due' | 'booking.released' | 'booking.calendar_failed' | 'booking.disputed' | 'booking.trial_follow_up' | 'booking.after_session' | 'booking.review_submitted' | 'booking.review_returned' | 'booking.review_due'
export type BookingNotice = { notice_id: string; kind: BookingNoticeKind; recipient_kind: 'customer' | 'host'; recipient: string | null; booking_id: string; status: string
  starts_at: Date; ends_at: Date; time_zone: string; offer_title: string; host_name: string; product_key: string; meet_url: string | null; amount: string | number
  nextOfferUrl?: string | null; reviewDueAt?: string | null;
  refund_amount: string | number; cancel_deadline: Date; hold_expires_at: Date | null; cancelled_by: string | null; dispute_state?: string | null; dispute_due_by?: Date | null }
export declare function bookingTimeLabel(start: Date, end: Date, timeZone: string): string;
export declare function bookingMailText(n: BookingNotice, myUrl: string | null): { subject: string; text: string };
