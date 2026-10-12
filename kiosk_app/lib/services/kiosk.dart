import 'package:flutter/services.dart';

/// Android lock-task (kiosk) mode. With the app set as device owner the lock is silent and
/// complete; otherwise Android's screen pinning is used (see docs/SETUP.md).
class KioskMode {
  static const _ch = MethodChannel('com.epixs.picok_booth/kiosk');

  Future<bool> isDeviceOwner() async => await _call<bool>('isDeviceOwner') ?? false;
  Future<bool> isLocked() async => await _call<bool>('isLocked') ?? false;
  Future<void> start() => _call('start');
  Future<void> stop() => _call('stop');

  Future<T?> _call<T>(String method) async {
    try {
      return await _ch.invokeMethod<T>(method);
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }
}
