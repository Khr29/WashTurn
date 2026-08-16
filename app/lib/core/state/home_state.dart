import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/turn.dart';
import '../models/turn_request.dart';
import 'household_state.dart';
import 'providers.dart';

class HomeData {
  final Machine machine;
  final Turn turn;
  final List<TurnRequest> requests;
  HomeData({required this.machine, required this.turn, required this.requests});
}

class HomeNotifier extends StateNotifier<AsyncValue<HomeData>> {
  final Ref ref;
  final String householdId;

  HomeNotifier(this.ref, this.householdId) : super(const AsyncValue.loading()) {
    refresh();
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    try {
      final householdRepo = ref.read(householdRepositoryProvider);
      final results = await Future.wait([householdRepo.getMachine(householdId), householdRepo.getTodayTurn(householdId)]);
      final machine = results[0] as Machine;
      final turn = results[1] as Turn;
      final requests = await ref.read(turnRepositoryProvider).getRequests(turn.id);
      state = AsyncValue.data(HomeData(machine: machine, turn: turn, requests: requests));
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  /// Runs a turn action optimistically-safe: on ApiException (e.g. 409 because
  /// someone else already acted), just refreshes to show the real current
  /// state rather than surfacing a stale error the user can't act on.
  ///
  /// [conflictMessage] overrides the raw backend text for a 409 specifically
  /// — used by [claim] so a lost emergency-claim race reads as a friendly
  /// "someone beat you to it" rather than the backend's generic conflict
  /// wording (which is accurate but written for any 409, not this one).
  Future<String?> _runAction<T>(Future<T> Function() action, {String? conflictMessage}) async {
    try {
      await action();
      await refresh();
      return null;
    } on ApiException catch (e) {
      await refresh();
      return (conflictMessage != null && e.isConflict) ? conflictMessage : e.message;
    } catch (_) {
      // Network failure etc. — the action may or may not have gone through
      // server-side, so refresh to reflect whatever the real state is.
      await refresh();
      return 'Could not reach the server. Check your connection and try again.';
    }
  }

  Future<String?> start({int? estimatedDurationMinutes}) {
    final turnId = state.value!.turn.id;
    return _runAction(
        () => ref.read(turnRepositoryProvider).start(turnId, estimatedDurationMinutes: estimatedDurationMinutes));
  }

  Future<String?> release() {
    final turnId = state.value!.turn.id;
    return _runAction(() => ref.read(turnRepositoryProvider).release(turnId));
  }

  Future<String?> claim() {
    final turnId = state.value!.turn.id;
    return _runAction(
      () => ref.read(turnRepositoryProvider).claim(turnId),
      conflictMessage: 'Someone else claimed the machine first.',
    );
  }

  Future<String?> finish() {
    final turnId = state.value!.turn.id;
    return _runAction(() => ref.read(turnRepositoryProvider).finish(turnId));
  }

  Future<String?> transfer(String toUserId) {
    final turnId = state.value!.turn.id;
    return _runAction(() => ref.read(turnRepositoryProvider).transfer(turnId, toUserId));
  }

  Future<String?> requestTurn() {
    final turnId = state.value!.turn.id;
    return _runAction(() => ref.read(turnRepositoryProvider).requestTurn(turnId));
  }

  Future<String?> acceptRequest(String requestId) {
    final turnId = state.value!.turn.id;
    return _runAction(
      () => ref.read(turnRepositoryProvider).acceptRequest(turnId, requestId),
      conflictMessage: 'This request is no longer available to accept.',
    );
  }

  Future<String?> rejectRequest(String requestId) {
    final turnId = state.value!.turn.id;
    return _runAction(() => ref.read(turnRepositoryProvider).rejectRequest(turnId, requestId));
  }

  Future<String?> cancelRequest(String requestId) {
    final turnId = state.value!.turn.id;
    return _runAction(() => ref.read(turnRepositoryProvider).cancelRequest(turnId, requestId));
  }
}

final homeProvider = StateNotifierProvider.autoDispose<HomeNotifier, AsyncValue<HomeData>>((ref) {
  final householdId = ref.watch(householdIdProvider).value;
  if (householdId == null) {
    throw StateError('homeProvider read before a household is selected');
  }
  return HomeNotifier(ref, householdId);
});
