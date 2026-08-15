import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/models/household.dart';
import '../../../core/models/schedule.dart';
import '../../../core/models/turn.dart';
import '../../../core/state/auth_state.dart';
import '../../../core/state/home_state.dart';
import '../../../core/state/household_state.dart';
import '../../../core/utils/schedule_utils.dart';
import '../../../shared/widgets/async_view.dart';
import '../../../shared/widgets/status_badge.dart';

const _dayNames = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

String _nameFor(String userId, List<HouseholdMemberProfile> members, String? currentUserId) {
  if (userId == currentUserId) return 'You';
  final match = members.where((m) => m.id == userId);
  return match.isEmpty ? 'Someone' : match.first.name;
}

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final homeState = ref.watch(homeProvider);
    final membersAsync = ref.watch(membersProvider);
    final scheduleAsync = ref.watch(scheduleProvider);
    final authState = ref.watch(authStateProvider);
    final currentUserId = authState is AuthAuthenticated ? authState.user.id : null;

    return Scaffold(
      appBar: AppBar(title: const Text('Home')),
      body: RefreshIndicator(
        onRefresh: () => ref.read(homeProvider.notifier).refresh(),
        child: AsyncView(
          value: homeState,
          onRetry: () => ref.read(homeProvider.notifier).refresh(),
          builder: (context, data) {
            final members = membersAsync.value ?? const <HouseholdMemberProfile>[];
            final schedule = scheduleAsync.value;
            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                _StatusCard(turn: data.turn, members: members, currentUserId: currentUserId),
                const SizedBox(height: 16),
                _ActionCard(turn: data.turn, currentUserId: currentUserId),
                if (schedule != null) ...[
                  const SizedBox(height: 16),
                  _UpcomingCard(
                    schedule: schedule,
                    todayDateString: data.turn.date,
                    members: members,
                    currentUserId: currentUserId,
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  final Turn turn;
  final List<HouseholdMemberProfile> members;
  final String? currentUserId;

  const _StatusCard({required this.turn, required this.members, required this.currentUserId});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheduledName = _nameFor(turn.scheduledUserId, members, currentUserId);
    final isScheduledUserMe = currentUserId != null && turn.scheduledUserId == currentUserId;
    final isEmergency = turn.isEmergency;

    final (label, color) = switch (turn.status) {
      TurnStatus.pending => isScheduledUserMe
          ? ('Your turn', theme.colorScheme.primary)
          : ('Available', theme.colorScheme.primary),
      TurnStatus.released => ('🚨 Released — up for grabs', Colors.orange),
      TurnStatus.claimed => ('Claimed', Colors.orange),
      TurnStatus.inUse =>
        isEmergency ? ('🚨 Emergency use', Colors.deepOrange) : ('Machine in use', Colors.redAccent),
      TurnStatus.completed => ('✓ Turn completed', Colors.green),
      TurnStatus.expired => ('Not used today', theme.colorScheme.onSurfaceVariant),
    };

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("Today's schedule", style: theme.textTheme.labelLarge),
            const SizedBox(height: 6),
            Text(scheduledName, style: theme.textTheme.headlineSmall),
            const SizedBox(height: 16),
            StatusBadge(label: label, color: color),
            const SizedBox(height: 12),
            Text(_statusDetail(turn, members, currentUserId, isScheduledUserMe), style: theme.textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }

  String _statusDetail(
    Turn turn,
    List<HouseholdMemberProfile> members,
    String? currentUserId,
    bool isScheduledUserMe,
  ) {
    switch (turn.status) {
      case TurnStatus.pending:
        if (isScheduledUserMe) return "It's your turn — start whenever you're ready.";
        final name = _nameFor(turn.scheduledUserId, members, currentUserId);
        return "$name's scheduled day. Waiting for $name.";
      case TurnStatus.released:
        final name = _nameFor(turn.scheduledUserId, members, currentUserId);
        return "$name doesn't need today's turn. Emergency use is available.";
      case TurnStatus.claimed:
        return "${_nameFor(turn.actingUserId ?? '', members, currentUserId)} claimed this turn.";
      case TurnStatus.inUse:
        final name = _nameFor(turn.actingUserId ?? '', members, currentUserId);
        return '$name is washing.${_timingDetail(turn)}';
      case TurnStatus.completed:
        return "Today's wash is finished. Machine available.";
      case TurnStatus.expired:
        return "Nobody used the machine today.";
    }
  }

  // "Started 7:15 PM · Estimated finish 8:00 PM" — computed from the
  // already-fetched startedAt/estimatedDurationMinutes, no separate backend
  // field needed since it's a pure function of data we already have.
  String _timingDetail(Turn turn) {
    final startedAt = turn.startedAt;
    if (startedAt == null) return '';

    final started = DateFormat.jm().format(startedAt.toLocal());
    final duration = turn.estimatedDurationMinutes;
    if (duration == null) return ' Started $started.';

    final estimatedFinish = DateFormat.jm().format(startedAt.add(Duration(minutes: duration)).toLocal());
    return ' Started $started · Estimated finish $estimatedFinish.';
  }
}

class _ActionCard extends ConsumerStatefulWidget {
  final Turn turn;
  final String? currentUserId;

  const _ActionCard({required this.turn, required this.currentUserId});

  @override
  ConsumerState<_ActionCard> createState() => _ActionCardState();
}

const _durationChoices = [30, 45, 60, 90];

class _ActionCardState extends ConsumerState<_ActionCard> {
  bool _busy = false;

  Future<void> _run(Future<String?> Function() action) async {
    setState(() => _busy = true);
    final error = await action();
    if (!mounted) return;
    setState(() => _busy = false);
    if (error != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
    }
  }

  Future<void> _startWithDurationPrompt() async {
    final minutes = await _pickDuration(context);
    if (minutes == null) return; // user cancelled
    final notifier = ref.read(homeProvider.notifier);
    await _run(() => notifier.start(estimatedDurationMinutes: minutes));
  }

  Future<int?> _pickDuration(BuildContext context) {
    return showModalBottomSheet<int>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text('How long do you expect to wash?', style: Theme.of(context).textTheme.titleMedium),
            ),
            for (final minutes in _durationChoices)
              ListTile(
                title: Text('$minutes minutes'),
                onTap: () => Navigator.of(context).pop(minutes),
              ),
            ListTile(
              title: const Text('Custom'),
              onTap: () async {
                final custom = await _promptCustomDuration(context);
                if (context.mounted) Navigator.of(context).pop(custom);
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<int?> _promptCustomDuration(BuildContext context) async {
    final controller = TextEditingController();
    return showDialog<int>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Custom duration'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: const InputDecoration(suffixText: 'minutes'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final value = int.tryParse(controller.text);
              Navigator.of(context).pop(value);
            },
            child: const Text('Start'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final turn = widget.turn;
    final userId = widget.currentUserId;
    final notifier = ref.read(homeProvider.notifier);

    Widget? primaryAction;
    Widget? secondaryAction;

    final isScheduledUser = userId != null && turn.scheduledUserId == userId;
    final isActingUser = userId != null && turn.actingUserId == userId;

    if (turn.status == TurnStatus.pending && isScheduledUser) {
      primaryAction = FilledButton.icon(
        onPressed: _busy ? null : _startWithDurationPrompt,
        icon: const Icon(Icons.play_arrow),
        label: const Text('Start washing'),
      );
      secondaryAction = OutlinedButton.icon(
        onPressed: _busy ? null : () => _run(() => notifier.release()),
        icon: const Icon(Icons.free_cancellation_outlined),
        label: const Text("Release today's turn"),
      );
    } else if (turn.status == TurnStatus.released) {
      primaryAction = FilledButton.icon(
        onPressed: _busy ? null : () => _run(() => notifier.claim()),
        icon: const Icon(Icons.bolt),
        label: const Text('Claim for emergency use'),
      );
    } else if (turn.status == TurnStatus.claimed && isActingUser) {
      primaryAction = FilledButton.icon(
        onPressed: _busy ? null : _startWithDurationPrompt,
        icon: const Icon(Icons.play_arrow),
        label: const Text('Start washing'),
      );
    } else if (turn.status == TurnStatus.inUse && isActingUser) {
      primaryAction = FilledButton.icon(
        onPressed: _busy ? null : () => _run(() => notifier.finish()),
        icon: const Icon(Icons.check),
        label: const Text('Finish washing'),
      );
    }

    if (primaryAction == null && secondaryAction == null) {
      return const SizedBox.shrink();
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (primaryAction != null) primaryAction,
            if (secondaryAction != null) ...[
              const SizedBox(height: 10),
              secondaryAction,
            ],
          ],
        ),
      ),
    );
  }
}

class _UpcomingCard extends StatelessWidget {
  final WeekSchedule schedule;
  final String todayDateString;
  final List<HouseholdMemberProfile> members;
  final String? currentUserId;

  const _UpcomingCard({
    required this.schedule,
    required this.todayDateString,
    required this.members,
    required this.currentUserId,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final next = nextScheduledDay(schedule, todayDateString);
    final name = _nameFor(next.entry.userId, members, currentUserId);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            Icon(Icons.event_outlined, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Next up: ${_dayNames[next.dayOfWeek]} — $name',
                style: theme.textTheme.bodyMedium,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
