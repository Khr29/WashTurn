// Verifies the persistent-login feature's behavior end-to-end through the real
// AuthNotifier/HouseholdIdNotifier logic — no widget tree needed, just a
// ProviderContainer with the storage/network boundaries faked out. Storage
// fakes subclass the real (concrete, non-abstract) TokenStore/HouseholdStore
// and override their methods, so flutter_secure_storage's platform channel
// is never touched — no plugin mocking required, and the app's actual
// restore/renew/discard logic runs unmodified.
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:washturn/core/api/api_client.dart';
import 'package:washturn/core/api/household_store.dart';
import 'package:washturn/core/api/token_store.dart';
import 'package:washturn/core/realtime/socket_service.dart';
import 'package:washturn/core/state/auth_state.dart';
import 'package:washturn/core/state/providers.dart';

class FakeTokenStore extends TokenStore {
  String? token;
  FakeTokenStore([this.token]);

  @override
  Future<String?> read() async => token;

  @override
  Future<void> write(String value) async => token = value;

  @override
  Future<void> clear() async => token = null;
}

class FakeHouseholdStore extends HouseholdStore {
  String? id;
  FakeHouseholdStore([this.id]);

  @override
  Future<String?> read() async => id;

  @override
  Future<void> write(String householdId) async => id = householdId;

  @override
  Future<void> clear() async => id = null;
}

/// Never opens a real socket — session-restore tests care about auth state,
/// not realtime connectivity, and a real SocketService would try to reach
/// the network during the test.
class FakeSocketService extends SocketService {
  int connectCalls = 0;
  FakeSocketService(super.ref);

  @override
  void connect(String token) => connectCalls++;

  @override
  void disconnect() {}
}

/// Waits for AuthNotifier's async _restoreSession() to leave AuthLoading.
Future<AuthState> _settle(ProviderContainer container) async {
  for (var i = 0; i < 200; i++) {
    final state = container.read(authStateProvider);
    if (state is! AuthLoading) return state;
    await Future.delayed(const Duration(milliseconds: 5));
  }
  throw StateError('authStateProvider never left AuthLoading');
}

void main() {
  group('session restore (TODO #3 persistent login)', () {
    test('a valid stored token restores AuthAuthenticated and renews the token via /auth/refresh', () async {
      final tokenStore = FakeTokenStore('old-token-from-previous-launch');
      final householdStore = FakeHouseholdStore(null);

      final mockHttp = MockClient((request) async {
        if (request.method == 'POST' && request.url.path.endsWith('/auth/refresh')) {
          expect(request.headers['Authorization'], 'Bearer old-token-from-previous-launch');
          return http.Response(
            jsonEncode({
              'user': {'id': 'u1', 'name': 'Restored User', 'email': 'restored@test.com'},
              'token': 'freshly-renewed-token',
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (request.url.path.endsWith('/households/mine')) {
          return http.Response(jsonEncode({'household': null}), 200, headers: {'content-type': 'application/json'});
        }
        fail('Unexpected request in this test: ${request.method} ${request.url}');
      });

      final container = ProviderContainer(overrides: [
        tokenStoreProvider.overrideWithValue(tokenStore),
        householdStoreProvider.overrideWithValue(householdStore),
        apiClientProvider.overrideWithValue(
          ApiClient(tokenStore: tokenStore, httpClient: mockHttp, onUnauthorized: () {}),
        ),
        socketServiceProvider.overrideWith((ref) => FakeSocketService(ref)),
      ]);
      addTearDown(container.dispose);

      final state = await _settle(container);

      expect(state, isA<AuthAuthenticated>());
      expect((state as AuthAuthenticated).user.email, 'restored@test.com');
      // The renewed token (not the old one) is what got persisted back to
      // storage — this is the "renew when appropriate" half of persistent login.
      expect(tokenStore.token, 'freshly-renewed-token');
      // Socket.IO reconnected using the (renewed) session, not left stale.
      expect((container.read(socketServiceProvider) as FakeSocketService).connectCalls, 1);
    });

    test('no stored token goes straight to AuthUnauthenticated without any network call', () async {
      final tokenStore = FakeTokenStore(null);
      final mockHttp = MockClient((request) async => fail('No request should be made when there is no token'));

      final container = ProviderContainer(overrides: [
        tokenStoreProvider.overrideWithValue(tokenStore),
        apiClientProvider.overrideWithValue(
          ApiClient(tokenStore: tokenStore, httpClient: mockHttp, onUnauthorized: () {}),
        ),
        socketServiceProvider.overrideWith((ref) => FakeSocketService(ref)),
      ]);
      addTearDown(container.dispose);

      final state = await _settle(container);
      expect(state, isA<AuthUnauthenticated>());
    });

    test('an invalid/expired token is discarded (not kept) and the session cannot be restored', () async {
      final tokenStore = FakeTokenStore('a-token-that-expired-while-the-app-was-closed');
      final householdStore = FakeHouseholdStore('some-stale-household-id');

      final mockHttp = MockClient((request) async {
        return http.Response(
          jsonEncode({'error': 'Invalid or expired token.'}),
          401,
          headers: {'content-type': 'application/json'},
        );
      });

      final container = ProviderContainer(overrides: [
        tokenStoreProvider.overrideWithValue(tokenStore),
        householdStoreProvider.overrideWithValue(householdStore),
        apiClientProvider.overrideWithValue(
          ApiClient(tokenStore: tokenStore, httpClient: mockHttp, onUnauthorized: () {}),
        ),
        socketServiceProvider.overrideWith((ref) => FakeSocketService(ref)),
      ]);
      addTearDown(container.dispose);

      final state = await _settle(container);

      expect(state, isA<AuthUnauthenticated>());
      // The stale token and stale household id must both be gone — otherwise
      // a *different* account logging in next on this device could silently
      // inherit them.
      expect(tokenStore.token, isNull);
      expect(householdStore.id, isNull);
      expect((container.read(socketServiceProvider) as FakeSocketService).connectCalls, 0);
    });

    test('a network failure during restore keeps the token instead of logging the user out', () async {
      final tokenStore = FakeTokenStore('a-token-that-is-probably-still-valid');
      final mockHttp = MockClient((request) async => throw const SocketExceptionStub());

      final container = ProviderContainer(overrides: [
        tokenStoreProvider.overrideWithValue(tokenStore),
        apiClientProvider.overrideWithValue(
          ApiClient(tokenStore: tokenStore, httpClient: mockHttp, onUnauthorized: () {}),
        ),
        socketServiceProvider.overrideWith((ref) => FakeSocketService(ref)),
      ]);
      addTearDown(container.dispose);

      final state = await _settle(container);

      expect(state, isA<AuthUnauthenticated>());
      expect((state as AuthUnauthenticated).error, contains('Could not reach the server'));
      // Unlike the invalid-token case, the token must NOT be discarded here
      // — it may well still be valid once connectivity comes back.
      expect(tokenStore.token, 'a-token-that-is-probably-still-valid');
    });
  });
}

/// A minimal stand-in for a real network failure (e.g. SocketException) —
/// anything that isn't an ApiException, so it exercises AuthNotifier's
/// generic catch-all branch.
class SocketExceptionStub implements Exception {
  const SocketExceptionStub();
}
