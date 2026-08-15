import 'dart:io' show Platform;

/// Base URL for the WashTurn API.
///
/// - Android emulator routes host-loopback through 10.0.2.2, not localhost.
/// - iOS simulator and desktop can reach the host machine via localhost directly.
/// - A real device needs the host machine's LAN IP — override via
///   `--dart-define=API_BASE_URL=http://192.168.x.x:4000/api` when running/building.
class ApiConfig {
  static String get baseUrl {
    const override = String.fromEnvironment('API_BASE_URL');
    if (override.isNotEmpty) return override;

    if (Platform.isAndroid) return 'http://10.0.2.2:4000/api';
    return 'http://localhost:4000/api';
  }
}
