import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../models/app_settings.dart';
import '../../models/print_size.dart';
import '../../services/booth.dart';
import '../../templates/template_def.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../admin_widgets.dart';

/// Show, hide and reorder templates; upload your own PNG frames; template cloud sync.
class TemplatesSection extends StatefulWidget {
  const TemplatesSection({super.key});

  @override
  State<TemplatesSection> createState() => _TemplatesSectionState();
}

class _TemplatesSectionState extends State<TemplatesSection> {
  late PrintSize _size = Booth.I.s.availableSizes.firstOrNull ?? PrintSize.p4x6;
  bool _syncing = false;
  String? _syncMessage;

  Future<void> _update(void Function(AppSettings s) f) async {
    await Booth.I.settings.update(f);
    if (mounted) setState(() {});
  }

  List<TemplateDef> _forSize() => Booth.I.templates.ordered(Booth.I.s).where((t) => t.size == _size).toList();

  Future<void> _reorder(int oldIndex, int newIndex) async {
    final b = Booth.I;
    final full = b.templates.ordered(b.s);
    final subset = full.where((t) => t.size == _size).toList();
    if (newIndex > oldIndex) newIndex--;
    final moved = subset.removeAt(oldIndex);
    subset.insert(newIndex, moved);
    // Keep other sizes where they are; replace this size's entries in order.
    var i = 0;
    final merged = [for (final t in full) t.size == _size ? subset[i++] : t];
    await _update((s) => s.templateOrder = merged.map((t) => t.id).toList());
  }

  Future<void> _addFrame() async {
    final bases = Booth.I.templates.all.where((t) => t.size == _size && t.category == 'standard' && t.id.startsWith('std_classic')).toList();
    if (bases.isEmpty) return;
    var base = bases.first;
    final nameCtl = TextEditingController(text: 'My frame');
    final go = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: Text('Add your own frame · ${_size.label}'),
          content: SizedBox(
            width: 560,
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Pick the photo layout your frame was designed for:'),
              const SizedBox(height: 8),
              DropdownButton<TemplateDef>(
                value: base,
                isExpanded: true,
                onChanged: (v) => set(() => base = v ?? base),
                items: [for (final t in bases) DropdownMenuItem(value: t, child: Text('${t.photos} photo${t.photos == 1 ? '' : 's'}${t.landscape ? ' · landscape' : ''}'))],
              ),
              const SizedBox(height: 8),
              Text(
                'Design your frame in Canva or Photoshop as a PNG of ${base.width.round()} × ${base.height.round()} px '
                '(300 dpi) with transparent windows where the photos go:\n'
                '${base.slots.map((s) => '• x ${s.x.round()}, y ${s.y.round()}, ${s.w.round()} × ${s.h.round()}').join('\n')}\n'
                'The logo strip sits at y ${base.logo.y.round()} – leave it transparent to keep the client logo.',
                style: const TextStyle(fontSize: 13, color: PicokColors.textDim),
              ),
              const SizedBox(height: 12),
              TextField(controller: nameCtl, decoration: const InputDecoration(labelText: 'Template name')),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton.icon(onPressed: () => Navigator.pop(c, true), icon: const Icon(Icons.upload_file), label: const Text('Choose PNG…')),
          ],
        ),
      ),
    );
    final name = nameCtl.text.trim();
    nameCtl.dispose();
    if (go != true) return;
    final res = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: ['png']);
    final path = res?.files.single.path;
    if (path == null) return;
    try {
      await Booth.I.templates.addCustomFrame(base: base, name: name.isEmpty ? 'My frame' : name, png: File(path));
      TemplateThumb.clearCache();
      if (mounted) {
        setState(() {});
        showToast(context, 'Frame added. It is now available to customers.');
      }
    } catch (e) {
      if (mounted) showToast(context, 'Could not add the frame: $e', error: true);
    }
  }

  Future<void> _sync() async {
    setState(() => _syncing = true);
    final r = await Booth.I.cloud.sync();
    TemplateThumb.clearCache();
    if (mounted) {
      setState(() {
        _syncing = false;
        _syncMessage = r.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = Booth.I;
    final s = b.s;
    final list = _forSize();
    final lastSync = DateTime.tryParse(s.lastCloudSync);
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        AdminSection(
          title: 'Templates',
          subtitle: 'Drag to reorder. Switch off designs that do not suit this event.',
          trailing: FilledButton.icon(onPressed: _addFrame, icon: const Icon(Icons.add_photo_alternate_outlined), label: const Text('Add your own frame')),
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SegmentedButton<PrintSize>(
                segments: [for (final p in PrintSize.values) ButtonSegment(value: p, label: Text(p.shortLabel))],
                selected: {_size},
                onSelectionChanged: (v) => setState(() => _size = v.first),
              ),
            ),
            const SizedBox(height: 12),
            ReorderableListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              buildDefaultDragHandles: false,
              itemCount: list.length,
              onReorder: _reorder,
              itemBuilder: (_, i) {
                final t = list[i];
                final visible = !s.hiddenTemplates.contains(t.id);
                final live = t.isActiveOn(DateTime.now());
                final dates = [
                  if (t.activeFrom != null) 'from ${DateFormat('d MMM').format(t.activeFrom!)}',
                  if (t.activeTo != null) 'until ${DateFormat('d MMM yyyy').format(t.activeTo!)}',
                ].join(' ');
                return Container(
                  key: ValueKey(t.id),
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: PicokColors.surfaceHigh, borderRadius: BorderRadius.circular(12)),
                  child: Row(children: [
                    ReorderableDragStartListener(index: i, child: const Padding(padding: EdgeInsets.all(8), child: Icon(Icons.drag_indicator))),
                    SizedBox(width: 56, height: 80, child: TemplateThumb(template: t, scale: 0.06)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(t.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                        Text(
                          '${t.category.toUpperCase()} · ${t.photos} photo${t.photos == 1 ? '' : 's'}'
                          '${t.packId != 'builtin' && t.packId != 'custom' ? ' · pack ${b.templates.packNames[t.packId] ?? t.packId}' : ''}'
                          '${dates.isEmpty ? '' : ' · $dates'}${live ? '' : ' (not live today)'}',
                          style: const TextStyle(fontSize: 13, color: PicokColors.textDim),
                        ),
                      ]),
                    ),
                    if (t.category == 'custom')
                      IconButton(
                        tooltip: 'Delete frame',
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () async {
                          if (!await confirm(context, 'Delete “${t.name}”?', 'This removes your uploaded frame.', ok: 'Delete')) return;
                          await b.templates.removeCustom(t.id);
                          if (mounted) setState(() {});
                        },
                      ),
                    Switch(
                      value: visible,
                      onChanged: (on) => _update((s) => on ? s.hiddenTemplates.remove(t.id) : s.hiddenTemplates.add(t.id)),
                    ),
                  ]),
                );
              },
            ),
          ],
        ),
        AdminSection(
          title: 'EPIXS template cloud',
          subtitle: 'New template packs and festival packs download automatically. No photos are ever uploaded.',
          children: [
            SettingRow(
              label: 'Manifest URL',
              help: 'https://…/manifest.json',
              child: CommitField(
                width: 420,
                value: s.cloudManifestUrl,
                hint: 'https://your-project.web.app/manifest.json',
                validator: (v) => v.isEmpty || v.startsWith('https://') ? null : 'Must start with https://',
                onCommit: (v) => _update((s) => s.cloudManifestUrl = v),
              ),
            ),
            SettingRow(
              label: 'Accept prices & settings from the cloud',
              help: 'Lets EPIXS push price or event changes remotely',
              child: Switch(value: s.acceptCloudSettings, onChanged: (v) => _update((s) => s.acceptCloudSettings = v)),
            ),
            Row(children: [
              FilledButton.icon(
                onPressed: _syncing || s.cloudManifestUrl.isEmpty ? null : _sync,
                icon: _syncing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.cloud_sync_rounded),
                label: const Text('Check for updates now'),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Text(
                  _syncMessage ?? (lastSync == null ? 'Never synced' : 'Last sync ${DateFormat('d MMM, HH:mm').format(lastSync)}'),
                  style: const TextStyle(color: PicokColors.textDim),
                ),
              ),
            ]),
            if (b.templates.packVersions.isNotEmpty) ...[
              const SizedBox(height: 12),
              for (final e in b.templates.packVersions.entries)
                Text('• ${b.templates.packNames[e.key] ?? e.key} (v${e.value})', style: const TextStyle(color: PicokColors.textDim)),
            ],
          ],
        ),
      ],
    );
  }
}
