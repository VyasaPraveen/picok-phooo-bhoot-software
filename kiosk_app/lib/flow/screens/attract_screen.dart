import 'dart:async';

import 'package:flutter/material.dart';

import '../../services/booth.dart';
import '../../templates/template_def.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Step 1 · "Tap to start": event name, client logo and looping sample prints.
class AttractScreen extends StatefulWidget {
  const AttractScreen({super.key, required this.onStart, required this.onAdmin});
  final VoidCallback onStart;
  final VoidCallback onAdmin;

  @override
  State<AttractScreen> createState() => _AttractScreenState();
}

class _AttractScreenState extends State<AttractScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat(reverse: true);
  Timer? _carousel;
  int _sample = 0;
  final List<DateTime> _secretTaps = [];

  @override
  void initState() {
    super.initState();
    _carousel = Timer.periodic(const Duration(seconds: 3), (_) {
      if (mounted) setState(() => _sample++);
    });
  }

  @override
  void dispose() {
    _pulse.dispose();
    _carousel?.cancel();
    super.dispose();
  }

  /// Five quick taps in the top-left corner open the PIN pad.
  void _secretTap() {
    final now = DateTime.now();
    _secretTaps
      ..add(now)
      ..removeWhere((t) => now.difference(t) > const Duration(seconds: 3));
    if (_secretTaps.length >= 5) {
      _secretTaps.clear();
      widget.onAdmin();
    }
  }

  List<TemplateDef> _samples() {
    final b = Booth.I;
    final out = <TemplateDef>[];
    for (final size in b.s.availableSizes) {
      out.addAll(b.templates.visibleFor(size, b.s).where((t) => t.category != 'standard'));
    }
    if (out.isEmpty) {
      for (final size in b.s.availableSizes) {
        out.addAll(b.templates.visibleFor(size, b.s).take(2));
      }
    }
    return out;
  }

  String? _outOfOrder() {
    final s = Booth.I.s;
    if (!s.bridgeConfigured) return 'Booth setup is not finished. Please call the operator.';
    if (s.printsRemaining <= 0) return 'We are changing the paper. Back in a moment!';
    if (s.availableSizes.isEmpty) return 'No print sizes are switched on. Please call the operator.';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final s = Booth.I.s;
    final samples = _samples();
    final problem = _outOfOrder();
    final minPrice = s.availableSizes.isEmpty
        ? 0
        : s.availableSizes.map(Booth.I.fromPrice).reduce((a, b) => a < b ? a : b);

    return Stack(
      children: [
        Positioned.fill(
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: problem == null ? widget.onStart : null,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(56, 40, 40, 32),
              child: Row(
                children: [
                  Expanded(
                    flex: 11,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Spacer(),
                        Image.asset('assets/brand/picok_logo_transparent.png', height: 150, semanticLabel: 'Picok'),
                        const SizedBox(height: 24),
                        if (s.eventName.isNotEmpty)
                          ShaderMask(
                            shaderCallback: (r) => PicokColors.rainbowGradient.createShader(r),
                            child: Text(
                              s.eventName,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 46, fontWeight: FontWeight.w800, color: Colors.white, height: 1.1),
                            ),
                          ),
                        if (s.eventDate.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(s.eventDate, style: const TextStyle(fontSize: 22, color: PicokColors.textDim)),
                          ),
                        const SizedBox(height: 16),
                        const Text('Strike a pose. Take home a print\nin seconds.',
                            style: TextStyle(fontSize: 26, height: 1.3, color: PicokColors.textDim)),
                        const SizedBox(height: 40),
                        if (problem == null)
                          ScaleTransition(
                            scale: Tween(begin: 0.96, end: 1.04).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut)),
                            child: BigButton(
                              label: 'Tap to start',
                              icon: Icons.photo_camera_rounded,
                              height: 92,
                              fontSize: 32,
                              onPressed: widget.onStart,
                            ),
                          )
                        else
                          Container(
                            padding: const EdgeInsets.all(20),
                            decoration: BoxDecoration(
                              color: PicokColors.surface,
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: PicokColors.orange, width: 2),
                            ),
                            child: Row(mainAxisSize: MainAxisSize.min, children: [
                              const Icon(Icons.info_outline_rounded, color: PicokColors.orange, size: 32),
                              const SizedBox(width: 14),
                              Flexible(child: Text(problem, style: const TextStyle(fontSize: 22))),
                            ]),
                          ),
                        const SizedBox(height: 20),
                        if (problem == null)
                          Text(
                            s.freeMode ? 'Prints are FREE today — enjoy!' : 'Prints from ${rupees(minPrice)} · Pay by any UPI app',
                            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: PicokColors.yellow),
                          ),
                        const Spacer(),
                        if (s.showConsent)
                          Text(s.consentText, style: const TextStyle(fontSize: 13, color: PicokColors.textDim)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 32),
                  Expanded(
                    flex: 9,
                    child: samples.isEmpty
                        ? const SizedBox()
                        : Center(
                            child: AnimatedSwitcher(
                              duration: const Duration(milliseconds: 700),
                              transitionBuilder: (child, a) => FadeTransition(
                                opacity: a,
                                child: ScaleTransition(scale: Tween(begin: 0.92, end: 1.0).animate(a), child: child),
                              ),
                              child: KeyedSubtree(
                                key: ValueKey(_sample % samples.length),
                                child: PrintCard(
                                  rotation: (_sample.isEven ? -1 : 1) * 0.035,
                                  child: ConstrainedBox(
                                    constraints: const BoxConstraints(maxHeight: 620, maxWidth: 520),
                                    child: TemplateThumb(template: samples[_sample % samples.length], scale: 0.35),
                                  ),
                                ),
                              ),
                            ),
                          ),
                  ),
                ],
              ),
            ),
          ),
        ),
        // Hidden staff hotspot.
        Positioned(
          left: 0,
          top: 0,
          width: 110,
          height: 110,
          child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: _secretTap),
        ),
      ],
    );
  }
}
