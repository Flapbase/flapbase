# Booking availability

`computeSlots(rules, { from, to, now, occupied, busy })` returns ISO timestamps in `[from, to)`. The caller supplies business hours in the host's time zone, date exceptions, duration, step, notice, buffers and calendar busy periods. `windowsOn` and `zonedInstant` also support fixed-date schedules and class calendars.

予約とイベントで使う空き枠候補の計算です。確定と二重予約防止は、保存先が最新の占有状況と定員をトランザクション内で照合して行います。カレンダーAPIやCloudアカウントは計算に不要です。
