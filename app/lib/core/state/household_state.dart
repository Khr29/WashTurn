import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/household.dart';
import '../models/schedule.dart';
import 'providers.dart';

/// Tracks the id of the household the signed-in user belongs to. WashTurn v1
/// assumes a single household per user (see HouseholdStore).
class HouseholdIdNotifier extends StateNotifier<AsyncValue<String?>> {
  final Ref ref;
  HouseholdIdNotifier(this.ref) : super(const AsyncValue.loading()) {
    _load();
  }

  // The cached id on disk can outlive its household: it survives a token
  // becoming invalid (only the token is cleared on restore, see
  // AuthNotifier._restoreSession), and it isn't reset by login()/register(),
  // so a different account signing in on the same device would otherwise
  // inherit whatever household the previous session left behind. Confirming
  // the id still resolves for *this* account before trusting it is what
  // catches all of those cases in one place, instead of every downstream
  // screen independently discovering "Household not found."
  Future<void> _load() async {
    final id = await ref.read(householdStoreProvider).read();
    if (id == null) {
      state = const AsyncValue.data(null);
      return;
    }
    try {
      await ref.read(householdRepositoryProvider).get(id);
      state = AsyncValue.data(id);
    } on ApiException {
      // The household is gone, or this account isn't a member of it anymore
      // — drop the stale reference so onboarding is offered instead of a
      // screen that can never load.
      await ref.read(householdStoreProvider).clear();
      state = const AsyncValue.data(null);
    } catch (_) {
      // Network failure etc. — not evidence the household is actually gone,
      // so keep the cached id optimistically; the screens that depend on it
      // already have their own retry affordances.
      state = AsyncValue.data(id);
    }
  }

  Future<void> set(String householdId) async {
    await ref.read(householdStoreProvider).write(householdId);
    state = AsyncValue.data(householdId);
  }

  Future<void> clear() async {
    await ref.read(householdStoreProvider).clear();
    state = const AsyncValue.data(null);
  }
}

final householdIdProvider =
    StateNotifierProvider<HouseholdIdNotifier, AsyncValue<String?>>((ref) => HouseholdIdNotifier(ref));

final householdProvider = FutureProvider.autoDispose<Household?>((ref) async {
  final id = ref.watch(householdIdProvider).value;
  if (id == null) return null;
  return ref.watch(householdRepositoryProvider).get(id);
});

final scheduleProvider = FutureProvider.autoDispose<WeekSchedule?>((ref) async {
  final id = ref.watch(householdIdProvider).value;
  if (id == null) return null;
  return ref.watch(householdRepositoryProvider).getSchedule(id);
});

final membersProvider = FutureProvider.autoDispose<List<HouseholdMemberProfile>>((ref) async {
  final id = ref.watch(householdIdProvider).value;
  if (id == null) return [];
  return ref.watch(householdRepositoryProvider).getMembers(id);
});
