import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the JWT across app restarts. WashTurn uses a single long-lived
/// token with no refresh flow (see backend Decisions Needed) — logout is
/// simply discarding this value.
class TokenStore {
  static const _key = 'washturn_jwt';
  final _storage = const FlutterSecureStorage();

  Future<String?> read() => _storage.read(key: _key);

  Future<void> write(String token) => _storage.write(key: _key, value: token);

  Future<void> clear() => _storage.delete(key: _key);
}
