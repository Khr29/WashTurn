import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Which MainShell tab is selected (0=Home, 1=Schedule, 2=Activity, 3=Profile).
/// Lives outside the widget tree so code with no BuildContext of its own —
/// notably the FCM tap/foreground handlers in FcmService — can still
/// navigate the user to the right tab.
final mainTabIndexProvider = StateProvider<int>((ref) => 0);
