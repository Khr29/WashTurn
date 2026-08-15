import '../models/user.dart';
import 'api_client.dart';

class AuthResult {
  final AppUser user;
  final String token;
  AuthResult({required this.user, required this.token});
}

class AuthRepository {
  final ApiClient client;
  AuthRepository(this.client);

  Future<AuthResult> register({required String name, required String email, required String password}) async {
    final json = await client.post('/auth/register', body: {
      'name': name,
      'email': email,
      'password': password,
    });
    return AuthResult(user: AppUser.fromJson(json['user']), token: json['token'] as String);
  }

  Future<AuthResult> login({required String email, required String password}) async {
    final json = await client.post('/auth/login', body: {'email': email, 'password': password});
    return AuthResult(user: AppUser.fromJson(json['user']), token: json['token'] as String);
  }

  Future<void> logout() => client.post('/auth/logout');

  Future<AppUser> me() async {
    final json = await client.get('/auth/me');
    return AppUser.fromJson(json['user']);
  }
}
