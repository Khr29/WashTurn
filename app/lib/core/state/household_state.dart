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
    // Explicit even though the constructor's super() call already starts in
    // this state — refresh() re-enters here later, when state may already be
    // AsyncData(null) from a previous clear(). Without resetting to loading
    // first, _AuthenticatedGate would flash onboarding for a frame before
    // this resolves.
    state = const AsyncValue.loading();
    final id = await ref.read(householdStoreProvider).read();
    if (id != null) {
      try {
        await ref.read(householdRepositoryProvider).get(id);
        state = AsyncValue.data(id);
        return;
      } on ApiException {
        // The household is gone, or this account isn't a member of it
        // anymore — drop the stale reference and fall through to the
        // server-side lookup below rather than assuming "no household".
        await ref.read(householdStoreProvider).clear();
      } catch (_) {
        // Network failure etc. — not evidence the household is actually
        // gone, so keep the cached id optimistically; the screens that
        // depend on it already have their own retry affordances.
        state = AsyncValue.data(id);
        return;
      }
    }

    // No usable local cache. Rather than assuming this account has no
    // household, ask the server directly — the cache is empty after any
    // logout/login on this device (by design, so a different account
    // signing in next doesn't inherit it), a reinstall, or a first login on
    // a new device, none of which mean the account actually left its
    // household. Without this, a returning user hits onboarding with no way
    // back in: re-"join"-ing their own household 409s as "already a member".
    try {
      final household = await ref.read(householdRepositoryProvider).getMine();
      if (household == null) {
        state = const AsyncValue.data(null);
      } else {
        await ref.read(householdStoreProvider).write(household.id);
        state = AsyncValue.data(household.id);
      }
    } catch (_) {
      state = const AsyncValue.data(null);
    }
  }

  // Public re-entry point for _load's logic, for callers outside this
  // notifier's own constructor. _load only ever runs once, at provider
  // construction (app cold-start) — this notifier is not autoDispose, so it
  // survives logout/login cycles within the same app run. Without calling
  // this after a fresh login/register, a returning user's household would
  // never be looked up again after their first logout: clear() below sets
  // state to null but nothing re-triggers the server-side lookup, so
  // _AuthenticatedGate would offer onboarding even though the account still
  // has a household server-side.
  Future<void> refresh() => _load();

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
