import 'package:flutter_riverpod/flutter_riverpod.dart';

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
      await ref.read(tokenStoreProvider).clear();
      state = const AuthUnauthenticated();
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
    }
  }

  Future<void> logout() async {
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
