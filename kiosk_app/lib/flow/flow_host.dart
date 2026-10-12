import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;

import '../admin/admin_screen.dart';
import '../models/order.dart';
import '../services/booth.dart';
import '../ui/widgets.dart';
import 'pin_pad.dart';
import 'screens/attract_screen.dart';
import 'screens/capture_screen.dart';
import 'screens/options_screen.dart';
import 'screens/payment_screen.dart';
import 'screens/preview_screen.dart';
import 'screens/printing_screen.dart';
import 'screens/size_screen.dart';
import 'screens/template_screen.dart';
import 'session.dart';

/// The eight booth steps from the quotation (Section 01).
enum FlowStep { attract, size, template, options, payment, capture, preview, printing }

/// Hosts the customer flow, switches between steps and returns to the start screen
/// when a customer walks away before paying.
class FlowHost extends StatefulWidget {
  const FlowHost({super.key});

  @override
  State<FlowHost> createState() => _FlowHostState();
}

class _FlowHostState extends State<FlowHost> {
  FlowStep _step = FlowStep.attract;
  BoothSession _session = BoothSession();
  Timer? _idle;

  static const _idleSteps = {FlowStep.size, FlowStep.template, FlowStep.options};

  @override
  void initState() {
    super.initState();
    Booth.I.settings.addListener(_onSettings);
  }

  @override
  void dispose() {
    _idle?.cancel();
    Booth.I.settings.removeListener(_onSettings);
    super.dispose();
  }

  void _onSettings() {
    if (mounted && _step == FlowStep.attract) setState(() {});
  }

  void _go(FlowStep step) {
    setState(() => _step = step);
    _armIdle();
  }

  void _armIdle() {
    _idle?.cancel();
    if (_idleSteps.contains(_step)) {
      _idle = Timer(Duration(seconds: Booth.I.s.inactivitySeconds), _reset);
    }
  }

  void _reset() {
    _idle?.cancel();
    setState(() {
      _session = BoothSession();
      _step = FlowStep.attract;
    });
    unawaited(Booth.I.housekeeping());
  }

  Future<void> _openAdmin() async {
    final role = await askPin(context, title: 'Operator / Admin PIN');
    if (role == null || !mounted) return;
    final booth = Booth.I;
    // Leave lock-task while staff are in the panel (sharing reports, picking files).
    await booth.kiosk.stop();
    if (!mounted) return;
    final resume = await Navigator.of(context).push<BoothOrder>(
      MaterialPageRoute(builder: (_) => AdminScreen(role: role)),
    );
    TemplateThumb.clearCache();
    await booth.brand.refresh();
    if (booth.s.kioskEnabled) await booth.kiosk.start();
    if (!mounted) return;
    if (resume != null) {
      await _resume(resume);
    } else {
      setState(() {});
    }
  }

  /// Continues a paid order from wherever it stopped.
  Future<void> _resume(BoothOrder o) async {
    final s = BoothSession.fromOrder(o);
    if (s.template == null) {
      showToast(context, 'The template for order ${o.id} is no longer available.', error: true);
      return;
    }
    if (o.printFile != null && await File(o.printFile!).exists()) {
      _session = s;
      _go(FlowStep.printing);
      return;
    }
    if (o.photoDir != null) {
      final photos = [
        for (var i = 1; i <= s.template!.photos; i++) p.join(o.photoDir!, 'photo_$i.jpg'),
      ];
      if (await Future.wait(photos.map((f) => File(f).exists())).then((r) => r.every((e) => e))) {
        s.photos.addAll(photos);
        _session = s;
        _go(FlowStep.preview);
        return;
      }
    }
    _session = s;
    _go(FlowStep.capture);
  }

  Widget _screen() {
    final s = _session;
    switch (_step) {
      case FlowStep.attract:
        return AttractScreen(onStart: () => _go(FlowStep.size), onAdmin: _openAdmin);
      case FlowStep.size:
        return SizeScreen(
          onBack: _reset,
          onPicked: (size) {
            if (s.size != size) s.template = null;
            s.size = size;
            _go(FlowStep.template);
          },
        );
      case FlowStep.template:
        return TemplateScreen(
          session: s,
          onBack: () => _go(FlowStep.size),
          onPicked: (t) {
            s.template = t;
            s.bw = t.filter == 'classic_bw';
            _go(FlowStep.options);
          },
        );
      case FlowStep.options:
        return OptionsScreen(
          session: s,
          onBack: () => _go(FlowStep.template),
          onContinue: () => _go(FlowStep.payment),
          onChanged: _armIdle,
        );
      case FlowStep.payment:
        return PaymentScreen(
          session: s,
          onCancel: () => _go(FlowStep.options),
          onTimeout: _reset,
          onPaid: () => _go(FlowStep.capture),
        );
      case FlowStep.capture:
        return CaptureScreen(
          session: s,
          onDone: () => _go(FlowStep.preview),
          onAbandoned: _reset,
        );
      case FlowStep.preview:
        return PreviewScreen(session: s, onPrint: () => _go(FlowStep.printing));
      case FlowStep.printing:
        return PrintingScreen(session: s, onFinished: _reset);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: (_) => _armIdle(),
        child: Scaffold(
          body: GlowBackground(
            child: SafeArea(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 280),
                child: KeyedSubtree(key: ValueKey(_step), child: _screen()),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
