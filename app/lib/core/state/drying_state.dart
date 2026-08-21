import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/drying_request.dart';
import '../realtime/socket_service.dart';
import 'household_state.dart';
import 'providers.dart';

class DryingData {
  final List<DryingRequest> incoming; // PENDING, I'm the helper
  final List<DryingRequest> tasks; // ACCEPTED, I'm the helper
  final List<DryingRequest> outgoing; // my still-active (PENDING/ACCEPTED) requests
  final List<DryingFavorBalance> balances;

  DryingData({required this.incoming, required this.tasks, required this.outgoing, required this.balances});
}

/// Deliberately its own provider rather than folded into HomeData — drying is
/// a separate responsibility from the machine/turn lifecycle (see the
/// backend's drying.service.js) and must keep working, and refreshing, on its
/// own regardless of what the machine is doing.
class DryingNotifier extends StateNotifier<AsyncValue<DryingData>> {
  final Ref ref;
  final String householdId;
  late final StreamSubscription<SocketEvent> _socketSub;

  DryingNotifier(this.ref, this.householdId) : super(const AsyncValue.loading()) {
    refresh();
    // A drying_request:updated on any transition (created/accepted/rejected/
    // cancelled/completed) can change all four lists here, including the
    // favor balances (derived from COMPLETED requests) — simplest correct
    // reaction is to refetch the whole slice, same as pull-to-refresh does.
    _socketSub = ref.read(socketServiceProvider).events
        .where((e) => e.name == 'drying_request:updated' || e.name == 'resync')
        .listen((_) => refresh());
  }

  @override
  void dispose() {
    _socketSub.cancel();
    super.dispose();
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    try {
      final repo = ref.read(dryingRepositoryProvider);
      final results = await Future.wait([
        repo.list(householdId, scope: 'incoming'),
        repo.list(householdId, scope: 'tasks'),
        repo.list(householdId, scope: 'outgoing'),
        repo.balances(householdId),
      ]);
      final outgoing = (results[2] as List<DryingRequest>).where((r) => r.isPending || r.isAccepted).toList();
      state = AsyncValue.data(DryingData(
        incoming: results[0] as List<DryingRequest>,
        tasks: results[1] as List<DryingRequest>,
        outgoing: outgoing,
        balances: results[3] as List<DryingFavorBalance>,
      ));
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  /// Same optimistic-safe pattern as HomeNotifier._runAction: on failure
  /// (including a lost race, e.g. someone else already accepted/completed
  /// the task), refresh from the backend rather than trusting local state.
  Future<String?> _runAction<T>(Future<T> Function() action, {String? conflictMessage}) async {
    try {
      await action();
      await refresh();
      return null;
    } on ApiException catch (e) {
      await refresh();
      return (conflictMessage != null && e.isConflict) ? conflictMessage : e.message;
    } catch (_) {
      await refresh();
      return 'Could not reach the server. Check your connection and try again.';
    }
  }

  Future<String?> requestDrying(String helperId, {String? turnId}) {
    return _runAction(
      () => ref.read(dryingRepositoryProvider).create(householdId, helperId, turnId: turnId),
      conflictMessage: 'You already have an active drying request with them for this.',
    );
  }

  Future<String?> accept(String requestId) {
    return _runAction(
      () => ref.read(dryingRepositoryProvider).accept(requestId),
      conflictMessage: 'This request is no longer available.',
    );
  }

  Future<String?> reject(String requestId) {
    return _runAction(() => ref.read(dryingRepositoryProvider).reject(requestId));
  }

  Future<String?> cancel(String requestId) {
    return _runAction(() => ref.read(dryingRepositoryProvider).cancel(requestId));
  }

  Future<String?> complete(String requestId) {
    return _runAction(
      () => ref.read(dryingRepositoryProvider).complete(requestId),
      conflictMessage: 'This task is no longer available to complete.',
    );
  }
}

final dryingProvider = StateNotifierProvider.autoDispose<DryingNotifier, AsyncValue<DryingData>>((ref) {
  final householdId = ref.watch(householdIdProvider).value;
  if (householdId == null) {
    throw StateError('dryingProvider read before a household is selected');
  }
  return DryingNotifier(ref, householdId);
});
