import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/models/activity_entry.dart';
import '../../../core/state/activity_state.dart';
import '../../../shared/widgets/async_view.dart';
import '../../../shared/widgets/empty_state.dart';
import '../../../shared/widgets/profile_avatar_action.dart';
import '../../../shared/widgets/section_header.dart';

const _icons = {
  'RELEASED': Icons.free_cancellation_outlined,
  'CLAIMED': Icons.bolt,
  'STARTED': Icons.play_arrow,
  'COMPLETED': Icons.check_circle_outline,
  'EXPIRED': Icons.timer_off_outlined,
  'TRANSFERRED': Icons.card_giftcard_outlined,
};

sealed class _ActivityListItem {}

class _DateHeaderItem extends _ActivityListItem {
  final String label;
  _DateHeaderItem(this.label);
}

class _EntryItem extends _ActivityListItem {
  final ActivityEntry entry;
  _EntryItem(this.entry);
}

String _dayLabelFor(DateTime timestamp) {
  final local = timestamp.toLocal();
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final date = DateTime(local.year, local.month, local.day);
  final diff = today.difference(date).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  return DateFormat.MMMd().format(local);
}

// Entries already arrive newest-first from the backend, so consecutive
// same-day entries are already adjacent — a single pass is enough to insert
// "Today" / "Yesterday" / "Aug 14" separators between day groups.
List<_ActivityListItem> _groupByDay(List<ActivityEntry> entries) {
  final items = <_ActivityListItem>[];
  String? lastLabel;
  for (final entry in entries) {
    final label = _dayLabelFor(entry.timestamp);
    if (label != lastLabel) {
      items.add(_DateHeaderItem(label));
      lastLabel = label;
    }
    items.add(_EntryItem(entry));
  }
  return items;
}

class ActivityScreen extends ConsumerWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activityAsync = ref.watch(activityProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Activity'), actions: const [ProfileAvatarAction()]),
      body: AsyncView(
        value: activityAsync,
        onRetry: () => ref.read(activityProvider.notifier).refresh(),
        builder: (context, list) {
          if (list.entries.isEmpty) {
            return const EmptyState(
              icon: Icons.history,
              title: 'No activity yet',
              subtitle: 'Washes, releases, and emergency claims will show up here.',
            );
          }

          final items = _groupByDay(list.entries);

          return RefreshIndicator(
            onRefresh: () => ref.read(activityProvider.notifier).refresh(),
            child: NotificationListener<ScrollNotification>(
              onNotification: (notification) {
                if (notification.metrics.pixels >= notification.metrics.maxScrollExtent - 200) {
                  ref.read(activityProvider.notifier).loadMore();
                }
                return false;
              },
              child: ListView.builder(
                padding: const EdgeInsets.all(20),
                itemCount: items.length + (list.hasMore ? 1 : 0),
                itemBuilder: (context, index) {
                  if (index >= items.length) {
                    return const Padding(
                      padding: EdgeInsets.symmetric(vertical: 16),
                      child: Center(child: CircularProgressIndicator()),
                    );
                  }
                  final item = items[index];
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: switch (item) {
                      _DateHeaderItem() => Padding(
                          padding: EdgeInsets.only(top: index == 0 ? 0 : 8, bottom: 2),
                          child: SectionHeader(title: item.label),
                        ),
                      _EntryItem() => _ActivityTile(entry: item.entry),
                    },
                  );
                },
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  final ActivityEntry entry;
  const _ActivityTile({required this.entry});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: CircleAvatar(
          backgroundColor: theme.colorScheme.primaryContainer,
          child: Icon(_icons[entry.type] ?? Icons.info_outline, color: theme.colorScheme.onPrimaryContainer),
        ),
        title: Text(entry.summary),
        subtitle: Text('${entry.userName ?? 'Someone'} · ${DateFormat.jm().format(entry.timestamp.toLocal())}'),
      ),
    );
  }
}
