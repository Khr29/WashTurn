// Day-of-week convention used throughout the backend: 0 = Sunday ... 6 = Saturday
// (matches JS Date#getDay()), even though the product spec lists days Mon-Sun.

function getHouseholdDateParts(timezone, when = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(when).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);

  return {
    dateString: `${parts.year}-${parts.month}-${parts.day}`, // household-local calendar date
    dayOfWeek: weekdayIndex,
  };
}

function getHouseholdHour(timezone, when = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(formatter.format(when), 10) % 24;
}

// The offset (in minutes, UTC - zoned) in effect for `timezone` at the instant
// `when`. Used to convert a household-local wall-clock time into the correct
// UTC instant, DST included: formatting `when` through the target zone and
// diffing against its own UTC representation gives exactly the offset that
// was in effect at that instant, which is what a wall-clock time near it
// should use. This is a day-scale approximation (fine for our purposes — the
// only caller passes a `when` within the same day as the wall time being
// converted) rather than an exact answer for a moment that falls inside a DST
// transition itself.
function offsetMinutesAt(timezone, when) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(when).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  // "24" for midnight under hour12:false in some ICU versions — normalize.
  const hour = parts.hour === '24' ? 0 : parseInt(parts.hour, 10);
  const asIfUtc = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    hour,
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10)
  );
  return Math.round((asIfUtc - when.getTime()) / 60000);
}

// Converts a household-local calendar date + "HH:mm" wall-clock time into the
// real UTC instant it refers to. `dateString` is "YYYY-MM-DD"; `timeString` is
// "HH:mm" (24-hour). Anchors the offset lookup near the target instant itself
// (via a UTC-naive guess) so DST is resolved correctly for that date rather
// than for "now".
function zonedTimeToUtc(dateString, timeString, timezone) {
  const [year, month, day] = dateString.split('-').map(Number);
  const [hour, minute] = timeString.split(':').map(Number);
  const naiveUtcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMinutes = offsetMinutesAt(timezone, naiveUtcGuess);
  return new Date(naiveUtcGuess.getTime() - offsetMinutes * 60000);
}

// "YYYY-MM-DD" arithmetic that never touches wall-clock/timezone — pure
// calendar-date offsetting, used to step to the previous/next day when
// resolving which schedule slot is active around a midnight boundary.
function addDaysToDateString(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// dayOfWeek (0=Sun..6=Sat) for a bare "YYYY-MM-DD" calendar date — pure
// calendar-date math, deliberately timezone-independent (the date string is
// already household-local; re-deriving via a timezone-aware formatter here
// would just risk shifting it by a day near a DST boundary).
function dayOfWeekFromDateString(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

module.exports = {
  getHouseholdDateParts,
  getHouseholdHour,
  zonedTimeToUtc,
  addDaysToDateString,
  dayOfWeekFromDateString,
};
