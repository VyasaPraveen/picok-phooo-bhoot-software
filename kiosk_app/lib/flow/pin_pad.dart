import 'package:flutter/material.dart';

import '../services/booth.dart';
import '../services/settings_store.dart';
import '../ui/theme.dart';

/// Shows a numeric PIN pad. Returns the unlocked role, or null if cancelled.
/// When [adminOnly] is true an operator PIN is not accepted.
Future<PinRole?> askPin(BuildContext context, {String title = 'Enter PIN', bool adminOnly = false}) =>
    showDialog<PinRole>(
      context: context,
      barrierDismissible: true,
      builder: (_) => _PinDialog(title: title, adminOnly: adminOnly),
    );

class _PinDialog extends StatefulWidget {
  const _PinDialog({required this.title, required this.adminOnly});
  final String title;
  final bool adminOnly;

  @override
  State<_PinDialog> createState() => _PinDialogState();
}

class _PinDialogState extends State<_PinDialog> {
  String _pin = '';
  String? _error;

  void _press(String d) {
    if (_pin.length >= 8) return;
    setState(() {
      _pin += d;
      _error = null;
    });
  }

  void _submit() {
    final store = Booth.I.settings;
    final lock = store.pinLockSeconds;
    if (lock > 0) {
      setState(() => _error = 'Too many attempts. Try again in $lock s.');
      return;
    }
    final role = store.checkPin(_pin);
    if (role == null || (widget.adminOnly && role != PinRole.admin)) {
      setState(() {
        _pin = '';
        _error = role == null ? 'Wrong PIN' : 'Admin PIN required';
      });
      return;
    }
    Navigator.of(context).pop(role);
  }

  Widget _key(String label, {VoidCallback? onTap, IconData? icon}) => Padding(
        padding: const EdgeInsets.all(6),
        child: SizedBox(
          width: 86,
          height: 72,
          child: FilledButton.tonal(
            onPressed: onTap ?? () => _press(label),
            style: FilledButton.styleFrom(
              backgroundColor: PicokColors.surfaceHigh,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            ),
            child: icon != null
                ? Icon(icon, size: 28)
                : Text(label, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w600)),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: PicokColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
            const SizedBox(height: 16),
            Semantics(
              label: '${_pin.length} digits entered',
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: List.generate(
                  _pin.isEmpty ? 4 : _pin.length.clamp(4, 8),
                  (i) => Container(
                    margin: const EdgeInsets.symmetric(horizontal: 6),
                    width: 16,
                    height: 16,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: i < _pin.length ? PicokColors.pink : PicokColors.outline,
                    ),
                  ),
                ),
              ),
            ),
            SizedBox(
              height: 32,
              child: Center(
                child: Text(_error ?? '', style: const TextStyle(color: PicokColors.danger, fontSize: 16)),
              ),
            ),
            for (final row in const [
              ['1', '2', '3'],
              ['4', '5', '6'],
              ['7', '8', '9'],
            ])
              Row(mainAxisSize: MainAxisSize.min, children: [for (final d in row) _key(d)]),
            Row(mainAxisSize: MainAxisSize.min, children: [
              _key('⌫', icon: Icons.backspace_outlined, onTap: () => setState(() => _pin = _pin.isEmpty ? '' : _pin.substring(0, _pin.length - 1))),
              _key('0'),
              _key('OK', icon: Icons.check_rounded, onTap: _pin.length >= 4 ? _submit : null),
            ]),
            const SizedBox(height: 8),
            TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          ],
        ),
      ),
    );
  }
}
