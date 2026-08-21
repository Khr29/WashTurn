import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kReleaseMode;

/// Base URL for the WashTurn API.
///
/// Dev and production are deliberately different code paths, not just
/// different values of the same one, so a debug build can never accidentally
/// ship pointed at the local dev backend (and vice versa):
///
/// - Debug/profile (`flutter run`, `flutter build ... --debug/--profile`):
///   defaults to the local dev backend, same as always.
///     - Android emulator routes host-loopback through 10.0.2.2, not localhost.
///     - iOS simulator and desktop reach the host machine via localhost directly.
///     - A real device needs the host machine's LAN IP — override via
///       `--dart-define=API_BASE_URL=http://192.168.x.x:4000/api`.
/// - Release (`flutter build apk/ipa --release`, the default build mode):
///   defaults to [_productionBaseUrl] — no flag needed, so a release build
///   can't accidentally ship pointed at localhost just because someone
///   forgot a dart-define.
///
/// `--dart-define=API_BASE_URL=...` overrides either default, in either
/// mode — useful for e.g. a release build against a staging backend.
class ApiConfig {
  // Filled in once the production backend is deployed (see README's
  // "Deploying to production"). Never a secret — it's a public HTTPS URL —
  // just needs to exist before cutting a real release build.
  static const _productionBaseUrl = 'https://REPLACE_WITH_PRODUCTION_URL/api';

  static String get baseUrl {
    const override = String.fromEnvironment('API_BASE_URL');
    if (override.isNotEmpty) return override;

    if (kReleaseMode) return _productionBaseUrl;

    if (Platform.isAndroid) return 'http://10.0.2.2:4000/api';
    return 'http://localhost:4000/api';
  }
}
