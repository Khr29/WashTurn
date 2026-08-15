import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// WashTurn v1 assumes a user belongs to a single household — there is no
/// "list my households" endpoint, so the app remembers the active household
/// id locally once the user creates or joins one.
class HouseholdStore {
  static const _key = 'washturn_household_id';
  final _storage = const FlutterSecureStorage();

  Future<String?> read() => _storage.read(key: _key);

  Future<void> write(String householdId) => _storage.write(key: _key, value: householdId);

  Future<void> clear() => _storage.delete(key: _key);
}
