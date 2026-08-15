class ScheduleDay {
  final int dayOfWeek; // 0 = Sunday ... 6 = Saturday (matches backend convention)
  final String userId;
  final String? startTime;
  final String? endTime;

  ScheduleDay({
    required this.dayOfWeek,
    required this.userId,
    this.startTime,
    this.endTime,
  });

  factory ScheduleDay.fromJson(Map<String, dynamic> json) => ScheduleDay(
        dayOfWeek: json['dayOfWeek'] as int,
        userId: json['userId'] as String,
        startTime: json['startTime'] as String?,
        endTime: json['endTime'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'dayOfWeek': dayOfWeek,
        'userId': userId,
        'startTime': startTime,
        'endTime': endTime,
      };

  ScheduleDay copyWith({String? userId, String? startTime, String? endTime}) => ScheduleDay(
        dayOfWeek: dayOfWeek,
        userId: userId ?? this.userId,
        startTime: startTime ?? this.startTime,
        endTime: endTime ?? this.endTime,
      );
}

class WeekSchedule {
  final String householdId;
  final List<ScheduleDay> days; // always length 7, sorted 0..6

  WeekSchedule({required this.householdId, required this.days});

  ScheduleDay forDay(int dayOfWeek) => days.firstWhere((d) => d.dayOfWeek == dayOfWeek);

  factory WeekSchedule.fromJson(Map<String, dynamic> json) {
    final days = (json['days'] as List<dynamic>)
        .map((d) => ScheduleDay.fromJson(d as Map<String, dynamic>))
        .toList()
      ..sort((a, b) => a.dayOfWeek.compareTo(b.dayOfWeek));
    return WeekSchedule(householdId: json['householdId'] as String, days: days);
  }
}
