import 'dart:io';

import 'package:excel/excel.dart';
import 'package:intl/intl.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../models/order.dart';
import 'order_db.dart';

class ReportBucket {
  int orders = 0;
  int sheets = 0;
  int revenue = 0;
}

/// Sales figures for a date range. Revenue counts only collected money (UPI + cash);
/// reprints and free-event prints are counted separately.
class SalesReport {
  SalesReport(this.from, this.to, this.orders) {
    for (final o in orders) {
      if (!o.status.isPaid) continue;
      if (o.isReprint) {
        reprints++;
        if (o.status == OrderStatus.printed) reprintSheets += o.sheets;
        continue;
      }
      final printedSheets = o.status == OrderStatus.printed ? o.sheets : 0;
      paidOrders++;
      revenue += o.amount;
      sheets += printedSheets;
      switch (o.paymentMethod) {
        case PaymentMethod.upi:
          upi += o.amount;
        case PaymentMethod.cash:
          cash += o.amount;
        case PaymentMethod.free:
          freeOrders++;
        default:
          break;
      }
      if (o.status == OrderStatus.failed || o.status == OrderStatus.paid) pendingOrders++;
      for (final b in [
        byDay.putIfAbsent(DateFormat('yyyy-MM-dd').format(o.createdAt), ReportBucket.new),
        bySize.putIfAbsent(o.size.shortLabel, ReportBucket.new),
        byColour.putIfAbsent(o.bw ? 'Black & white' : 'Colour', ReportBucket.new),
      ]) {
        b.orders++;
        b.sheets += printedSheets;
        b.revenue += o.amount;
      }
    }
  }

  final DateTime from;
  final DateTime to;
  final List<BoothOrder> orders;
  int paidOrders = 0;
  int revenue = 0;
  int sheets = 0;
  int upi = 0;
  int cash = 0;
  int freeOrders = 0;
  int reprints = 0;
  int reprintSheets = 0;
  int pendingOrders = 0;
  final byDay = <String, ReportBucket>{};
  final bySize = <String, ReportBucket>{};
  final byColour = <String, ReportBucket>{};

  static Future<SalesReport> build(OrderDb db, DateTime from, DateTime to) async =>
      SalesReport(from, to, await db.between(from, to));

  /// Writes an .xlsx file and returns it.
  Future<File> exportExcel() async {
    final x = Excel.createExcel();
    final df = DateFormat('dd-MM-yyyy');
    final dtf = DateFormat('dd-MM-yyyy HH:mm');
    double rs(int paise) => paise / 100.0;

    final sum = x['Summary'];
    sum.appendRow([TextCellValue('Picok Photo Booth – Sales report')]);
    sum.appendRow([TextCellValue('Period'), TextCellValue('${df.format(from)} to ${df.format(to.subtract(const Duration(seconds: 1)))}')]);
    sum.appendRow([TextCellValue('Generated'), TextCellValue(dtf.format(DateTime.now()))]);
    sum.appendRow([]);
    for (final row in <List<Object>>[
      ['Paid orders', paidOrders],
      ['Prints (sheets)', sheets],
      ['Revenue (₹)', rs(revenue)],
      ['UPI (₹)', rs(upi)],
      ['Cash (₹)', rs(cash)],
      ['Free-event orders', freeOrders],
      ['Reprints', reprints],
      ['Reprint sheets', reprintSheets],
      ['Paid but not printed', pendingOrders],
    ]) {
      sum.appendRow([TextCellValue(row[0] as String), _num(row[1])]);
    }

    void bucketSheet(String name, String label, Map<String, ReportBucket> data) {
      final sh = x[name];
      sh.appendRow([TextCellValue(label), TextCellValue('Orders'), TextCellValue('Prints'), TextCellValue('Revenue (₹)')]);
      final keys = data.keys.toList()..sort();
      for (final k in keys) {
        final b = data[k]!;
        sh.appendRow([TextCellValue(k), IntCellValue(b.orders), IntCellValue(b.sheets), DoubleCellValue(rs(b.revenue))]);
      }
    }

    bucketSheet('By day', 'Date', byDay);
    bucketSheet('By size', 'Size', bySize);
    bucketSheet('By colour', 'Colour', byColour);

    final ord = x['Orders'];
    ord.appendRow([
      for (final h in [
        'Order', 'Date & time', 'Event', 'Size', 'Template', 'Colour', 'Copies', 'Amount (₹)',
        'Payment', 'UPI payment ID', 'Payer UPI', 'Status', 'Reprint of', 'Note',
      ])
        TextCellValue(h),
    ]);
    for (final o in orders) {
      ord.appendRow([
        TextCellValue(o.id),
        TextCellValue(dtf.format(o.createdAt)),
        TextCellValue(o.eventName),
        TextCellValue(o.size.shortLabel),
        TextCellValue(o.templateName),
        TextCellValue(o.bw ? 'B&W' : 'Colour'),
        IntCellValue(o.copies),
        DoubleCellValue(rs(o.amount)),
        TextCellValue(o.paymentMethod.label),
        TextCellValue(o.paymentId ?? ''),
        TextCellValue(o.payerVpa ?? ''),
        TextCellValue(o.status.label),
        TextCellValue(o.reprintOf ?? ''),
        TextCellValue(o.error ?? ''),
      ]);
    }

    x.setDefaultSheet('Summary');
    x.delete('Sheet1');
    final bytes = x.save();
    if (bytes == null) throw StateError('Could not create the Excel file');
    final dir = Directory(p.join((await getTemporaryDirectory()).path, 'reports'));
    await dir.create(recursive: true);
    final f = File(p.join(dir.path,
        'Picok_Sales_${DateFormat('yyyyMMdd').format(from)}_${DateFormat('yyyyMMdd').format(to.subtract(const Duration(seconds: 1)))}.xlsx'));
    await f.writeAsBytes(bytes, flush: true);
    return f;
  }

  static CellValue _num(Object v) => v is int ? IntCellValue(v) : DoubleCellValue((v as num).toDouble());
}
