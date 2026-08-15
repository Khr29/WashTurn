import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/auth_repository.dart';
import '../api/household_repository.dart';
import '../api/household_store.dart';
import '../api/notification_repository.dart';
import '../api/token_store.dart';
import '../api/turn_repository.dart';

final tokenStoreProvider = Provider((ref) => TokenStore());
final householdStoreProvider = Provider((ref) => HouseholdStore());

final apiClientProvider = Provider((ref) => ApiClient(tokenStore: ref.watch(tokenStoreProvider)));

final authRepositoryProvider = Provider((ref) => AuthRepository(ref.watch(apiClientProvider)));
final householdRepositoryProvider =
    Provider((ref) => HouseholdRepository(ref.watch(apiClientProvider)));
final turnRepositoryProvider = Provider((ref) => TurnRepository(ref.watch(apiClientProvider)));
final notificationRepositoryProvider =
    Provider((ref) => NotificationRepository(ref.watch(apiClientProvider)));
