import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/state/activity_state.dart';
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
    // IndexedStack builds and keeps all three tabs alive from the very first
    // frame (that's what makes switching tabs instant, with no reload), so
    // ActivityScreen's provider fetches exactly once — right at startup —
    // and never again on its own. Without this, turn/drying actions taken
    // on Home don't show up on Activity until the user happens to
    // pull-to-refresh there themselves; the tab looks stuck on whatever was
    // true when the app launched.
    ref.listen<int>(mainTabIndexProvider, (previous, next) {
      if (next == 2) {
        ref.read(activityProvider.notifier).refresh();
      }
    });

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
