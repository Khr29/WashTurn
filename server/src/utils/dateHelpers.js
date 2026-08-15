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

module.exports = { getHouseholdDateParts, getHouseholdHour };
