import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';

// Must be a top-level (or static) function — firebase_messaging runs it in a
// separate isolate when a data message arrives while the app is backgrounded
// or terminated. WashTurn doesn't need custom background processing (FCM
// already displays the system notification from the `notification` payload
// on its own); this only exists because the plugin requires a handler to be
// registered for background messages to be handled consistently at all.
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    // Requires `flutterfire configure` to have generated firebase_options.dart
    // for this project (see app/README.md). Push notifications are best-effort
    // for v1 — the rest of the app must work without Firebase configured.
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
  } catch (_) {
    // Firebase not configured yet — continue without push notifications.
  }

  runApp(const ProviderScope(child: WashTurnApp()));
}
