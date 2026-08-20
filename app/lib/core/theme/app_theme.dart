import 'package:flutter/material.dart';

/// WashTurn's "Fresh Aqua" brand palette. Light mode pins the exact brand
/// values (background/text especially — those are product-specified, not
/// derived); dark mode is generated from the same primary hue so it reads as
/// the same brand rather than a generic Material dark theme, with a bespoke
/// deep-teal surface so it doesn't wash out to plain neutral gray.
class AppTheme {
  static const primaryTeal = Color(0xFF087F8C);
  static const accentAqua = Color(0xFF35C6C8);
  static const lightBackground = Color(0xFFF5FAFA);
  static const lightText = Color(0xFF12343B);

  static const _darkBackground = Color(0xFF0D2226);
  static const _darkText = Color(0xFFE3F5F5);

  /// Semantic status colors, shared across screens so "done" / "needs
  /// attention" / "urgent" read consistently everywhere instead of every
  /// screen picking its own ad hoc shade of green/orange/red.
  static const success = Color(0xFF2E9E5B);
  static const successDark = Color(0xFF5CD68C);
  static const warning = Color(0xFFE08A2E);
  static const urgent = Color(0xFFE0522E);

  static ThemeData light() => _base(Brightness.light);
  static ThemeData dark() => _base(Brightness.dark);

  static ThemeData _base(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final seedScheme = ColorScheme.fromSeed(seedColor: primaryTeal, brightness: brightness);

    final colorScheme = isDark
        ? seedScheme.copyWith(
            primary: accentAqua,
            onPrimary: _darkBackground,
            secondary: primaryTeal,
            surface: _darkBackground,
            onSurface: _darkText,
          )
        : seedScheme.copyWith(
            primary: primaryTeal,
            onPrimary: Colors.white,
            secondary: accentAqua,
            onSecondary: lightText,
            surface: lightBackground,
            onSurface: lightText,
          );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: colorScheme.surface,
      appBarTheme: AppBarTheme(
        backgroundColor: colorScheme.surface,
        foregroundColor: colorScheme.onSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
          color: colorScheme.onSurface,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: isDark ? colorScheme.surfaceContainerHigh : Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        margin: EdgeInsets.zero,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
          side: BorderSide(color: colorScheme.primary.withValues(alpha: 0.4)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? colorScheme.surfaceContainerHighest : const Color(0xFFEAF5F5),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: colorScheme.primary, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: colorScheme.primary.withValues(alpha: isDark ? 0.24 : 0.14),
        elevation: 0,
        height: 64,
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: colorScheme.primary,
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: colorScheme.inverseSurface,
        contentTextStyle: TextStyle(color: colorScheme.onInverseSurface, fontSize: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        actionTextColor: colorScheme.inversePrimary,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: isDark ? colorScheme.surfaceContainerHigh : Colors.white,
        modalBackgroundColor: isDark ? colorScheme.surfaceContainerHigh : Colors.white,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: isDark ? colorScheme.surfaceContainerHigh : Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: colorScheme.onSurfaceVariant,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: isDark ? colorScheme.surfaceContainerHighest : const Color(0xFFEAF5F5),
        selectedColor: colorScheme.primary.withValues(alpha: isDark ? 0.3 : 0.16),
        labelStyle: TextStyle(color: colorScheme.onSurface, fontWeight: FontWeight.w600),
        side: BorderSide.none,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: colorScheme.primary),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? colorScheme.primary : null,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? colorScheme.primary.withValues(alpha: 0.5) : null,
        ),
      ),
      splashFactory: InkSparkle.splashFactory,
    );
  }
}
