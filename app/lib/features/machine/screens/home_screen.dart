import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/models/drying_request.dart';
import '../../../core/models/household.dart';
import '../../../core/models/schedule.dart';
import '../../../core/models/turn.dart';
import '../../../core/models/turn_request.dart';
import '../../../core/state/auth_state.dart';
import '../../../core/state/drying_state.dart';
import '../../../core/state/home_state.dart';
import '../../../core/state/household_state.dart';
import '../../../core/utils/schedule_utils.dart';
import '../../../shared/widgets/async_view.dart';
import '../../../shared/widgets/confirm_sheet.dart';
import '../../../shared/widgets/member_avatar.dart';
import '../../../shared/widgets/section_header.dart';
import '../../profile/screens/profile_screen.dart';

bool _isTerminal(TurnStatus status) => status == TurnStatus.completed || status == TurnStatus.expired;

const _dayNames = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

const _durationChoices = [30, 45, 60, 90];

String _nameFor(String userId, List<HouseholdMemberProfile> members, String? currentUserId) {
  if (userId == currentUserId) return 'You';
  final match = members.where((m) => m.id == userId);
  return match.isEmpty ? 'Someone' : match.first.name;
}

/// A member-picker bottom sheet whose list scrolls once it outgrows the
/// available height, so a household with many members doesn't overflow a
/// fixed-size, non-scrolling sheet.
Future<String?> _pickMemberSheet(
  BuildContext context, {
  required String title,
  required List<HouseholdMemberProfile> members,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    builder: (context) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(title, style: Theme.of(context).textTheme.titleMedium),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final member in members)
                    ListTile(
                      leading: MemberAvatar(name: member.name, radius: 16),
                      title: Text(member.name),
                      onTap: () => Navigator.of(context).pop(member.id),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final homeState = ref.watch(homeProvider);
    final dryingState = ref.watch(dryingProvider);
    final membersAsync = ref.watch(membersProvider);
    final scheduleAsync = ref.watch(scheduleProvider);
    final authState = ref.watch(authStateProvider);
    final currentUserId = authState is AuthAuthenticated ? authState.user.id : null;
    final currentUserName = authState is AuthAuthenticated ? authState.user.name : '';

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => Future.wait([
            ref.read(homeProvider.notifier).refresh(),
            ref.read(dryingProvider.notifier).refresh(),
          ]),
          child: ListView(
            children: [
              _HomeHeader(name: currentUserName),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
                child: AsyncView(
                  value: homeState,
                  onRetry: () => ref.read(homeProvider.notifier).refresh(),
                  builder: (context, data) {
                    // valueOrNull: membersAsync/scheduleAsync are independent
                    // of homeState (already confirmed to have data above)
                    // and could still be in an errored, valueless state.
                    final members = membersAsync.valueOrNull ?? const <HouseholdMemberProfile>[];
                    final schedule = scheduleAsync.valueOrNull;
                    final todayEntry = schedule?.forDay(dayOfWeekFromDateString(data.turn.date));

                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _StatusCard(turn: data.turn, members: members, currentUserId: currentUserId),
                        const SizedBox(height: 20),
                        const SectionHeader(title: "Today's turn"),
                        _TodayTurnCard(
                          turn: data.turn,
                          scheduleDay: todayEntry,
                          members: members,
                          currentUserId: currentUserId,
                        ),
                        const SizedBox(height: 16),
                        _ActionCard(turn: data.turn, currentUserId: currentUserId, members: members),
                        const SizedBox(height: 16),
                        _TurnOwnershipCard(
                          turn: data.turn,
                          currentUserId: currentUserId,
                          members: members,
                          requests: data.requests,
                        ),
                        const SizedBox(height: 20),
                        const SectionHeader(title: 'Drying'),
                        AsyncView(
                          value: dryingState,
                          onRetry: () => ref.read(dryingProvider.notifier).refresh(),
                          builder: (context, drying) => _DryingCard(
                            data: drying,
                            turnId: data.turn.id,
                            currentUserId: currentUserId,
                            members: members,
                          ),
                        ),
                        if (dryingState.valueOrNull != null && dryingState.valueOrNull!.balances.isNotEmpty) ...[
                          const SizedBox(height: 20),
                          const SectionHeader(title: 'Drying favors'),
                          _DryingFavorsCard(
                            balances: dryingState.valueOrNull!.balances,
                            members: members,
                            currentUserId: currentUserId,
                          ),
                        ],
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
            ],
          ),
        ),
      ),
    );
  }
}

class _HomeHeader extends StatelessWidget {
  final String name;
  const _HomeHeader({required this.name});

  String _greetingFor(int hour) {
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final now = DateTime.now();
    final greeting = _greetingFor(now.hour);
    final dateLabel = DateFormat('EEEE, MMMM d').format(now);
    final firstName = name.trim().isEmpty ? '' : name.trim().split(' ').first;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 12, 4),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  firstName.isEmpty ? greeting : '$greeting, $firstName 👋',
                  style: theme.textTheme.headlineSmall,
                ),
                const SizedBox(height: 2),
                Text(
                  dateLabel,
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            tooltip: 'Notification settings',
            onPressed: () => _openProfile(context),
          ),
          InkWell(
            borderRadius: BorderRadius.circular(24),
            onTap: () => _openProfile(context),
            child: Padding(
              padding: const EdgeInsets.all(4),
              child: MemberAvatar(name: name),
            ),
          ),
        ],
      ),
    );
  }

  void _openProfile(BuildContext context) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProfileScreen()));
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
    final isEmergency = turn.isEmergency;

    final (emoji, label, color) = switch (turn.status) {
      TurnStatus.pending => ('🧺', 'MACHINE AVAILABLE', theme.colorScheme.primary),
      TurnStatus.released => ('🚨', 'TURN RELEASED', Colors.orange),
      TurnStatus.claimed => ('🚨', 'EMERGENCY CLAIMED', Colors.orange),
      TurnStatus.inUse =>
        isEmergency ? ('🚨', 'EMERGENCY USE', Colors.deepOrange) : ('🧺', 'MACHINE IN USE', Colors.redAccent),
      TurnStatus.completed => ('✓', 'COMPLETED', Colors.green),
      TurnStatus.expired => ('🧺', 'NOT USED TODAY', theme.colorScheme.onSurfaceVariant),
    };

    // Tinted with the status color rather than the flat default card color —
    // this is the single most important thing on the screen (what the
    // machine is doing right now), so it should read as the hero card at a
    // glance instead of blending into the cards below it.
    final tintedBackground = Color.alphaBlend(color.withValues(alpha: 0.14), theme.colorScheme.surface);

    return Card(
      color: tintedBackground,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 250),
          child: Column(
            key: ValueKey('${turn.status}-$isEmergency'),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(emoji, style: const TextStyle(fontSize: 32)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      label,
                      style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800, color: color),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                _statusDetail(turn, members, currentUserId),
                style: theme.textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _statusDetail(Turn turn, List<HouseholdMemberProfile> members, String? currentUserId) {
    switch (turn.status) {
      case TurnStatus.pending:
        return 'Available now.';
      case TurnStatus.released:
        final name = _nameFor(turn.scheduledUserId, members, currentUserId);
        return "$name doesn't need today's turn. Emergency use is available.";
      case TurnStatus.claimed:
        return "${_nameFor(turn.actingUserId ?? '', members, currentUserId)} claimed this turn and is about to start.";
      case TurnStatus.inUse:
        final name = _nameFor(turn.actingUserId ?? '', members, currentUserId);
        return '$name is washing.${_timingDetail(turn)}';
      case TurnStatus.completed:
        return "Today's wash is finished. Machine available.";
      case TurnStatus.expired:
        return 'Nobody used the machine today.';
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

class _TodayTurnCard extends StatelessWidget {
  final Turn turn;
  final ScheduleDay? scheduleDay;
  final List<HouseholdMemberProfile> members;
  final String? currentUserId;

  const _TodayTurnCard({
    required this.turn,
    required this.scheduleDay,
    required this.members,
    required this.currentUserId,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheduledName = _nameFor(turn.scheduledUserId, members, currentUserId);
    final isMe = currentUserId != null && turn.scheduledUserId == currentUserId;
    final subtitle = isMe ? 'Your scheduled turn' : "$scheduledName's scheduled turn";
    final timeSlot = (scheduleDay?.startTime != null && scheduleDay?.endTime != null)
        ? '${scheduleDay!.startTime} – ${scheduleDay!.endTime}'
        : null;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            MemberAvatar(name: scheduledName, radius: 24),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(scheduledName, style: theme.textTheme.titleMedium),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                  if (timeSlot != null) ...[
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Icon(Icons.schedule, size: 14, color: theme.colorScheme.onSurfaceVariant),
                        const SizedBox(width: 4),
                        Text(timeSlot, style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionCard extends ConsumerStatefulWidget {
  final Turn turn;
  final String? currentUserId;
  final List<HouseholdMemberProfile> members;

  const _ActionCard({required this.turn, required this.currentUserId, required this.members});

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

  Future<void> _startWithDurationPrompt() async {
    final minutes = await _pickDuration(title: 'Start wash', confirmLabel: 'Start Washing');
    if (minutes == null || !mounted) return;
    final notifier = ref.read(homeProvider.notifier);
    await _run(() => notifier.start(estimatedDurationMinutes: minutes));
  }

  Future<void> _releaseWithConfirmation() async {
    final confirmed = await showConfirmSheet(
      context,
      title: "Release today's turn?",
      message: "You don't need the washing machine today. Someone else will be able to use it for an "
          "emergency.\n\nYour normal weekly schedule will not change.",
      confirmLabel: 'Release Turn',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    await _run(() => ref.read(homeProvider.notifier).release());
  }

  Future<void> _claimWithDurationPrompt() async {
    final minutes = await _pickDuration(title: 'Claim the machine', confirmLabel: 'Confirm');
    if (minutes == null || !mounted) return;

    setState(() => _busy = true);
    final notifier = ref.read(homeProvider.notifier);
    final claimError = await notifier.claim();
    if (claimError != null) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(claimError)));
      return;
    }

    final startError = await notifier.start(estimatedDurationMinutes: minutes);
    if (!mounted) return;
    setState(() => _busy = false);
    if (startError != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(startError)));
    }
  }

  Future<int?> _pickDuration({required String title, required String confirmLabel}) {
    return showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _DurationPickerSheet(title: title, confirmLabel: confirmLabel),
    );
  }

  @override
  Widget build(BuildContext context) {
    final turn = widget.turn;
    final userId = widget.currentUserId;

    Widget? primaryAction;
    Widget? secondaryAction;
    String? statusOnlyMessage;

    final isScheduledUser = userId != null && turn.scheduledUserId == userId;
    final isActingUser = userId != null && turn.actingUserId == userId;

    if (turn.status == TurnStatus.pending && isScheduledUser) {
      primaryAction = FilledButton.icon(
        onPressed: _busy ? null : _startWithDurationPrompt,
        icon: const Icon(Icons.play_arrow),
        label: const Text('Start Wash'),
      );
      secondaryAction = OutlinedButton.icon(
        onPressed: _busy ? null : _releaseWithConfirmation,
        icon: const Icon(Icons.free_cancellation_outlined),
        label: const Text('Release Turn'),
      );
    } else if (turn.status == TurnStatus.pending && !isScheduledUser) {
      final name = _nameFor(turn.scheduledUserId, widget.members, userId);
      statusOnlyMessage = 'Waiting for $name.';
    } else if (turn.status == TurnStatus.released) {
      primaryAction = FilledButton.icon(
        onPressed: _busy ? null : _claimWithDurationPrompt,
        icon: const Icon(Icons.bolt),
        label: const Text('Claim Machine'),
      );
    } else if (turn.status == TurnStatus.claimed && isActingUser) {
      primaryAction = FilledButton.icon(
        onPressed: _busy ? null : _startWithDurationPrompt,
        icon: const Icon(Icons.play_arrow),
        label: const Text('Start Washing'),
      );
    } else if (turn.status == TurnStatus.inUse && isActingUser) {
      primaryAction = FilledButton.icon(
        onPressed: _busy ? null : () => _run(() => ref.read(homeProvider.notifier).finish()),
        icon: const Icon(Icons.check),
        label: const Text("I'm Finished"),
      );
    } else if (turn.status == TurnStatus.inUse && !isActingUser) {
      statusOnlyMessage = "${_nameFor(turn.actingUserId ?? '', widget.members, userId)} is using the machine.";
    } else if (turn.status == TurnStatus.completed) {
      statusOnlyMessage = "✓ Today's turn completed";
    }

    if (primaryAction == null && secondaryAction == null && statusOnlyMessage == null) {
      return const SizedBox.shrink();
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: statusOnlyMessage != null
            ? Row(
                children: [
                  Icon(Icons.info_outline, size: 18, color: Theme.of(context).colorScheme.onSurfaceVariant),
                  const SizedBox(width: 10),
                  Expanded(child: Text(statusOnlyMessage, style: Theme.of(context).textTheme.bodyMedium)),
                ],
              )
            : Column(
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

/// Turn ownership actions, independent of the turn's physical status (start/
/// claim/finish above) — giving, requesting, and responding to requests are
/// about who a turn belongs to, not whether it's currently being used, so
/// this renders as its own card rather than folding into _ActionCard's
/// single-message-or-single-action-group layout.
class _TurnOwnershipCard extends ConsumerStatefulWidget {
  final Turn turn;
  final String? currentUserId;
  final List<HouseholdMemberProfile> members;
  final List<TurnRequest> requests;

  const _TurnOwnershipCard({
    required this.turn,
    required this.currentUserId,
    required this.members,
    required this.requests,
  });

  @override
  ConsumerState<_TurnOwnershipCard> createState() => _TurnOwnershipCardState();
}

class _TurnOwnershipCardState extends ConsumerState<_TurnOwnershipCard> {
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

  Future<void> _giveTurn() async {
    final otherMembers = widget.members.where((m) => m.id != widget.currentUserId).toList();
    if (otherMembers.isEmpty) return;

    if (!mounted) return;
    final selectedUserId = await _pickMemberSheet(context, title: 'Give turn to…', members: otherMembers);

    if (selectedUserId == null || !mounted) return;
    await _run(() => ref.read(homeProvider.notifier).transfer(selectedUserId));
  }

  @override
  Widget build(BuildContext context) {
    final turn = widget.turn;
    final userId = widget.currentUserId;
    final theme = Theme.of(context);

    if (userId == null || _isTerminal(turn.status)) return const SizedBox.shrink();

    final isOwner = turn.scheduledUserId == userId;
    final pending = widget.requests.where((r) => r.isPending).toList();
    final incoming = isOwner ? pending : const <TurnRequest>[];
    final mine = pending.where((r) => r.requesterId == userId).toList();
    final myRequest = mine.isEmpty ? null : mine.first;

    final sections = <Widget>[];

    if (isOwner) {
      sections.add(
        OutlinedButton.icon(
          onPressed: _busy ? null : _giveTurn,
          icon: const Icon(Icons.card_giftcard_outlined),
          label: const Text('Give Turn'),
        ),
      );
    } else if (myRequest != null) {
      sections.add(
        Row(
          children: [
            Icon(Icons.hourglass_top, size: 18, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: 10),
            const Expanded(child: Text('Your request for this turn is pending.')),
            TextButton(
              onPressed: _busy ? null : () => _run(() => ref.read(homeProvider.notifier).cancelRequest(myRequest.id)),
              child: const Text('Cancel'),
            ),
          ],
        ),
      );
    } else {
      sections.add(
        OutlinedButton.icon(
          onPressed: _busy ? null : () => _run(() => ref.read(homeProvider.notifier).requestTurn()),
          icon: const Icon(Icons.pan_tool_outlined),
          label: const Text('Request This Turn'),
        ),
      );
    }

    if (incoming.isNotEmpty) {
      if (sections.isNotEmpty) sections.add(const SizedBox(height: 14));
      sections.add(Text('Incoming requests', style: theme.textTheme.labelLarge));
      sections.add(const SizedBox(height: 6));
      for (final req in incoming) {
        final name = _nameFor(req.requesterId, widget.members, userId);
        sections.add(
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                MemberAvatar(name: name, radius: 16),
                const SizedBox(width: 10),
                Expanded(child: Text('$name wants this turn')),
                IconButton(
                  tooltip: 'Accept',
                  icon: const Icon(Icons.check_circle_outline, color: Colors.green),
                  onPressed: _busy ? null : () => _run(() => ref.read(homeProvider.notifier).acceptRequest(req.id)),
                ),
                IconButton(
                  tooltip: 'Reject',
                  icon: const Icon(Icons.cancel_outlined),
                  onPressed: _busy ? null : () => _run(() => ref.read(homeProvider.notifier).rejectRequest(req.id)),
                ),
              ],
            ),
          ),
        );
      }
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: sections),
      ),
    );
  }
}

/// Requesting/accepting/completing drying help — deliberately independent of
/// the turn/machine cards above, since drying is a separate responsibility
/// from the wash cycle (see the backend's drying.service.js) and must keep
/// working no matter what today's turn/machine status is.
class _DryingCard extends ConsumerStatefulWidget {
  final DryingData data;
  final String turnId;
  final String? currentUserId;
  final List<HouseholdMemberProfile> members;

  const _DryingCard({
    required this.data,
    required this.turnId,
    required this.currentUserId,
    required this.members,
  });

  @override
  ConsumerState<_DryingCard> createState() => _DryingCardState();
}

class _DryingCardState extends ConsumerState<_DryingCard> {
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

  Future<void> _askSomeone() async {
    final otherMembers = widget.members.where((m) => m.id != widget.currentUserId).toList();
    if (otherMembers.isEmpty) return;

    final selectedUserId =
        await _pickMemberSheet(context, title: 'Ask someone to dry your clothes…', members: otherMembers);

    if (selectedUserId == null || !mounted) return;
    final helperName = otherMembers.firstWhere((m) => m.id == selectedUserId).name;
    final confirmed = await showConfirmSheet(
      context,
      title: 'Ask $helperName to dry your clothes?',
      message: "They'll be asked to accept, and you'll owe them a drying favor once they mark it done.",
      confirmLabel: 'Ask $helperName',
    );
    if (!confirmed || !mounted) return;

    await _run(() => ref.read(dryingProvider.notifier).requestDrying(selectedUserId, turnId: widget.turnId));
  }

  @override
  Widget build(BuildContext context) {
    final userId = widget.currentUserId;
    final data = widget.data;

    final sections = <Widget>[];

    for (final req in data.outgoing) {
      final name = _nameFor(req.helperId, widget.members, userId);
      sections.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            children: [
              MemberAvatar(name: name, radius: 16),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  req.isAccepted ? '$name is drying your clothes' : 'Waiting for $name',
                ),
              ),
              if (req.isPending)
                TextButton(
                  onPressed: _busy ? null : () => _run(() => ref.read(dryingProvider.notifier).cancel(req.id)),
                  child: const Text('Cancel'),
                ),
            ],
          ),
        ),
      );
    }

    for (final req in data.incoming) {
      final name = _nameFor(req.requesterId, widget.members, userId);
      sections.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            children: [
              MemberAvatar(name: name, radius: 16),
              const SizedBox(width: 10),
              Expanded(child: Text('$name needs help drying their clothes')),
              IconButton(
                tooltip: 'Accept',
                icon: const Icon(Icons.check_circle_outline, color: Colors.green),
                onPressed: _busy ? null : () => _run(() => ref.read(dryingProvider.notifier).accept(req.id)),
              ),
              IconButton(
                tooltip: 'Reject',
                icon: const Icon(Icons.cancel_outlined),
                onPressed: _busy ? null : () => _run(() => ref.read(dryingProvider.notifier).reject(req.id)),
              ),
            ],
          ),
        ),
      );
    }

    for (final req in data.tasks) {
      final name = _nameFor(req.requesterId, widget.members, userId);
      sections.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            children: [
              MemberAvatar(name: name, radius: 16),
              const SizedBox(width: 10),
              Expanded(child: Text("Dry $name's clothes")),
              FilledButton.tonal(
                onPressed: _busy ? null : () => _run(() => ref.read(dryingProvider.notifier).complete(req.id)),
                child: const Text('Mark as Dried'),
              ),
            ],
          ),
        ),
      );
    }

    if (sections.isNotEmpty) sections.add(const SizedBox(height: 6));
    sections.add(
      OutlinedButton.icon(
        onPressed: _busy ? null : _askSomeone,
        icon: const Icon(Icons.wb_sunny_outlined),
        label: const Text('Ask Someone to Dry'),
      ),
    );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: sections),
      ),
    );
  }
}

class _DryingFavorsCard extends StatelessWidget {
  final List<DryingFavorBalance> balances;
  final List<HouseholdMemberProfile> members;
  final String? currentUserId;

  const _DryingFavorsCard({required this.balances, required this.members, required this.currentUserId});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          children: [
            for (final balance in balances)
              ListTile(
                leading: MemberAvatar(name: _nameFor(balance.userId, members, currentUserId), radius: 18),
                title: Text(_nameFor(balance.userId, members, currentUserId)),
                subtitle: Text(
                  balance.youOwe > 0
                      ? 'You owe ${balance.youOwe} drying favor${balance.youOwe == 1 ? '' : 's'}'
                      : 'Owes you ${balance.owesYou} drying favor${balance.owesYou == 1 ? '' : 's'}',
                  style: TextStyle(
                    color: balance.youOwe > 0 ? theme.colorScheme.error : Colors.green,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Duration selection with a live "estimated finish" preview, matching chips
/// (30/45/60/90) plus a custom entry — all in one sheet with an explicit
/// confirm step, rather than closing immediately on tap.
class _DurationPickerSheet extends StatefulWidget {
  final String title;
  final String confirmLabel;

  const _DurationPickerSheet({required this.title, required this.confirmLabel});

  @override
  State<_DurationPickerSheet> createState() => _DurationPickerSheetState();
}

class _DurationPickerSheetState extends State<_DurationPickerSheet> {
  int? _selected = 45;
  bool _customSelected = false;
  final _customController = TextEditingController();

  @override
  void dispose() {
    _customController.dispose();
    super.dispose();
  }

  int? get _minutes {
    if (!_customSelected) return _selected;
    return int.tryParse(_customController.text);
  }

  bool get _isValid {
    final m = _minutes;
    return m != null && m >= 1 && m <= 240;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final minutes = _minutes;
    final estimatedFinish =
        _isValid ? DateFormat.jm().format(DateTime.now().add(Duration(minutes: minutes!))) : null;

    return Padding(
      padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(context).viewInsets.bottom + 24),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title, style: theme.textTheme.titleLarge),
            const SizedBox(height: 4),
            Text('How long do you expect it to take?', style: theme.textTheme.bodyMedium),
            const SizedBox(height: 16),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final m in _durationChoices)
                  ChoiceChip(
                    label: Text('$m min'),
                    selected: !_customSelected && _selected == m,
                    onSelected: (_) => setState(() {
                      _customSelected = false;
                      _selected = m;
                    }),
                  ),
                ChoiceChip(
                  label: const Text('Custom'),
                  selected: _customSelected,
                  onSelected: (_) => setState(() => _customSelected = true),
                ),
              ],
            ),
            if (_customSelected) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _customController,
                keyboardType: TextInputType.number,
                autofocus: true,
                decoration: const InputDecoration(labelText: 'Minutes', suffixText: 'min'),
                onChanged: (_) => setState(() {}),
              ),
            ],
            const SizedBox(height: 20),
            Row(
              children: [
                Icon(Icons.schedule, size: 18, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Text(
                  estimatedFinish != null ? 'Estimated finish: $estimatedFinish' : 'Choose a duration',
                  style: theme.textTheme.bodyMedium,
                ),
              ],
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _isValid ? () => Navigator.of(context).pop(minutes) : null,
              child: Text(widget.confirmLabel),
            ),
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
