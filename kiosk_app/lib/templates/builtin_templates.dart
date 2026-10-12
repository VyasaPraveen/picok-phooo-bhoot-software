import '../models/print_size.dart';
import 'template_def.dart';

/// Picok brand rainbow (from the logo lens ring).
const picokRainbow = ['#19D3E6', '#2F6BFF', '#8B3DFF', '#FF3D9A', '#FF8A1F', '#FFD21F'];

/// The 6 custom AI Retro templates (Section 03 of the quotation) plus standard layouts.
class BuiltinTemplates {
  BuiltinTemplates._();

  static List<TemplateDef> all() => [...retro(), ...standard()];

  static List<TemplateDef> retro() => [
        _groovy70s(),
        _neon80s(),
        _bollywoodPoster(),
        _vintageFilmStrip(),
        _popComic90s(),
        _oldTimesNewspaper(),
      ];

  // 1 · Groovy '70s — 4×6, 2 photos, warm film filter.
  static TemplateDef _groovy70s() => TemplateDef(
        id: 'retro_groovy_70s',
        name: "Groovy '70s",
        category: 'retro',
        description: 'Sunset rainbow arcs, cream paper and warm faded tones.',
        size: PrintSize.p4x6,
        filter: 'warm_film',
        background: const {'color': '#F4E9D3'},
        layers: const [
          {
            'type': 'arcs', 'cx': 600, 'cy': 340, 'r': 620, 'band': 44, 'gap': 6,
            'colors': ['#D9480F', '#F28C28', '#F6B93B', '#8AA05A', '#3E8E8E'],
          },
          {
            'type': 'text', 'text': 'Groovy!', 'font': 'Shrikhand', 'size': 170, 'color': '#C2410C',
            'x': 150, 'y': 40, 'w': 900, 'shadow': {'color': '#F6B93B', 'dx': 9, 'dy': 9},
          },
          {
            'type': 'text', 'text': '{event}', 'fallback': 'Far out, friends!', 'font': 'Poppins',
            'weight': 700, 'size': 46, 'color': '#7A4A1E', 'letterSpacing': 3, 'uppercase': true,
            'x': 220, 'y': 268, 'w': 760,
          },
          {'type': 'rect', 'x': 0, 'y': 1548, 'w': 1200, 'h': 10, 'color': '#D9480F'},
          {'type': 'rect', 'x': 0, 'y': 1562, 'w': 1200, 'h': 10, 'color': '#F28C28'},
          {'type': 'rect', 'x': 0, 'y': 1576, 'w': 1200, 'h': 10, 'color': '#F6B93B'},
        ],
        slots: const [
          SlotDef(x: 90, y: 372, w: 1020, h: 560, radius: 34, rotation: -1.4, borderWidth: 14, borderColor: '#FFF8EC', shadow: true),
          SlotDef(x: 90, y: 968, w: 1020, h: 560, radius: 34, rotation: 1.4, borderWidth: 14, borderColor: '#FFF8EC', shadow: true),
        ],
        logo: const LogoAreaDef(x: 0, y: 1600, w: 1200, h: 200, bg: '#3B2314', textColor: '#F4E9D3'),
      );

  // 2 · Neon '80s Synthwave — 4×6, 3 photos, neon pop filter.
  static TemplateDef _neon80s() => TemplateDef(
        id: 'retro_neon_80s',
        name: "Neon '80s Synthwave",
        category: 'retro',
        description: 'Glowing pink and cyan grid on a midnight-purple sky.',
        size: PrintSize.p4x6,
        filter: 'neon_pop',
        background: const {
          'gradient': {
            'colors': ['#0B0620', '#22094F', '#4A1677'],
            'stops': [0.0, 0.45, 1.0],
          },
        },
        layers: const [
          {'type': 'dots', 'x': 0, 'y': 0, 'w': 1200, 'h': 420, 'spacing': 64, 'rMax': 2.2, 'rMin': 2.2, 'color': '#66FFFFFF'},
          {
            'type': 'sun', 'cx': 600, 'cy': 330, 'r': 240, 'glow': 50, 'bands': 7, 'bandColor': '#1A0841',
            'colors': ['#FFD23F', '#FF6B9A', '#C23BFF'],
          },
          {
            'type': 'text', 'text': 'NEON', 'font': 'Monoton', 'size': 200, 'color': '#FFFFFF',
            'x': 100, 'y': 70, 'w': 1000, 'glow': {'color': '#FF2BD6', 'blur': 20},
          },
          {
            'type': 'text', 'text': '{EVENT}', 'fallback': 'RETRO NIGHTS', 'font': 'BebasNeue', 'size': 70,
            'color': '#22E5FF', 'letterSpacing': 12, 'x': 100, 'y': 352, 'w': 1000,
            'glow': {'color': '#22E5FF', 'blur': 12},
          },
          {'type': 'grid', 'x': 0, 'y': 1000, 'w': 1200, 'h': 600, 'cols': 14, 'rows': 9, 'color': '#FF2BD6', 'width': 4, 'glow': 10},
          {'type': 'rect', 'x': 82, 'y': 452, 'w': 1036, 'h': 556, 'radius': 10, 'stroke': {'color': '#22E5FF', 'width': 6}, 'glow': 16},
          {'type': 'rect', 'x': 82, 'y': 1052, 'w': 512, 'h': 486, 'radius': 10, 'stroke': {'color': '#FF2BD6', 'width': 6}, 'glow': 16},
          {'type': 'rect', 'x': 606, 'y': 1052, 'w': 512, 'h': 486, 'radius': 10, 'stroke': {'color': '#FF2BD6', 'width': 6}, 'glow': 16},
        ],
        slots: const [
          SlotDef(x: 90, y: 460, w: 1020, h: 540, radius: 6),
          SlotDef(x: 90, y: 1060, w: 496, h: 470, radius: 6),
          SlotDef(x: 614, y: 1060, w: 496, h: 470, radius: 6),
        ],
        logo: const LogoAreaDef(x: 0, y: 1600, w: 1200, h: 200, bg: '#0B0620', textColor: '#22E5FF'),
      );

  // 3 · Bollywood Retro Poster — 4×6, 1 photo, poster colour filter.
  static TemplateDef _bollywoodPoster() => TemplateDef(
        id: 'retro_bollywood_poster',
        name: 'Bollywood Retro Poster',
        category: 'retro',
        description: 'Hand-painted cinema-poster look with halftone dots and a "Now Showing" title.',
        size: PrintSize.p4x6,
        filter: 'poster',
        background: const {'color': '#F3D9A4'},
        layers: const [
          {'type': 'rays', 'cx': 600, 'cy': 780, 'count': 36, 'colors': ['#F5B53F', '#F3D9A4'], 'clip': {'x': 0, 'y': 0, 'w': 1200, 'h': 1600}},
          {'type': 'dots', 'x': 0, 'y': 0, 'w': 1200, 'h': 1600, 'spacing': 22, 'rMax': 7, 'rMin': 0, 'color': '#40B23A48', 'direction': 'edges'},
          {'type': 'starburst', 'cx': 110, 'cy': 150, 'points': 5, 'rOuter': 62, 'rInner': 26, 'jitter': 0, 'rotation': -90, 'color': '#C1121F'},
          {'type': 'starburst', 'cx': 1090, 'cy': 150, 'points': 5, 'rOuter': 62, 'rInner': 26, 'jitter': 0, 'rotation': -90, 'color': '#C1121F'},
          {
            'type': 'text', 'text': 'Superhit!', 'font': 'Rye', 'size': 150, 'color': '#C1121F',
            'x': 170, 'y': 50, 'w': 860, 'rotation': -3,
            'stroke': {'color': '#FFF3D6', 'width': 16}, 'shadow': {'color': '#5A0A0A', 'dx': 8, 'dy': 8},
          },
          {'type': 'rect', 'x': -40, 'y': 1318, 'w': 1280, 'h': 124, 'color': '#C1121F', 'rotation': -3},
          {
            'type': 'text', 'text': 'NOW SHOWING', 'font': 'BebasNeue', 'size': 100, 'color': '#FFF3D6',
            'letterSpacing': 14, 'x': 0, 'y': 1318, 'w': 1200, 'h': 124, 'rotation': -3,
          },
          {
            'type': 'text', 'text': '{EVENT}', 'fallback': 'IN CINEMAS TODAY', 'font': 'Rye', 'size': 58,
            'color': '#5A0A0A', 'x': 60, 'y': 1468, 'w': 1080, 'h': 110,
          },
        ],
        slots: const [
          SlotDef(x: 110, y: 270, w: 980, h: 1010, borderWidth: 16, borderColor: '#FFF3D6', shadow: true),
        ],
        logo: const LogoAreaDef(x: 0, y: 1600, w: 1200, h: 200, bg: '#5A0A0A', textColor: '#FFF3D6'),
      );

  // 4 · Vintage Film Strip — 2×6, 4 photos, sepia filter.
  static TemplateDef _vintageFilmStrip() => TemplateDef(
        id: 'retro_vintage_film',
        name: 'Vintage Film Strip',
        category: 'retro',
        description: 'Sprocket-hole film frame with four sepia shots, made for the 2×6 strip.',
        size: PrintSize.strip2x6,
        filter: 'sepia',
        background: const {'color': '#16130F'},
        layers: const [
          {'type': 'sprockets', 'x': 0, 'y': 0, 'w': 74, 'h': 1560, 'holeW': 34, 'holeH': 26, 'gap': 22, 'radius': 5, 'color': '#E9DFC9'},
          {'type': 'sprockets', 'x': 526, 'y': 0, 'w': 74, 'h': 1560, 'holeW': 34, 'holeH': 26, 'gap': 22, 'radius': 5, 'color': '#E9DFC9'},
          {
            'type': 'text', 'text': 'FILM', 'font': 'SpecialElite', 'size': 66, 'color': '#E9DFC9',
            'letterSpacing': 22, 'x': 80, 'y': 22, 'w': 440,
          },
          {'type': 'text', 'text': '1', 'font': 'SpecialElite', 'size': 26, 'color': '#E9A13B', 'x': 470, 'y': 112, 'w': 50, 'align': 'right'},
          {'type': 'text', 'text': '2', 'font': 'SpecialElite', 'size': 26, 'color': '#E9A13B', 'x': 470, 'y': 468, 'w': 50, 'align': 'right'},
          {'type': 'text', 'text': '3', 'font': 'SpecialElite', 'size': 26, 'color': '#E9A13B', 'x': 470, 'y': 824, 'w': 50, 'align': 'right'},
          {'type': 'text', 'text': '4', 'font': 'SpecialElite', 'size': 26, 'color': '#E9A13B', 'x': 470, 'y': 1180, 'w': 50, 'align': 'right'},
        ],
        slots: const [
          SlotDef(x: 86, y: 146, w: 428, h: 330, radius: 8),
          SlotDef(x: 86, y: 502, w: 428, h: 330, radius: 8),
          SlotDef(x: 86, y: 858, w: 428, h: 330, radius: 8),
          SlotDef(x: 86, y: 1214, w: 428, h: 330, radius: 8),
        ],
        logo: const LogoAreaDef(x: 0, y: 1560, w: 600, h: 240, bg: '#16130F', textColor: '#E9DFC9', font: 'SpecialElite'),
      );

  // 5 · '90s Pop Comic — 4×6, 4 photos, vivid filter.
  static TemplateDef _popComic90s() => TemplateDef(
        id: 'retro_pop_comic_90s',
        name: "'90s Pop Comic",
        category: 'retro',
        description: 'Comic-book panels, bold outlines and a "POW!" title.',
        size: PrintSize.p4x6,
        filter: 'vivid',
        background: const {'color': '#FFE14D'},
        layers: const [
          {'type': 'dots', 'x': 0, 'y': 0, 'w': 1200, 'h': 1600, 'spacing': 26, 'rMax': 6, 'rMin': 6, 'color': '#55FF3D9A'},
          {
            'type': 'starburst', 'cx': 600, 'cy': 150, 'points': 16, 'rOuter': 215, 'rInner': 135,
            'color': '#FF3B30', 'stroke': {'color': '#111111', 'width': 10}, 'shadow': {'color': '#111111', 'dx': 12, 'dy': 12},
          },
          {
            'type': 'text', 'text': 'POW!', 'font': 'Bangers', 'size': 160, 'color': '#FFE14D', 'letterSpacing': 6,
            'x': 350, 'y': 52, 'w': 500, 'rotation': -6, 'stroke': {'color': '#111111', 'width': 14},
          },
          {
            'type': 'text', 'text': 'ZAP!', 'font': 'Bangers', 'size': 92, 'color': '#22A7F0',
            'x': 30, 'y': 70, 'w': 300, 'rotation': -14, 'stroke': {'color': '#111111', 'width': 9},
          },
          {'type': 'polygon', 'points': [[930, 205], [900, 268], [985, 212]], 'color': '#FFFFFF', 'stroke': {'color': '#111111', 'width': 7}},
          {'type': 'rect', 'x': 850, 'y': 60, 'w': 310, 'h': 160, 'radius': 70, 'color': '#FFFFFF', 'stroke': {'color': '#111111', 'width': 7}},
          {
            'type': 'text', 'text': '{EVENT}', 'fallback': 'WOW!', 'font': 'Bangers', 'size': 62, 'color': '#111111',
            'maxLines': 2, 'x': 870, 'y': 72, 'w': 270, 'h': 136, 'letterSpacing': 2,
          },
        ],
        slots: const [
          SlotDef(x: 64, y: 316, w: 516, h: 560, rotation: -1.6, borderWidth: 12, borderColor: '#111111'),
          SlotDef(x: 620, y: 316, w: 516, h: 560, rotation: 1.6, borderWidth: 12, borderColor: '#111111'),
          SlotDef(x: 64, y: 930, w: 516, h: 600, rotation: 1.2, borderWidth: 12, borderColor: '#111111'),
          SlotDef(x: 620, y: 930, w: 516, h: 600, rotation: -1.2, borderWidth: 12, borderColor: '#111111'),
        ],
        logo: const LogoAreaDef(x: 0, y: 1600, w: 1200, h: 200, bg: '#111111', textColor: '#FFE14D'),
      );

  // 6 · Old Times Newspaper — 4×6, 1 photo, classic B&W filter.
  static TemplateDef _oldTimesNewspaper() => TemplateDef(
        id: 'retro_old_times_news',
        name: 'Old Times Newspaper',
        category: 'retro',
        description: 'Front-page headline with the event name. Looks best in black & white.',
        size: PrintSize.p4x6,
        filter: 'classic_bw',
        background: const {'color': '#F1EAD8'},
        layers: const [
          {'type': 'text', 'text': 'The Daily Booth', 'font': 'UnifrakturMaguntia', 'size': 128, 'color': '#151515', 'x': 50, 'y': 30, 'w': 1100},
          {'type': 'line', 'x1': 50, 'y1': 214, 'x2': 1150, 'y2': 214, 'width': 6, 'color': '#151515'},
          {'type': 'line', 'x1': 50, 'y1': 228, 'x2': 1150, 'y2': 228, 'width': 2, 'color': '#151515'},
          {'type': 'text', 'text': '{date}', 'fallback': 'SPECIAL EDITION', 'font': 'OldStandard', 'size': 28, 'color': '#151515', 'align': 'left', 'x': 56, 'y': 238, 'w': 380, 'uppercase': true},
          {'type': 'text', 'text': 'VOL. I  ·  No. 1', 'font': 'OldStandard', 'size': 28, 'color': '#151515', 'x': 400, 'y': 238, 'w': 400},
          {'type': 'text', 'text': 'PRICE: ONE SMILE', 'font': 'OldStandard', 'size': 28, 'color': '#151515', 'align': 'right', 'x': 764, 'y': 238, 'w': 380},
          {'type': 'line', 'x1': 50, 'y1': 284, 'x2': 1150, 'y2': 284, 'width': 2, 'color': '#151515'},
          {
            'type': 'text', 'text': '{EVENT}', 'fallback': 'LOCAL STARS SPOTTED!', 'font': 'OldStandard', 'weight': 700,
            'size': 92, 'maxLines': 2, 'lineHeight': 1.05, 'color': '#151515', 'x': 50, 'y': 300, 'w': 1100, 'h': 220,
          },
          {
            'type': 'text', 'text': 'Pictured: our guests, looking absolutely fabulous.', 'font': 'OldStandard',
            'italic': true, 'size': 30, 'color': '#333333', 'x': 50, 'y': 1256, 'w': 1100,
          },
          {'type': 'line', 'x1': 50, 'y1': 1306, 'x2': 1150, 'y2': 1306, 'width': 2, 'color': '#151515'},
          {'type': 'lines', 'x': 50, 'y': 1326, 'w': 1100, 'h': 250, 'columns': 3, 'gutter': 40, 'lineHeight': 22, 'thickness': 7, 'color': '#59151515'},
        ],
        slots: const [
          SlotDef(x: 50, y: 536, w: 1100, h: 704, borderWidth: 3, borderColor: '#151515'),
        ],
        logo: const LogoAreaDef(x: 0, y: 1600, w: 1200, h: 200, bg: '#151515', textColor: '#F1EAD8', font: 'OldStandard'),
      );

  // ---- standard layouts --------------------------------------------------------

  static List<TemplateDef> standard() {
    final out = <TemplateDef>[];
    for (final size in PrintSize.values) {
      for (final n in size.photoCounts) {
        for (final style in _StdStyle.values) {
          out.add(_standard(size, n, style, landscape: false));
        }
      }
    }
    // 4×6 postcards can also print landscape.
    for (final n in [1, 2, 3, 4]) {
      for (final style in _StdStyle.values) {
        out.add(_standard(PrintSize.p4x6, n, style, landscape: true));
      }
    }
    return out;
  }

  static double _logoHeight(PrintSize size, bool landscape) {
    if (landscape) return 170;
    return switch (size) {
      PrintSize.strip2x6 => 240,
      PrintSize.p4x6 => 200,
      PrintSize.p35x5 => 175,
      PrintSize.p5x7 => 235,
      PrintSize.p6x8 => 265,
    };
  }

  /// Generates slots for [n] photos in a W×H area above the logo strip.
  static List<SlotDef> standardSlots(PrintSize size, int n, {required bool landscape, double radius = 0}) {
    final w = (landscape ? size.heightPx : size.widthPx).toDouble();
    final h = (landscape ? size.widthPx : size.heightPx).toDouble();
    final logoH = _logoHeight(size, landscape);
    final m = size.isStrip ? 36.0 : w * 0.05;
    final gap = size.isStrip ? 24.0 : w * 0.03;
    final areaW = w - m * 2;
    final areaH = h - logoH - m * 2 + m * 0.5;
    final top = m;
    SlotDef s(double x, double y, double sw, double sh) =>
        SlotDef(x: x, y: y, w: sw, h: sh, radius: radius);

    if (n == 1) return [s(m, top, areaW, areaH)];

    // Stack vertically for strips and portrait 2/3-photo layouts; columns for landscape.
    final columns = landscape && n <= 3;
    final grid = n == 4 && !size.isStrip;
    if (grid) {
      final cw = (areaW - gap) / 2, ch = (areaH - gap) / 2;
      return [
        s(m, top, cw, ch),
        s(m + cw + gap, top, cw, ch),
        s(m, top + ch + gap, cw, ch),
        s(m + cw + gap, top + ch + gap, cw, ch),
      ];
    }
    if (columns) {
      final cw = (areaW - gap * (n - 1)) / n;
      return [for (var i = 0; i < n; i++) s(m + i * (cw + gap), top, cw, areaH)];
    }
    final ch = (areaH - gap * (n - 1)) / n;
    return [for (var i = 0; i < n; i++) s(m, top + i * (ch + gap), areaW, ch)];
  }

  static TemplateDef _standard(PrintSize size, int n, _StdStyle style, {required bool landscape}) {
    final w = (landscape ? size.heightPx : size.widthPx).toDouble();
    final h = (landscape ? size.widthPx : size.heightPx).toDouble();
    final logoH = _logoHeight(size, landscape);
    final dark = style == _StdStyle.midnight;
    final orient = landscape ? ' · Landscape' : '';
    return TemplateDef(
      id: 'std_${style.name}_${size.key}_$n${landscape ? '_l' : ''}',
      name: '${style.label}$orient',
      category: 'standard',
      description: '$n photo${n == 1 ? '' : 's'} · ${size.shortLabel}',
      size: size,
      landscape: landscape,
      filter: 'none',
      background: {'color': dark ? '#0A0A0F' : '#FFFFFF'},
      layers: [
        if (dark)
          {
            'type': 'rect', 'x': 0, 'y': h - logoH - 6, 'w': w, 'h': 6,
            'gradient': {'colors': picokRainbow, 'begin': [0, 0.5], 'end': [1, 0.5]},
          },
      ],
      slots: standardSlots(size, n, landscape: landscape, radius: dark ? 10 : 0),
      logo: LogoAreaDef(
        x: 0,
        y: h - logoH,
        w: w,
        h: logoH,
        bg: dark ? '#0A0A0F' : '#FFFFFF',
        textColor: dark ? '#FFFFFF' : '#111111',
      ),
    );
  }
}

enum _StdStyle {
  classic('Classic White'),
  midnight('Picok Midnight');

  const _StdStyle(this.label);
  final String label;
}
