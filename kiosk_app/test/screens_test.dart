import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:picok_booth/admin/sections/booth_section.dart';
import 'package:picok_booth/admin/sections/branding_section.dart';
import 'package:picok_booth/admin/sections/paper_section.dart';
import 'package:picok_booth/admin/sections/prices_section.dart';
import 'package:picok_booth/admin/sections/templates_section.dart';
import 'package:picok_booth/flow/screens/attract_screen.dart';
import 'package:picok_booth/flow/screens/options_screen.dart';
import 'package:picok_booth/flow/screens/size_screen.dart';
import 'package:picok_booth/flow/screens/template_screen.dart';
import 'package:picok_booth/flow/session.dart';
import 'package:picok_booth/models/print_size.dart';
import 'package:picok_booth/services/booth.dart';
import 'package:picok_booth/ui/theme.dart';
import 'package:picok_booth/ui/widgets.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Renders customer and admin screens at the Galaxy Tab A11+ resolution (1920×1200, 1.5×).
/// Fails on any layout overflow; writes screenshots to build/screens (or SCREENS_OUT).
class _FakePaths extends PathProviderPlatform with MockPlatformInterfaceMixin {
  _FakePaths(this.dir);
  final String dir;
  @override
  Future<String?> getApplicationDocumentsPath() async => dir;
  @override
  Future<String?> getTemporaryPath() async => dir;
}

Future<void> _loadFonts() async {
  final families = <String, List<String>>{};
  for (final f in Directory('assets/fonts').listSync().whereType<File>()) {
    families.putIfAbsent(f.uri.pathSegments.last.split('-').first, () => []).add(f.path);
  }
  for (final e in families.entries) {
    final loader = FontLoader(e.key);
    for (final p in e.value) {
      loader.addFont(Future.value(ByteData.sublistView(File(p).readAsBytesSync())));
    }
    await loader.load();
  }
  // Material icons for the UI.
  final icons = File('${Platform.environment['FLUTTER_ROOT'] ?? r'C:\dev\flutter'}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  if (icons.existsSync()) {
    await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load();
  }
}

void main() {
  final out = Directory(Platform.environment['SCREENS_OUT'] ?? 'build/screens');
  final boundary = GlobalKey();

  setUpAll(() async {
    out.createSync(recursive: true);
    PathProviderPlatform.instance = _FakePaths(Directory.systemTemp.createTempSync('picok_test').path);
    SharedPreferences.setMockInitialValues({});
  });

  Future<void> shoot(WidgetTester tester, String name, Widget screen, {bool admin = false}) async {
    await tester.pumpWidget(RepaintBoundary(
      key: boundary,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: buildPicokTheme(),
        home: admin
            ? Scaffold(body: screen)
            : Scaffold(body: GlowBackground(child: SafeArea(child: screen))),
      ),
    ));
    // Let template thumbnails and images finish rendering.
    for (var i = 0; i < 6; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 250)));
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.runAsync(() async {
      final ro = boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final img = await ro.toImage(pixelRatio: 1.0);
      final data = await img.toByteData(format: ui.ImageByteFormat.png);
      File('${out.path}/$name.png').writeAsBytesSync(data!.buffer.asUint8List());
      img.dispose();
    });
    expect(tester.takeException(), isNull, reason: '$name rendered with an error');
  }

  testWidgets('customer and admin screens render at tablet size without overflow', (tester) async {
    tester.view.physicalSize = const Size(1920, 1200);
    tester.view.devicePixelRatio = 1.5;
    addTearDown(tester.view.reset);
    await tester.runAsync(_loadFonts);
    await tester.runAsync(() async {
      final b = await Booth.initForTesting();
      await b.settings.update((s) {
        s.eventName = 'Ravi weds Priya';
        s.eventDate = '12 Oct 2026';
        s.bridgeHost = '192.168.1.20';
        s.bridgeKey = 'K7M2QX';
      });
    });

    await shoot(tester, '1_attract', AttractScreen(onStart: () {}, onAdmin: () {}));
    await shoot(tester, '2_size', SizeScreen(onPicked: (_) {}, onBack: () {}));

    final session = BoothSession()
      ..size = PrintSize.p4x6
      ..template = Booth.I.templates.byId('retro_groovy_70s');
    await shoot(tester, '3_template', TemplateScreen(session: session, onPicked: (_) {}, onBack: () {}));
    session.copies = 2;
    await shoot(tester, '4_options', OptionsScreen(session: session, onBack: () {}, onContinue: () {}, onChanged: () {}));

    final strip = BoothSession()
      ..size = PrintSize.strip2x6
      ..template = Booth.I.templates.byId('retro_vintage_film');
    await shoot(tester, '4b_options_strip', OptionsScreen(session: strip, onBack: () {}, onContinue: () {}, onChanged: () {}));

    await shoot(tester, 'admin_paper', const PaperSection(), admin: true);
    await shoot(tester, 'admin_branding', const BrandingSection(), admin: true);
    await shoot(tester, 'admin_prices', const PricesSection(), admin: true);
    await shoot(tester, 'admin_templates', const TemplatesSection(), admin: true);
    await shoot(tester, 'admin_booth', const BoothSection(), admin: true);

    TemplateThumb.clearCache();
    await tester.pumpWidget(const SizedBox());
  });
}
