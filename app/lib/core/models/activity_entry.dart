class ActivityEntry {
  final String id;
  final String turnId;
  final String type;
  final String summary;
  final String? userName;
  final DateTime timestamp;

  ActivityEntry({
    required this.id,
    required this.turnId,
    required this.type,
    required this.summary,
    this.userName,
    required this.timestamp,
  });

  factory ActivityEntry.fromJson(Map<String, dynamic> json) => ActivityEntry(
        id: json['id'] as String,
        turnId: json['turnId'] as String,
        type: json['type'] as String,
        summary: json['summary'] as String,
        userName: json['user'] != null ? (json['user']['name'] as String?) : null,
        timestamp: DateTime.parse(json['timestamp'] as String),
      );
}

class ActivityPage {
  final List<ActivityEntry> entries;
  final int page;
  final bool hasMore;

  ActivityPage({required this.entries, required this.page, required this.hasMore});

  factory ActivityPage.fromJson(Map<String, dynamic> json) => ActivityPage(
        entries: (json['entries'] as List<dynamic>)
            .map((e) => ActivityEntry.fromJson(e as Map<String, dynamic>))
            .toList(),
        page: json['page'] as int,
        hasMore: json['hasMore'] as bool,
      );
}
