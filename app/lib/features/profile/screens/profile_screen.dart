import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/household.dart';
import '../../../core/models/notification_preferences.dart';
import '../../../core/state/auth_state.dart';
import '../../../core/state/household_state.dart';
import '../../../core/state/notification_preferences_state.dart';
import '../../../core/state/providers.dart';
import '../../../shared/widgets/async_view.dart';
import '../../../shared/widgets/member_avatar.dart';
import '../../household/screens/invite_screen.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authStateProvider);
    final householdAsync = ref.watch(householdProvider);
    final membersAsync = ref.watch(membersProvider);
    final currentUserId = authState is AuthAuthenticated ? authState.user.id : null;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: AsyncView(
        value: householdAsync,
        onRetry: () => ref.invalidate(householdProvider),
        builder: (context, household) {
          if (household == null) return const SizedBox.shrink();
          final isOwner = currentUserId != null && household.isOwner(currentUserId);

          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              if (authState is AuthAuthenticated)
                _AccountCard(name: authState.user.name, email: authState.user.email, isOwner: isOwner),
              const SizedBox(height: 16),
              _InviteCard(household: household),
              const SizedBox(height: 16),
              _MembersCard(
                membersAsync: membersAsync,
                isOwner: isOwner,
                currentUserId: currentUserId,
                householdId: household.id,
              ),
              const SizedBox(height: 16),
              const _NotificationSettingsCard(),
              const SizedBox(height: 24),
              OutlinedButton.icon(
                onPressed: () => ref.read(authStateProvider.notifier).logout(),
                icon: const Icon(Icons.logout),
                label: const Text('Log out'),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _AccountCard extends StatelessWidget {
  final String name;
  final String email;
  final bool isOwner;
  const _AccountCard({required this.name, required this.email, required this.isOwner});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            MemberAvatar(name: name, radius: 26),
            const SizedBox(width: 16),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: theme.textTheme.titleMedium),
                Text(isOwner ? 'Owner' : 'Member', style: theme.textTheme.bodySmall),
                Text(email, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _InviteCard extends StatelessWidget {
  final Household household;
  const _InviteCard({required this.household});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        title: Text(household.name, style: theme.textTheme.titleMedium),
        subtitle: const Text('Invite members'),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => InviteScreen(householdName: household.name, inviteCode: household.inviteCode),
          ),
        ),
      ),
    );
  }
}

class _MembersCard extends ConsumerWidget {
  final AsyncValue<List<HouseholdMemberProfile>> membersAsync;
  final bool isOwner;
  final String? currentUserId;
  final String householdId;

  const _MembersCard({
    required this.membersAsync,
    required this.isOwner,
    required this.currentUserId,
    required this.householdId,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text('Members', style: theme.textTheme.titleMedium),
            ),
            const SizedBox(height: 4),
            AsyncView(
              value: membersAsync,
              builder: (context, members) => Column(
                children: [
                  for (final member in members)
                    ListTile(
                      leading: MemberAvatar(name: member.name, radius: 18),
                      title: Text(member.name),
                      subtitle: Text(member.isOwner ? 'Owner' : 'Member'),
                      trailing: (isOwner && !member.isOwner && member.id != currentUserId)
                          ? IconButton(
                              icon: const Icon(Icons.person_remove_outlined),
                              onPressed: () async {
                                await ref
                                    .read(householdRepositoryProvider)
                                    .removeMember(householdId, member.id);
                                ref.invalidate(membersProvider);
                              },
                            )
                          : null,
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

const _notificationCategoryLabels = {
  'turnToday': ('Your turn', 'When it\'s your day on the schedule'),
  'turnTomorrow': ('Turn tomorrow', 'A heads-up the day before your turn'),
  'machineStarted': ('Machine started', 'When someone starts a wash'),
  'machineFinished': ('Machine finished', 'When the machine becomes free'),
  'emergencyActivity': ('Emergency activity', 'Releases and emergency claims'),
  'turnRequests': ('Turn requests', 'Requests, transfers, and responses to your turns'),
  'dryingRequests': ('Drying requests', 'Drying requests, responses, and completed favors'),
};

class _NotificationSettingsCard extends ConsumerWidget {
  const _NotificationSettingsCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final prefsAsync = ref.watch(notificationPreferencesProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text('Notifications', style: theme.textTheme.titleMedium),
            ),
            const SizedBox(height: 4),
            AsyncView(
              value: prefsAsync,
              builder: (context, prefs) => Column(
                children: [
                  for (final entry in _notificationCategoryLabels.entries)
                    SwitchListTile(
                      title: Text(entry.value.$1),
                      subtitle: Text(entry.value.$2),
                      value: _valueFor(prefs, entry.key),
                      onChanged: (value) =>
                          ref.read(notificationPreferencesProvider.notifier).setCategory(entry.key, value),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  bool _valueFor(NotificationPreferences prefs, String key) {
    switch (key) {
      case 'turnToday':
        return prefs.turnToday;
      case 'turnTomorrow':
        return prefs.turnTomorrow;
      case 'machineStarted':
        return prefs.machineStarted;
      case 'machineFinished':
        return prefs.machineFinished;
      case 'emergencyActivity':
        return prefs.emergencyActivity;
      case 'turnRequests':
        return prefs.turnRequests;
      case 'dryingRequests':
        return prefs.dryingRequests;
      default:
        return true;
    }
  }
}
