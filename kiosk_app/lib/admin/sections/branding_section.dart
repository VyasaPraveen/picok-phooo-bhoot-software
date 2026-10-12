import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../models/app_settings.dart';
import '../../services/booth.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../admin_widgets.dart';

/// Event client's logo, event name/date on prints, and the guest photo-consent notice.
class BrandingSection extends StatefulWidget {
  const BrandingSection({super.key});

  @override
  State<BrandingSection> createState() => _BrandingSectionState();
}

class _BrandingSectionState extends State<BrandingSection> {
  int _previewKey = 0;

  Future<void> _update(void Function(AppSettings s) f) async {
    await Booth.I.settings.update(f);
    TemplateThumb.clearCache();
    if (mounted) setState(() => _previewKey++);
  }

  Future<void> _pickLogo() async {
    final res = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: ['png', 'jpg', 'jpeg', 'webp']);
    final path = res?.files.single.path;
    if (path == null) return;
    try {
      await Booth.I.brand.setClientLogo(File(path));
      TemplateThumb.clearCache();
      if (mounted) {
        setState(() => _previewKey++);
        showToast(context, 'Client logo updated. It now appears on every print.');
      }
    } catch (_) {
      if (mounted) showToast(context, 'That file is not a valid image.', error: true);
    }
  }

  Future<void> _clearLogo() async {
    await Booth.I.brand.clearClientLogo();
    TemplateThumb.clearCache();
    if (mounted) setState(() => _previewKey++);
  }

  @override
  Widget build(BuildContext context) {
    final b = Booth.I;
    final s = b.s;
    final size = s.availableSizes.firstOrNull;
    final sample = size == null ? null : b.templates.visibleFor(size, s).firstOrNull;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(children: [
                AdminSection(
                  title: 'Client brand logo',
                  subtitle: 'Printed at the bottom of every print. Use a PNG with a transparent background for best results.',
                  children: [
                    Row(children: [
                      Container(
                        width: 220,
                        height: 90,
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(color: PicokColors.surfaceHigh, borderRadius: BorderRadius.circular(12)),
                        child: s.clientLogoPath != null && File(s.clientLogoPath!).existsSync()
                            ? Image.file(File(s.clientLogoPath!), fit: BoxFit.contain)
                            : Image.asset('assets/brand/picok_logo_transparent.png', fit: BoxFit.contain),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Wrap(spacing: 8, runSpacing: 8, children: [
                          FilledButton.icon(onPressed: _pickLogo, icon: const Icon(Icons.upload_rounded), label: const Text('Upload logo')),
                          if (s.clientLogoPath != null)
                            OutlinedButton(onPressed: _clearLogo, child: const Text('Use Picok logo')),
                        ]),
                      ),
                    ]),
                    const SizedBox(height: 8),
                    SettingRow(
                      label: 'Logo strip colour',
                      help: 'Follow each template, or force white / black for this client\'s logo',
                      child: SegmentedButton<String>(
                        segments: const [
                          ButtonSegment(value: 'template', label: Text('Template')),
                          ButtonSegment(value: '#FFFFFF', label: Text('White')),
                          ButtonSegment(value: '#000000', label: Text('Black')),
                        ],
                        selected: {s.logoStripBg},
                        onSelectionChanged: (v) => _update((s) => s.logoStripBg = v.first),
                      ),
                    ),
                  ],
                ),
                AdminSection(
                  title: 'Event',
                  children: [
                    SettingRow(
                      label: 'Event name',
                      help: 'Shown on the start screen and on prints (e.g. “Ravi weds Priya”)',
                      child: CommitField(value: s.eventName, hint: 'Event name', onCommit: (v) => _update((s) => s.eventName = v)),
                    ),
                    SettingRow(
                      label: 'Event date',
                      child: CommitField(value: s.eventDate, hint: 'e.g. 12 Oct 2026', onCommit: (v) => _update((s) => s.eventDate = v)),
                    ),
                    SettingRow(
                      label: 'Show event name & date on prints',
                      child: Switch(value: s.showEventOnPrint, onChanged: (v) => _update((s) => s.showEventOnPrint = v)),
                    ),
                    SettingRow(
                      label: 'Business name',
                      child: CommitField(value: s.businessName, onCommit: (v) => _update((s) => s.businessName = v.isEmpty ? 'Picok' : v)),
                    ),
                  ],
                ),
                AdminSection(
                  title: 'Photo consent notice',
                  subtitle: 'Shown on the start screen. You are responsible for displaying consent at events.',
                  children: [
                    SettingRow(label: 'Show notice', child: Switch(value: s.showConsent, onChanged: (v) => _update((s) => s.showConsent = v))),
                    CommitField(
                      width: double.infinity,
                      value: s.consentText,
                      onCommit: (v) => _update((s) => s.consentText = v.isEmpty ? AppSettings.defaultConsent : v),
                    ),
                  ],
                ),
              ]),
            ),
            const SizedBox(width: 24),
            SizedBox(
              width: 300,
              child: AdminSection(
                title: 'Preview',
                children: [
                  if (sample != null)
                    TemplateThumb(key: ValueKey('${sample.id}$_previewKey'), template: sample, scale: 0.25)
                  else
                    const Text('No template available for the loaded media.'),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}
