import 'package:flutter/material.dart';

import '../../services/booth.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../session.dart';

/// Step 4 · Colour or B&W, then the number of copies. The total updates live.
class OptionsScreen extends StatefulWidget {
  const OptionsScreen({
    super.key,
    required this.session,
    required this.onBack,
    required this.onContinue,
    required this.onChanged,
  });
  final BoothSession session;
  final VoidCallback onBack;
  final VoidCallback onContinue;
  final VoidCallback onChanged;

  @override
  State<OptionsScreen> createState() => _OptionsScreenState();
}

class _OptionsScreenState extends State<OptionsScreen> {
  void _set(void Function() f) {
    setState(f);
    widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    final b = Booth.I;
    final size = s.size!;
    final t = s.template!;
    final price = b.s.priceFor(size);
    final maxCopies = b.s.maxCopies.clamp(1, 10);
    if (s.copies > maxCopies) s.copies = maxCopies;
    final free = b.s.freeMode;

    return Column(
      children: [
        StepHeader(step: 4, title: 'Colour or black & white?', subtitle: '${size.label} · ${t.name}'),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 8),
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: Row(
                    children: [
                      Expanded(
                        child: _ModeCard(
                          label: 'Colour',
                          price: free ? null : price.colour,
                          selected: !s.bw,
                          onTap: () => _set(() => s.bw = false),
                          child: TemplateThumb(template: t, scale: 0.25),
                        ),
                      ),
                      const SizedBox(width: 20),
                      Expanded(
                        child: _ModeCard(
                          label: 'Black & white',
                          price: free ? null : price.bw,
                          selected: s.bw,
                          onTap: () => _set(() => s.bw = true),
                          child: TemplateThumb(template: t, bw: true, scale: 0.25),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 28),
                Expanded(
                  flex: 2,
                  child: Container(
                    padding: const EdgeInsets.all(28),
                    decoration: BoxDecoration(color: PicokColors.surface, borderRadius: BorderRadius.circular(28)),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Text('How many copies?', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
                        if (size.isStrip)
                          const Text('Each copy gives you 2 strips', style: TextStyle(fontSize: 16, color: PicokColors.textDim)),
                        const SizedBox(height: 20),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            _RoundButton(
                              icon: Icons.remove_rounded,
                              label: 'One less copy',
                              onTap: s.copies > 1 ? () => _set(() => s.copies--) : null,
                            ),
                            SizedBox(
                              width: 120,
                              child: Text('${s.copies}',
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(fontSize: 72, fontWeight: FontWeight.w800)),
                            ),
                            _RoundButton(
                              icon: Icons.add_rounded,
                              label: 'One more copy',
                              onTap: s.copies < maxCopies ? () => _set(() => s.copies++) : null,
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),
                        if (!free) ...[
                          _line('First copy', rupees(s.bw ? price.bw : price.colour)),
                          if (s.copies > 1) _line('${s.copies - 1} extra × ${rupees(price.extraCopy)}', rupees((s.copies - 1) * price.extraCopy)),
                          const Divider(height: 28),
                        ],
                        Row(
                          children: [
                            const Text('Total', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700)),
                            const Spacer(),
                            AnimatedSwitcher(
                              duration: const Duration(milliseconds: 200),
                              child: Text(
                                free ? 'FREE' : rupees(s.total),
                                key: ValueKey(s.total),
                                style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w800, color: PicokColors.yellow),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(32, 8, 32, 24),
          child: Row(
            children: [
              GhostButton(label: 'Back', onPressed: widget.onBack),
              const Spacer(),
              BigButton(
                label: free ? 'Continue' : 'Pay ${rupees(s.total)}',
                icon: free ? Icons.arrow_forward_rounded : Icons.qr_code_2_rounded,
                onPressed: widget.onContinue,
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _line(String a, String b) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Text(a, style: const TextStyle(fontSize: 18, color: PicokColors.textDim)),
          const Spacer(),
          Text(b, style: const TextStyle(fontSize: 18)),
        ]),
      );
}

class _ModeCard extends StatelessWidget {
  const _ModeCard({required this.label, required this.price, required this.selected, required this.onTap, required this.child});
  final String label;
  final int? price;
  final bool selected;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        selected: selected,
        label: label,
        child: GestureDetector(
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: PicokColors.surface,
              borderRadius: BorderRadius.circular(28),
              border: Border.all(color: selected ? PicokColors.cyan : Colors.transparent, width: 4),
            ),
            child: Column(
              children: [
                Expanded(child: Center(child: child)),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off,
                        color: selected ? PicokColors.cyan : PicokColors.textDim),
                    const SizedBox(width: 8),
                    Text(label, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                  ],
                ),
                if (price != null) Text(rupees(price!), style: const TextStyle(fontSize: 18, color: PicokColors.textDim)),
              ],
            ),
          ),
        ),
      );
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: label,
        child: Material(
          color: onTap == null ? PicokColors.surfaceHigh : PicokColors.purple,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(width: 76, height: 76, child: Icon(icon, size: 40)),
          ),
        ),
      );
}
