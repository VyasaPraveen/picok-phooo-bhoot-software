import 'package:flutter/material.dart';

import '../../models/app_settings.dart';
import '../../models/print_size.dart';
import '../../services/booth.dart';
import '../../services/bridge_client.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../admin_widgets.dart';

/// Loaded media roll, paper counter, finish and the live printer status.
class PaperSection extends StatefulWidget {
  const PaperSection({super.key});

  @override
  State<PaperSection> createState() => _PaperSectionState();
}

class _PaperSectionState extends State<PaperSection> {
  BridgeStatus? _status;
  String? _statusError;
  bool _testing = false;

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  Future<void> _loadStatus() async {
    final b = Booth.I.bridge;
    if (b == null) {
      setState(() => _statusError = 'Print PC not set up (Booth setup → Print PC).');
      return;
    }
    try {
      final st = await b.status();
      if (mounted) {
        setState(() {
          _status = st;
          _statusError = null;
        });
      }
    } on BridgeException catch (e) {
      if (mounted) setState(() => _statusError = e.message);
    }
  }

  Future<void> _testPrint() async {
    final b = Booth.I.bridge;
    if (b == null) return;
    setState(() => _testing = true);
    try {
      final media = Booth.I.s.availableSizes.firstOrNull?.key ?? '4x6';
      await b.testPrint(media, Booth.I.s.finish);
      if (mounted) showToast(context, 'Test print sent ($media).');
    } on BridgeException catch (e) {
      if (mounted) showToast(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _testing = false);
    }
  }

  Future<void> _update(void Function(AppSettings s) f) async {
    await Booth.I.settings.update(f);
    if (mounted) setState(() {});
  }

  Future<void> _newRoll() async {
    final roll = Booth.I.s.loadedRoll;
    if (!await confirm(context, 'New roll loaded?', 'Reset the paper counter to ${roll.capacity} prints for ${roll.label}?', ok: 'Reset')) return;
    await _update((s) => s.printsRemaining = roll.capacity);
  }

  @override
  Widget build(BuildContext context) {
    final s = Booth.I.s;
    final st = _status;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        AdminSection(
          title: 'Printer',
          trailing: IconButton(onPressed: _loadStatus, icon: const Icon(Icons.refresh), tooltip: 'Refresh'),
          children: [
            if (_statusError != null)
              Text(_statusError!, style: const TextStyle(color: PicokColors.danger))
            else if (st == null)
              const LinearProgressIndicator()
            else ...[
              SettingRow(
                label: st.printer.name.isEmpty ? 'Printer' : st.printer.name,
                help: st.printer.message,
                child: Chip(
                  label: Text(st.printer.state.replaceAll('_', ' ').toUpperCase()),
                  backgroundColor: st.printer.canPrint ? PicokColors.peacock : PicokColors.danger,
                ),
              ),
              SettingRow(
                label: 'Payments',
                help: st.paymentMessage,
                child: Chip(
                  label: Text(st.paymentProvider.toUpperCase()),
                  backgroundColor: st.paymentsReady ? PicokColors.peacock : PicokColors.orange,
                ),
              ),
            ],
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: _testing || Booth.I.bridge == null ? null : _testPrint,
                icon: const Icon(Icons.print_rounded),
                label: const Text('Send test print'),
              ),
            ),
          ],
        ),
        AdminSection(
          title: 'Paper counter',
          subtitle: 'Counts prints left on the loaded roll and warns before it runs out',
          children: [
            Row(children: [
              Text('${s.printsRemaining}',
                  style: TextStyle(fontSize: 56, fontWeight: FontWeight.w800, color: s.paperLow ? PicokColors.orange : PicokColors.text)),
              const SizedBox(width: 12),
              Text('prints left of ${s.loadedRoll.capacity}', style: const TextStyle(fontSize: 18, color: PicokColors.textDim)),
              const Spacer(),
              FilledButton.icon(onPressed: _newRoll, icon: const Icon(Icons.autorenew_rounded), label: const Text('New roll loaded')),
            ]),
            if (s.paperLow)
              const Text('Paper is running low — keep a new media set ready.', style: TextStyle(color: PicokColors.orange)),
            SettingRow(
              label: 'Adjust count',
              child: IntStepper(value: s.printsRemaining, min: 0, max: 2000, step: 1, onChanged: (v) => _update((s) => s.printsRemaining = v)),
            ),
            SettingRow(
              label: 'Warn when below',
              child: IntStepper(value: s.lowPaperThreshold, min: 0, max: 300, step: 10, onChanged: (v) => _update((s) => s.lowPaperThreshold = v)),
            ),
          ],
        ),
        AdminSection(
          title: 'Loaded media',
          subtitle: 'The DNP holds one roll at a time. Customers only see sizes this roll can print.',
          children: [
            SettingRow(
              label: 'Roll in the printer',
              child: DropdownButton<MediaRoll>(
                value: s.loadedRoll,
                onChanged: (r) async {
                  if (r == null || r == s.loadedRoll) return;
                  await _update((s) {
                    s.loadedRoll = r;
                    s.printsRemaining = r.capacity;
                  });
                  if (context.mounted) showToast(context, 'Media set to ${r.label}. Counter reset to ${r.capacity}.');
                },
                items: [for (final r in MediaRoll.values) DropdownMenuItem(value: r, child: Text(r.label))],
              ),
            ),
            for (final size in s.loadedRoll.sizes)
              SettingRow(
                label: 'Offer ${size.label}',
                child: Switch(
                  value: !s.disabledSizes.contains(size.key),
                  onChanged: (on) => _update((s) => on ? s.disabledSizes.remove(size.key) : s.disabledSizes.add(size.key)),
                ),
              ),
            SettingRow(
              label: 'Print finish',
              help: 'Sent to the Print Bridge, which applies the matching DNP driver profile',
              child: SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'gloss', label: Text('Gloss')),
                  ButtonSegment(value: 'matte', label: Text('Matte')),
                ],
                selected: {s.finish},
                onSelectionChanged: (v) => _update((s) => s.finish = v.first),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
