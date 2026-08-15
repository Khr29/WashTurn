import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/household.dart';
import '../../../core/state/auth_state.dart';
import '../../../core/state/household_state.dart';
import '../../../core/state/providers.dart';
import '../../../shared/widgets/async_view.dart';

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
              if (authState is AuthAuthenticated) _AccountCard(name: authState.user.name, email: authState.user.email),
              const SizedBox(height: 16),
              _InviteCard(household: household),
              const SizedBox(height: 16),
              _MembersCard(
                membersAsync: membersAsync,
                isOwner: isOwner,
                currentUserId: currentUserId,
                householdId: household.id,
              ),
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
  const _AccountCard({required this.name, required this.email});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            CircleAvatar(
              radius: 26,
              backgroundColor: theme.colorScheme.primaryContainer,
              child: Text(
                name.isNotEmpty ? name[0].toUpperCase() : '?',
                style: theme.textTheme.titleLarge?.copyWith(color: theme.colorScheme.onPrimaryContainer),
              ),
            ),
            const SizedBox(width: 16),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: theme.textTheme.titleMedium),
                Text(email, style: theme.textTheme.bodySmall),
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
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(household.name, style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            Text('Invite code', style: theme.textTheme.labelMedium),
            const SizedBox(height: 4),
            Row(
              children: [
                Text(
                  household.inviteCode,
                  style: theme.textTheme.headlineSmall?.copyWith(letterSpacing: 4),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.copy),
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: household.inviteCode));
                    ScaffoldMessenger.of(context)
                        .showSnackBar(const SnackBar(content: Text('Invite code copied')));
                  },
                ),
              ],
            ),
          ],
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
