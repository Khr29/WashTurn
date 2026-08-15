import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/state/navigation_state.dart';
import '../../features/activity/screens/activity_screen.dart';
import '../../features/machine/screens/home_screen.dart';
import '../../features/schedule/screens/schedule_screen.dart';

/// Bottom nav is deliberately just Home/Schedule/Activity — Profile and
/// household settings live behind the avatar in each screen's header instead
/// of a fourth tab, per the approved navigation design.
class MainShell extends ConsumerWidget {
  const MainShell({super.key});

  static const _screens = [
    HomeScreen(),
    ScheduleScreen(),
    ActivityScreen(),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final index = ref.watch(mainTabIndexProvider);
    final clampedIndex = index < _screens.length ? index : 0;

    return Scaffold(
      body: IndexedStack(index: clampedIndex, children: _screens),
      bottomNavigationBar: NavigationBar(
        selectedIndex: clampedIndex,
        onDestinationSelected: (i) => ref.read(mainTabIndexProvider.notifier).state = i,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(
              icon: Icon(Icons.calendar_today_outlined), selectedIcon: Icon(Icons.calendar_today), label: 'Schedule'),
          NavigationDestination(icon: Icon(Icons.history_outlined), selectedIcon: Icon(Icons.history), label: 'Activity'),
        ],
      ),
    );
  }
}
