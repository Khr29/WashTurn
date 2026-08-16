enum TurnRequestStatus { pending, accepted, rejected, cancelled }

TurnRequestStatus _parseRequestStatus(String s) => switch (s) {
      'PENDING' => TurnRequestStatus.pending,
      'ACCEPTED' => TurnRequestStatus.accepted,
      'REJECTED' => TurnRequestStatus.rejected,
      'CANCELLED' => TurnRequestStatus.cancelled,
      _ => TurnRequestStatus.pending,
    };

class TurnRequest {
  final String id;
  final String turnId;
  final String requesterId;
  final TurnRequestStatus status;
  final DateTime createdAt;

  TurnRequest({
    required this.id,
    required this.turnId,
    required this.requesterId,
    required this.status,
    required this.createdAt,
  });

  bool get isPending => status == TurnRequestStatus.pending;

  factory TurnRequest.fromJson(Map<String, dynamic> json) => TurnRequest(
        id: json['_id'] as String,
        turnId: json['turnId'] as String,
        requesterId: json['requesterId'] as String,
        status: _parseRequestStatus(json['status'] as String),
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}
