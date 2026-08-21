enum TurnStatus { pending, released, claimed, inUse, completed, expired }

enum TurnType { normal, emergency }

TurnStatus _parseStatus(String s) => switch (s) {
      'PENDING' => TurnStatus.pending,
      'RELEASED' => TurnStatus.released,
      'CLAIMED' => TurnStatus.claimed,
      'IN_USE' => TurnStatus.inUse,
      'COMPLETED' => TurnStatus.completed,
      'EXPIRED' => TurnStatus.expired,
      _ => TurnStatus.pending,
    };

TurnType? _parseType(String? s) => switch (s) {
      'NORMAL' => TurnType.normal,
      'EMERGENCY' => TurnType.emergency,
      _ => null,
    };

class Turn {
  final String id;
  final String householdId;
  final String machineId;
  final String date;
  // The real instants this turn's owner has the machine for — the single
  // source of truth for "is this turn active right now" and for display; a
  // slot can cross midnight, so never assume endAt is on the same calendar
  // day as startAt (or that it's "end of day").
  final DateTime startAt;
  final DateTime endAt;
  final String scheduledUserId;
  final String? actingUserId;
  final TurnType? type;
  final TurnStatus status;
  final int? estimatedDurationMinutes;
  final DateTime? startedAt;
  final DateTime? finishedAt;
  final DateTime? releasedAt;

  Turn({
    required this.id,
    required this.householdId,
    required this.machineId,
    required this.date,
    required this.startAt,
    required this.endAt,
    required this.scheduledUserId,
    this.actingUserId,
    this.type,
    required this.status,
    this.estimatedDurationMinutes,
    this.startedAt,
    this.finishedAt,
    this.releasedAt,
  });

  bool get isEmergency => type == TurnType.emergency;

  /// Time left in this turn's slot, clamped to zero once endAt has passed
  /// (a stale/not-yet-refreshed turn should never show a negative duration).
  Duration remainingAt(DateTime now) {
    final remaining = endAt.difference(now);
    return remaining.isNegative ? Duration.zero : remaining;
  }

  factory Turn.fromJson(Map<String, dynamic> json) => Turn(
        id: json['_id'] as String,
        householdId: json['householdId'] as String,
        machineId: json['machineId'] as String,
        date: json['date'] as String,
        startAt: DateTime.parse(json['startAt'] as String),
        endAt: DateTime.parse(json['endAt'] as String),
        scheduledUserId: json['scheduledUserId'] as String,
        actingUserId: json['actingUserId'] as String?,
        type: _parseType(json['type'] as String?),
        status: _parseStatus(json['status'] as String),
        estimatedDurationMinutes: json['estimatedDurationMinutes'] as int?,
        startedAt: json['startedAt'] != null ? DateTime.parse(json['startedAt'] as String) : null,
        finishedAt: json['finishedAt'] != null ? DateTime.parse(json['finishedAt'] as String) : null,
        releasedAt: json['releasedAt'] != null ? DateTime.parse(json['releasedAt'] as String) : null,
      );
}

enum MachineStatus { available, inUse, released, completed }

MachineStatus _parseMachineStatus(String s) => switch (s) {
      'AVAILABLE' => MachineStatus.available,
      'IN_USE' => MachineStatus.inUse,
      'RELEASED' => MachineStatus.released,
      'COMPLETED' => MachineStatus.completed,
      _ => MachineStatus.available,
    };

class Machine {
  final String id;
  final String householdId;
  final MachineStatus status;
  final String? currentTurnId;

  Machine({required this.id, required this.householdId, required this.status, this.currentTurnId});

  factory Machine.fromJson(Map<String, dynamic> json) => Machine(
        id: json['_id'] as String,
        householdId: json['householdId'] as String,
        status: _parseMachineStatus(json['status'] as String),
        currentTurnId: json['currentTurnId'] as String?,
      );
}
