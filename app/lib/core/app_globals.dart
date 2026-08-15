import 'package:flutter/material.dart';

/// Lets code with no BuildContext of its own — notably the FCM
/// foreground-message handler — show a SnackBar for a notification that
/// arrived while the app was already open (FCM does not auto-display a
/// system notification in that case).
final scaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();
