import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/state/auth_state.dart';
import 'core/state/household_state.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/household/screens/household_onboarding_screen.dart';
import 'features/notifications/fcm_service.dart';
import 'shared/widgets/main_shell.dart';

class WashTurnApp extends ConsumerWidget {
  const WashTurnApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'WashTurn',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.system,
      home: const _RootGate(),
    );
  }
}

class _RootGate extends ConsumerStatefulWidget {
  const _RootGate();

  @override
  ConsumerState<_RootGate> createState() => _RootGateState();
}

class _RootGateState extends ConsumerState<_RootGate> {
  bool _fcmInitialized = false;

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authStateProvider);

    return switch (authState) {
      AuthLoading() => const _Splash(),
      AuthUnauthenticated() => const LoginScreen(),
      AuthAuthenticated() => _AuthenticatedGate(onReady: _initFcmOnce),
    };
  }

  void _initFcmOnce() {
    if (_fcmInitialized) return;
    _fcmInitialized = true;
    // Push notifications require Firebase to be configured for this project
    // (see app/README) — failures here shouldn't block the rest of the app.
    FcmService(ref).init().catchError((_) {});
  }
}

class _AuthenticatedGate extends ConsumerWidget {
  final VoidCallback onReady;
  const _AuthenticatedGate({required this.onReady});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final householdIdAsync = ref.watch(householdIdProvider);

    return householdIdAsync.when(
      loading: () => const _Splash(),
      error: (err, st) => const _Splash(),
      data: (householdId) {
        WidgetsBinding.instance.addPostFrameCallback((_) => onReady());
        if (householdId == null) return const HouseholdOnboardingScreen();
        return const MainShell();
      },
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
