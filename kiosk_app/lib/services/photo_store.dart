import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../models/order.dart';
import 'order_db.dart';

/// Customer photos live only on the tablet, in one private folder per order,
/// and are deleted automatically after printing (or after the retention time).
class PhotoStore {
  PhotoStore._(this._root, this._db);

  final Directory _root;
  final OrderDb _db;

  static Future<PhotoStore> open(OrderDb db) async {
    final docs = await getApplicationDocumentsDirectory();
    final root = Directory(p.join(docs.path, 'orders'));
    await root.create(recursive: true);
    return PhotoStore._(root, db);
  }

  Future<Directory> dirFor(String orderId) async {
    final d = Directory(p.join(_root.path, orderId));
    await d.create(recursive: true);
    return d;
  }

  /// Moves a captured camera file into the order folder.
  Future<String> keepPhoto(String orderId, int index, String capturedPath) async {
    final d = await dirFor(orderId);
    final dest = p.join(d.path, 'photo_${index + 1}.jpg');
    final src = File(capturedPath);
    try {
      await src.rename(dest);
    } on FileSystemException {
      await src.copy(dest);
      await src.delete();
    }
    return dest;
  }

  Future<String> savePrint(String orderId, List<int> png) async {
    final d = await dirFor(orderId);
    final f = File(p.join(d.path, 'print.png'));
    await f.writeAsBytes(png, flush: true);
    return f.path;
  }

  Future<void> deleteOrderFiles(BoothOrder o) async {
    final d = Directory(p.join(_root.path, o.id));
    if (await d.exists()) await d.delete(recursive: true);
    o.filesDeleted = true;
    o.photoDir = null;
    o.printFile = null;
    await _db.save(o);
  }

  /// Deletes photos of finished orders older than [retentionMinutes] and
  /// cancels unpaid orders abandoned at the payment screen.
  Future<void> purge(int retentionMinutes) async {
    final now = DateTime.now();
    for (final o in await _db.withFilesOlderThan(now.subtract(Duration(minutes: retentionMinutes)))) {
      await deleteOrderFiles(o);
    }
    await _db.cancelStaleUnpaid(now.subtract(const Duration(minutes: 30)));
    // Remove leftovers of cancelled orders that never got a DB row update.
    await for (final e in _root.list()) {
      if (e is! Directory) continue;
      final o = await _db.get(p.basename(e.path));
      if (o == null || o.status == OrderStatus.cancelled) {
        final age = now.difference((await e.stat()).modified);
        if (age.inMinutes > 30) await e.delete(recursive: true);
      }
    }
  }
}
