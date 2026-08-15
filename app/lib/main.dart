import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    // Requires `flutterfire configure` to have generated firebase_options.dart
    // for this project (see app/README.md). Push notifications are best-effort
    // for v1 — the rest of the app must work without Firebase configured.
    await Firebase.initializeApp();
  } catch (_) {
    // Firebase not configured yet — continue without push notifications.
  }

  runApp(const ProviderScope(child: WashTurnApp()));
}
