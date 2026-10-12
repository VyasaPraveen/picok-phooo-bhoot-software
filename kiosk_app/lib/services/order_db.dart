import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/order.dart';

/// Local order log (SQLite). Paid orders are kept permanently for the sales report.
class OrderDb {
  OrderDb._(this._db);
  final Database _db;

  static Future<OrderDb> open() async {
    final dir = await getDatabasesPath();
    final db = await openDatabase(
      p.join(dir, 'picok_orders.db'),
      version: 1,
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE orders (
            id TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            size TEXT NOT NULL,
            template_id TEXT,
            template_name TEXT,
            photos INTEGER,
            bw INTEGER,
            copies INTEGER,
            amount INTEGER,
            status TEXT,
            payment_method TEXT,
            payment_id TEXT,
            qr_id TEXT,
            payer_vpa TEXT,
            print_job_id TEXT,
            error TEXT,
            photo_dir TEXT,
            print_file TEXT,
            event_name TEXT,
            reprint_of TEXT,
            files_deleted INTEGER DEFAULT 0
          )''');
        await db.execute('CREATE INDEX idx_orders_created ON orders(created_at)');
        await db.execute('CREATE INDEX idx_orders_status ON orders(status)');
      },
    );
    return OrderDb._(db);
  }

  /// Next order number for today, formatted `yyyyMMdd-NNNN`.
  Future<String> nextOrderId(DateTime now) async {
    final day = '${now.year}${now.month.toString().padLeft(2, '0')}${now.day.toString().padLeft(2, '0')}';
    final rows = await _db.rawQuery(
        "SELECT id FROM orders WHERE id LIKE ? ORDER BY id DESC LIMIT 1", ['$day-%']);
    var n = 1;
    if (rows.isNotEmpty) {
      final last = (rows.first['id'] as String).split('-').last;
      n = (int.tryParse(last) ?? 0) + 1;
    }
    return '$day-${n.toString().padLeft(4, '0')}';
  }

  Future<void> save(BoothOrder o) async {
    o.updatedAt = DateTime.now();
    await _db.insert('orders', o.toRow(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<BoothOrder?> get(String id) async {
    final rows = await _db.query('orders', where: 'id = ?', whereArgs: [id], limit: 1);
    return rows.isEmpty ? null : BoothOrder.fromRow(rows.first);
  }

  Future<List<BoothOrder>> recent({int limit = 200}) async {
    final rows = await _db.query('orders', orderBy: 'created_at DESC', limit: limit);
    return rows.map(BoothOrder.fromRow).toList();
  }

  /// Paid orders that still need the operator's attention (not printed yet, or failed).
  Future<List<BoothOrder>> needingAttention() async {
    final rows = await _db.query('orders',
        where: "status IN ('paid','printing','failed')", orderBy: 'created_at DESC', limit: 100);
    return rows.map(BoothOrder.fromRow).toList();
  }

  Future<List<BoothOrder>> between(DateTime from, DateTime to) async {
    final rows = await _db.query('orders',
        where: 'created_at >= ? AND created_at < ?',
        whereArgs: [from.millisecondsSinceEpoch, to.millisecondsSinceEpoch],
        orderBy: 'created_at ASC');
    return rows.map(BoothOrder.fromRow).toList();
  }

  /// Orders whose photo files are still on the device and were last touched before [cutoff].
  Future<List<BoothOrder>> withFilesOlderThan(DateTime cutoff) async {
    final rows = await _db.query('orders',
        where: "files_deleted = 0 AND updated_at < ? AND status NOT IN ('paid','printing')",
        whereArgs: [cutoff.millisecondsSinceEpoch]);
    return rows.map(BoothOrder.fromRow).toList();
  }

  /// Abandoned unpaid orders (customer walked away at the QR screen).
  Future<int> cancelStaleUnpaid(DateTime cutoff) => _db.update(
        'orders',
        {'status': OrderStatus.cancelled.key, 'updated_at': DateTime.now().millisecondsSinceEpoch},
        where: 'status = ? AND updated_at < ?',
        whereArgs: [OrderStatus.awaitingPayment.key, cutoff.millisecondsSinceEpoch],
      );
}
