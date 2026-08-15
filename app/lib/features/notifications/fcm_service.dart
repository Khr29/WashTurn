import 'dart:io' show Platform;

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/state/providers.dart';

/// Registers this device's FCM token with the backend so the household can
/// receive turn/schedule push notifications. Call [init] once, after login,
/// once a household exists (registration is keyed to the signed-in user, not
/// the household, so it can run as soon as the user is authenticated).
class FcmService {
  final Ref ref;
  FcmService(this.ref);

  Future<void> init() async {
    final messaging = FirebaseMessaging.instance;

    final settings = await messaging.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) return;

    final token = await messaging.getToken();
    if (token != null) {
      await _register(token);
    }

    messaging.onTokenRefresh.listen(_register);
  }

  Future<void> _register(String token) async {
    final platform = Platform.isIOS ? 'ios' : 'android';
    await ref.read(notificationRepositoryProvider).registerToken(token, platform);
  }

  Future<void> unregisterCurrentToken() async {
    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) {
      await ref.read(notificationRepositoryProvider).unregisterToken(token);
    }
  }
}
