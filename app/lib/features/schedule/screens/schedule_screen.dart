import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/household.dart';
import '../../../core/models/schedule.dart';
import '../../../core/state/auth_state.dart';
import '../../../core/state/household_state.dart';
import '../../../core/state/providers.dart';
import '../../../shared/widgets/async_view.dart';

const _dayNames = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

// Displayed Monday-first per product spec, even though the backend's
// dayOfWeek values follow the 0=Sunday..6=Saturday JS convention.
const _displayOrder = [1, 2, 3, 4, 5, 6, 0];

class ScheduleScreen extends ConsumerWidget {
  const ScheduleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheduleAsync = ref.watch(scheduleProvider);
    final householdAsync = ref.watch(householdProvider);
    final membersAsync = ref.watch(membersProvider);
    final authState = ref.watch(authStateProvider);
    final currentUserId = authState is AuthAuthenticated ? authState.user.id : null;
    final todayDayOfWeek = DateTime.now().weekday % 7;

    return Scaffold(
      appBar: AppBar(title: const Text('Schedule')),
      body: AsyncView(
        value: scheduleAsync,
        onRetry: () => ref.invalidate(scheduleProvider),
        builder: (context, schedule) {
          if (schedule == null) return const SizedBox.shrink();
          final household = householdAsync.value;
          final members = membersAsync.value ?? const <HouseholdMemberProfile>[];
          final isOwner = household != null && currentUserId != null && household.isOwner(currentUserId);

          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(scheduleProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(20),
              itemCount: _displayOrder.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final dayOfWeek = _displayOrder[index];
                final entry = schedule.forDay(dayOfWeek);
                final isToday = dayOfWeek == todayDayOfWeek;
                final matchingMembers = members.where((m) => m.id == entry.userId);
                final memberName = matchingMembers.isEmpty ? 'Unassigned' : matchingMembers.first.name;

                return _DayTile(
                  dayLabel: _dayNames[dayOfWeek]!,
                  memberName: memberName,
                  timeRange: (entry.startTime != null && entry.endTime != null)
                      ? '${entry.startTime} – ${entry.endTime}'
                      : null,
                  isToday: isToday,
                  onTap: isOwner
                      ? () => _editDay(context, ref, schedule, entry, members)
                      : null,
                );
              },
            ),
          );
        },
      ),
    );
  }

  Future<void> _editDay(
    BuildContext context,
    WidgetRef ref,
    WeekSchedule schedule,
    ScheduleDay entry,
    List<HouseholdMemberProfile> members,
  ) async {
    final selectedUserId = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text('Assign ${_dayNames[entry.dayOfWeek]}', style: Theme.of(context).textTheme.titleMedium),
            ),
            for (final member in members)
              ListTile(
                title: Text(member.name),
                trailing: member.id == entry.userId ? const Icon(Icons.check) : null,
                onTap: () => Navigator.of(context).pop(member.id),
              ),
          ],
        ),
      ),
    );

    if (selectedUserId == null || selectedUserId == entry.userId) return;

    final updatedDays = schedule.days
        .map((d) => d.dayOfWeek == entry.dayOfWeek ? d.copyWith(userId: selectedUserId) : d)
        .toList();

    final householdId = ref.read(householdIdProvider).value;
    if (householdId == null) return;
    await ref.read(householdRepositoryProvider).updateSchedule(householdId, updatedDays);
    ref.invalidate(scheduleProvider);
  }
}

class _DayTile extends StatelessWidget {
  final String dayLabel;
  final String memberName;
  final String? timeRange;
  final bool isToday;
  final VoidCallback? onTap;

  const _DayTile({
    required this.dayLabel,
    required this.memberName,
    required this.timeRange,
    required this.isToday,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      color: isToday ? theme.colorScheme.primaryContainer : theme.cardTheme.color,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Row(
            children: [
              SizedBox(
                width: 96,
                child: Text(
                  dayLabel,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: isToday ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(memberName, style: theme.textTheme.bodyLarge),
                    if (timeRange != null)
                      Text(timeRange!, style: theme.textTheme.bodySmall),
                  ],
                ),
              ),
              if (onTap != null) const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
