import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/notifications/fcm_service.dart';
import '../api/api_exception.dart';
import '../models/user.dart';
import 'providers.dart';

sealed class AuthState {
  const AuthState();
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

class AuthUnauthenticated extends AuthState {
  final String? error;
  const AuthUnauthenticated({this.error});
}

class AuthAuthenticated extends AuthState {
  final AppUser user;
  const AuthAuthenticated(this.user);
}

class AuthNotifier extends StateNotifier<AuthState> {
  final Ref ref;
  AuthNotifier(this.ref) : super(const AuthLoading()) {
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    final token = await ref.read(tokenStoreProvider).read();
    if (token == null) {
      state = const AuthUnauthenticated();
      return;
    }
    try {
      final user = await ref.read(authRepositoryProvider).me();
      state = AuthAuthenticated(user);
    } on ApiException {
      // Token is invalid/expired server-side — discard it and require login
      // again. The cached household id goes with it: it's meaningless
      // without a session that can prove which account it belongs to, and
      // leaving it behind would let it get silently inherited by whichever
      // account logs in next on this device.
      await ref.read(tokenStoreProvider).clear();
      await ref.read(householdStoreProvider).clear();
      state = const AuthUnauthenticated();
    } catch (_) {
      // Network failure etc.: keep the token (it may still be valid) and let
      // the user retry from the login screen rather than getting stuck on a
      // splash screen forever.
      state = const AuthUnauthenticated(error: 'Could not reach the server. Check your connection and try again.');
    }
  }

  Future<void> register({required String name, required String email, required String password}) async {
    state = const AuthLoading();
    try {
      final result = await ref.read(authRepositoryProvider).register(name: name, email: email, password: password);
      await ref.read(tokenStoreProvider).write(result.token);
      state = AuthAuthenticated(result.user);
    } on ApiException catch (e) {
      state = AuthUnauthenticated(error: e.message);
    } catch (_) {
      state = const AuthUnauthenticated(error: 'Could not reach the server. Check your connection and try again.');
    }
  }

  Future<void> login({required String email, required String password}) async {
    state = const AuthLoading();
    try {
      final result = await ref.read(authRepositoryProvider).login(email: email, password: password);
      await ref.read(tokenStoreProvider).write(result.token);
      state = AuthAuthenticated(result.user);
    } on ApiException catch (e) {
      state = AuthUnauthenticated(error: e.message);
    } catch (_) {
      state = const AuthUnauthenticated(error: 'Could not reach the server. Check your connection and try again.');
    }
  }

  Future<void> logout() async {
    // Best-effort and must run before the token is cleared below (the
    // unregister call needs a still-valid JWT) — this device shouldn't keep
    // receiving push notifications for an account it's no longer signed
    // into, e.g. if someone else logs in on the same device afterward.
    try {
      await FcmService(ref).unregisterCurrentToken();
    } catch (_) {
      // Not fatal to logging out — a stale token left registered is a minor
      // annoyance, not a broken session.
    }

    try {
      await ref.read(authRepositoryProvider).logout();
    } on ApiException {
      // JWTs are stateless — even if this call fails, discarding the local
      // token below is sufficient to end the session on-device.
    }
    await ref.read(tokenStoreProvider).clear();
    await ref.read(householdStoreProvider).clear();
    state = const AuthUnauthenticated();
  }
}

final authStateProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) => AuthNotifier(ref));
