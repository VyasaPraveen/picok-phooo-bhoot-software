@Tags(['e2e'])
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:picok_booth/services/bridge_client.dart';

/// End-to-end contract test against a running EPIXS Print Bridge in Simulator payment mode.
/// Opt-in: BRIDGE_E2E=1 BRIDGE_KEY=PAIRING_KEY [BRIDGE_HOST=127.0.0.1] flutter test test/bridge_e2e_test.dart
/// (It does not print, so no paper is used.)
void main() {
  final env = Platform.environment;
  final enabled = env['BRIDGE_E2E'] == '1';
  final client = BridgeClient(
    host: env['BRIDGE_HOST'] ?? '127.0.0.1',
    port: int.tryParse(env['BRIDGE_PORT'] ?? '') ?? 8686,
    key: env['BRIDGE_KEY'] ?? '',
  );

  test('ping and status', () async {
    expect(await client.ping(), isNotEmpty);
    final st = await client.status();
    expect(st.paymentProvider, 'simulator');
    expect(st.paymentsReady, isTrue);
    expect(['ready', 'printing', 'offline', 'paper_out', 'jammed', 'error', 'not_found'], contains(st.printer.state));
  }, skip: !enabled);

  test('wrong key is rejected', () async {
    final bad = BridgeClient(host: client.host, port: client.port, key: 'WRONG1');
    await expectLater(bad.status(), throwsA(isA<BridgeException>().having((e) => e.unauthorized, 'unauthorized', isTrue)));
  }, skip: !enabled);

  test('UPI QR is created, image served, and auto-paid', () async {
    final qr = await client.createQr(orderId: '20261012-9001', amount: 15000, description: 'Picok Booth e2e');
    expect(qr.amount, 15000);
    expect(qr.upiString, startsWith('upi://pay'));
    expect(qr.imageUrl, startsWith('http://'));
    final img = await HttpClient().getUrl(Uri.parse(qr.imageUrl!)).then((r) {
      client.headers.forEach(r.headers.set);
      return r.close();
    });
    expect(img.statusCode, 200);
    expect(img.headers.contentType?.mimeType, 'image/png');
    await img.drain<void>();

    QrStatus st = await client.qrStatus(qr.qrId);
    expect(st.status, 'pending');
    final deadline = DateTime.now().add(const Duration(seconds: 20));
    while (!st.paid && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(seconds: 1));
      st = await client.qrStatus(qr.qrId);
    }
    expect(st.paid, isTrue);
    expect(st.paymentId, isNotEmpty);
  }, skip: !enabled);

  test('closing an unpaid QR reports closed', () async {
    final qr = await client.createQr(orderId: '20261012-9002', amount: 10000, description: 'cancel');
    final st = await client.closeQr(qr.qrId);
    expect(st.status, 'closed');
    expect(st.paid, isFalse);
  }, skip: !enabled);

  test('UDP discovery finds the bridge', () async {
    final found = await BridgeClient.discover();
    expect(found.where((b) => b.port == client.port), isNotEmpty);
  }, skip: !enabled);
}
