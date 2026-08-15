import '../models/schedule.dart';

/// Backend dayOfWeek convention: 0 = Sunday ... 6 = Saturday (matches JS
/// Date#getDay()). `dateString` is a "YYYY-MM-DD" calendar date with no time
/// component, so DateTime.parse resolves it to that literal date at local
/// midnight — .weekday is then a pure function of the calendar date and is
/// NOT affected by the device's timezone.
int dayOfWeekFromDateString(String dateString) {
  final date = DateTime.parse(dateString);
  return date.weekday % 7; // Dart weekday: Mon=1..Sun=7 -> 0=Sun..6=Sat
}

/// The day after `todayDateString` in the fixed weekly rotation. Since the
/// backend guarantees every day 0-6 has an assignment, this always resolves.
///
/// `todayDateString` must be the household-local "today" as returned by the
/// backend (Turn.date) — never the device's local date — so this stays
/// consistent with the backend's notion of "today" for this household.
({int dayOfWeek, ScheduleDay entry}) nextScheduledDay(WeekSchedule schedule, String todayDateString) {
  final todayDow = dayOfWeekFromDateString(todayDateString);
  final nextDow = (todayDow + 1) % 7;
  return (dayOfWeek: nextDow, entry: schedule.forDay(nextDow));
}
