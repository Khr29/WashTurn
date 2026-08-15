class HouseholdMember {
  final String userId;
  final DateTime joinedAt;

  HouseholdMember({required this.userId, required this.joinedAt});

  factory HouseholdMember.fromJson(Map<String, dynamic> json) => HouseholdMember(
        userId: json['userId'] as String,
        joinedAt: DateTime.parse(json['joinedAt'] as String),
      );
}

class Household {
  final String id;
  final String name;
  final String inviteCode;
  final String ownerId;
  final String timezone;
  final List<HouseholdMember> members;

  Household({
    required this.id,
    required this.name,
    required this.inviteCode,
    required this.ownerId,
    required this.timezone,
    required this.members,
  });

  bool isOwner(String userId) => ownerId == userId;

  factory Household.fromJson(Map<String, dynamic> json) => Household(
        id: json['_id'] as String,
        name: json['name'] as String,
        inviteCode: json['inviteCode'] as String,
        ownerId: json['ownerId'] as String,
        timezone: json['timezone'] as String,
        members: (json['members'] as List<dynamic>? ?? [])
            .map((m) => HouseholdMember.fromJson(m as Map<String, dynamic>))
            .toList(),
      );
}

/// A member entry enriched with name/email, as returned by GET /members.
class HouseholdMemberProfile {
  final String id;
  final String name;
  final String email;
  final DateTime joinedAt;
  final bool isOwner;

  HouseholdMemberProfile({
    required this.id,
    required this.name,
    required this.email,
    required this.joinedAt,
    required this.isOwner,
  });

  factory HouseholdMemberProfile.fromJson(Map<String, dynamic> json) => HouseholdMemberProfile(
        id: json['id'] as String,
        name: json['name'] as String? ?? 'Unknown',
        email: json['email'] as String? ?? '',
        joinedAt: DateTime.parse(json['joinedAt'] as String),
        isOwner: json['isOwner'] as bool,
      );
}
