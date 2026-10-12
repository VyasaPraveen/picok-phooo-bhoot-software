import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

import '../models/app_settings.dart';
import 'settings_store.dart';
import 'template_repository.dart';

class CloudSyncResult {
  CloudSyncResult(this.ok, this.message);
  final bool ok;
  final String message;
}

/// Pulls template packs (and optionally prices/settings) from the EPIXS template cloud.
/// The cloud is a static manifest – see template_cloud/README.md. No photos are ever sent.
class TemplateCloud {
  TemplateCloud(this._settings, this._repo);

  final SettingsStore _settings;
  final TemplateRepository _repo;
  bool _running = false;
  Timer? _timer;

  static final _safeId = RegExp(r'^[a-z0-9][a-z0-9_\-]{0,63}$');
  static final _safePath = RegExp(r'^[A-Za-z0-9_\-][A-Za-z0-9_\-./]{0,200}$');
  static const _maxFileBytes = 15 * 1024 * 1024;

  /// Syncs now and then every 6 hours.
  void startAutoSync() {
    _timer?.cancel();
    unawaited(sync());
    _timer = Timer.periodic(const Duration(hours: 6), (_) => sync());
  }

  void dispose() => _timer?.cancel();

  Future<CloudSyncResult> sync() async {
    final url = _settings.value.cloudManifestUrl.trim();
    if (url.isEmpty) return CloudSyncResult(false, 'No template cloud URL set.');
    final manifestUri = Uri.tryParse(url);
    if (manifestUri == null || manifestUri.scheme != 'https') {
      return CloudSyncResult(false, 'Template cloud URL must start with https://');
    }
    if (_running) return CloudSyncResult(false, 'A sync is already running.');
    _running = true;
    try {
      final manifest = jsonDecode(utf8.decode(await _get(manifestUri, maxBytes: 1024 * 1024)));
      if (manifest is! Map<String, dynamic>) throw const FormatException('Manifest is not an object');

      final remotePacks = <String>{};
      var updated = 0;
      for (final raw in (manifest['packs'] as List? ?? const []).whereType<Map>()) {
        final id = raw['id'], ver = raw['version'], packUrl = raw['url'];
        if (id is! String || !_safeId.hasMatch(id) || ver is! num || packUrl is! String) continue;
        remotePacks.add(id);
        if ((_repo.packVersions[id] ?? -1) >= ver.toInt()) continue;
        await _downloadPack(id, manifestUri.resolve(packUrl));
        updated++;
      }

      // Packs removed from the manifest are removed from the booth.
      var removed = 0;
      for (final id in _repo.packVersions.keys.toList()) {
        if (!remotePacks.contains(id)) {
          final dir = Directory(p.join(_repo.packsDir.path, id));
          if (await dir.exists()) await dir.delete(recursive: true);
          removed++;
        }
      }

      final settingsApplied = await _applySettings(manifest['settings']);
      await _settings.update((s) => s.lastCloudSync = DateTime.now().toIso8601String());
      await _repo.reload();
      final parts = <String>[
        updated == 0 ? 'Templates up to date' : '$updated pack${updated == 1 ? '' : 's'} updated',
        if (removed > 0) '$removed removed',
        if (settingsApplied) 'cloud settings applied',
      ];
      return CloudSyncResult(true, parts.join(' · '));
    } catch (e) {
      return CloudSyncResult(false, 'Sync failed: ${e is FormatException ? 'invalid manifest' : e}');
    } finally {
      _running = false;
    }
  }

  Future<List<int>> _get(Uri uri, {int maxBytes = _maxFileBytes}) async {
    if (uri.scheme != 'https') throw 'Only https downloads are allowed';
    final res = await http.get(uri).timeout(const Duration(seconds: 30));
    if (res.statusCode != 200) throw 'HTTP ${res.statusCode} for ${uri.path}';
    if (res.bodyBytes.length > maxBytes) throw 'File too large: ${uri.path}';
    return res.bodyBytes;
  }

  Future<void> _downloadPack(String id, Uri packUri) async {
    final packJson = jsonDecode(utf8.decode(await _get(packUri, maxBytes: 2 * 1024 * 1024)));
    if (packJson is! Map<String, dynamic>) throw const FormatException('Pack is not an object');
    packJson['id'] = id;

    final files = <String>{};
    for (final t in (packJson['templates'] as List? ?? const []).whereType<Map>()) {
      for (final l in (t['layers'] as List? ?? const []).whereType<Map>()) {
        final src = l['src'];
        if (l['type'] == 'image' && src is String) files.add(src);
      }
    }
    for (final f in (packJson['fonts'] as List? ?? const []).whereType<Map>()) {
      final file = f['file'];
      if (file is String) files.add(file);
    }

    final tmp = Directory(p.join(_repo.packsDir.path, '$id.tmp'));
    if (await tmp.exists()) await tmp.delete(recursive: true);
    await tmp.create(recursive: true);
    for (final rel in files) {
      if (!_safePath.hasMatch(rel) || rel.contains('..')) throw 'Unsafe file path in pack $id: $rel';
      final bytes = await _get(packUri.resolve(rel));
      final out = File(p.join(tmp.path, rel));
      await out.parent.create(recursive: true);
      await out.writeAsBytes(bytes);
    }
    await File(p.join(tmp.path, 'pack.json')).writeAsString(jsonEncode(packJson));

    final dest = Directory(p.join(_repo.packsDir.path, id));
    if (await dest.exists()) await dest.delete(recursive: true);
    await tmp.rename(dest.path);
  }

  /// Applies prices/settings pushed from the cloud, if the operator allowed it.
  Future<bool> _applySettings(Object? raw) async {
    if (raw is! Map || !_settings.value.acceptCloudSettings) return false;
    final version = raw['version'];
    if (version is! num || version.toInt() <= _settings.value.cloudSettingsVersion) return false;
    await _settings.update((s) {
      final prices = raw['prices'];
      if (prices is Map) {
        prices.forEach((k, v) {
          if (k is String && v is Map && AppSettings.defaultPrices.containsKey(k)) {
            s.prices[k] = SizePrice.fromJson(v.cast<String, dynamic>(), s.prices[k] ?? AppSettings.defaultPrices[k]!);
          }
        });
      }
      final maxCopies = raw['maxCopies'];
      if (maxCopies is num) s.maxCopies = maxCopies.toInt().clamp(1, 10);
      final eventName = raw['eventName'];
      if (eventName is String) s.eventName = eventName;
      final eventDate = raw['eventDate'];
      if (eventDate is String) s.eventDate = eventDate;
      final freeMode = raw['freeMode'];
      if (freeMode is bool) s.freeMode = freeMode;
      s.cloudSettingsVersion = version.toInt();
    });
    return true;
  }
}
