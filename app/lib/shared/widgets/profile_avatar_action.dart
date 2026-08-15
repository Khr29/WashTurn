import 'package:flutter/material.dart';

import '../../features/profile/screens/profile_screen.dart';

/// Standard top-right entry point to Profile/household settings, used on
/// every top-level tab now that Profile isn't a bottom-nav destination.
class ProfileAvatarAction extends StatelessWidget {
  const ProfileAvatarAction({super.key});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: const Icon(Icons.person_outline),
      tooltip: 'Profile & household',
      onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProfileScreen())),
    );
  }
}
