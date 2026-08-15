import '../models/activity_entry.dart';
import '../models/household.dart';
import '../models/schedule.dart';
import '../models/turn.dart';
import 'api_client.dart';

class HouseholdRepository {
  final ApiClient client;
  HouseholdRepository(this.client);

  Future<Household> create({required String name, String? timezone}) async {
    final json = await client.post('/households', body: {
      'name': name,
      if (timezone != null) 'timezone': timezone,
    });
    return Household.fromJson(json['household']);
  }

  Future<Household> join(String inviteCode) async {
    final json = await client.post('/households/join', body: {'inviteCode': inviteCode});
    return Household.fromJson(json['household']);
  }

  Future<Household> get(String householdId) async {
    final json = await client.get('/households/$householdId');
    return Household.fromJson(json['household']);
  }

  Future<List<HouseholdMemberProfile>> getMembers(String householdId) async {
    final json = await client.get('/households/$householdId/members');
    return (json['members'] as List<dynamic>)
        .map((m) => HouseholdMemberProfile.fromJson(m as Map<String, dynamic>))
        .toList();
  }

  Future<void> removeMember(String householdId, String userId) =>
      client.patch('/households/$householdId/members/$userId');

  Future<WeekSchedule> getSchedule(String householdId) async {
    final json = await client.get('/households/$householdId/schedule');
    return WeekSchedule.fromJson(json['schedule']);
  }

  Future<WeekSchedule> updateSchedule(String householdId, List<ScheduleDay> days) async {
    final json = await client.put('/households/$householdId/schedule', body: {
      'days': days.map((d) => d.toJson()).toList(),
    });
    return WeekSchedule.fromJson(json['schedule']);
  }

  Future<Machine> getMachine(String householdId) async {
    final json = await client.get('/households/$householdId/machine');
    return Machine.fromJson(json['machine']);
  }

  Future<Turn> getTodayTurn(String householdId) async {
    final json = await client.get('/households/$householdId/turns/today');
    return Turn.fromJson(json['turn']);
  }

  Future<ActivityPage> getActivity(String householdId, {int page = 1}) async {
    final json = await client.get(
      '/households/$householdId/activity',
      query: {'page': '$page'},
    );
    return ActivityPage.fromJson(json as Map<String, dynamic>);
  }
}
