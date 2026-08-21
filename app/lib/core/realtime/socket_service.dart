import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../api/api_config.dart';
import '../state/household_state.dart';

/// A change notification from the backend's realtime.service.js. Sockets are
/// notify-only here — `data` is never trusted as the new state, it's just
/// enough to know something changed; every listener reacts by calling the
/// same REST-backed `refresh()` its screen already uses for pull-to-refresh.
/// `'resync'` is synthetic (not sent by the server): emitted locally whenever
/// the socket successfully (re)joins the household room, so a reconnect after
/// a drop always ends with every active screen catching up on whatever it
/// missed while disconnected.
class SocketEvent {
  final String name;
  final dynamic data;
  SocketEvent(this.name, this.data);
}

const _forwardedEvents = [
  'turn:updated',
  'turn_request:updated',
  'drying_request:updated',
  'household:updated',
  'activity:created',
];

/// Owns the app's single Socket.IO connection. Connect/disconnect is driven
/// externally by auth transitions (see auth_state.dart); household room
/// membership is driven by householdIdProvider (see the ref.listen below).
///
/// `household:removed` (this user was kicked out of their household) is
/// handled centrally here rather than by a screen — the same "one place
/// reacts to a signal every screen would otherwise have to check for"
/// approach ApiClient.onUnauthorized already uses for expired sessions.
class SocketService {
  final Ref ref;
  final _eventsController = StreamController<SocketEvent>.broadcast();
  io.Socket? _socket;
  String? _currentHouseholdId;
  bool _disposed = false;

  SocketService(this.ref) {
    ref.listen<AsyncValue<String?>>(householdIdProvider, (previous, next) {
      final householdId = next.value;
      if (householdId != null) {
        joinHousehold(householdId);
      } else {
        leaveHousehold();
      }
    }, fireImmediately: true);
  }

  Stream<SocketEvent> get events => _eventsController.stream;

  static String _originFromApiBaseUrl(String baseUrl) {
    final uri = Uri.parse(baseUrl);
    return Uri(scheme: uri.scheme, host: uri.host, port: uri.port).toString();
  }

  void connect(String token) {
    disconnect();
    if (_disposed) return;

    final socket = io.io(
      _originFromApiBaseUrl(ApiConfig.baseUrl),
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .enableReconnection()
          .build(),
    );
    _socket = socket;

    for (final event in _forwardedEvents) {
      socket.on(event, (data) => _eventsController.add(SocketEvent(event, data)));
    }
    socket.on('household:removed', (_) => ref.read(householdIdProvider.notifier).clear());

    socket.onConnect((_) {
      final householdId = _currentHouseholdId;
      if (householdId != null) _emitJoin(householdId);
    });
  }

  void _emitJoin(String householdId) {
    final socket = _socket;
    if (socket == null || !socket.connected) return;
    socket.emitWithAck(
      'household:join',
      householdId,
      ack: (dynamic response) {
        final ok = response is Map && response['ok'] == true;
        if (ok) _eventsController.add(SocketEvent('resync', null));
      },
    );
  }

  void joinHousehold(String householdId) {
    _currentHouseholdId = householdId;
    _emitJoin(householdId);
  }

  void leaveHousehold() {
    _currentHouseholdId = null;
    if (_socket?.connected == true) _socket!.emit('household:leave');
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }

  void dispose() {
    _disposed = true;
    disconnect();
    _eventsController.close();
  }
}

final socketServiceProvider = Provider<SocketService>((ref) {
  final service = SocketService(ref);
  ref.onDispose(service.dispose);
  return service;
});

/// Bumped on every `household:updated`/`resync` event. household_state.dart's
/// FutureProviders (household/schedule/members) `ref.watch` this purely to be
/// re-run when it changes — the value itself carries no meaning.
class HouseholdRevisionNotifier extends StateNotifier<int> {
  late final StreamSubscription<SocketEvent> _sub;

  HouseholdRevisionNotifier(Ref ref) : super(0) {
    _sub = ref.read(socketServiceProvider).events
        .where((e) => e.name == 'household:updated' || e.name == 'resync')
        .listen((_) => state++);
  }

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}

final householdRevisionProvider =
    StateNotifierProvider<HouseholdRevisionNotifier, int>((ref) => HouseholdRevisionNotifier(ref));
