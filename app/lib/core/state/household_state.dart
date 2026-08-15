import 'package:flutter_riverpod/flutter_riverpod.dart';

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

  Future<void> _load() async {
    final id = await ref.read(householdStoreProvider).read();
    state = AsyncValue.data(id);
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
