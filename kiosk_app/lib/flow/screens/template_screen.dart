import 'package:flutter/material.dart';

import '../../render/filters.dart';
import '../../services/booth.dart';
import '../../templates/template_def.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../session.dart';

/// Step 3 · Choose layout & template: 1–4 photo layouts, standard designs or the AI Retro templates.
class TemplateScreen extends StatefulWidget {
  const TemplateScreen({super.key, required this.session, required this.onPicked, required this.onBack});
  final BoothSession session;
  final ValueChanged<TemplateDef> onPicked;
  final VoidCallback onBack;

  @override
  State<TemplateScreen> createState() => _TemplateScreenState();
}

class _TemplateScreenState extends State<TemplateScreen> {
  int? _photoFilter;
  TemplateDef? _selected;

  @override
  void initState() {
    super.initState();
    _selected = widget.session.template;
  }

  @override
  Widget build(BuildContext context) {
    final b = Booth.I;
    final size = widget.session.size!;
    final all = b.templates.visibleFor(size, b.s);
    final counts = all.map((t) => t.photos).toSet().toList()..sort();
    final shown = _photoFilter == null ? all : all.where((t) => t.photos == _photoFilter).toList();
    final selected = _selected != null && all.any((t) => t.id == _selected!.id) ? _selected : (all.isEmpty ? null : all.first);

    return Column(
      children: [
        StepHeader(step: 3, title: 'Pick your layout & design', subtitle: size.label),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(32, 8, 32, 0),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  flex: 3,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 10,
                        children: [
                          _chip('All designs', _photoFilter == null, () => setState(() => _photoFilter = null)),
                          for (final c in counts)
                            _chip('$c photo${c == 1 ? '' : 's'}', _photoFilter == c, () => setState(() => _photoFilter = c)),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Expanded(
                        child: GridView.builder(
                          padding: const EdgeInsets.only(bottom: 16),
                          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                            maxCrossAxisExtent: 210,
                            mainAxisSpacing: 16,
                            crossAxisSpacing: 16,
                            childAspectRatio: 0.62,
                          ),
                          itemCount: shown.length,
                          itemBuilder: (_, i) => _TemplateTile(
                            template: shown[i],
                            selected: shown[i].id == selected?.id,
                            onTap: () => setState(() => _selected = shown[i]),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 28),
                Expanded(
                  flex: 2,
                  child: selected == null
                      ? const Center(child: Text('No designs available for this size.', style: TextStyle(fontSize: 20)))
                      : Column(
                          children: [
                            Expanded(
                              child: Center(
                                child: PrintCard(child: TemplateThumb(key: ValueKey(selected.id), template: selected, scale: 0.4)),
                              ),
                            ),
                            const SizedBox(height: 14),
                            Text(selected.name, textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
                            Text(
                              [
                                '${selected.photos} photo${selected.photos == 1 ? '' : 's'}',
                                if (selected.filter != 'none') '${PhotoFilters.names[selected.filter] ?? selected.filter} filter',
                              ].join(' · '),
                              style: const TextStyle(fontSize: 16, color: PicokColors.textDim),
                            ),
                          ],
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
                label: 'Use this design',
                icon: Icons.arrow_forward_rounded,
                onPressed: selected == null ? null : () => widget.onPicked(selected),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _chip(String label, bool on, VoidCallback onTap) => ChoiceChip(
        label: Text(label, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
        selected: on,
        onSelected: (_) => onTap(),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        selectedColor: PicokColors.purple,
        backgroundColor: PicokColors.surface,
        showCheckmark: false,
        shape: const StadiumBorder(),
      );
}

class _TemplateTile extends StatelessWidget {
  const _TemplateTile({required this.template, required this.selected, required this.onTap});
  final TemplateDef template;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final badge = switch (template.category) {
      'retro' => ('AI RETRO', PicokColors.pink),
      'festival' || 'event' => ('SPECIAL', PicokColors.orange),
      'custom' => ('CUSTOM', PicokColors.peacock),
      _ => null,
    };
    return Semantics(
      button: true,
      selected: selected,
      label: '${template.name}, ${template.photos} photos',
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: PicokColors.surface,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: selected ? PicokColors.cyan : Colors.transparent, width: 3),
          ),
          child: Column(
            children: [
              Expanded(child: Center(child: TemplateThumb(template: template, scale: 0.16))),
              const SizedBox(height: 8),
              Text(template.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('${template.photos}', style: const TextStyle(fontSize: 13, color: PicokColors.textDim)),
                  const SizedBox(width: 3),
                  const Icon(Icons.photo_camera_outlined, size: 14, color: PicokColors.textDim),
                  if (badge != null) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                      decoration: BoxDecoration(color: badge.$2, borderRadius: BorderRadius.circular(6)),
                      child: Text(badge.$1, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800)),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
