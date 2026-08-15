const { getHouseholdDateParts } = require('../src/utils/dateHelpers');

describe('getHouseholdDateParts', () => {
  test('resolves the correct weekday and date for a household timezone', () => {
    // 2026-08-16 12:00 UTC is a Sunday.
    const when = new Date('2026-08-16T12:00:00Z');
    const result = getHouseholdDateParts('UTC', when);
    expect(result.dateString).toBe('2026-08-16');
    expect(result.dayOfWeek).toBe(0); // Sunday
  });

  test('the same instant can fall on a different calendar day in another timezone', () => {
    // 2026-08-17 01:00 UTC (Monday) is still 2026-08-16 18:00 (Sunday) in Los Angeles.
    const when = new Date('2026-08-17T01:00:00Z');

    const utc = getHouseholdDateParts('UTC', when);
    expect(utc.dateString).toBe('2026-08-17');
    expect(utc.dayOfWeek).toBe(1); // Monday

    const la = getHouseholdDateParts('America/Los_Angeles', when);
    expect(la.dateString).toBe('2026-08-16');
    expect(la.dayOfWeek).toBe(0); // Sunday
  });
});
