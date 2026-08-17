import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:washturn/app.dart';

void main() {
  testWidgets('app boots to the splash screen while auth state is restored', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: WashTurnApp()));

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
