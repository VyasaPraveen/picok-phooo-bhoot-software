import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_settings.dart';

/// Default PINs used until the operator changes them (shown as a warning in the admin panel).
const defaultAdminPin = '2580';
const defaultOperatorPin = '1470';

/// Holds the booth settings and persists every change immediately.
class SettingsStore extends ChangeNotifier {
  SettingsStore._(this._prefs, this._settings);

  static const _key = 'picok_settings_v1';
  final SharedPreferences _prefs;
  final AppSettings _settings;

  AppSettings get value => _settings;

  static Future<SettingsStore> load() async {
    final prefs = await SharedPreferences.getInstance();
    AppSettings s;
    final raw = prefs.getString(_key);
    try {
      s = raw == null ? AppSettings() : AppSettings.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      s = AppSettings();
    }
    final store = SettingsStore._(prefs, s);
    if (s.adminPinHash.isEmpty) s.adminPinHash = hashPin(defaultAdminPin);
    if (s.operatorPinHash.isEmpty) s.operatorPinHash = hashPin(defaultOperatorPin);
    await store._persist();
    return store;
  }

  /// Applies [change] to the settings, saves, and notifies listeners.
  Future<void> update(void Function(AppSettings s) change) async {
    change(_settings);
    await _persist();
    notifyListeners();
  }

  Future<void> _persist() => _prefs.setString(_key, jsonEncode(_settings.toJson()));

  // ---- PINs ----

  static String hashPin(String pin) =>
      sha256.convert(utf8.encode('picok-booth::$pin')).toString();

  bool get usingDefaultPins =>
      _settings.adminPinHash == hashPin(defaultAdminPin) ||
      _settings.operatorPinHash == hashPin(defaultOperatorPin);

  int _failedAttempts = 0;
  DateTime? _lockedUntil;

  /// Seconds until PIN entry is allowed again after too many wrong attempts.
  int get pinLockSeconds {
    final until = _lockedUntil;
    if (until == null) return 0;
    final s = until.difference(DateTime.now()).inSeconds;
    return s > 0 ? s : 0;
  }

  /// Returns the role unlocked by [pin], or null. Five wrong PINs lock entry for 60 seconds.
  PinRole? checkPin(String pin) {
    if (pinLockSeconds > 0) return null;
    final h = hashPin(pin);
    if (h == _settings.adminPinHash) {
      _failedAttempts = 0;
      return PinRole.admin;
    }
    if (h == _settings.operatorPinHash) {
      _failedAttempts = 0;
      return PinRole.operator;
    }
    _failedAttempts++;
    if (_failedAttempts >= 5) {
      _failedAttempts = 0;
      _lockedUntil = DateTime.now().add(const Duration(seconds: 60));
    }
    return null;
  }
}

enum PinRole { operator, admin }
