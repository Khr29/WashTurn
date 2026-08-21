import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/app_globals.dart';
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
      scaffoldMessengerKey: scaffoldMessengerKey,
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
  // Tracks *which* user FCM was last initialized for, not just whether it
  // ever ran — a bare bool would leave a second, different account's push
  // registration never sent if they log in later in the same app session
  // (e.g. after the first account logs out), since AuthNotifier.logout only
  // unregisters the outgoing account's token and never re-triggers this.
  String? _fcmInitializedForUserId;

  @override
  Widget build(BuildContext context) {
    // _RootGate is the base route of the app's single Navigator; screens like
    // RegisterScreen and ProfileScreen are pushed on top of it. Rebuilding
    // this widget (e.g. to swap LoginScreen for MainShell) does NOT by itself
    // pop those routes — without this, a successful registration or a logout
    // triggered from a pushed screen leaves that screen stuck on top,
    // covering the new content underneath it. Popping back to the root route
    // on every authenticated<->unauthenticated transition keeps whatever
    // _RootGate now renders actually visible.
    ref.listen<AuthState>(authStateProvider, (previous, next) {
      final wasAuthenticated = previous is AuthAuthenticated;
      final isAuthenticated = next is AuthAuthenticated;
      if (wasAuthenticated != isAuthenticated) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    });
    final authState = ref.watch(authStateProvider);

    return switch (authState) {
      AuthLoading() => const _Splash(),
      AuthUnauthenticated() => const LoginScreen(),
      AuthAuthenticated() => _AuthenticatedGate(onReady: () => _initFcmForUser(authState.user.id)),
    };
  }

  void _initFcmForUser(String userId) {
    if (_fcmInitializedForUserId == userId) return;
    _fcmInitializedForUserId = userId;
    // Push notifications require Firebase to be configured for this project
    // (see app/README) — failures here shouldn't block the rest of the app.
    ref.read(fcmServiceProvider).init().catchError((_) {});
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
