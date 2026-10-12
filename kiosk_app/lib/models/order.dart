import 'print_size.dart';

/// Lifecycle of a booth order. A paid order is never deleted, so it can always be resumed or reprinted.
enum OrderStatus {
  awaitingPayment('awaiting_payment', 'Awaiting payment'),
  paid('paid', 'Paid · not printed'),
  printing('printing', 'Printing'),
  printed('printed', 'Printed'),
  failed('failed', 'Print failed'),
  cancelled('cancelled', 'Cancelled');

  const OrderStatus(this.key, this.label);
  final String key;
  final String label;

  static OrderStatus fromKey(String? k) =>
      OrderStatus.values.firstWhere((s) => s.key == k, orElse: () => OrderStatus.cancelled);

  /// Money has been collected (or the order was free / released by the operator).
  bool get isPaid => this == paid || this == printing || this == printed || this == failed;
}

/// How an order was paid for.
enum PaymentMethod {
  upi('upi', 'UPI'),
  cash('cash', 'Cash'),
  free('free', 'Free event'),
  reprint('reprint', 'Reprint'),
  none('none', '—');

  const PaymentMethod(this.key, this.label);
  final String key;
  final String label;

  static PaymentMethod fromKey(String? k) =>
      PaymentMethod.values.firstWhere((s) => s.key == k, orElse: () => PaymentMethod.none);
}

class BoothOrder {
  BoothOrder({
    required this.id,
    required this.createdAt,
    required this.updatedAt,
    required this.size,
    required this.templateId,
    required this.templateName,
    required this.photos,
    required this.bw,
    required this.copies,
    required this.amount,
    required this.status,
    this.paymentMethod = PaymentMethod.none,
    this.paymentId,
    this.qrId,
    this.payerVpa,
    this.printJobId,
    this.error,
    this.photoDir,
    this.printFile,
    this.eventName = '',
    this.reprintOf,
    this.filesDeleted = false,
  });

  final String id;
  final DateTime createdAt;
  DateTime updatedAt;
  final PrintSize size;
  final String templateId;
  final String templateName;
  final int photos;
  final bool bw;
  final int copies;

  /// Amount in paise.
  final int amount;
  OrderStatus status;
  PaymentMethod paymentMethod;
  String? paymentId;
  String? qrId;
  String? payerVpa;
  String? printJobId;
  String? error;
  String? photoDir;
  String? printFile;
  final String eventName;
  final String? reprintOf;
  bool filesDeleted;

  bool get isReprint => reprintOf != null;

  /// Physical sheets this order uses on the roll.
  int get sheets => copies;

  /// Prints the customer takes home (a 2×6 sheet gives two strips).
  int get printsOut => size.isStrip ? copies * 2 : copies;

  Map<String, Object?> toRow() => {
        'id': id,
        'created_at': createdAt.millisecondsSinceEpoch,
        'updated_at': updatedAt.millisecondsSinceEpoch,
        'size': size.key,
        'template_id': templateId,
        'template_name': templateName,
        'photos': photos,
        'bw': bw ? 1 : 0,
        'copies': copies,
        'amount': amount,
        'status': status.key,
        'payment_method': paymentMethod.key,
        'payment_id': paymentId,
        'qr_id': qrId,
        'payer_vpa': payerVpa,
        'print_job_id': printJobId,
        'error': error,
        'photo_dir': photoDir,
        'print_file': printFile,
        'event_name': eventName,
        'reprint_of': reprintOf,
        'files_deleted': filesDeleted ? 1 : 0,
      };

  static BoothOrder fromRow(Map<String, Object?> r) => BoothOrder(
        id: r['id'] as String,
        createdAt: DateTime.fromMillisecondsSinceEpoch(r['created_at'] as int),
        updatedAt: DateTime.fromMillisecondsSinceEpoch(r['updated_at'] as int),
        size: PrintSize.fromKey(r['size'] as String?) ?? PrintSize.p4x6,
        templateId: r['template_id'] as String? ?? '',
        templateName: r['template_name'] as String? ?? '',
        photos: r['photos'] as int? ?? 1,
        bw: (r['bw'] as int? ?? 0) == 1,
        copies: r['copies'] as int? ?? 1,
        amount: r['amount'] as int? ?? 0,
        status: OrderStatus.fromKey(r['status'] as String?),
        paymentMethod: PaymentMethod.fromKey(r['payment_method'] as String?),
        paymentId: r['payment_id'] as String?,
        qrId: r['qr_id'] as String?,
        payerVpa: r['payer_vpa'] as String?,
        printJobId: r['print_job_id'] as String?,
        error: r['error'] as String?,
        photoDir: r['photo_dir'] as String?,
        printFile: r['print_file'] as String?,
        eventName: r['event_name'] as String? ?? '',
        reprintOf: r['reprint_of'] as String?,
        filesDeleted: (r['files_deleted'] as int? ?? 0) == 1,
      );
}
