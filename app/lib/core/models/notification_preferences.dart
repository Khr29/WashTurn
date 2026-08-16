class NotificationPreferences {
  final bool turnToday;
  final bool turnTomorrow;
  final bool machineStarted;
  final bool machineFinished;
  final bool emergencyActivity;
  final bool turnRequests;

  const NotificationPreferences({
    required this.turnToday,
    required this.turnTomorrow,
    required this.machineStarted,
    required this.machineFinished,
    required this.emergencyActivity,
    required this.turnRequests,
  });

  factory NotificationPreferences.fromJson(Map<String, dynamic> json) => NotificationPreferences(
        turnToday: json['turnToday'] as bool? ?? true,
        turnTomorrow: json['turnTomorrow'] as bool? ?? true,
        machineStarted: json['machineStarted'] as bool? ?? true,
        machineFinished: json['machineFinished'] as bool? ?? true,
        emergencyActivity: json['emergencyActivity'] as bool? ?? true,
        turnRequests: json['turnRequests'] as bool? ?? true,
      );

  NotificationPreferences copyWith({
    bool? turnToday,
    bool? turnTomorrow,
    bool? machineStarted,
    bool? machineFinished,
    bool? emergencyActivity,
    bool? turnRequests,
  }) =>
      NotificationPreferences(
        turnToday: turnToday ?? this.turnToday,
        turnTomorrow: turnTomorrow ?? this.turnTomorrow,
        machineStarted: machineStarted ?? this.machineStarted,
        machineFinished: machineFinished ?? this.machineFinished,
        emergencyActivity: emergencyActivity ?? this.emergencyActivity,
        turnRequests: turnRequests ?? this.turnRequests,
      );
}
