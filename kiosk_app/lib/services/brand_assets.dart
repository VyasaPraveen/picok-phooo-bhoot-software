import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../render/template_renderer.dart';
import 'settings_store.dart';

/// The logo printed on every print: the event client's logo, or the Picok logo by default.
class BrandAssets extends ChangeNotifier {
  BrandAssets(this._settings);

  final SettingsStore _settings;
  ui.Image? _logo;
  ui.Image? _logoOnLight;
  String? _loadedPath = '\u0000';

  ui.Image? get logo => _logo;
  ui.Image? get logoOnLight => _logoOnLight;
  bool get usingClientLogo => _settings.value.clientLogoPath != null;

  Future<void> refresh() async {
    final path = _settings.value.clientLogoPath;
    if (path == _loadedPath) return;
    _loadedPath = path;
    ui.Image? client;
    if (path != null && await File(path).exists()) {
      try {
        client = await TemplateRenderer.decode(await File(path).readAsBytes(), maxDimension: 1400);
      } catch (_) {
        client = null;
      }
    }
    if (client != null) {
      _logo = client;
      _logoOnLight = null;
    } else {
      _logo = await _asset('assets/brand/picok_logo_transparent.png');
      _logoOnLight = await _asset('assets/brand/picok_logo.png');
    }
    notifyListeners();
  }

  static Future<ui.Image> _asset(String key) async =>
      TemplateRenderer.decode((await rootBundle.load(key)).buffer.asUint8List());

  /// Stores a copy of the chosen logo file inside the app and makes it the print logo.
  Future<void> setClientLogo(File source) async {
    final bytes = await source.readAsBytes();
    // Validate it decodes before accepting it.
    await TemplateRenderer.decode(bytes, maxDimension: 400);
    final dir = Directory(p.join((await getApplicationDocumentsDirectory()).path, 'branding'));
    await dir.create(recursive: true);
    final ext = p.extension(source.path).toLowerCase();
    final dest = File(p.join(dir.path, 'client_logo_${DateTime.now().millisecondsSinceEpoch}${ext.isEmpty ? '.png' : ext}'));
    await dest.writeAsBytes(bytes);
    final old = _settings.value.clientLogoPath;
    await _settings.update((s) => s.clientLogoPath = dest.path);
    if (old != null && old != dest.path) {
      try {
        await File(old).delete();
      } catch (_) {}
    }
    await refresh();
  }

  Future<void> clearClientLogo() async {
    final old = _settings.value.clientLogoPath;
    await _settings.update((s) => s.clientLogoPath = null);
    if (old != null) {
      try {
        await File(old).delete();
      } catch (_) {}
    }
    await refresh();
  }
}
