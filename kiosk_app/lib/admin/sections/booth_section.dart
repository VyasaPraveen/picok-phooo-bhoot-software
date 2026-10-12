import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../models/app_settings.dart';
import '../../services/booth.dart';
import '../../services/bridge_client.dart';
import '../../services/settings_store.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../admin_widgets.dart';

/// Print PC pairing, camera, timings, privacy, kiosk lock and PINs.
class BoothSection extends StatefulWidget {
  const BoothSection({super.key});

  @override
  State<BoothSection> createState() => _BoothSectionState();
}

class _BoothSectionState extends State<BoothSection> {
  String? _bridgeResult;
  bool _bridgeOk = false;
  bool _busy = false;
  bool? _deviceOwner;

  @override
  void initState() {
    super.initState();
    Booth.I.kiosk.isDeviceOwner().then((v) {
      if (mounted) setState(() => _deviceOwner = v);
    });
  }

  Future<void> _update(void Function(AppSettings s) f) async {
    await Booth.I.settings.update(f);
    if (mounted) setState(() {});
  }

  Future<void> _discover() async {
    setState(() {
      _busy = true;
      _bridgeResult = 'Searching the network…';
    });
    final found = await BridgeClient.discover();
    if (!mounted) return;
    setState(() => _busy = false);
    if (found.isEmpty) {
      setState(() => _bridgeResult = 'No Print Bridge found. Check the PC is on the same Wi-Fi and the bridge is running, or type its address.');
      return;
    }
    final pick = found.length == 1
        ? found.first
        : await showDialog<DiscoveredBridge>(
            context: context,
            builder: (c) => SimpleDialog(
              title: const Text('Choose the print PC'),
              children: [
                for (final f in found)
                  SimpleDialogOption(onPressed: () => Navigator.pop(c, f), child: Text('${f.name}  (${f.host}:${f.port})')),
              ],
            ),
          );
    if (pick == null) return;
    await _update((s) {
      s.bridgeHost = pick.host;
      s.bridgePort = pick.port;
    });
    setState(() => _bridgeResult = 'Found ${pick.name} at ${pick.host}. Now enter the pairing key shown on the PC.');
  }

  Future<void> _test() async {
    final b = Booth.I.bridge;
    if (b == null) {
      setState(() => _bridgeResult = 'Enter the PC address and pairing key first.');
      return;
    }
    setState(() {
      _busy = true;
      _bridgeResult = 'Connecting…';
    });
    try {
      final name = await b.ping();
      final st = await b.status();
      _bridgeOk = true;
      _bridgeResult = 'Connected to $name · printer: ${st.printer.message.isEmpty ? st.printer.state : st.printer.message} · '
          'payments: ${st.paymentProvider}${st.paymentsReady ? ' ready' : ' NOT ready – ${st.paymentMessage}'}';
    } on BridgeException catch (e) {
      _bridgeOk = false;
      _bridgeResult = e.message;
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _changePin(PinRole role) async {
    final c1 = TextEditingController(), c2 = TextEditingController();
    String? error;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: Text('New ${role == PinRole.admin ? 'admin' : 'operator'} PIN'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: c1, obscureText: true, keyboardType: TextInputType.number, maxLength: 8,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'New PIN (4–8 digits)')),
            TextField(controller: c2, obscureText: true, keyboardType: TextInputType.number, maxLength: 8,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: InputDecoration(labelText: 'Repeat PIN', errorText: error)),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(
              onPressed: () {
                final a = c1.text, b = c2.text;
                final other = role == PinRole.admin ? Booth.I.s.operatorPinHash : Booth.I.s.adminPinHash;
                if (a.length < 4) return set(() => error = 'At least 4 digits');
                if (a != b) return set(() => error = 'PINs do not match');
                if (SettingsStore.hashPin(a) == other) return set(() => error = 'Admin and operator PINs must differ');
                Navigator.pop(c, true);
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    final pin = c1.text;
    c1.dispose();
    c2.dispose();
    if (ok != true) return;
    await _update((s) {
      if (role == PinRole.admin) {
        s.adminPinHash = SettingsStore.hashPin(pin);
      } else {
        s.operatorPinHash = SettingsStore.hashPin(pin);
      }
    });
    if (mounted) showToast(context, 'PIN changed.');
  }

  Future<void> _exitApp() async {
    if (!await confirm(context, 'Close the booth app?', 'Kiosk lock is released and the app closes. Open it again from the tablet home screen.', ok: 'Close app')) {
      return;
    }
    await Booth.I.kiosk.stop();
    await SystemNavigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    final s = Booth.I.s;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        AdminSection(
          title: 'Print PC (EPIXS Print Bridge)',
          subtitle: 'The Windows PC connected to the DNP printer. Its address and pairing key are shown in the Print Bridge window.',
          children: [
            SettingRow(
              label: 'PC address',
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                CommitField(
                  width: 220,
                  value: s.bridgeHost,
                  hint: '192.168.1.20',
                  keyboard: TextInputType.url,
                  validator: (v) => RegExp(r'^[A-Za-z0-9.\-]*$').hasMatch(v) ? null : 'Invalid address',
                  onCommit: (v) => _update((s) => s.bridgeHost = v),
                ),
                const SizedBox(width: 8),
                CommitField(
                  width: 100,
                  value: '${s.bridgePort}',
                  keyboard: TextInputType.number,
                  formatters: [FilteringTextInputFormatter.digitsOnly],
                  validator: (v) {
                    final p = int.tryParse(v);
                    return p == null || p < 1 || p > 65535 ? 'Port?' : null;
                  },
                  onCommit: (v) => _update((s) => s.bridgePort = int.parse(v)),
                ),
              ]),
            ),
            SettingRow(
              label: 'Pairing key',
              child: CommitField(
                width: 220,
                value: s.bridgeKey,
                hint: 'e.g. K7M2QX',
                formatters: [UpperCaseTextFormatter()],
                onCommit: (v) => _update((s) => s.bridgeKey = v.toUpperCase()),
              ),
            ),
            Wrap(spacing: 8, children: [
              OutlinedButton.icon(onPressed: _busy ? null : _discover, icon: const Icon(Icons.wifi_find_rounded), label: const Text('Find print PC')),
              FilledButton.icon(onPressed: _busy ? null : _test, icon: const Icon(Icons.link_rounded), label: const Text('Test connection')),
            ]),
            if (_bridgeResult != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(_bridgeResult!, style: TextStyle(color: _bridgeOk ? PicokColors.peacock : PicokColors.textDim)),
              ),
          ],
        ),
        AdminSection(
          title: 'Camera',
          children: [
            SettingRow(
              label: 'Countdown',
              child: IntStepper(value: s.countdownSeconds, min: 1, max: 10, suffix: ' s', onChanged: (v) => _update((s) => s.countdownSeconds = v)),
            ),
            SettingRow(
              label: 'Retakes allowed per photo',
              child: IntStepper(value: s.retakesAllowed, min: 0, max: 5, onChanged: (v) => _update((s) => s.retakesAllowed = v)),
            ),
            SettingRow(
              label: 'Mirror photos on print',
              help: 'On = prints look like the on-screen preview; Off = true orientation (text reads correctly)',
              child: Switch(value: s.mirrorPhotos, onChanged: (v) => _update((s) => s.mirrorPhotos = v)),
            ),
            SettingRow(
              label: 'Black & white converts',
              child: SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, label: Text('Photos only')),
                  ButtonSegment(value: true, label: Text('Whole print')),
                ],
                selected: {s.bwWholePrint},
                onSelectionChanged: (v) => _update((s) => s.bwWholePrint = v.first),
              ),
            ),
          ],
        ),
        AdminSection(
          title: 'Timings',
          children: [
            SettingRow(
              label: 'Return to start when idle (before payment)',
              child: IntStepper(value: s.inactivitySeconds, min: 20, max: 600, step: 10, suffix: ' s', onChanged: (v) => _update((s) => s.inactivitySeconds = v)),
            ),
            SettingRow(
              label: 'Payment time limit',
              child: IntStepper(value: s.paymentTimeoutSeconds, min: 60, max: 900, step: 30, suffix: ' s', onChanged: (v) => _update((s) => s.paymentTimeoutSeconds = v)),
            ),
            SettingRow(
              label: 'Auto-print after preview',
              child: IntStepper(value: s.previewAutoPrintSeconds, min: 5, max: 120, step: 5, suffix: ' s', onChanged: (v) => _update((s) => s.previewAutoPrintSeconds = v)),
            ),
          ],
        ),
        AdminSection(
          title: 'Photo privacy',
          subtitle: 'Photos stay on this tablet and are never uploaded. They are deleted automatically.',
          children: [
            SettingRow(
              label: 'Delete photos',
              help: 'Keeping them for a short time allows reprints after a paper jam',
              child: DropdownButton<int>(
                value: const [0, 10, 30, 60, 180, 1440].contains(s.retentionMinutes) ? s.retentionMinutes : 30,
                onChanged: (v) => _update((s) => s.retentionMinutes = v ?? 30),
                items: const [
                  DropdownMenuItem(value: 0, child: Text('Immediately after printing')),
                  DropdownMenuItem(value: 10, child: Text('10 minutes after printing')),
                  DropdownMenuItem(value: 30, child: Text('30 minutes after printing')),
                  DropdownMenuItem(value: 60, child: Text('1 hour after printing')),
                  DropdownMenuItem(value: 180, child: Text('3 hours after printing')),
                  DropdownMenuItem(value: 1440, child: Text('24 hours after printing')),
                ],
              ),
            ),
          ],
        ),
        AdminSection(
          title: 'Kiosk lock',
          subtitle: _deviceOwner == true
              ? 'Full kiosk mode: guests cannot leave the app. Only the PIN unlocks it.'
              : 'Using Android screen pinning. For full lock-down set the app as device owner (see SETUP.md).',
          children: [
            SettingRow(
              label: 'Lock the tablet to the booth app',
              child: Switch(value: s.kioskEnabled, onChanged: (v) => _update((s) => s.kioskEnabled = v)),
            ),
            SettingRow(
              label: 'Screen orientation',
              help: 'Applies after closing this panel',
              child: SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: true, label: Text('Landscape')),
                  ButtonSegment(value: false, label: Text('Portrait')),
                ],
                selected: {s.landscape},
                onSelectionChanged: (v) async {
                  await _update((s) => s.landscape = v.first);
                  await SystemChrome.setPreferredOrientations(v.first
                      ? [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]
                      : [DeviceOrientation.portraitUp]);
                },
              ),
            ),
          ],
        ),
        AdminSection(
          title: 'PINs',
          children: [
            Wrap(spacing: 8, children: [
              OutlinedButton.icon(onPressed: () => _changePin(PinRole.admin), icon: const Icon(Icons.admin_panel_settings), label: const Text('Change admin PIN')),
              OutlinedButton.icon(onPressed: () => _changePin(PinRole.operator), icon: const Icon(Icons.badge_outlined), label: const Text('Change operator PIN')),
            ]),
            const SizedBox(height: 6),
            const Text('Operator PIN: orders, reprints, cash release and paper. Admin PIN: everything.',
                style: TextStyle(color: PicokColors.textDim, fontSize: 13)),
          ],
        ),
        AdminSection(
          title: 'App',
          children: [
            Row(children: [
              const Expanded(child: Text('Picok Booth 1.0.0 · by EPIXS Media', style: TextStyle(color: PicokColors.textDim))),
              TextButton.icon(onPressed: _exitApp, icon: const Icon(Icons.power_settings_new, color: PicokColors.danger), label: const Text('Close app')),
            ]),
          ],
        ),
      ],
    );
  }
}

class UpperCaseTextFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) =>
      newValue.copyWith(text: newValue.text.toUpperCase());
}
