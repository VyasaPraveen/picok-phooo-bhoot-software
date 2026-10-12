import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../models/app_settings.dart';
import '../models/print_size.dart';
import '../templates/builtin_templates.dart';
import '../templates/template_def.dart';

/// All templates the booth knows: built-in, downloaded packs and the operator's own PNG frames.
class TemplateRepository extends ChangeNotifier {
  TemplateRepository._(this._root);

  final Directory _root;
  final List<TemplateDef> _builtin = BuiltinTemplates.all();
  List<TemplateDef> _packs = [];
  List<TemplateDef> _custom = [];
  final Map<String, int> _packVersions = {};
  final Map<String, String> _packNames = {};
  final Set<String> _loadedFonts = {};

  static Future<TemplateRepository> open() async {
    final docs = await getApplicationDocumentsDirectory();
    final repo = TemplateRepository._(docs);
    await repo.reload();
    return repo;
  }

  Directory get packsDir => Directory(p.join(_root.path, 'packs'));
  Directory get customDir => Directory(p.join(_root.path, 'custom_frames'));
  File get _customIndex => File(p.join(customDir.path, 'custom_templates.json'));

  List<TemplateDef> get all => [..._packs, ..._builtin, ..._custom];
  Map<String, int> get packVersions => Map.unmodifiable(_packVersions);
  Map<String, String> get packNames => Map.unmodifiable(_packNames);

  TemplateDef? byId(String id) {
    for (final t in all) {
      if (t.id == id) return t;
    }
    return null;
  }

  static int _categoryRank(String c) => switch (c) {
        'festival' || 'event' => 0,
        'retro' => 1,
        'custom' => 2,
        _ => 3,
      };

  /// Templates the operator has arranged, in display order (all sizes).
  List<TemplateDef> ordered(AppSettings s) {
    final list = all;
    final index = {for (var i = 0; i < list.length; i++) list[i].id: i};
    final custom = {for (var i = 0; i < s.templateOrder.length; i++) s.templateOrder[i]: i};
    list.sort((a, b) {
      final oa = custom[a.id], ob = custom[b.id];
      if (oa != null && ob != null) return oa.compareTo(ob);
      if (oa != null) return -1;
      if (ob != null) return 1;
      final r = _categoryRank(a.category).compareTo(_categoryRank(b.category));
      return r != 0 ? r : index[a.id]!.compareTo(index[b.id]!);
    });
    return list;
  }

  /// What customers see for [size]: not hidden, and inside its festival date range.
  List<TemplateDef> visibleFor(PrintSize size, AppSettings s, {DateTime? now}) {
    final day = now ?? DateTime.now();
    return ordered(s)
        .where((t) => t.size == size && !s.hiddenTemplates.contains(t.id) && t.isActiveOn(day))
        .toList();
  }

  Future<void> reload() async {
    _packs = await _loadPacks();
    _custom = await _loadCustom();
    notifyListeners();
  }

  Future<List<TemplateDef>> _loadPacks() async {
    _packVersions.clear();
    _packNames.clear();
    final out = <TemplateDef>[];
    if (!await packsDir.exists()) return out;
    await for (final e in packsDir.list()) {
      if (e is! Directory || e.path.endsWith('.tmp')) continue;
      final f = File(p.join(e.path, 'pack.json'));
      if (!await f.exists()) continue;
      try {
        final j = jsonDecode(await f.readAsString()) as Map<String, dynamic>;
        final packId = j['id'] as String? ?? p.basename(e.path);
        _packVersions[packId] = (j['version'] as num?)?.toInt() ?? 0;
        _packNames[packId] = j['name'] as String? ?? packId;
        await _loadPackFonts(j, e.path);
        final packFrom = j['activeFrom'], packTo = j['activeTo'];
        for (final raw in (j['templates'] as List? ?? const []).whereType<Map>()) {
          final m = raw.cast<String, dynamic>();
          // Pack-level festival dates apply to templates that don't set their own.
          m.putIfAbsent('activeFrom', () => packFrom);
          m.putIfAbsent('activeTo', () => packTo);
          final t = TemplateDef.tryParse(m, packId: packId, basePath: e.path);
          if (t != null) out.add(t);
        }
      } catch (err) {
        debugPrint('Skipping broken template pack ${e.path}: $err');
      }
    }
    return out;
  }

  Future<void> _loadPackFonts(Map<String, dynamic> pack, String base) async {
    for (final f in (pack['fonts'] as List? ?? const []).whereType<Map>()) {
      final family = f['family'], file = f['file'];
      if (family is! String || file is! String || _loadedFonts.contains(family)) continue;
      final font = File(p.join(base, file));
      if (!await font.exists()) continue;
      final loader = FontLoader(family)..addFont(font.readAsBytes().then(ByteData.sublistView));
      await loader.load();
      _loadedFonts.add(family);
    }
  }

  Future<List<TemplateDef>> _loadCustom() async {
    if (!await _customIndex.exists()) return [];
    try {
      final list = jsonDecode(await _customIndex.readAsString()) as List;
      return list
          .whereType<Map>()
          .map((m) => TemplateDef.tryParse(m.cast<String, dynamic>(), packId: 'custom', basePath: customDir.path))
          .whereType<TemplateDef>()
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> _saveCustom() async {
    await customDir.create(recursive: true);
    await _customIndex.writeAsString(jsonEncode(_custom.map((t) => t.toJson()).toList()));
  }

  /// Adds the operator's own PNG frame on top of an existing layout's photo slots.
  Future<TemplateDef> addCustomFrame({
    required TemplateDef base,
    required String name,
    required File png,
  }) async {
    await customDir.create(recursive: true);
    final id = 'custom_${DateTime.now().millisecondsSinceEpoch}';
    final fileName = '$id.png';
    await png.copy(p.join(customDir.path, fileName));
    final t = TemplateDef(
      id: id,
      name: name,
      category: 'custom',
      description: 'Your own frame · ${base.photos} photo${base.photos == 1 ? '' : 's'}',
      size: base.size,
      landscape: base.landscape,
      filter: 'none',
      background: const {'color': '#FFFFFF'},
      layers: [
        {'type': 'image', 'src': fileName, 'x': 0, 'y': 0, 'w': base.width, 'h': base.height, 'fit': 'fill', 'z': 'above'},
      ],
      slots: base.slots,
      // The frame artwork is drawn over everything, so the logo strip keeps the base position.
      logo: base.logo,
      packId: 'custom',
      basePath: customDir.path,
    );
    _custom = [..._custom, t];
    await _saveCustom();
    notifyListeners();
    return t;
  }

  Future<void> removeCustom(String id) async {
    final t = _custom.where((e) => e.id == id).firstOrNull;
    if (t == null) return;
    _custom = _custom.where((e) => e.id != id).toList();
    await _saveCustom();
    final f = File(p.join(customDir.path, '$id.png'));
    if (await f.exists()) await f.delete();
    notifyListeners();
  }
}
