import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/models/activity_entry.dart';
import '../../../core/state/activity_state.dart';
import '../../../shared/widgets/async_view.dart';
import '../../../shared/widgets/empty_state.dart';

const _icons = {
  'RELEASED': Icons.free_cancellation_outlined,
  'CLAIMED': Icons.bolt,
  'STARTED': Icons.play_arrow,
  'COMPLETED': Icons.check_circle_outline,
  'EXPIRED': Icons.timer_off_outlined,
};

class ActivityScreen extends ConsumerWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activityAsync = ref.watch(activityProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Activity')),
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

          return RefreshIndicator(
            onRefresh: () => ref.read(activityProvider.notifier).refresh(),
            child: NotificationListener<ScrollNotification>(
              onNotification: (notification) {
                if (notification.metrics.pixels >= notification.metrics.maxScrollExtent - 200) {
                  ref.read(activityProvider.notifier).loadMore();
                }
                return false;
              },
              child: ListView.separated(
                padding: const EdgeInsets.all(20),
                itemCount: list.entries.length + (list.hasMore ? 1 : 0),
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  if (index >= list.entries.length) {
                    return const Padding(
                      padding: EdgeInsets.symmetric(vertical: 16),
                      child: Center(child: CircularProgressIndicator()),
                    );
                  }
                  return _ActivityTile(entry: list.entries[index]);
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
        subtitle: Text(
          '${entry.userName ?? 'Someone'} · ${DateFormat.MMMd().add_jm().format(entry.timestamp.toLocal())}',
        ),
      ),
    );
  }
}
