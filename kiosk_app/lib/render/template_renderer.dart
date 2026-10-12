import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';
import 'package:flutter/services.dart';

import '../templates/template_def.dart';
import 'filters.dart';

/// Everything needed to draw one print.
class RenderRequest {
  RenderRequest({
    required this.template,
    this.photos = const [],
    this.logo,
    this.logoOnLight,
    this.eventName = '',
    this.eventDate = '',
    this.showEvent = true,
    this.bw = false,
    this.bwWholePrint = false,
    this.mirror = false,
    this.logoBgOverride,
    this.layerImages = const {},
  });

  final TemplateDef template;

  /// One entry per slot; a missing/null entry draws a placeholder (used for thumbnails).
  final List<ui.Image?> photos;
  final ui.Image? logo;

  /// Optional alternative logo for light strip backgrounds (drawn as a rounded badge).
  final ui.Image? logoOnLight;
  final String eventName;
  final String eventDate;
  final bool showEvent;
  final bool bw;
  final bool bwWholePrint;
  final bool mirror;
  final String? logoBgOverride;

  /// Decoded images for `image` layers, keyed by their `src`.
  final Map<String, ui.Image> layerImages;
}

/// Draws templates onto a canvas at 300 dpi (scale 1) or smaller for previews.
class TemplateRenderer {
  TemplateRenderer._();

  static Future<ui.Image> render(RenderRequest r, {double scale = 1}) async {
    final t = r.template;
    final w = math.max(1, (t.width * scale).round());
    final h = math.max(1, (t.height * scale).round());
    final rec = ui.PictureRecorder();
    final canvas = Canvas(rec, Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()));
    final whole = r.bw && r.bwWholePrint;
    if (whole) {
      canvas.saveLayer(Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()),
          Paint()..colorFilter = PhotoFilters.wholePrintBw());
    }
    canvas.scale(w / t.width, h / t.height);
    paint(canvas, r);
    if (whole) canvas.restore();
    final picture = rec.endRecording();
    try {
      return await picture.toImage(w, h);
    } finally {
      picture.dispose();
    }
  }

  /// Two 2×6 strips side by side on one 4×6 sheet (1200×1800); the DNP 2-inch cut separates them.
  static Future<ui.Image> stripSheet(ui.Image strip) async {
    const w = 1200, h = 1800;
    final rec = ui.PictureRecorder();
    final c = Canvas(rec, const Rect.fromLTWH(0, 0, 1200, 1800));
    final src = Rect.fromLTWH(0, 0, strip.width.toDouble(), strip.height.toDouble());
    final p = Paint()..filterQuality = FilterQuality.high;
    c.drawImageRect(strip, src, const Rect.fromLTWH(0, 0, 600, 1800), p);
    c.drawImageRect(strip, src, const Rect.fromLTWH(600, 0, 600, 1800), p);
    final picture = rec.endRecording();
    try {
      return await picture.toImage(w, h);
    } finally {
      picture.dispose();
    }
  }

  static Future<Uint8List> encodePng(ui.Image image) async {
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    if (data == null) throw StateError('Could not encode print image');
    return data.buffer.asUint8List();
  }

  /// Loads every image referenced by `image` layers of [t].
  static Future<Map<String, ui.Image>> loadLayerImages(TemplateDef t) async {
    final out = <String, ui.Image>{};
    for (final l in t.layers) {
      if (l['type'] != 'image') continue;
      final src = l['src'];
      if (src is! String || out.containsKey(src)) continue;
      try {
        Uint8List bytes;
        if (src.startsWith('asset:')) {
          bytes = (await rootBundle.load(src.substring(6))).buffer.asUint8List();
        } else {
          final base = t.basePath;
          final path = src.startsWith('/') || base == null ? src : '$base/$src';
          bytes = await File(path).readAsBytes();
        }
        out[src] = await decode(bytes);
      } catch (_) {
        // A missing decoration image is skipped rather than failing the print.
      }
    }
    return out;
  }

  static Future<ui.Image> decode(Uint8List bytes, {int? maxDimension}) async {
    final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
    final descriptor = await ui.ImageDescriptor.encoded(buffer);
    int? tw, th;
    if (maxDimension != null) {
      final big = math.max(descriptor.width, descriptor.height);
      if (big > maxDimension) {
        final k = maxDimension / big;
        tw = (descriptor.width * k).round();
        th = (descriptor.height * k).round();
      }
    }
    final codec = await descriptor.instantiateCodec(targetWidth: tw, targetHeight: th);
    final frame = await codec.getNextFrame();
    codec.dispose();
    descriptor.dispose();
    buffer.dispose();
    return frame.image;
  }

  // ---------------------------------------------------------------------------

  static void paint(Canvas c, RenderRequest r) {
    final t = r.template;
    final full = Rect.fromLTWH(0, 0, t.width, t.height);
    _fill(c, full, t.background, radius: 0);
    for (final l in t.layers) {
      if (l['z'] != 'above') _layer(c, l, r);
    }
    final filter = PhotoFilters.photoFilter(t.filter, bw: r.bw && !r.bwWholePrint);
    for (var i = 0; i < t.slots.length; i++) {
      _slot(c, t.slots[i], i < r.photos.length ? r.photos[i] : null, i, r.mirror, filter);
    }
    for (final l in t.layers) {
      if (l['z'] == 'above') _layer(c, l, r);
    }
    _logoStrip(c, r);
  }

  static void _layer(Canvas c, Map<String, dynamic> l, RenderRequest r) {
    final opacity = _d(l['opacity'], 1).clamp(0.0, 1.0);
    final needsLayer = opacity < 1;
    if (needsLayer) c.saveLayer(null, Paint()..color = Color.fromRGBO(0, 0, 0, opacity));
    switch (l['type']) {
      case 'rect':
        _rect(c, l);
      case 'circle':
        _circle(c, l);
      case 'arcs':
        _arcs(c, l);
      case 'text':
        _text(c, l, r);
      case 'grid':
        _grid(c, l);
      case 'dots':
        _dots(c, l);
      case 'stripes':
        _stripes(c, l);
      case 'rays':
        _rays(c, l);
      case 'starburst':
        _starburst(c, l);
      case 'sprockets':
        _sprockets(c, l);
      case 'line':
        _line(c, l);
      case 'lines':
        _fauxText(c, l);
      case 'polygon':
        _polygon(c, l);
      case 'sun':
        _sun(c, l);
      case 'image':
        _image(c, l, r);
    }
    if (needsLayer) c.restore();
  }

  // ---- primitives -----------------------------------------------------------

  static void _rotateAbout(Canvas c, Offset centre, double degrees) {
    if (degrees == 0) return;
    c.translate(centre.dx, centre.dy);
    c.rotate(degrees * math.pi / 180);
    c.translate(-centre.dx, -centre.dy);
  }

  static void _fill(Canvas c, Rect rect, Map<String, dynamic> spec, {double radius = 0}) {
    final paint = _paintFor(spec, rect);
    if (paint == null) return;
    if (radius > 0) {
      c.drawRRect(RRect.fromRectAndRadius(rect, Radius.circular(radius)), paint);
    } else {
      c.drawRect(rect, paint);
    }
  }

  /// A fill paint from `color` or `gradient` keys.
  static Paint? _paintFor(Map<String, dynamic> spec, Rect bounds) {
    final g = spec['gradient'];
    if (g is Map) {
      final colors = _colors(g['colors']);
      if (colors.length >= 2) {
        final stops = (g['stops'] as List?)?.whereType<num>().map((e) => e.toDouble()).toList();
        final validStops = stops != null && stops.length == colors.length ? stops : _evenStops(colors.length);
        if (g['type'] == 'radial') {
          final centre = _rel(g['center'], bounds, const Offset(0.5, 0.5));
          final radius = _d(g['radius'], 0.5) * math.max(bounds.width, bounds.height);
          return Paint()..shader = ui.Gradient.radial(centre, radius, colors, validStops);
        }
        final from = _rel(g['begin'], bounds, const Offset(0.5, 0));
        final to = _rel(g['end'], bounds, const Offset(0.5, 1));
        return Paint()..shader = ui.Gradient.linear(from, to, colors, validStops);
      }
    }
    final col = spec['color'];
    if (col is String) return Paint()..color = parseColor(col);
    return null;
  }

  static Offset _rel(Object? v, Rect b, Offset fallback) {
    if (v is List && v.length == 2 && v[0] is num && v[1] is num) {
      return Offset(b.left + (v[0] as num) * b.width, b.top + (v[1] as num) * b.height);
    }
    return Offset(b.left + fallback.dx * b.width, b.top + fallback.dy * b.height);
  }

  static Paint? _stroke(Object? spec) {
    if (spec is! Map) return null;
    return Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = _d(spec['width'], 4)
      ..color = parseColor(spec['color'] as String? ?? '#000000')
      ..strokeJoin = StrokeJoin.round;
  }

  static MaskFilter? _glow(Map<String, dynamic> l) {
    final g = _d(l['glow'], 0);
    return g > 0 ? MaskFilter.blur(BlurStyle.normal, g) : null;
  }

  static void _rect(Canvas c, Map<String, dynamic> l) {
    final rect = Rect.fromLTWH(_d(l['x']), _d(l['y']), _d(l['w']), _d(l['h']));
    final radius = _d(l['radius']);
    c.save();
    _rotateAbout(c, rect.center, _d(l['rotation']));
    final shadow = l['shadow'];
    if (shadow is Map) {
      final sp = Paint()
        ..color = parseColor(shadow['color'] as String? ?? '#66000000')
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, _d(shadow['blur'], 12));
      final o = Offset(_d(shadow['dx'], 6), _d(shadow['dy'], 10));
      c.drawRRect(RRect.fromRectAndRadius(rect.shift(o), Radius.circular(radius)), sp);
    }
    _fill(c, rect, l, radius: radius);
    final s = _stroke(l['stroke']);
    if (s != null) {
      s.maskFilter = _glow(l);
      c.drawRRect(RRect.fromRectAndRadius(rect, Radius.circular(radius)), s);
      if (s.maskFilter != null) {
        c.drawRRect(RRect.fromRectAndRadius(rect, Radius.circular(radius)), s..maskFilter = null);
      }
    }
    c.restore();
  }

  static void _circle(Canvas c, Map<String, dynamic> l) {
    final centre = Offset(_d(l['cx']), _d(l['cy']));
    final r = _d(l['r']);
    final p = _paintFor(l, Rect.fromCircle(center: centre, radius: r));
    if (p != null) c.drawCircle(centre, r, p..maskFilter = _glow(l));
    final s = _stroke(l['stroke']);
    if (s != null) c.drawCircle(centre, r, s);
  }

  /// Concentric rainbow bands, outermost first.
  static void _arcs(Canvas c, Map<String, dynamic> l) {
    final centre = Offset(_d(l['cx']), _d(l['cy']));
    final outer = _d(l['r']);
    final band = _d(l['band'], 40);
    final gap = _d(l['gap'], 0);
    final start = _d(l['start'], 180) * math.pi / 180;
    final sweep = _d(l['sweep'], 180) * math.pi / 180;
    final colors = _colors(l['colors']);
    for (var i = 0; i < colors.length; i++) {
      final radius = outer - i * (band + gap) - band / 2;
      if (radius <= 0) break;
      final p = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = band
        ..color = colors[i];
      c.drawArc(Rect.fromCircle(center: centre, radius: radius), start, sweep, false, p);
    }
  }

  static void _grid(Canvas c, Map<String, dynamic> l) {
    final rect = Rect.fromLTWH(_d(l['x']), _d(l['y']), _d(l['w']), _d(l['h']));
    final cols = _d(l['cols'], 12).toInt();
    final rows = _d(l['rows'], 8).toInt();
    final perspective = l['perspective'] != false;
    final colour = parseColor(l['color'] as String? ?? '#FF2BD6');
    final width = _d(l['width'], 3);
    final glow = _d(l['glow'], 0);
    c.save();
    c.clipRect(rect);
    void strokeAll(Paint p) {
      for (var i = 0; i <= rows; i++) {
        final f = i / rows;
        final y = rect.top + rect.height * (perspective ? f * f : f);
        c.drawLine(Offset(rect.left, y), Offset(rect.right, y), p);
      }
      final cx = rect.center.dx;
      for (var i = 0; i <= cols; i++) {
        final xb = rect.left - rect.width * 0.75 + (rect.width * 2.5) * i / cols;
        final xt = perspective ? cx + (xb - cx) * 0.18 : xb;
        c.drawLine(Offset(xt, rect.top), Offset(xb, rect.bottom), p);
      }
    }

    if (glow > 0) {
      strokeAll(Paint()
        ..color = colour.withValues(alpha: 0.8)
        ..strokeWidth = width * 3
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, glow));
    }
    strokeAll(Paint()
      ..color = colour
      ..strokeWidth = width);
    c.restore();
  }

  /// Halftone dots that grow towards one edge.
  static void _dots(Canvas c, Map<String, dynamic> l) {
    final rect = Rect.fromLTWH(_d(l['x']), _d(l['y']), _d(l['w']), _d(l['h']));
    final spacing = math.max(4.0, _d(l['spacing'], 24));
    final rMax = _d(l['rMax'], spacing * 0.45);
    final rMin = _d(l['rMin'], 1);
    final dir = l['direction'] as String? ?? 'none';
    final p = Paint()..color = parseColor(l['color'] as String? ?? '#33000000');
    c.save();
    c.clipRect(rect);
    var row = 0;
    for (var y = rect.top; y <= rect.bottom + spacing; y += spacing * 0.866, row++) {
      final offset = row.isOdd ? spacing / 2 : 0.0;
      for (var x = rect.left - spacing + offset; x <= rect.right + spacing; x += spacing) {
        double f;
        switch (dir) {
          case 'down':
            f = (y - rect.top) / rect.height;
          case 'up':
            f = 1 - (y - rect.top) / rect.height;
          case 'radial':
            final d = (Offset(x, y) - rect.center).distance;
            f = 1 - (d / (rect.shortestSide * 0.75)).clamp(0.0, 1.0);
          case 'edges':
            final d = (Offset(x, y) - rect.center).distance;
            f = (d / (rect.longestSide * 0.6)).clamp(0.0, 1.0);
          default:
            f = 1;
        }
        final r = rMin + (rMax - rMin) * f.clamp(0.0, 1.0);
        if (r > 0.3) c.drawCircle(Offset(x, y), r, p);
      }
    }
    c.restore();
  }

  static void _stripes(Canvas c, Map<String, dynamic> l) {
    final rect = Rect.fromLTWH(_d(l['x']), _d(l['y']), _d(l['w']), _d(l['h']));
    final colors = _colors(l['colors']);
    if (colors.isEmpty) return;
    final width = math.max(2.0, _d(l['width'], 40));
    c.save();
    c.clipRect(rect);
    _rotateAbout(c, rect.center, _d(l['angle']));
    final reach = rect.longestSide * 1.5;
    var i = 0;
    for (var x = rect.center.dx - reach; x < rect.center.dx + reach; x += width, i++) {
      c.drawRect(Rect.fromLTWH(x, rect.center.dy - reach, width + 0.5, reach * 2),
          Paint()..color = colors[i % colors.length]);
    }
    c.restore();
  }

  /// Sunburst wedges around a centre (poster and comic backgrounds).
  static void _rays(Canvas c, Map<String, dynamic> l) {
    final centre = Offset(_d(l['cx']), _d(l['cy']));
    final count = math.max(4, _d(l['count'], 24).toInt());
    final r = _d(l['r'], 3000);
    final colors = _colors(l['colors']);
    if (colors.isEmpty) return;
    final clip = l['clip'];
    c.save();
    if (clip is Map) {
      c.clipRect(Rect.fromLTWH(_d(clip['x']), _d(clip['y']), _d(clip['w']), _d(clip['h'])));
    }
    final step = 2 * math.pi / count;
    final rot = _d(l['rotation']) * math.pi / 180;
    for (var i = 0; i < count; i++) {
      final a0 = rot + i * step, a1 = a0 + step;
      final path = Path()
        ..moveTo(centre.dx, centre.dy)
        ..lineTo(centre.dx + r * math.cos(a0), centre.dy + r * math.sin(a0))
        ..lineTo(centre.dx + r * math.cos(a1), centre.dy + r * math.sin(a1))
        ..close();
      c.drawPath(path, Paint()..color = colors[i % colors.length]);
    }
    c.restore();
  }

  /// Comic-style "POW!" burst with irregular points.
  static void _starburst(Canvas c, Map<String, dynamic> l) {
    final centre = Offset(_d(l['cx']), _d(l['cy']));
    final points = math.max(5, _d(l['points'], 14).toInt());
    final ro = _d(l['rOuter'], 200);
    final ri = _d(l['rInner'], 130);
    final jitter = _d(l['jitter'], 0.18);
    final rot = _d(l['rotation']) * math.pi / 180;
    final path = Path();
    for (var i = 0; i < points * 2; i++) {
      final outer = i.isEven;
      // Deterministic irregularity so every print looks identical.
      final wobble = 1 + jitter * math.sin(i * 2.399963) * (outer ? 1 : 0.4);
      final radius = (outer ? ro : ri) * wobble;
      final a = rot + i * math.pi / points;
      final p = Offset(centre.dx + radius * math.cos(a), centre.dy + radius * math.sin(a));
      i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
    }
    path.close();
    final shadow = l['shadow'];
    if (shadow is Map) {
      c.drawPath(path.shift(Offset(_d(shadow['dx'], 10), _d(shadow['dy'], 10))),
          Paint()..color = parseColor(shadow['color'] as String? ?? '#000000'));
    }
    final fill = _paintFor(l, path.getBounds());
    if (fill != null) c.drawPath(path, fill);
    final s = _stroke(l['stroke']);
    if (s != null) c.drawPath(path, s);
  }

  /// A column of film sprocket holes.
  static void _sprockets(Canvas c, Map<String, dynamic> l) {
    final rect = Rect.fromLTWH(_d(l['x']), _d(l['y']), _d(l['w']), _d(l['h']));
    final hw = _d(l['holeW'], rect.width * 0.55);
    final hh = _d(l['holeH'], hw * 0.75);
    final gap = _d(l['gap'], hh * 0.9);
    final radius = _d(l['radius'], 6);
    final p = Paint()..color = parseColor(l['color'] as String? ?? '#F2EBDD');
    for (var y = rect.top + gap / 2; y + hh <= rect.bottom; y += hh + gap) {
      c.drawRRect(
          RRect.fromRectAndRadius(
              Rect.fromLTWH(rect.center.dx - hw / 2, y, hw, hh), Radius.circular(radius)),
          p);
    }
  }

  static void _line(Canvas c, Map<String, dynamic> l) {
    final p = Paint()
      ..color = parseColor(l['color'] as String? ?? '#000000')
      ..strokeWidth = _d(l['width'], 3)
      ..strokeCap = StrokeCap.round
      ..maskFilter = _glow(l);
    final a = Offset(_d(l['x1']), _d(l['y1']));
    final b = Offset(_d(l['x2']), _d(l['y2']));
    final dash = l['dash'];
    if (dash is List && dash.length == 2) {
      final on = _d(dash[0], 10), off = _d(dash[1], 10);
      final total = (b - a).distance;
      final dir = (b - a) / total;
      for (var t = 0.0; t < total; t += on + off) {
        c.drawLine(a + dir * t, a + dir * math.min(total, t + on), p);
      }
    } else {
      c.drawLine(a, b, p);
    }
  }

  /// Faux newspaper body text: rows of thin bars in columns.
  static void _fauxText(Canvas c, Map<String, dynamic> l) {
    final rect = Rect.fromLTWH(_d(l['x']), _d(l['y']), _d(l['w']), _d(l['h']));
    final columns = math.max(1, _d(l['columns'], 2).toInt());
    final gutter = _d(l['gutter'], 24);
    final lineH = math.max(4.0, _d(l['lineHeight'], 18));
    final thick = _d(l['thickness'], 6);
    final p = Paint()..color = parseColor(l['color'] as String? ?? '#55000000');
    final colW = (rect.width - gutter * (columns - 1)) / columns;
    for (var col = 0; col < columns; col++) {
      final x = rect.left + col * (colW + gutter);
      var i = 0;
      for (var y = rect.top; y + thick <= rect.bottom; y += lineH, i++) {
        // Paragraph rhythm: every 7th line is short, every 8th is blank.
        if (i % 8 == 7) continue;
        final len = i % 8 == 6 ? colW * (0.35 + 0.1 * (col % 3)) : colW;
        c.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x, y, len, thick), Radius.circular(thick / 2)), p);
      }
    }
  }

  static void _polygon(Canvas c, Map<String, dynamic> l) {
    final pts = (l['points'] as List?)
            ?.whereType<List>()
            .where((e) => e.length == 2)
            .map((e) => Offset(_d(e[0]), _d(e[1])))
            .toList() ??
        const <Offset>[];
    if (pts.length < 3) return;
    final path = Path()..addPolygon(pts, true);
    final fill = _paintFor(l, path.getBounds());
    if (fill != null) c.drawPath(path, fill);
    final s = _stroke(l['stroke']);
    if (s != null) c.drawPath(path, s);
  }

  /// Synthwave sun: gradient disc with horizontal cut bands in its lower half.
  static void _sun(Canvas c, Map<String, dynamic> l) {
    final centre = Offset(_d(l['cx']), _d(l['cy']));
    final r = _d(l['r'], 300);
    final bounds = Rect.fromCircle(center: centre, radius: r);
    final colors = _colors(l['colors']);
    final glow = _d(l['glow'], 0);
    if (glow > 0 && colors.isNotEmpty) {
      c.drawCircle(centre, r * 1.05,
          Paint()
            ..color = colors.first.withValues(alpha: 0.55)
            ..maskFilter = MaskFilter.blur(BlurStyle.normal, glow));
    }
    final paint = colors.length >= 2
        ? (Paint()..shader = ui.Gradient.linear(bounds.topCenter, bounds.bottomCenter, colors, _evenStops(colors.length)))
        : (Paint()..color = colors.isEmpty ? const Color(0xFFFFB000) : colors.first);
    c.drawCircle(centre, r, paint);
    final bands = _d(l['bands'], 6).toInt();
    final bandColor = parseColor(l['bandColor'] as String? ?? '#1A0B3D');
    for (var i = 0; i < bands; i++) {
      final f = i / bands;
      final y = centre.dy + r * (0.1 + 0.9 * f);
      final hgt = r * (0.03 + 0.07 * f);
      c.save();
      c.clipPath(Path()..addOval(bounds));
      c.drawRect(Rect.fromLTWH(bounds.left, y, bounds.width, hgt), Paint()..color = bandColor);
      c.restore();
    }
  }

  static void _image(Canvas c, Map<String, dynamic> l, RenderRequest r) {
    final img = r.layerImages[l['src']];
    if (img == null) return;
    final dst = Rect.fromLTWH(_d(l['x']), _d(l['y']), _d(l['w'], r.template.width), _d(l['h'], r.template.height));
    final src = Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble());
    final fit = switch (l['fit']) { 'cover' => BoxFit.cover, 'contain' => BoxFit.contain, _ => BoxFit.fill };
    final fitted = applyBoxFit(fit, src.size, dst.size);
    final s = Alignment.center.inscribe(fitted.source, src);
    final d = Alignment.center.inscribe(fitted.destination, dst);
    c.save();
    c.clipRect(dst);
    c.drawImageRect(img, s, d, Paint()..filterQuality = FilterQuality.high);
    c.restore();
  }

  // ---- text -----------------------------------------------------------------

  static String _fillPlaceholders(String text, RenderRequest r) => text
      .replaceAll('{event}', r.eventName)
      .replaceAll('{EVENT}', r.eventName.toUpperCase())
      .replaceAll('{date}', r.eventDate);

  static FontWeight _weight(Object? w) {
    final v = w is num ? w.toInt() : 400;
    final idx = ((v / 100).round() - 1).clamp(0, 8);
    return FontWeight.values[idx];
  }

  static void _text(Canvas c, Map<String, dynamic> l, RenderRequest r) {
    var text = _fillPlaceholders(l['text'] as String? ?? '', r);
    if (text.trim().isEmpty) {
      final fallback = l['fallback'];
      if (fallback is! String || fallback.isEmpty) return;
      text = _fillPlaceholders(fallback, r);
    }
    if (l['uppercase'] == true) text = text.toUpperCase();
    final x = _d(l['x']), y = _d(l['y']), w = _d(l['w'], r.template.width);
    final boxH = l['h'] is num ? _d(l['h']) : null;
    final align = switch (l['align']) {
      'left' => TextAlign.left,
      'right' => TextAlign.right,
      _ => TextAlign.center,
    };
    final colour = parseColor(l['color'] as String? ?? '#000000');
    final maxLines = math.max(1, _d(l['maxLines'], 1).toInt());
    final stroke = l['stroke'];
    final shadows = <Shadow>[];
    final glow = l['glow'];
    if (glow is Map) {
      final gc = parseColor(glow['color'] as String? ?? '#FF2BD6');
      final blur = _d(glow['blur'], 18);
      shadows
        ..add(Shadow(color: gc, blurRadius: blur))
        ..add(Shadow(color: gc, blurRadius: blur * 2));
    }
    final sh = l['shadow'];
    if (sh is Map) {
      shadows.add(Shadow(
        color: parseColor(sh['color'] as String? ?? '#88000000'),
        offset: Offset(_d(sh['dx'], 4), _d(sh['dy'], 4)),
        blurRadius: _d(sh['blur'], 0),
      ));
    }

    ui.Paragraph build(double size, {Paint? foreground, bool withShadows = true}) {
      final pb = ui.ParagraphBuilder(ui.ParagraphStyle(
        textAlign: align,
        maxLines: maxLines,
        ellipsis: '…',
      ));
      pb.pushStyle(ui.TextStyle(
        fontFamily: l['font'] as String? ?? 'Poppins',
        fontSize: size,
        fontWeight: _weight(l['weight']),
        fontStyle: l['italic'] == true ? FontStyle.italic : FontStyle.normal,
        letterSpacing: _d(l['letterSpacing']),
        height: l['lineHeight'] is num ? _d(l['lineHeight']) : null,
        color: foreground == null ? colour : null,
        foreground: foreground,
        shadows: withShadows && shadows.isNotEmpty ? shadows : null,
      ));
      pb.addText(text);
      return pb.build()..layout(ui.ParagraphConstraints(width: w));
    }

    // Shrink to fit so long event names never get cut off.
    var size = _d(l['size'], 60);
    final minSize = size * 0.35;
    var para = build(size);
    while ((para.didExceedMaxLines || para.longestLine > w + 0.5) && size > minSize) {
      size *= 0.92;
      para = build(size);
    }
    final dy = boxH != null ? y + (boxH - para.height) / 2 : y;
    c.save();
    _rotateAbout(c, Offset(x + w / 2, dy + para.height / 2), _d(l['rotation']));
    if (stroke is Map) {
      final sp = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = _d(stroke['width'], 6)
        ..strokeJoin = StrokeJoin.round
        ..color = parseColor(stroke['color'] as String? ?? '#000000');
      c.drawParagraph(build(size, foreground: sp), Offset(x, dy));
      c.drawParagraph(build(size, withShadows: false), Offset(x, dy));
    } else {
      c.drawParagraph(para, Offset(x, dy));
    }
    c.restore();
  }

  // ---- photo slots ------------------------------------------------------------

  static void _slot(Canvas c, SlotDef s, ui.Image? photo, int index, bool mirror, ColorFilter? filter) {
    final rect = s.rect;
    final rr = RRect.fromRectAndRadius(rect, Radius.circular(s.radius));
    c.save();
    _rotateAbout(c, rect.center, s.rotation);
    if (s.shadow) {
      c.drawRRect(
          rr.inflate(s.borderWidth).shift(const Offset(8, 12)),
          Paint()
            ..color = const Color(0x55000000)
            ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 14));
    }
    if (s.borderWidth > 0) {
      c.drawRRect(rr.inflate(s.borderWidth), Paint()..color = parseColor(s.borderColor ?? '#FFFFFF'));
    }
    c.save();
    c.clipRRect(rr);
    if (photo != null) {
      final src = _coverSource(photo.width.toDouble(), photo.height.toDouble(), rect.width / rect.height);
      if (mirror) {
        c.translate(rect.center.dx, 0);
        c.scale(-1, 1);
        c.translate(-rect.center.dx, 0);
      }
      c.drawImageRect(photo, src, rect, Paint()
        ..filterQuality = FilterQuality.high
        ..colorFilter = filter);
    } else {
      if (filter != null) c.saveLayer(rect, Paint()..colorFilter = filter);
      _placeholder(c, rect, index);
      if (filter != null) c.restore();
    }
    c.restore();
    c.restore();
  }

  static Rect _coverSource(double iw, double ih, double targetAspect) {
    final imgAspect = iw / ih;
    if (imgAspect > targetAspect) {
      final w = ih * targetAspect;
      return Rect.fromLTWH((iw - w) / 2, 0, w, ih);
    }
    final h = iw / targetAspect;
    return Rect.fromLTWH(0, (ih - h) / 2, iw, h);
  }

  static const _placeholderHues = [
    [Color(0xFF7FD3F7), Color(0xFF3C6FD8)],
    [Color(0xFFF7B37F), Color(0xFFD8513C)],
    [Color(0xFFB59CF7), Color(0xFF6A3CD8)],
    [Color(0xFF9CF7C4), Color(0xFF2E9E6A)],
  ];

  /// A friendly silhouette used in thumbnails and sample prints.
  static void _placeholder(Canvas c, Rect rect, int index) {
    final hues = _placeholderHues[index % _placeholderHues.length];
    c.drawRect(rect, Paint()..shader = ui.Gradient.linear(rect.topLeft, rect.bottomRight, hues));
    final unit = math.min(rect.width, rect.height);
    final cx = rect.center.dx;
    final headR = unit * 0.17;
    final headY = rect.top + rect.height * 0.5 - headR * 0.6;
    final body = Paint()..color = const Color(0xCCFFFFFF);
    c.drawCircle(Offset(cx, headY), headR, body);
    final shoulders = Rect.fromCenter(
        center: Offset(cx, headY + headR * 2.9), width: unit * 0.68, height: headR * 3.2);
    c.drawRRect(RRect.fromRectAndRadius(shoulders, Radius.circular(headR * 1.4)), body);
  }

  // ---- brand logo strip ---------------------------------------------------------

  static void _logoStrip(Canvas c, RenderRequest r) {
    final a = r.template.logo;
    final rect = a.rect;
    if (rect.width <= 0 || rect.height <= 0) return;
    final bg = r.logoBgOverride ?? a.bg;
    if (bg != null) c.drawRect(rect, Paint()..color = parseColor(bg));
    final textColour = r.logoBgOverride != null ? _contrastOn(parseColor(r.logoBgOverride!)) : parseColor(a.textColor);
    final lightBg = bg != null && parseColor(bg).computeLuminance() > 0.5;
    final useBadge = lightBg && r.logoOnLight != null;

    final name = r.showEvent ? r.eventName.trim() : '';
    final date = r.showEvent ? r.eventDate.trim() : '';
    final hasText = name.isNotEmpty || date.isNotEmpty;
    final logo = useBadge ? r.logoOnLight : r.logo;
    final pad = rect.height * 0.14;
    final horizontal = rect.width / rect.height >= 3.2;

    ui.Paragraph para(String s, double size, FontWeight weight, double maxW) {
      final pb = ui.ParagraphBuilder(ui.ParagraphStyle(
          textAlign: horizontal ? TextAlign.left : TextAlign.center, maxLines: 1, ellipsis: '…'))
        ..pushStyle(ui.TextStyle(fontFamily: a.font, fontSize: size, fontWeight: weight, color: textColour))
        ..addText(s);
      final p = pb.build()..layout(ui.ParagraphConstraints(width: maxW));
      return p;
    }

    if (horizontal) {
      final innerH = rect.height - pad * 2;
      double lw = 0, lh = 0;
      if (logo != null) {
        lh = innerH;
        lw = logo.width / logo.height * lh;
        final maxW = rect.width * (hasText ? 0.5 : 0.85);
        if (lw > maxW) {
          lw = maxW;
          lh = lw * logo.height / logo.width;
        }
      }
      final maxTextW = rect.width - lw - pad * (logo != null ? 3 : 2);
      ui.Paragraph? p1, p2;
      if (name.isNotEmpty) p1 = para(name, innerH * 0.34, FontWeight.w700, maxTextW);
      if (date.isNotEmpty) p2 = para(date, innerH * 0.24, FontWeight.w500, maxTextW);
      final textW = math.max(p1?.longestLine ?? 0, p2?.longestLine ?? 0);
      final gapW = logo != null && hasText ? pad : 0;
      final total = lw + gapW + textW;
      var x = rect.left + (rect.width - total) / 2;
      if (logo != null) {
        _drawImageFit(c, logo, Rect.fromLTWH(x, rect.center.dy - lh / 2, lw, lh), badge: useBadge);
        x += lw + gapW;
      }
      final textH = (p1?.height ?? 0) + (p2?.height ?? 0);
      var ty = rect.center.dy - textH / 2;
      if (p1 != null) {
        c.drawParagraph(p1, Offset(x, ty));
        ty += p1.height;
      }
      if (p2 != null) c.drawParagraph(p2, Offset(x, ty));
    } else {
      final innerW = rect.width - pad * 2;
      final innerH = rect.height - pad * 2;
      final logoH = hasText ? innerH * 0.62 : innerH;
      ui.Paragraph? p1;
      final line = [name, date].where((s) => s.isNotEmpty).join(' · ');
      if (line.isNotEmpty) p1 = para(line, innerH * 0.2, FontWeight.w600, innerW);
      final totalH = (logo != null ? logoH : 0) + (p1 != null ? p1.height + pad * 0.3 : 0);
      var y = rect.center.dy - totalH / 2;
      if (logo != null) {
        var lh = logoH;
        var lw = logo.width / logo.height * lh;
        if (lw > innerW) {
          lw = innerW;
          lh = lw * logo.height / logo.width;
        }
        _drawImageFit(c, logo, Rect.fromLTWH(rect.center.dx - lw / 2, y + (logoH - lh) / 2, lw, lh), badge: useBadge);
        y += logoH + pad * 0.3;
      }
      if (p1 != null) c.drawParagraph(p1, Offset(rect.left + pad, y));
    }
  }

  static void _drawImageFit(Canvas c, ui.Image img, Rect dst, {bool badge = false}) {
    if (badge) {
      c.save();
      c.clipRRect(RRect.fromRectAndRadius(dst, Radius.circular(dst.shortestSide * 0.18)));
    }
    c.drawImageRect(img, Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble()), dst,
        Paint()..filterQuality = FilterQuality.high);
    if (badge) c.restore();
  }

  static Color _contrastOn(Color bg) => bg.computeLuminance() > 0.5 ? const Color(0xFF111111) : const Color(0xFFFFFFFF);

  // ---- parsing helpers ----------------------------------------------------------

  static double _d(Object? v, [double fallback = 0]) => v is num ? v.toDouble() : fallback;

  static List<double>? _evenStops(int n) => n <= 2 ? null : [for (var i = 0; i < n; i++) i / (n - 1)];

  static List<Color> _colors(Object? v) =>
      v is List ? v.whereType<String>().map(parseColor).toList() : const <Color>[];

  /// Accepts `#RRGGBB` or `#AARRGGBB`.
  static Color parseColor(String hex) {
    var h = hex.trim().replaceFirst('#', '');
    if (h.length == 3) h = h.split('').map((c) => '$c$c').join();
    if (h.length == 6) h = 'FF$h';
    final v = int.tryParse(h, radix: 16);
    return v == null ? const Color(0xFF000000) : Color(v);
  }
}
