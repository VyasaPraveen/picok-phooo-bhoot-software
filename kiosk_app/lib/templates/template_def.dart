import 'dart:ui';

import '../models/print_size.dart';

/// A rectangle (in template pixels at 300 dpi) where one customer photo is placed.
class SlotDef {
  const SlotDef({
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    this.radius = 0,
    this.rotation = 0,
    this.borderWidth = 0,
    this.borderColor,
    this.shadow = false,
  });

  final double x, y, w, h;
  final double radius;

  /// Degrees, clockwise, around the slot centre.
  final double rotation;
  final double borderWidth;
  final String? borderColor;
  final bool shadow;

  double get aspect => w / h;
  Rect get rect => Rect.fromLTWH(x, y, w, h);

  Map<String, dynamic> toJson() => {
        'x': x,
        'y': y,
        'w': w,
        'h': h,
        if (radius != 0) 'radius': radius,
        if (rotation != 0) 'rotation': rotation,
        if (borderWidth != 0) 'borderWidth': borderWidth,
        if (borderColor != null) 'borderColor': borderColor,
        if (shadow) 'shadow': true,
      };

  static SlotDef fromJson(Map<String, dynamic> j) => SlotDef(
        x: _d(j['x']),
        y: _d(j['y']),
        w: _d(j['w']),
        h: _d(j['h']),
        radius: _d(j['radius']),
        rotation: _d(j['rotation']),
        borderWidth: _d(j['borderWidth']),
        borderColor: j['borderColor'] as String?,
        shadow: j['shadow'] == true,
      );
}

/// The brand-logo strip that appears at the bottom of every print.
class LogoAreaDef {
  const LogoAreaDef({
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    this.bg,
    this.textColor = '#FFFFFF',
    this.font = 'Poppins',
  });

  final double x, y, w, h;

  /// Strip background colour; null = transparent (template artwork shows through).
  final String? bg;
  final String textColor;
  final String font;

  Rect get rect => Rect.fromLTWH(x, y, w, h);

  Map<String, dynamic> toJson() => {
        'x': x,
        'y': y,
        'w': w,
        'h': h,
        if (bg != null) 'bg': bg,
        'textColor': textColor,
        'font': font,
      };

  static LogoAreaDef fromJson(Map<String, dynamic> j) => LogoAreaDef(
        x: _d(j['x']),
        y: _d(j['y']),
        w: _d(j['w']),
        h: _d(j['h']),
        bg: j['bg'] as String?,
        textColor: j['textColor'] as String? ?? '#FFFFFF',
        font: j['font'] as String? ?? 'Poppins',
      );
}

/// A print template. Built-in templates are defined in code; remote packs and custom frames
/// use exactly the same JSON shape (see template_cloud/README.md).
class TemplateDef {
  TemplateDef({
    required this.id,
    required this.name,
    required this.category,
    required this.size,
    required this.slots,
    required this.logo,
    this.landscape = false,
    this.filter = 'none',
    this.description = '',
    this.background = const {'color': '#FFFFFF'},
    this.layers = const [],
    this.packId = 'builtin',
    this.basePath,
    this.activeFrom,
    this.activeTo,
  });

  final String id;
  final String name;

  /// 'retro', 'standard', 'festival', 'event' or 'custom'.
  final String category;
  final PrintSize size;
  final bool landscape;
  final List<SlotDef> slots;
  final LogoAreaDef logo;
  final String filter;
  final String description;
  final Map<String, dynamic> background;

  /// Decoration layers, drawn in order. A layer with `"z":"above"` is drawn over the photos.
  final List<Map<String, dynamic>> layers;
  final String packId;

  /// Local folder that relative image paths in [layers] resolve against (remote packs, custom frames).
  final String? basePath;
  final DateTime? activeFrom;
  final DateTime? activeTo;

  int get photos => slots.length;
  double get width => (landscape ? size.heightPx : size.widthPx).toDouble();
  double get height => (landscape ? size.widthPx : size.heightPx).toDouble();
  bool get isRetro => category == 'retro';

  /// Whether a date-limited (festival/event) template is live on [now].
  bool isActiveOn(DateTime now) {
    final day = DateTime(now.year, now.month, now.day);
    if (activeFrom != null && day.isBefore(activeFrom!)) return false;
    if (activeTo != null && day.isAfter(activeTo!)) return false;
    return true;
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'category': category,
        'size': size.key,
        'landscape': landscape,
        'filter': filter,
        'description': description,
        'background': background,
        'layers': layers,
        'slots': slots.map((s) => s.toJson()).toList(),
        'logo': logo.toJson(),
        if (activeFrom != null) 'activeFrom': _date(activeFrom!),
        if (activeTo != null) 'activeTo': _date(activeTo!),
      };

  /// Parses a template from JSON. Returns null if it is not valid, so one bad remote
  /// template never breaks the booth.
  static TemplateDef? tryParse(Map<String, dynamic> j, {String packId = 'builtin', String? basePath}) {
    try {
      final size = PrintSize.fromKey(j['size'] as String?);
      final slots = (j['slots'] as List?)
          ?.whereType<Map>()
          .map((e) => SlotDef.fromJson(e.cast<String, dynamic>()))
          .toList();
      final logo = j['logo'];
      final id = j['id'];
      if (size == null || slots == null || slots.isEmpty || slots.length > 4 || logo is! Map || id is! String) {
        return null;
      }
      return TemplateDef(
        id: id,
        name: (j['name'] as String?) ?? id,
        category: (j['category'] as String?) ?? 'event',
        size: size,
        landscape: j['landscape'] == true,
        filter: (j['filter'] as String?) ?? 'none',
        description: (j['description'] as String?) ?? '',
        background: (j['background'] as Map?)?.cast<String, dynamic>() ?? const {'color': '#FFFFFF'},
        layers: (j['layers'] as List?)?.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList() ??
            const [],
        slots: slots,
        logo: LogoAreaDef.fromJson(logo.cast<String, dynamic>()),
        packId: packId,
        basePath: basePath,
        activeFrom: _parseDate(j['activeFrom']),
        activeTo: _parseDate(j['activeTo']),
      );
    } catch (_) {
      return null;
    }
  }
}

double _d(Object? v) => v is num ? v.toDouble() : 0;

DateTime? _parseDate(Object? v) {
  if (v is! String || v.isEmpty) return null;
  final d = DateTime.tryParse(v);
  return d == null ? null : DateTime(d.year, d.month, d.day);
}

String _date(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
