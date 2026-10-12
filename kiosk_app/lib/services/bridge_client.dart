import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

/// Error talking to the EPIXS Print Bridge. [message] is safe to show to the operator.
class BridgeException implements Exception {
  BridgeException(this.message, {this.unauthorized = false});
  final String message;
  final bool unauthorized;
  @override
  String toString() => message;
}

class PrinterStatus {
  PrinterStatus({required this.name, required this.online, required this.state, required this.message, required this.jobs});
  final String name;
  final bool online;

  /// ready | printing | offline | paper_out | jammed | error | not_found
  final String state;
  final String message;
  final int jobs;

  bool get canPrint => state == 'ready' || state == 'printing';
}

class BridgeStatus {
  BridgeStatus({required this.printer, required this.paymentProvider, required this.paymentsReady, required this.paymentMessage});
  final PrinterStatus printer;
  final String paymentProvider;
  final bool paymentsReady;
  final String paymentMessage;
}

class PrintJobStatus {
  PrintJobStatus({required this.jobId, required this.status, required this.message});
  final String jobId;

  /// queued | printing | done | error
  final String status;
  final String message;
}

class QrSession {
  QrSession({required this.qrId, required this.amount, required this.upiString, required this.imageUrl, required this.expiresAt});
  final String qrId;
  final int amount;
  final String? upiString;
  final String? imageUrl;
  final DateTime expiresAt;
}

class QrStatus {
  QrStatus({required this.status, this.paymentId, this.payerVpa, this.message});

  /// pending | paid | expired | closed | error
  final String status;
  final String? paymentId;
  final String? payerVpa;
  final String? message;
  bool get paid => status == 'paid';
}

class DiscoveredBridge {
  DiscoveredBridge(this.host, this.port, this.name);
  final String host;
  final int port;
  final String name;
}

/// HTTP client for the Print Bridge LAN API (docs/BRIDGE_API.md).
class BridgeClient {
  BridgeClient({required this.host, required this.port, required this.key});

  final String host;
  final int port;
  final String key;

  static const discoveryPort = 8687;
  static const _timeout = Duration(seconds: 8);

  Uri _u(String path) => Uri(scheme: 'http', host: host.trim(), port: port, path: path);
  Map<String, String> get headers => {'X-Bridge-Key': key.trim()};

  /// Absolute URL for a bridge-relative path such as a QR image.
  String absolute(String relative) =>
      relative.startsWith('http') ? relative : 'http://${host.trim()}:$port$relative';

  Future<Map<String, dynamic>> _json(Future<http.Response> req) async {
    http.Response res;
    try {
      res = await req.timeout(_timeout);
    } on TimeoutException {
      throw BridgeException('Print PC did not respond. Check that EPIXS Print Bridge is running.');
    } on SocketException {
      throw BridgeException('Cannot reach the print PC at $host:$port. Check Wi-Fi / hotspot.');
    } on http.ClientException {
      throw BridgeException('Cannot reach the print PC at $host:$port.');
    }
    Map<String, dynamic> body = const {};
    try {
      final decoded = jsonDecode(utf8.decode(res.bodyBytes));
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}
    if (res.statusCode == 401) {
      throw BridgeException('Pairing key rejected by the print PC.', unauthorized: true);
    }
    if (res.statusCode >= 400) {
      throw BridgeException(body['error'] as String? ?? 'Print PC error (${res.statusCode}).');
    }
    return body;
  }

  Future<String> ping() async {
    final j = await _json(http.get(_u('/api/ping')));
    return j['name'] as String? ?? 'Print PC';
  }

  Future<BridgeStatus> status() async {
    final j = await _json(http.get(_u('/api/status'), headers: headers));
    final p = (j['printer'] as Map?)?.cast<String, dynamic>() ?? const {};
    final pay = (j['payments'] as Map?)?.cast<String, dynamic>() ?? const {};
    return BridgeStatus(
      printer: PrinterStatus(
        name: p['name'] as String? ?? '',
        online: p['online'] == true,
        state: p['state'] as String? ?? 'error',
        message: p['message'] as String? ?? '',
        jobs: (p['jobsInQueue'] as num?)?.toInt() ?? 0,
      ),
      paymentProvider: pay['provider'] as String? ?? 'none',
      paymentsReady: pay['ready'] == true,
      paymentMessage: pay['message'] as String? ?? '',
    );
  }

  Future<String> print({
    required Uint8List png,
    required String orderId,
    required String media,
    required String finish,
    required int copies,
    bool reprint = false,
  }) async {
    final req = http.MultipartRequest('POST', _u('/api/print'))
      ..headers.addAll(headers)
      ..fields['meta'] = jsonEncode({
        'orderId': orderId,
        'media': media,
        'finish': finish,
        'copies': copies,
        'reprint': reprint,
      })
      ..files.add(http.MultipartFile.fromBytes('image', png, filename: '$orderId.png'));
    final j = await _json(req.send().then(http.Response.fromStream));
    final id = j['jobId'] as String?;
    if (id == null) throw BridgeException('Print PC did not accept the job.');
    return id;
  }

  Future<PrintJobStatus> job(String jobId) async {
    final j = await _json(http.get(_u('/api/jobs/$jobId'), headers: headers));
    return PrintJobStatus(
      jobId: jobId,
      status: j['status'] as String? ?? 'error',
      message: j['message'] as String? ?? '',
    );
  }

  Future<String> testPrint(String media, String finish) async {
    final j = await _json(http.post(_u('/api/test-print'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'media': media, 'finish': finish})));
    return j['jobId'] as String? ?? '';
  }

  Future<QrSession> createQr({required String orderId, required int amount, required String description}) async {
    final j = await _json(http.post(_u('/api/payments/qr'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'orderId': orderId, 'amount': amount, 'description': description})));
    final id = j['qrId'] as String?;
    if (id == null) throw BridgeException('Payment QR could not be created.');
    final img = j['imageUrl'] as String?;
    return QrSession(
      qrId: id,
      amount: (j['amount'] as num?)?.toInt() ?? amount,
      upiString: j['upiString'] as String?,
      imageUrl: img == null ? null : absolute(img),
      expiresAt: DateTime.tryParse(j['expiresAt'] as String? ?? '')?.toLocal() ??
          DateTime.now().add(const Duration(minutes: 5)),
    );
  }

  QrStatus _qr(Map<String, dynamic> j) => QrStatus(
        status: j['status'] as String? ?? 'error',
        paymentId: j['paymentId'] as String?,
        payerVpa: j['payerVpa'] as String?,
        message: j['message'] as String?,
      );

  Future<QrStatus> qrStatus(String qrId) async =>
      _qr(await _json(http.get(_u('/api/payments/qr/$qrId'), headers: headers)));

  Future<QrStatus> closeQr(String qrId) async =>
      _qr(await _json(http.post(_u('/api/payments/qr/$qrId/close'), headers: headers)));

  /// Finds bridges on the local network by UDP broadcast.
  static Future<List<DiscoveredBridge>> discover({Duration wait = const Duration(seconds: 2)}) async {
    final found = <String, DiscoveredBridge>{};
    RawDatagramSocket? socket;
    try {
      socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      socket.broadcastEnabled = true;
      final done = Completer<void>();
      socket.listen((event) {
        if (event != RawSocketEvent.read) return;
        final dg = socket!.receive();
        if (dg == null) return;
        try {
          final j = jsonDecode(utf8.decode(dg.data)) as Map<String, dynamic>;
          if (j['app'] == 'EPIXS Print Bridge') {
            final host = dg.address.address;
            found[host] = DiscoveredBridge(host, (j['port'] as num?)?.toInt() ?? 8686, j['name'] as String? ?? host);
          }
        } catch (_) {}
      });
      final msg = utf8.encode('EPIXS_BRIDGE_DISCOVER');
      for (var i = 0; i < 3; i++) {
        socket.send(msg, InternetAddress('255.255.255.255'), discoveryPort);
        await Future<void>.delayed(const Duration(milliseconds: 250));
      }
      Future<void>.delayed(wait, () {
        if (!done.isCompleted) done.complete();
      });
      await done.future;
    } catch (_) {
      // Discovery is best-effort; manual IP entry is always available.
    } finally {
      socket?.close();
    }
    return found.values.toList();
  }
}
