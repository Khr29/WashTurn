import 'api_client.dart';

class NotificationRepository {
  final ApiClient client;
  NotificationRepository(this.client);

  Future<void> registerToken(String token, String platform) =>
      client.post('/notifications/register-token', body: {'token': token, 'platform': platform});

  Future<void> unregisterToken(String token) =>
      client.delete('/notifications/register-token', body: {'token': token});
}
