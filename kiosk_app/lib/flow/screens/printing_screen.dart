import 'dart:async';

import 'package:flutter/material.dart';

import '../../services/booth.dart';
import '../../services/bridge_client.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../session.dart';

enum _PrintPhase { sending, printing, done, failed }

/// Step 8 · Print: sent to the DNP printer, then back to Step 1.
class PrintingScreen extends StatefulWidget {
  const PrintingScreen({super.key, required this.session, required this.onFinished});
  final BoothSession session;
  final VoidCallback onFinished;

  @override
  State<PrintingScreen> createState() => _PrintingScreenState();
}

class _PrintingScreenState extends State<PrintingScreen> with SingleTickerProviderStateMixin {
  _PrintPhase _phase = _PrintPhase.sending;
  String _message = '';

  /// A printer problem the operator is fixing while the job waits (e.g. paper out).
  String? _problem;
  late final AnimationController _anim =
      AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();
  Timer? _exit;

  @override
  void initState() {
    super.initState();
    _run();
  }

  @override
  void dispose() {
    _anim.dispose();
    _exit?.cancel();
    super.dispose();
  }

  Future<void> _run() async {
    final order = widget.session.order!;
    PrintJobStatus result;
    try {
      result = await Booth.I.printOrder(order, onStatus: (st) {
        if (!mounted) return;
        setState(() {
          _phase = _PrintPhase.printing;
          _problem = st.startsWith('error:') ? st.substring(6) : null;
        });
      });
    } on BridgeException catch (e) {
      result = PrintJobStatus(jobId: '', status: 'error', message: e.message);
    }
    if (!mounted) return;
    final ok = result.status == 'done';
    setState(() {
      _phase = ok ? _PrintPhase.done : _PrintPhase.failed;
      _message = result.message;
    });
    _anim.stop();
    _exit = Timer(Duration(seconds: ok ? 9 : 30), widget.onFinished);
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    final order = s.order!;
    final prints = order.printsOut;
    final what = s.size!.isStrip ? '$prints strip${prints == 1 ? '' : 's'}' : '$prints print${prints == 1 ? '' : 's'}';
    return Column(
      children: [
        StepHeader(step: 8, title: _phase == _PrintPhase.done ? 'Enjoy your $what!' : 'Printing', subtitle: 'Order ${order.id}'),
        Expanded(
          child: Center(
            child: switch (_phase) {
              _PrintPhase.sending || _PrintPhase.printing => Column(mainAxisSize: MainAxisSize.min, children: [
                  RotationTransition(
                    turns: _anim,
                    child: ShaderMask(
                      shaderCallback: (r) => const SweepGradient(colors: [...PicokColors.rainbow, PicokColors.cyan]).createShader(r),
                      child: const Icon(Icons.camera_rounded, size: 160, color: Colors.white),
                    ),
                  ),
                  const SizedBox(height: 28),
                  Text(_phase == _PrintPhase.sending ? 'Sending to the printer…' : 'Printing your $what…',
                      style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  if (_problem == null)
                    const Text('It takes about 12 seconds per print. Please collect it from the printer tray.',
                        style: TextStyle(fontSize: 20, color: PicokColors.textDim))
                  else
                    Text('Printer needs attention: $_problem\nPlease call the operator — your print will continue.',
                        textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, color: PicokColors.orange, height: 1.4)),
                ]),
              _PrintPhase.done => Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.favorite_rounded, color: PicokColors.pink, size: 130),
                  const SizedBox(height: 16),
                  const Text('Thank you!', style: TextStyle(fontSize: 56, fontWeight: FontWeight.w800)),
                  Text('Collect your $what from the printer tray.', style: const TextStyle(fontSize: 24, color: PicokColors.textDim)),
                  const SizedBox(height: 36),
                  BigButton(label: 'Done', icon: Icons.check_rounded, onPressed: widget.onFinished),
                ]),
              _PrintPhase.failed => Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.print_disabled_rounded, color: PicokColors.orange, size: 120),
                  const SizedBox(height: 16),
                  const Text('Oops — the printer needs a hand', style: TextStyle(fontSize: 38, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  Text(
                    'Your order ${order.id} is saved and paid. Please call the operator to reprint it.'
                    '${_message.isEmpty ? '' : '\n($_message)'}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 22, color: PicokColors.textDim, height: 1.4),
                  ),
                  const SizedBox(height: 32),
                  GhostButton(label: 'OK', icon: Icons.check_rounded, onPressed: widget.onFinished),
                ]),
            },
          ),
        ),
      ],
    );
  }
}
