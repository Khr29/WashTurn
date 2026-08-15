import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/turn.dart';
import 'household_state.dart';
import 'providers.dart';

class HomeData {
  final Machine machine;
  final Turn turn;
  HomeData({required this.machine, required this.turn});
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
      final repo = ref.read(householdRepositoryProvider);
      final results = await Future.wait([repo.getMachine(householdId), repo.getTodayTurn(householdId)]);
      state = AsyncValue.data(HomeData(machine: results[0] as Machine, turn: results[1] as Turn));
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  /// Runs a turn action optimistically-safe: on ApiException (e.g. 409 because
  /// someone else already acted), just refreshes to show the real current
  /// state rather than surfacing a stale error the user can't act on.
  Future<String?> _runAction(Future<Turn> Function() action) async {
    try {
      await action();
      await refresh();
      return null;
    } on ApiException catch (e) {
      await refresh();
      return e.message;
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
    return _runAction(() => ref.read(turnRepositoryProvider).claim(turnId));
  }

  Future<String?> finish() {
    final turnId = state.value!.turn.id;
    return _runAction(() => ref.read(turnRepositoryProvider).finish(turnId));
  }
}

final homeProvider = StateNotifierProvider.autoDispose<HomeNotifier, AsyncValue<HomeData>>((ref) {
  final householdId = ref.watch(householdIdProvider).value;
  if (householdId == null) {
    throw StateError('homeProvider read before a household is selected');
  }
  return HomeNotifier(ref, householdId);
});
