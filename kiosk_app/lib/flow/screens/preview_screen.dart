import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../services/booth.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../session.dart';

/// Step 7 · Preview: the photos in the chosen template with the brand logo, exactly as they will print.
class PreviewScreen extends StatefulWidget {
  const PreviewScreen({super.key, required this.session, required this.onPrint});
  final BoothSession session;
  final VoidCallback onPrint;

  @override
  State<PreviewScreen> createState() => _PreviewScreenState();
}

class _PreviewScreenState extends State<PreviewScreen> {
  Uint8List? _png;
  String? _error;
  Timer? _timer;
  int _secondsLeft = 0;
  bool _sent = false;

  @override
  void initState() {
    super.initState();
    _compose();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _compose() async {
    final b = Booth.I;
    final s = widget.session;
    try {
      final png = await b.composePrint(s.template!, s.photos, bw: s.bw);
      final o = s.order!;
      o.printFile = await b.photos.savePrint(o.id, png);
      await b.db.save(o);
      if (!mounted) return;
      setState(() {
        _png = png;
        _secondsLeft = b.s.previewAutoPrintSeconds;
      });
      _timer = Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted) return;
        if (--_secondsLeft <= 0) {
          t.cancel();
          _print();
        } else {
          setState(() {});
        }
      });
    } catch (e) {
      if (mounted) setState(() => _error = 'We could not create your print. Your order is saved — please call the operator.');
    }
  }

  void _print() {
    if (_sent) return;
    _sent = true;
    _timer?.cancel();
    widget.onPrint();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    return Column(
      children: [
        StepHeader(step: 7, title: 'Your print', subtitle: s.description),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(32, 4, 32, 16),
            child: Row(
              children: [
                Expanded(
                  child: Center(
                    child: _png != null
                        ? PrintCard(child: Image.memory(_png!, fit: BoxFit.contain, filterQuality: FilterQuality.medium, semanticLabel: 'Print preview'))
                        : _error != null
                            ? Text(_error!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 22))
                            : const Column(mainAxisSize: MainAxisSize.min, children: [
                                CircularProgressIndicator(),
                                SizedBox(height: 16),
                                Text('Creating your print…', style: TextStyle(fontSize: 22)),
                              ]),
                  ),
                ),
                SizedBox(
                  width: 340,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (s.size!.isStrip)
                        const Padding(
                          padding: EdgeInsets.only(bottom: 16),
                          child: Text('You get two strips — one for you, one for a friend!',
                              textAlign: TextAlign.center, style: TextStyle(fontSize: 18, color: PicokColors.textDim)),
                        ),
                      BigButton(label: 'Print it!', icon: Icons.print_rounded, onPressed: _png == null ? null : _print),
                      const SizedBox(height: 12),
                      if (_png != null)
                        Text('Printing automatically in $_secondsLeft s',
                            style: const TextStyle(fontSize: 16, color: PicokColors.textDim)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
