import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../render/template_renderer.dart';
import '../services/booth.dart';
import '../templates/template_def.dart';
import 'theme.dart';

/// Black background with soft rainbow glows, used behind every customer screen.
class GlowBackground extends StatelessWidget {
  const GlowBackground({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => CustomPaint(painter: _GlowPainter(), child: child);
}

class _GlowPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = PicokColors.bg);
    void blob(Offset c, double r, Color col) => canvas.drawCircle(
        c, r, Paint()..shader = RadialGradient(colors: [col.withValues(alpha: 0.28), col.withValues(alpha: 0)]).createShader(Rect.fromCircle(center: c, radius: r)));
    blob(Offset(size.width * 0.05, size.height * 0.1), size.shortestSide * 0.7, PicokColors.blue);
    blob(Offset(size.width * 0.95, size.height * 0.95), size.shortestSide * 0.75, PicokColors.pink);
    blob(Offset(size.width * 0.75, size.height * 0.05), size.shortestSide * 0.45, PicokColors.peacock);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// Large gradient pill button for customer screens.
class BigButton extends StatelessWidget {
  const BigButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.gradient = PicokColors.actionGradient,
    this.height = 76,
    this.fontSize = 24,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Gradient gradient;
  final double height;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    return Semantics(
      button: true,
      label: label,
      child: Opacity(
        opacity: enabled ? 1 : 0.4,
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: gradient,
            borderRadius: BorderRadius.circular(height / 2),
            boxShadow: enabled ? [BoxShadow(color: PicokColors.pink.withValues(alpha: 0.35), blurRadius: 24, offset: const Offset(0, 8))] : null,
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(height / 2),
              onTap: onPressed,
              child: SizedBox(
                height: height,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 36),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(label, style: TextStyle(fontSize: fontSize, fontWeight: FontWeight.w700, color: Colors.white)),
                      if (icon != null) ...[const SizedBox(width: 12), Icon(icon, color: Colors.white, size: fontSize + 4)],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Outlined secondary button for customer screens.
class GhostButton extends StatelessWidget {
  const GhostButton({super.key, required this.label, required this.onPressed, this.icon});
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: onPressed,
        icon: Icon(icon ?? Icons.arrow_back_rounded, size: 26),
        label: Text(label, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
        style: OutlinedButton.styleFrom(
          foregroundColor: PicokColors.text,
          side: const BorderSide(color: PicokColors.outline, width: 2),
          minimumSize: const Size(0, 64),
          padding: const EdgeInsets.symmetric(horizontal: 28),
          shape: const StadiumBorder(),
        ),
      );
}

/// Top bar of each customer step: logo, title and progress dots.
class StepHeader extends StatelessWidget {
  const StepHeader({super.key, required this.step, required this.title, this.subtitle, this.trailing});
  final int step;
  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(32, 20, 32, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Image.asset('assets/brand/picok_logo_transparent.png', height: 44, semanticLabel: 'Picok'),
          const SizedBox(width: 28),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title, style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800, height: 1.1)),
                if (subtitle != null)
                  Text(subtitle!, style: const TextStyle(fontSize: 17, color: PicokColors.textDim)),
              ],
            ),
          ),
          StepDots(step: step),
          if (trailing != null) ...[const SizedBox(width: 24), trailing!],
        ],
      ),
    );
  }
}

class StepDots extends StatelessWidget {
  const StepDots({super.key, required this.step, this.total = 8});
  final int step;
  final int total;

  @override
  Widget build(BuildContext context) => Semantics(
        label: 'Step $step of $total',
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var i = 1; i <= total; i++)
              AnimatedContainer(
                duration: const Duration(milliseconds: 250),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: i == step ? 28 : 10,
                height: 10,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(5),
                  color: i <= step ? PicokColors.rainbow[(i - 1) % PicokColors.rainbow.length] : PicokColors.outline,
                ),
              ),
          ],
        ),
      );
}

/// Renders a template preview with placeholder (or given) photos, cached by key.
class TemplateThumb extends StatefulWidget {
  const TemplateThumb({super.key, required this.template, this.bw = false, this.scale = 0.3, this.photos});
  final TemplateDef template;
  final bool bw;
  final double scale;
  final List<ui.Image?>? photos;

  static final _cache = <String, ui.Image>{};

  /// Drops cached previews (after a logo, event name or template change).
  /// Images are not disposed here because a visible thumbnail may still be drawing them;
  /// the engine frees them once no widget references them.
  static void clearCache() => _cache.clear();

  @override
  State<TemplateThumb> createState() => _TemplateThumbState();
}

class _TemplateThumbState extends State<TemplateThumb> {
  ui.Image? _image;
  bool _owned = false;

  String get _key {
    final s = Booth.I.s;
    return '${widget.template.id}|${widget.bw}|${widget.scale}|${s.eventName}|${s.eventDate}|${s.showEventOnPrint}|'
        '${s.clientLogoPath}|${s.logoStripBg}|${s.bwWholePrint}';
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant TemplateThumb old) {
    super.didUpdateWidget(old);
    if (old.template.id != widget.template.id || old.bw != widget.bw || old.photos != widget.photos) _load();
  }

  Future<void> _load() async {
    final usesPhotos = widget.photos != null;
    final key = _key;
    if (!usesPhotos && TemplateThumb._cache.containsKey(key)) {
      setState(() => _image = TemplateThumb._cache[key]);
      return;
    }
    final b = Booth.I;
    final s = b.s;
    final img = await TemplateRenderer.render(
      RenderRequest(
        template: widget.template,
        photos: widget.photos ?? const [],
        logo: b.brand.logo,
        logoOnLight: b.brand.logoOnLight,
        eventName: s.showEventOnPrint ? s.eventName : '',
        eventDate: s.showEventOnPrint ? s.eventDate : '',
        bw: widget.bw,
        bwWholePrint: s.bwWholePrint,
        mirror: s.mirrorPhotos,
        logoBgOverride: s.logoStripBg == 'template' ? null : s.logoStripBg,
        layerImages: await TemplateRenderer.loadLayerImages(widget.template),
      ),
      scale: widget.scale,
    );
    if (!mounted) {
      img.dispose();
      return;
    }
    if (_owned) _image?.dispose();
    if (usesPhotos) {
      _owned = true;
    } else {
      _owned = false;
      TemplateThumb._cache[key] = img;
      while (TemplateThumb._cache.length > 120) {
        TemplateThumb._cache.remove(TemplateThumb._cache.keys.first);
      }
    }
    setState(() => _image = img);
  }

  @override
  void dispose() {
    if (_owned) _image?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.template;
    return AspectRatio(
      aspectRatio: t.width / t.height,
      child: _image == null
          ? Container(color: PicokColors.surfaceHigh)
          : RawImage(image: _image, fit: BoxFit.contain, filterQuality: FilterQuality.medium),
    );
  }
}

/// A print-shaped card with a soft shadow.
class PrintCard extends StatelessWidget {
  const PrintCard({super.key, required this.child, this.rotation = 0});
  final Widget child;
  final double rotation;

  @override
  Widget build(BuildContext context) => Transform.rotate(
        angle: rotation,
        child: DecoratedBox(
          decoration: BoxDecoration(boxShadow: [
            BoxShadow(color: Colors.black.withValues(alpha: 0.6), blurRadius: 30, offset: const Offset(0, 14)),
          ]),
          child: child,
        ),
      );
}

void showToast(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message, style: const TextStyle(fontSize: 16)),
      backgroundColor: error ? PicokColors.danger : PicokColors.surfaceHigh,
    ));
}
