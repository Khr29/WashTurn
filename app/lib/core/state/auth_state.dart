import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/notifications/fcm_service.dart';
import '../api/api_exception.dart';
import '../models/user.dart';
import 'household_state.dart';
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
      // account logs in next on this device. Going through the notifier
      // (rather than clearing householdStoreProvider directly) also resets
      // householdIdProvider's in-memory state — without that, a second
      // account signing in later in the same app session would still see
      // this account's household, even though the on-disk copy was cleared.
      await ref.read(tokenStoreProvider).clear();
      await ref.read(householdIdProvider.notifier).clear();
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
      // householdIdProvider's _load only runs once, at its own construction
      // — it doesn't automatically re-check on a fresh login within the same
      // app run, so without this a returning user (after an earlier logout
      // this session) would be stuck on onboarding even though clear() left
      // its state resolvable to null forever, not re-queried. See
      // HouseholdIdNotifier.refresh.
      unawaited(ref.read(householdIdProvider.notifier).refresh());
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
      // See the note in register() above — same reason this is needed here.
      unawaited(ref.read(householdIdProvider.notifier).refresh());
    } on ApiException catch (e) {
      state = AuthUnauthenticated(error: e.message);
    } catch (_) {
      state = const AuthUnauthenticated(error: 'Could not reach the server. Check your connection and try again.');
    }
  }

  /// Called when any API call comes back 401 while we believed the user was
  /// signed in — the token expired or was revoked server-side mid-session.
  /// Guarded to authenticated-only so it can't fire from a login/register
  /// screen's own failed-credentials 401 (state is AuthLoading there, not
  /// AuthAuthenticated) or interfere with an already-logged-out session.
  Future<void> sessionExpired() async {
    if (state is! AuthAuthenticated) return;
    await ref.read(tokenStoreProvider).clear();
    // Via the notifier, not householdStoreProvider directly, so the in-memory
    // householdIdProvider state is reset too (see the note in
    // _restoreSession's catch block above).
    await ref.read(householdIdProvider.notifier).clear();
    state = const AuthUnauthenticated(error: 'Your session has expired. Please log in again.');
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
    // Via the notifier, not householdStoreProvider directly — see the note in
    // _restoreSession's catch block above.
    await ref.read(householdIdProvider.notifier).clear();
    state = const AuthUnauthenticated();
  }
}

final authStateProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) => AuthNotifier(ref));
