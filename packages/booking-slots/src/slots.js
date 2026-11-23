const MINUTE = 60_000, DAY = 86_400_000;
/** The offset (ms) of a time zone at an instant: local wall time minus UTC. */
export function zoneOffset(at, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at));
    const n = (type) => Number(parts.find(p => p.type === type)?.value);
    return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(at / 1000) * 1000;
}
/** The instant of a local wall time (YYYY-MM-DD, HH:MM) in a time zone. */
export function zonedInstant(date, time, timeZone) {
    const [y, m, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const wall = Date.UTC(y, m - 1, d, h, mi);
    const first = wall - zoneOffset(wall, timeZone);
    return wall - zoneOffset(first, timeZone);
}
/** The local calendar date (YYYY-MM-DD) of an instant. */
export function localDate(at, timeZone) {
    return new Date(at + zoneOffset(at, timeZone)).toISOString().slice(0, 10);
}
const nextDate = (date) => new Date(Date.parse(date + 'T00:00:00Z') + DAY).toISOString().slice(0, 10);
const isoWeekday = (date) => ((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];
/** The windows that apply on a local date: an exception for the date wins over the weekday. */
export function windowsOn(date, rules) {
    return rules.exceptions.find(e => e.date === date)?.hours ?? rules.weeklyHours[String(isoWeekday(date))] ?? [];
}
/**
 * Bookable starts (ISO) in [from, to). occupied are held/confirmed blocks (buffers included); busy are the host's calendar busy times.
 * A start is offered when its whole block (buffers included) is free of both.
 */
export function computeSlots(rules, input) {
    if (!Number.isSafeInteger(rules.startStepMinutes) || rules.startStepMinutes < 1 ||
        !Number.isSafeInteger(rules.durationMinutes) || rules.durationMinutes < 1) {
        throw new RangeError('Booking duration and step must be positive whole minutes');
    }
    const out = [];
    const earliest = Math.max(input.from, input.now + rules.minNoticeMinutes * MINUTE), latest = Math.min(input.to, input.now + rules.horizonDays * DAY);
    if (earliest >= latest)
        return out;
    const taken = [...input.occupied, ...input.busy];
    const step = rules.startStepMinutes * MINUTE, length = rules.durationMinutes * MINUTE;
    const lastDate = localDate(latest, rules.timeZone);
    for (let date = localDate(earliest, rules.timeZone), guard = 0; date <= lastDate && guard < 400; date = nextDate(date), guard++) {
        for (const [open, close] of windowsOn(date, rules)) {
            const start = zonedInstant(date, open, rules.timeZone);
            const end = close === '24:00' ? zonedInstant(nextDate(date), '00:00', rules.timeZone) : zonedInstant(date, close, rules.timeZone);
            for (let s = start; s + length <= end; s += step) {
                if (s < earliest || s >= latest)
                    continue;
                const block = [s - rules.bufferBeforeMinutes * MINUTE, s + length + rules.bufferAfterMinutes * MINUTE];
                if (!taken.some(t => overlaps(block, t)))
                    out.push(new Date(s).toISOString());
            }
        }
    }
    return out;
}
/** Busy blocks that are whole local days (all-day events). Dropped when the host does not count them as busy. */
export function withoutAllDay(busy, timeZone) {
    return busy.filter(([s, e]) => {
        if (e - s < DAY - 2 * 3600_000)
            return true;
        const date = localDate(s, timeZone);
        return !(zonedInstant(date, '00:00', timeZone) === s && localDate(e, timeZone) > date && zonedInstant(localDate(e, timeZone), '00:00', timeZone) === e);
    });
}
