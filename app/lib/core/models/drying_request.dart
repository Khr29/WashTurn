enum DryingRequestStatus { pending, accepted, rejected, cancelled, completed }

DryingRequestStatus _parseDryingStatus(String s) => switch (s) {
      'PENDING' => DryingRequestStatus.pending,
      'ACCEPTED' => DryingRequestStatus.accepted,
      'REJECTED' => DryingRequestStatus.rejected,
      'CANCELLED' => DryingRequestStatus.cancelled,
      'COMPLETED' => DryingRequestStatus.completed,
      _ => DryingRequestStatus.pending,
    };

class DryingRequest {
  final String id;
  final String householdId;
  final String? turnId;
  final String requesterId; // clothes owner
  final String helperId; // asked to dry them
  final DryingRequestStatus status;
  final DateTime createdAt;
  final DateTime? acceptedAt;
  final DateTime? completedAt;
  final DateTime? rejectedAt;
  final DateTime? cancelledAt;

  DryingRequest({
    required this.id,
    required this.householdId,
    this.turnId,
    required this.requesterId,
    required this.helperId,
    required this.status,
    required this.createdAt,
    this.acceptedAt,
    this.completedAt,
    this.rejectedAt,
    this.cancelledAt,
  });

  bool get isPending => status == DryingRequestStatus.pending;
  bool get isAccepted => status == DryingRequestStatus.accepted;

  factory DryingRequest.fromJson(Map<String, dynamic> json) => DryingRequest(
        id: json['_id'] as String,
        householdId: json['householdId'] as String,
        turnId: json['turnId'] as String?,
        requesterId: json['requesterId'] as String,
        helperId: json['helperId'] as String,
        status: _parseDryingStatus(json['status'] as String),
        createdAt: DateTime.parse(json['createdAt'] as String),
        acceptedAt: json['acceptedAt'] != null ? DateTime.parse(json['acceptedAt'] as String) : null,
        completedAt: json['completedAt'] != null ? DateTime.parse(json['completedAt'] as String) : null,
        rejectedAt: json['rejectedAt'] != null ? DateTime.parse(json['rejectedAt'] as String) : null,
        cancelledAt: json['cancelledAt'] != null ? DateTime.parse(json['cancelledAt'] as String) : null,
      );
}

/// A directional drying-favor balance between the current user and one other
/// household member. Never both nonzero at once — see server drying.service.js.
class DryingFavorBalance {
  final String userId;
  final int youOwe;
  final int owesYou;

  DryingFavorBalance({required this.userId, required this.youOwe, required this.owesYou});

  factory DryingFavorBalance.fromJson(Map<String, dynamic> json) => DryingFavorBalance(
        userId: json['userId'] as String,
        youOwe: json['youOwe'] as int,
        owesYou: json['owesYou'] as int,
      );
}
