import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:picok_booth/render/template_renderer.dart';
import 'package:picok_booth/templates/builtin_templates.dart';
import 'package:picok_booth/templates/template_def.dart';

/// Renders every built-in template to PNG so the artwork can be checked by eye.
/// Output folder: build/template_previews (or RENDER_OUT env var).
Future<void> _loadFonts() async {
  final families = <String, List<String>>{};
  for (final f in Directory('assets/fonts').listSync().whereType<File>()) {
    final name = f.uri.pathSegments.last;
    final family = switch (name.split('-').first) {
      'Poppins' => 'Poppins',
      'OldStandard' => 'OldStandard',
      'UnifrakturMaguntia' => 'UnifrakturMaguntia',
      'SpecialElite' => 'SpecialElite',
      'BebasNeue' => 'BebasNeue',
      final other => other,
    };
    families.putIfAbsent(family, () => []).add(f.path);
  }
  for (final e in families.entries) {
    final loader = FontLoader(e.key);
    for (final p in e.value) {
      loader.addFont(Future.value(ByteData.sublistView(File(p).readAsBytesSync())));
    }
    await loader.load();
  }
}

void main() {
  testWidgets('render all built-in templates', (tester) async {
    await tester.runAsync(() async {
      await _loadFonts();
      final out = Directory(Platform.environment['RENDER_OUT'] ?? 'build/template_previews')
        ..createSync(recursive: true);
      final logo = await TemplateRenderer.decode(File('assets/brand/picok_logo_transparent.png').readAsBytesSync());
      final logoBadge = await TemplateRenderer.decode(File('assets/brand/picok_logo.png').readAsBytesSync());
      final all = BuiltinTemplates.all();
      final onlyRetro = Platform.environment['RENDER_ALL'] == null;
      for (final t in all.where((t) => !onlyRetro || t.isRetro || t.id.contains('_4x6_2') || t.id.contains('2x6_4'))) {
        for (final bw in [false, true]) {
          if (bw && !t.isRetro) continue;
          final img = await TemplateRenderer.render(
            RenderRequest(
              template: t,
              logo: logo,
              logoOnLight: logoBadge,
              eventName: bw ? '' : 'Ravi weds Priya',
              eventDate: bw ? '' : '12 Oct 2026',
              bw: bw,
            ),
            scale: 0.5,
          );
          final png = await TemplateRenderer.encodePng(img);
          File('${out.path}/${t.id}${bw ? '_bw' : ''}.png').writeAsBytesSync(png);
          expect(img.width, (t.width * 0.5).round());
          img.dispose();
        }
      }
      // Strip pair sheet for the DNP 2-inch cut.
      final strip = all.firstWhere((t) => t.id == 'retro_vintage_film');
      final s = await TemplateRenderer.render(RenderRequest(template: strip, logo: logo));
      final sheet = await TemplateRenderer.stripSheet(s);
      expect(sheet.width, 1200);
      expect(sheet.height, 1800);
      File('${out.path}/strip_sheet.png').writeAsBytesSync(await TemplateRenderer.encodePng(sheet));
      // Remote festival packs from template_cloud/ must parse and render.
      final packs = Directory('../template_cloud/public/packs').listSync().whereType<Directory>();
      for (final dir in packs) {
        final pack = jsonDecode(File('${dir.path}/pack.json').readAsStringSync()) as Map<String, dynamic>;
        for (final raw in (pack['templates'] as List).cast<Map<String, dynamic>>()) {
          final t = TemplateDef.tryParse(raw, packId: pack['id'] as String, basePath: dir.path);
          expect(t, isNotNull, reason: 'pack template ${raw['id']} must parse');
          final img = await TemplateRenderer.render(
              RenderRequest(template: t!, logo: logo, logoOnLight: logoBadge, eventName: 'Ravi weds Priya'),
              scale: 0.5);
          File('${out.path}/pack_${t.id}.png').writeAsBytesSync(await TemplateRenderer.encodePng(img));
          img.dispose();
        }
      }
    });
  });
}
