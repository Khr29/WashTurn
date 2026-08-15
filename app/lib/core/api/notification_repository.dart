import '../models/notification_preferences.dart';
import 'api_client.dart';

class NotificationRepository {
  final ApiClient client;
  NotificationRepository(this.client);

  Future<void> registerToken(String token, String platform) =>
      client.post('/notifications/register-token', body: {'token': token, 'platform': platform});

  Future<void> unregisterToken(String token) =>
      client.delete('/notifications/register-token', body: {'token': token});

  Future<NotificationPreferences> getPreferences() async {
    final json = await client.get('/notifications/preferences');
    return NotificationPreferences.fromJson(json['preferences']);
  }

  Future<NotificationPreferences> updatePreferences(Map<String, bool> updates) async {
    final json = await client.patch('/notifications/preferences', body: updates);
    return NotificationPreferences.fromJson(json['preferences']);
  }
}
