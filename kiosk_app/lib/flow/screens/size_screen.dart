import 'package:flutter/material.dart';

import '../../models/print_size.dart';
import '../../services/booth.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Step 2 · Choose print size. Only sizes the loaded media roll can print are offered.
class SizeScreen extends StatelessWidget {
  const SizeScreen({super.key, required this.onPicked, required this.onBack});
  final ValueChanged<PrintSize> onPicked;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final b = Booth.I;
    final sizes = b.s.availableSizes;
    return Column(
      children: [
        const StepHeader(step: 2, title: 'Choose your print size', subtitle: 'Tap a size to continue'),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (final size in sizes)
                  Flexible(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 420),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        child: _SizeCard(size: size, onTap: () => onPicked(size)),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(32, 0, 32, 24),
          child: Row(children: [GhostButton(label: 'Start over', onPressed: onBack, icon: Icons.home_rounded)]),
        ),
      ],
    );
  }
}

class _SizeCard extends StatelessWidget {
  const _SizeCard({required this.size, required this.onTap});
  final PrintSize size;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final b = Booth.I;
    final sample = b.templates.visibleFor(size, b.s).firstOrNull;
    final price = b.fromPrice(size);
    return Semantics(
      button: true,
      label: '${size.label}, from ${rupees(price)}',
      child: Material(
        color: PicokColors.surface,
        borderRadius: BorderRadius.circular(28),
        child: InkWell(
          borderRadius: BorderRadius.circular(28),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                Expanded(
                  child: Center(
                    child: sample == null
                        ? AspectRatio(
                            aspectRatio: size.widthPx / size.heightPx,
                            child: Container(color: Colors.white24),
                          )
                        : PrintCard(child: TemplateThumb(template: sample, scale: 0.22)),
                  ),
                ),
                const SizedBox(height: 20),
                Text(size.label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                Text(size.mm, style: const TextStyle(fontSize: 16, color: PicokColors.textDim)),
                const SizedBox(height: 6),
                Text(size.blurb, textAlign: TextAlign.center, style: const TextStyle(fontSize: 17)),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
                  decoration: BoxDecoration(gradient: PicokColors.actionGradient, borderRadius: BorderRadius.circular(40)),
                  child: Text(
                    b.s.freeMode ? 'FREE' : rupees(price),
                    style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
