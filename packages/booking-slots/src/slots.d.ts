/**
 * 予約の空き（2026-11-03 Owner）: 行を先に作らず、受付の宣言・確保・Google の busy から毎回計算する。
 * DB の platform.booking_slot_allowed と同じ決まり（提供者の地域の壁時計の時間帯、時間帯の始まりからの刻み、直前の締切、先の上限）。
 * 確定は DB がもう一度確かめるので、ここは見せる候補を出すだけ。
 */
export type Window = readonly [string, string];
export type WeeklyHours = Readonly<Record<string, readonly Window[]>>;
export type HoursException = Readonly<{
    date: string;
    hours: readonly Window[];
}>;
export type Interval = readonly [number, number];
export type SlotRules = Readonly<{
    timeZone: string;
    weeklyHours: WeeklyHours;
    exceptions: readonly HoursException[];
    durationMinutes: number;
    startStepMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    minNoticeMinutes: number;
    horizonDays: number;
}>;
/** The offset (ms) of a time zone at an instant: local wall time minus UTC. */
export declare function zoneOffset(at: number, timeZone: string): number;
/** The instant of a local wall time (YYYY-MM-DD, HH:MM) in a time zone. */
export declare function zonedInstant(date: string, time: string, timeZone: string): number;
/** The local calendar date (YYYY-MM-DD) of an instant. */
export declare function localDate(at: number, timeZone: string): string;
/** The windows that apply on a local date: an exception for the date wins over the weekday. */
export declare function windowsOn(date: string, rules: Pick<SlotRules, 'weeklyHours' | 'exceptions'>): readonly Window[];
/**
 * Bookable starts (ISO) in [from, to). occupied are held/confirmed blocks (buffers included); busy are the host's calendar busy times.
 * A start is offered when its whole block (buffers included) is free of both.
 */
export declare function computeSlots(rules: SlotRules, input: Readonly<{
    from: number;
    to: number;
    now: number;
    occupied: readonly Interval[];
    busy: readonly Interval[];
}>): string[];
/** Busy blocks that are whole local days (all-day events). Dropped when the host does not count them as busy. */
export declare function withoutAllDay(busy: readonly Interval[], timeZone: string): Interval[];
