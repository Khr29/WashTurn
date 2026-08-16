import 'dart:io' show Platform;

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_globals.dart';
import '../../core/state/navigation_state.dart';
import '../../core/state/providers.dart';

/// Registers this device's FCM token with the backend so the household can
/// receive turn/schedule push notifications, and wires up foreground,
/// background-tap, and cold-start-tap handling. Call [init] once, after
/// login (registration is keyed to the signed-in user, not the household, so
/// it can run as soon as the user is authenticated).
///
/// Every WashTurn notification is about "what's happening with the machine
/// right now," so tapping any of them just brings the user to Home — no
/// per-category routing table needed.
final fcmServiceProvider = Provider<FcmService>((ref) => FcmService(ref));

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

    // Foreground: FCM does not auto-display a system notification while the
    // app is open, so show an in-app banner instead.
    FirebaseMessaging.onMessage.listen(_showForegroundBanner);

    // App was backgrounded (not terminated) and the user tapped the notification.
    FirebaseMessaging.onMessageOpenedApp.listen((_) => _goToHome());

    // App was terminated and launched by tapping the notification.
    final initialMessage = await messaging.getInitialMessage();
    if (initialMessage != null) _goToHome();
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

  void _goToHome() {
    ref.read(mainTabIndexProvider.notifier).state = 0;
  }

  void _showForegroundBanner(RemoteMessage message) {
    final title = message.notification?.title;
    final body = message.notification?.body;
    if (title == null && body == null) return;

    scaffoldMessengerKey.currentState?.showSnackBar(
      SnackBar(
        content: Text([title, body].where((s) => s != null && s.isNotEmpty).join(' — ')),
        action: SnackBarAction(label: 'View', onPressed: _goToHome),
      ),
    );
  }
}
