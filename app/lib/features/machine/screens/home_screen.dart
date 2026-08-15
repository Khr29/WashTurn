import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/household.dart';
import '../../../core/models/turn.dart';
import '../../../core/state/auth_state.dart';
import '../../../core/state/home_state.dart';
import '../../../core/state/household_state.dart';
import '../../../shared/widgets/async_view.dart';
import '../../../shared/widgets/status_badge.dart';

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
            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                _StatusCard(turn: data.turn, members: members, currentUserId: currentUserId),
                const SizedBox(height: 16),
                _ActionCard(turn: data.turn, currentUserId: currentUserId),
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

    final (label, color) = switch (turn.status) {
      TurnStatus.pending => ('Available', theme.colorScheme.primary),
      TurnStatus.released => ('Released — up for grabs', Colors.orange),
      TurnStatus.claimed => ('Claimed', Colors.orange),
      TurnStatus.inUse => ('In use', Colors.redAccent),
      TurnStatus.completed => ('Done for today', Colors.green),
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
            Text(_statusDetail(turn, members, currentUserId), style: theme.textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }

  String _statusDetail(Turn turn, List<HouseholdMemberProfile> members, String? currentUserId) {
    switch (turn.status) {
      case TurnStatus.pending:
        return "The machine is free for the scheduled person to use.";
      case TurnStatus.released:
        return "${_nameFor(turn.scheduledUserId, members, currentUserId)} released today's turn. Anyone can claim it for an emergency wash.";
      case TurnStatus.claimed:
        return "${_nameFor(turn.actingUserId ?? '', members, currentUserId)} claimed this turn.";
      case TurnStatus.inUse:
        final name = _nameFor(turn.actingUserId ?? '', members, currentUserId);
        final duration = turn.estimatedDurationMinutes;
        return duration != null ? '$name is washing (~$duration min).' : '$name is washing.';
      case TurnStatus.completed:
        return "${_nameFor(turn.actingUserId ?? turn.scheduledUserId, members, currentUserId)} finished washing.";
      case TurnStatus.expired:
        return "Nobody used the machine today.";
    }
  }
}

class _ActionCard extends ConsumerStatefulWidget {
  final Turn turn;
  final String? currentUserId;

  const _ActionCard({required this.turn, required this.currentUserId});

  @override
  ConsumerState<_ActionCard> createState() => _ActionCardState();
}

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
        onPressed: _busy ? null : () => _run(() => notifier.start()),
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
        onPressed: _busy ? null : () => _run(() => notifier.start()),
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
