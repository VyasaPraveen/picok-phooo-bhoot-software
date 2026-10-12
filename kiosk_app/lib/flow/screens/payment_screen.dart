import 'dart:async';

import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../models/order.dart';
import '../../services/booth.dart';
import '../../services/bridge_client.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../pin_pad.dart';
import '../session.dart';

enum _PayState { preparing, waiting, paid, problem }

/// Step 5 · Pay by UPI. A single-use QR for the exact amount is created by the Print Bridge
/// (Razorpay) and the payment is confirmed automatically – no screenshots to check.
class PaymentScreen extends StatefulWidget {
  const PaymentScreen({
    super.key,
    required this.session,
    required this.onPaid,
    required this.onCancel,
    required this.onTimeout,
  });
  final BoothSession session;
  final VoidCallback onPaid;
  final VoidCallback onCancel;
  final VoidCallback onTimeout;

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  _PayState _state = _PayState.preparing;
  String _problem = '';
  bool _printerProblem = false;
  QrSession? _qr;
  BridgeClient? _bridge;
  BoothOrder? _order;
  Timer? _poll;
  Timer? _tick;
  DateTime _deadline = DateTime.now();
  bool _finished = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    final b = Booth.I;
    final s = widget.session;
    final now = DateTime.now();
    final order = BoothOrder(
      id: await b.db.nextOrderId(now),
      createdAt: now,
      updatedAt: now,
      size: s.size!,
      templateId: s.template!.id,
      templateName: s.template!.name,
      photos: s.template!.photos,
      bw: s.bw,
      copies: s.copies,
      amount: s.total,
      status: OrderStatus.awaitingPayment,
      eventName: b.s.eventName,
    );
    await b.db.save(order);
    _order = order;
    s.order = order;

    // Never take money if the booth cannot print.
    final problem = await b.readinessProblem(sheets: s.copies);
    if (!mounted) return;
    if (problem != null) {
      _showProblem('Sorry, the booth can’t print right now.\n$problem', printer: true);
      return;
    }

    if (b.s.freeMode || order.amount == 0) {
      await _markPaid(PaymentMethod.free);
      return;
    }

    _bridge = b.bridge;
    try {
      final qr = await _bridge!.createQr(orderId: order.id, amount: order.amount, description: 'Picok Booth ${s.description}');
      if (!mounted) return;
      order.qrId = qr.qrId;
      await b.db.save(order);
      final localLimit = DateTime.now().add(Duration(seconds: b.s.paymentTimeoutSeconds));
      _deadline = qr.expiresAt.isBefore(localLimit) ? qr.expiresAt : localLimit;
      setState(() {
        _qr = qr;
        _state = _PayState.waiting;
      });
      _poll = Timer.periodic(const Duration(seconds: 2), (_) => _check());
      _tick = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted) return;
        if (DateTime.now().isAfter(_deadline)) {
          _expire();
        } else {
          setState(() {});
        }
      });
    } on BridgeException catch (e) {
      _showProblem('UPI payment is not available right now.\n${e.message}');
    }
  }

  void _showProblem(String message, {bool printer = false}) {
    if (!mounted) return;
    setState(() {
      _state = _PayState.problem;
      _problem = message;
      _printerProblem = printer;
    });
  }

  Future<void> _check() async {
    final qr = _qr, bridge = _bridge;
    if (qr == null || bridge == null || _finished || _busy) return;
    _busy = true;
    try {
      final st = await bridge.qrStatus(qr.qrId);
      if (st.paid) {
        await _markPaid(PaymentMethod.upi, paymentId: st.paymentId, vpa: st.payerVpa);
      } else if (st.status == 'expired' || st.status == 'closed') {
        await _expire();
      }
    } on BridgeException {
      // Temporary network blip: keep polling until the deadline.
    } finally {
      _busy = false;
    }
  }

  /// Closes the QR. Returns true if money arrived in the meantime (the order then continues).
  Future<bool> _closeQr() async {
    final qr = _qr, bridge = _bridge;
    if (qr == null || bridge == null) return false;
    try {
      final st = await bridge.closeQr(qr.qrId);
      if (st.paid) {
        await _markPaid(PaymentMethod.upi, paymentId: st.paymentId, vpa: st.payerVpa);
        return true;
      }
    } on BridgeException {
      // If we cannot reach the bridge, the QR still expires on its own at the gateway.
    }
    return false;
  }

  Future<void> _expire() async {
    if (_finished) return;
    _stopTimers();
    if (await _closeQr()) return;
    await _cancelOrder();
    if (!mounted) return;
    showToast(context, 'Payment time ran out. Please start again.');
    widget.onTimeout();
  }

  Future<void> _cancel() async {
    if (_finished) return;
    _stopTimers();
    if (await _closeQr()) return;
    await _cancelOrder();
    if (mounted) widget.onCancel();
  }

  Future<void> _payCash() async {
    final role = await askPin(context, title: 'Operator PIN · cash received');
    if (role == null || _finished) return;
    _stopTimers();
    if (await _closeQr()) return;
    await _markPaid(PaymentMethod.cash);
  }

  void _stopTimers() {
    _poll?.cancel();
    _tick?.cancel();
  }

  Future<void> _cancelOrder() async {
    final o = _order;
    if (o == null || o.status != OrderStatus.awaitingPayment) return;
    o.status = OrderStatus.cancelled;
    await Booth.I.db.save(o);
  }

  Future<void> _markPaid(PaymentMethod method, {String? paymentId, String? vpa}) async {
    if (_finished) return;
    _finished = true;
    _stopTimers();
    final o = _order!;
    o
      ..status = OrderStatus.paid
      ..paymentMethod = method
      ..paymentId = paymentId
      ..payerVpa = vpa;
    if (method == PaymentMethod.free) {
      // Free-event orders carry no revenue.
      o.paymentId = null;
    }
    await Booth.I.db.save(o);
    if (!mounted) return;
    setState(() => _state = _PayState.paid);
    await Future<void>.delayed(Duration(milliseconds: method == PaymentMethod.free ? 300 : 1600));
    if (mounted) widget.onPaid();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    return Column(
      children: [
        StepHeader(step: 5, title: 'Scan & pay with UPI', subtitle: s.description),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 8),
            child: switch (_state) {
              _PayState.preparing => const Center(child: _Busy(text: 'Getting your payment QR ready…')),
              _PayState.paid => const Center(child: _PaidBanner()),
              _PayState.problem => _ProblemView(
                  message: _problem,
                  allowCash: !_printerProblem,
                  onCash: _payCash,
                  onBack: _cancel,
                ),
              _PayState.waiting => _qrView(s),
            },
          ),
        ),
      ],
    );
  }

  Widget _qrView(BoothSession s) {
    final qr = _qr!;
    final left = _deadline.difference(DateTime.now());
    final secs = left.inSeconds.clamp(0, 3600);
    return Row(
      children: [
        Expanded(
          child: Center(
            child: Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(28)),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    width: 380,
                    height: 380,
                    child: qr.upiString != null
                        ? QrImageView(data: qr.upiString!, size: 380, backgroundColor: Colors.white, semanticsLabel: 'UPI payment QR code')
                        : (qr.imageUrl != null
                            ? Image.network(qr.imageUrl!, headers: _bridge?.headers, fit: BoxFit.contain, semanticLabel: 'UPI payment QR code',
                                errorBuilder: (_, __, ___) => const Center(child: Text('QR unavailable', style: TextStyle(color: Colors.black))))
                            : const SizedBox()),
                  ),
                  const SizedBox(height: 8),
                  Text('Pay ${rupees(qr.amount)}', style: const TextStyle(color: Colors.black, fontSize: 30, fontWeight: FontWeight.w800)),
                  const Text('GPay · PhonePe · Paytm · BHIM · any UPI app', style: TextStyle(color: Colors.black54, fontSize: 15)),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 32),
        Expanded(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('1. Open any UPI app\n2. Scan this QR code\n3. Pay — we’ll confirm automatically',
                  style: TextStyle(fontSize: 24, height: 1.6)),
              const SizedBox(height: 28),
              Row(children: [
                SizedBox(
                  width: 64,
                  height: 64,
                  child: CircularProgressIndicator(
                    value: secs / Booth.I.s.paymentTimeoutSeconds.clamp(1, 3600),
                    strokeWidth: 6,
                    color: secs < 30 ? PicokColors.orange : PicokColors.cyan,
                    backgroundColor: PicokColors.outline,
                  ),
                ),
                const SizedBox(width: 18),
                Text('${secs ~/ 60}:${(secs % 60).toString().padLeft(2, '0')} left',
                    style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w600)),
              ]),
              const SizedBox(height: 12),
              const Row(children: [
                SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                SizedBox(width: 12),
                Text('Waiting for payment…', style: TextStyle(fontSize: 18, color: PicokColors.textDim)),
              ]),
              const SizedBox(height: 40),
              Row(children: [
                GhostButton(label: 'Cancel', onPressed: _cancel, icon: Icons.close_rounded),
                const SizedBox(width: 16),
                TextButton.icon(
                  onPressed: _payCash,
                  icon: const Icon(Icons.payments_outlined),
                  label: const Text('Pay cash at counter', style: TextStyle(fontSize: 17)),
                ),
              ]),
            ],
          ),
        ),
      ],
    );
  }
}

class _Busy extends StatelessWidget {
  const _Busy({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, children: [
        const CircularProgressIndicator(),
        const SizedBox(height: 20),
        Text(text, style: const TextStyle(fontSize: 22)),
      ]);
}

class _PaidBanner extends StatelessWidget {
  const _PaidBanner();
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(begin: 0.6, end: 1),
        duration: const Duration(milliseconds: 500),
        curve: Curves.elasticOut,
        builder: (_, v, child) => Transform.scale(scale: v, child: child),
        child: const Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.check_circle_rounded, color: PicokColors.peacock, size: 140),
          SizedBox(height: 12),
          Text('Payment received!', style: TextStyle(fontSize: 40, fontWeight: FontWeight.w800)),
          Text('Get ready to smile…', style: TextStyle(fontSize: 22, color: PicokColors.textDim)),
        ]),
      );
}

class _ProblemView extends StatelessWidget {
  const _ProblemView({required this.message, required this.allowCash, required this.onCash, required this.onBack});
  final String message;
  final bool allowCash;
  final VoidCallback onCash;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.error_outline_rounded, color: PicokColors.orange, size: 96),
          const SizedBox(height: 16),
          Text(message, textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, height: 1.4)),
          const SizedBox(height: 8),
          const Text('Please call the booth operator.', style: TextStyle(fontSize: 18, color: PicokColors.textDim)),
          const SizedBox(height: 32),
          Row(mainAxisSize: MainAxisSize.min, children: [
            GhostButton(label: 'Back', onPressed: onBack),
            if (allowCash) ...[
              const SizedBox(width: 16),
              BigButton(label: 'Pay cash at counter', icon: Icons.payments_outlined, onPressed: onCash, height: 64, fontSize: 20),
            ],
          ]),
        ]),
      );
}
