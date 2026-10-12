import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Picok brand colours, taken from the logo: black, white, the rainbow lens ring and peacock green.
class PicokColors {
  PicokColors._();
  static const bg = Color(0xFF07070B);
  static const surface = Color(0xFF14141C);
  static const surfaceHigh = Color(0xFF1E1E2A);
  static const outline = Color(0xFF2E2E3E);
  static const text = Color(0xFFFFFFFF);
  static const textDim = Color(0xFFB4B4C6);
  static const cyan = Color(0xFF19D3E6);
  static const blue = Color(0xFF2F6BFF);
  static const purple = Color(0xFF8B3DFF);
  static const pink = Color(0xFFFF3D9A);
  static const orange = Color(0xFFFF8A1F);
  static const yellow = Color(0xFFFFD21F);
  static const peacock = Color(0xFF12A56E);
  static const danger = Color(0xFFFF5A5F);
  static const rainbow = [cyan, blue, purple, pink, orange, yellow];
  static const rainbowGradient = LinearGradient(colors: rainbow);
  static const actionGradient = LinearGradient(colors: [blue, purple, pink]);
}

ThemeData buildPicokTheme() {
  const scheme = ColorScheme.dark(
    primary: PicokColors.pink,
    secondary: PicokColors.cyan,
    surface: PicokColors.surface,
    error: PicokColors.danger,
  );
  final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: 'Poppins', brightness: Brightness.dark);
  return base.copyWith(
    scaffoldBackgroundColor: PicokColors.bg,
    textTheme: base.textTheme.apply(bodyColor: PicokColors.text, displayColor: PicokColors.text),
    cardTheme: const CardThemeData(color: PicokColors.surface, margin: EdgeInsets.zero),
    dividerColor: PicokColors.outline,
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: PicokColors.surfaceHigh,
      border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12)), borderSide: BorderSide.none),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Colors.white : null),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? PicokColors.peacock : null),
    ),
  );
}

/// Formats paise as rupees: 15000 → "₹150", 15050 → "₹150.50".
String rupees(int paise) {
  final r = paise / 100;
  return paise % 100 == 0
      ? '₹${NumberFormat.decimalPattern('en_IN').format(r.round())}'
      : '₹${NumberFormat('#,##,##0.00', 'en_IN').format(r)}';
}
