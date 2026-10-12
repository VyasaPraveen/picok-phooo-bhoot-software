import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../ui/theme.dart';

/// A titled card grouping related settings.
class AdminSection extends StatelessWidget {
  const AdminSection({super.key, required this.title, required this.children, this.subtitle, this.trailing});
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 20),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: PicokColors.surface, borderRadius: BorderRadius.circular(18)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                  if (subtitle != null) Text(subtitle!, style: const TextStyle(fontSize: 14, color: PicokColors.textDim)),
                ]),
              ),
              if (trailing != null) trailing!,
            ]),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      );
}

/// Label on the left, control on the right.
class SettingRow extends StatelessWidget {
  const SettingRow({super.key, required this.label, required this.child, this.help});
  final String label;
  final String? help;
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(label, style: const TextStyle(fontSize: 16)),
                if (help != null) Text(help!, style: const TextStyle(fontSize: 13, color: PicokColors.textDim)),
              ]),
            ),
            const SizedBox(width: 16),
            child,
          ],
        ),
      );
}

/// − value + control for small integers.
class IntStepper extends StatelessWidget {
  const IntStepper({super.key, required this.value, required this.min, required this.max, required this.onChanged, this.step = 1, this.suffix = ''});
  final int value, min, max, step;
  final String suffix;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        IconButton.filledTonal(
          tooltip: 'Decrease',
          onPressed: value - step >= min ? () => onChanged(value - step) : null,
          icon: const Icon(Icons.remove),
        ),
        SizedBox(width: 90, child: Text('$value$suffix', textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600))),
        IconButton.filledTonal(
          tooltip: 'Increase',
          onPressed: value + step <= max ? () => onChanged(value + step) : null,
          icon: const Icon(Icons.add),
        ),
      ]);
}

/// Text field that commits on submit / focus loss.
class CommitField extends StatefulWidget {
  const CommitField({
    super.key,
    required this.value,
    required this.onCommit,
    this.width = 280,
    this.hint,
    this.keyboard,
    this.formatters,
    this.obscure = false,
    this.validator,
  });
  final String value;
  final ValueChanged<String> onCommit;
  final double width;
  final String? hint;
  final TextInputType? keyboard;
  final List<TextInputFormatter>? formatters;
  final bool obscure;

  /// Returns an error message, or null when valid.
  final String? Function(String)? validator;

  @override
  State<CommitField> createState() => _CommitFieldState();
}

class _CommitFieldState extends State<CommitField> {
  late final TextEditingController _c = TextEditingController(text: widget.value);
  final _focus = FocusNode();
  String? _error;

  @override
  void initState() {
    super.initState();
    _focus.addListener(() {
      if (!_focus.hasFocus) _commit();
    });
  }

  @override
  void didUpdateWidget(covariant CommitField old) {
    super.didUpdateWidget(old);
    if (!_focus.hasFocus && widget.value != _c.text) _c.text = widget.value;
  }

  @override
  void dispose() {
    _c.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _commit() {
    final v = _c.text.trim();
    final err = widget.validator?.call(v);
    setState(() => _error = err);
    if (err == null && v != widget.value) widget.onCommit(v);
  }

  @override
  Widget build(BuildContext context) => SizedBox(
        width: widget.width,
        child: TextField(
          controller: _c,
          focusNode: _focus,
          keyboardType: widget.keyboard,
          inputFormatters: widget.formatters,
          obscureText: widget.obscure,
          onSubmitted: (_) => _commit(),
          decoration: InputDecoration(hintText: widget.hint, errorText: _error, isDense: true),
        ),
      );
}

/// Rupee amount field storing paise.
class RupeeField extends StatelessWidget {
  const RupeeField({super.key, required this.paise, required this.onChanged, this.width = 120});
  final int paise;
  final ValueChanged<int> onChanged;
  final double width;

  @override
  Widget build(BuildContext context) => CommitField(
        width: width,
        value: paise % 100 == 0 ? '${paise ~/ 100}' : (paise / 100).toStringAsFixed(2),
        keyboard: const TextInputType.numberWithOptions(decimal: true),
        formatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
        hint: '₹',
        validator: (v) {
          final d = double.tryParse(v);
          if (d == null || d < 0 || d > 100000) return 'Invalid';
          return null;
        },
        onCommit: (v) => onChanged((double.parse(v) * 100).round()),
      );
}

Future<bool> confirm(BuildContext context, String title, String body, {String ok = 'OK'}) async =>
    await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(ok)),
        ],
      ),
    ) ??
    false;
