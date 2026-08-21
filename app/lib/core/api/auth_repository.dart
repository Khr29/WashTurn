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

  /// Validates the current token the same way [me] does, but also reissues a
  /// fresh one — this is what session restore calls so an active user's
  /// token keeps sliding forward and effectively never expires, without
  /// the backend having to hand out a long-lived token up front.
  Future<AuthResult> refresh() async {
    final json = await client.post('/auth/refresh');
    return AuthResult(user: AppUser.fromJson(json['user']), token: json['token'] as String);
  }
}
