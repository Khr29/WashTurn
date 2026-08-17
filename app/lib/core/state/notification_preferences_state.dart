import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/notification_preferences.dart';
import 'providers.dart';

class NotificationPreferencesNotifier extends StateNotifier<AsyncValue<NotificationPreferences>> {
  final Ref ref;
  NotificationPreferencesNotifier(this.ref) : super(const AsyncValue.loading()) {
    _load();
  }

  Future<void> _load() async {
    state = const AsyncValue.loading();
    try {
      final prefs = await ref.read(notificationRepositoryProvider).getPreferences();
      state = AsyncValue.data(prefs);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<void> setCategory(String key, bool value) async {
    final previous = state;
    // Optimistic update so the switch responds immediately.
    if (previous.hasValue) {
      state = AsyncValue.data(_applyKey(previous.value!, key, value));
    }
    try {
      final updated = await ref.read(notificationRepositoryProvider).updatePreferences({key: value});
      state = AsyncValue.data(updated);
    } catch (_) {
      // Roll back to the last known-good value rather than replacing the
      // whole settings card with an error screen over one failed toggle.
      if (previous.hasValue) state = previous;
    }
  }

  NotificationPreferences _applyKey(NotificationPreferences prefs, String key, bool value) {
    switch (key) {
      case 'turnToday':
        return prefs.copyWith(turnToday: value);
      case 'turnTomorrow':
        return prefs.copyWith(turnTomorrow: value);
      case 'machineStarted':
        return prefs.copyWith(machineStarted: value);
      case 'machineFinished':
        return prefs.copyWith(machineFinished: value);
      case 'emergencyActivity':
        return prefs.copyWith(emergencyActivity: value);
      case 'turnRequests':
        return prefs.copyWith(turnRequests: value);
      case 'dryingRequests':
        return prefs.copyWith(dryingRequests: value);
      default:
        return prefs;
    }
  }
}

final notificationPreferencesProvider =
    StateNotifierProvider.autoDispose<NotificationPreferencesNotifier, AsyncValue<NotificationPreferences>>(
        (ref) => NotificationPreferencesNotifier(ref));
