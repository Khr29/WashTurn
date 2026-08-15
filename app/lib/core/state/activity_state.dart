import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/activity_entry.dart';
import 'household_state.dart';
import 'providers.dart';

class ActivityListState {
  final List<ActivityEntry> entries;
  final bool hasMore;
  final bool isLoadingMore;
  ActivityListState({required this.entries, required this.hasMore, this.isLoadingMore = false});

  ActivityListState copyWith({List<ActivityEntry>? entries, bool? hasMore, bool? isLoadingMore}) =>
      ActivityListState(
        entries: entries ?? this.entries,
        hasMore: hasMore ?? this.hasMore,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      );
}

class ActivityNotifier extends StateNotifier<AsyncValue<ActivityListState>> {
  final Ref ref;
  final String householdId;
  int _page = 1;

  ActivityNotifier(this.ref, this.householdId) : super(const AsyncValue.loading()) {
    refresh();
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    _page = 1;
    try {
      final result = await ref.read(householdRepositoryProvider).getActivity(householdId, page: _page);
      state = AsyncValue.data(ActivityListState(entries: result.entries, hasMore: result.hasMore));
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;

    state = AsyncValue.data(current.copyWith(isLoadingMore: true));
    final nextPage = _page + 1;
    final result = await ref.read(householdRepositoryProvider).getActivity(householdId, page: nextPage);
    _page = nextPage;
    state = AsyncValue.data(ActivityListState(
      entries: [...current.entries, ...result.entries],
      hasMore: result.hasMore,
    ));
  }
}

final activityProvider =
    StateNotifierProvider.autoDispose<ActivityNotifier, AsyncValue<ActivityListState>>((ref) {
  final householdId = ref.watch(householdIdProvider).value;
  if (householdId == null) {
    throw StateError('activityProvider read before a household is selected');
  }
  return ActivityNotifier(ref, householdId);
});
