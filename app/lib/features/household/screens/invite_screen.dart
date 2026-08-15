import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

class InviteScreen extends StatelessWidget {
  final String householdName;
  final String inviteCode;

  const InviteScreen({super.key, required this.householdName, required this.inviteCode});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Invite to WashTurn')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 12),
            Text(
              'Share this code with your family:',
              style: theme.textTheme.bodyLarge,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 28),
            Card(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Center(
                  child: Text(
                    inviteCode,
                    style: theme.textTheme.displaySmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      letterSpacing: 6,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Anyone with this code can join $householdName and see the washing-machine schedule.',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 28),
            OutlinedButton.icon(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: inviteCode));
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Invite code copied')));
              },
              icon: const Icon(Icons.copy),
              label: const Text('Copy Code'),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => Share.share(
                'Join our household on WashTurn! Use invite code $inviteCode to join $householdName.',
              ),
              icon: const Icon(Icons.ios_share),
              label: const Text('Share'),
            ),
          ],
        ),
      ),
    );
  }
}
