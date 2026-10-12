import 'package:flutter_test/flutter_test.dart';
import 'package:picok_booth/models/app_settings.dart';
import 'package:picok_booth/models/order.dart';
import 'package:picok_booth/models/print_size.dart';
import 'package:picok_booth/render/filters.dart';
import 'package:picok_booth/services/report_service.dart';
import 'package:picok_booth/templates/builtin_templates.dart';
import 'package:picok_booth/templates/template_def.dart';

BoothOrder _order(String id, {
  PrintSize size = PrintSize.p4x6,
  bool bw = false,
  int copies = 1,
  int amount = 15000,
  OrderStatus status = OrderStatus.printed,
  PaymentMethod method = PaymentMethod.upi,
  String? reprintOf,
  DateTime? at,
}) {
  final t = at ?? DateTime(2026, 10, 12, 18);
  return BoothOrder(
    id: id,
    createdAt: t,
    updatedAt: t,
    size: size,
    templateId: 'x',
    templateName: 'X',
    photos: 2,
    bw: bw,
    copies: copies,
    amount: amount,
    status: status,
    paymentMethod: method,
    paymentId: method == PaymentMethod.upi ? 'pay_$id' : null,
    reprintOf: reprintOf,
  );
}

void main() {
  group('settings', () {
    test('JSON round trip keeps every field', () {
      final s = AppSettings()
        ..eventName = 'Ravi weds Priya'
        ..prices['4x6'] = const SizePrice(colour: 12000, bw: 10000, extraCopy: 6000)
        ..loadedRoll = MediaRoll.r35x5
        ..hiddenTemplates.add('retro_neon_80s')
        ..templateOrder = ['a', 'b']
        ..finish = 'matte'
        ..freeMode = true;
      final r = AppSettings.fromJson(s.toJson());
      expect(r.eventName, 'Ravi weds Priya');
      expect(r.priceFor(PrintSize.p4x6).bw, 10000);
      expect(r.loadedRoll, MediaRoll.r35x5);
      expect(r.hiddenTemplates, contains('retro_neon_80s'));
      expect(r.templateOrder, ['a', 'b']);
      expect(r.finish, 'matte');
      expect(r.freeMode, isTrue);
    });

    test('corrupt values fall back to safe defaults', () {
      final r = AppSettings.fromJson({'maxCopies': 99, 'finish': 'weird', 'loadedRoll': 'nope', 'prices': 'bad'});
      expect(r.maxCopies, 10);
      expect(r.finish, 'gloss');
      expect(r.loadedRoll, MediaRoll.r4x6);
      expect(r.priceFor(PrintSize.p4x6).colour, AppSettings.defaultPrices['4x6']!.colour);
    });

    test('4x6 roll offers 4x6 and 2x6, 3.5x5 roll only 3.5x5', () {
      final s = AppSettings();
      expect(s.availableSizes, containsAll([PrintSize.p4x6, PrintSize.strip2x6]));
      s.loadedRoll = MediaRoll.r35x5;
      expect(s.availableSizes, [PrintSize.p35x5]);
      s.loadedRoll = MediaRoll.r4x6;
      s.disabledSizes.add('2x6');
      expect(s.availableSizes, [PrintSize.p4x6]);
    });
  });

  group('black & white', () {
    test('true B&W has identical R, G and B rows (no colour tint)', () {
      final m = PhotoFilters.trueBlackAndWhite();
      for (var c = 0; c < 5; c++) {
        expect(m[c], closeTo(m[5 + c], 1e-9));
        expect(m[c], closeTo(m[10 + c], 1e-9));
      }
    });

    test('a coloured filter followed by B&W is still neutral', () {
      final f = PhotoFilters.photoFilter('warm_film', bw: true);
      expect(f, isNotNull);
    });

    test('natural filter without B&W needs no colour filter', () {
      expect(PhotoFilters.photoFilter('none', bw: false), isNull);
    });
  });

  group('templates', () {
    final all = BuiltinTemplates.all();

    test('the 6 AI Retro templates match the quotation', () {
      final retro = BuiltinTemplates.retro();
      expect(retro, hasLength(6));
      final spec = {
        'retro_groovy_70s': (PrintSize.p4x6, 2, 'warm_film'),
        'retro_neon_80s': (PrintSize.p4x6, 3, 'neon_pop'),
        'retro_bollywood_poster': (PrintSize.p4x6, 1, 'poster'),
        'retro_vintage_film': (PrintSize.strip2x6, 4, 'sepia'),
        'retro_pop_comic_90s': (PrintSize.p4x6, 4, 'vivid'),
        'retro_old_times_news': (PrintSize.p4x6, 1, 'classic_bw'),
      };
      for (final t in retro) {
        final (size, photos, filter) = spec[t.id]!;
        expect(t.size, size, reason: t.id);
        expect(t.photos, photos, reason: t.id);
        expect(t.filter, filter, reason: t.id);
      }
    });

    test('ids are unique', () {
      final ids = all.map((t) => t.id).toList();
      expect(ids.toSet().length, ids.length);
    });

    test('every size offers every promised photo count', () {
      for (final size in PrintSize.values) {
        final counts = all.where((t) => t.size == size).map((t) => t.photos).toSet();
        expect(counts, containsAll(size.photoCounts), reason: size.key);
      }
    });

    test('slots and logo strip stay inside the canvas and do not overlap the logo', () {
      for (final t in all) {
        final canvas = 0.0 <= t.logo.y && t.logo.y + t.logo.h <= t.height + 0.01;
        expect(canvas, isTrue, reason: '${t.id} logo');
        for (final s in t.slots) {
          expect(s.x >= 0 && s.y >= 0 && s.x + s.w <= t.width + 0.01, isTrue, reason: '${t.id} slot x');
          expect(s.y + s.h <= t.logo.y + 0.01, isTrue, reason: '${t.id} slot overlaps logo strip');
        }
      }
    });

    test('JSON round trip and validation of remote templates', () {
      final t = all.first;
      final back = TemplateDef.tryParse(t.toJson());
      expect(back, isNotNull);
      expect(back!.slots.length, t.slots.length);
      expect(TemplateDef.tryParse({'id': 'x', 'size': '9x9', 'slots': [], 'logo': {}}), isNull);
      expect(TemplateDef.tryParse({'id': 'x', 'size': '4x6', 'slots': 'bad', 'logo': {}}), isNull);
    });

    test('festival date range switches on and off automatically', () {
      final t = TemplateDef.tryParse({
        ...all.first.toJson(),
        'activeFrom': '2026-10-28',
        'activeTo': '2026-11-12',
      })!;
      expect(t.isActiveOn(DateTime(2026, 10, 27, 23)), isFalse);
      expect(t.isActiveOn(DateTime(2026, 10, 28, 9)), isTrue);
      expect(t.isActiveOn(DateTime(2026, 11, 12, 22)), isTrue);
      expect(t.isActiveOn(DateTime(2026, 11, 13)), isFalse);
    });
  });

  group('sales report', () {
    test('revenue counts UPI and cash, not reprints or unpaid orders', () {
      final r = SalesReport(DateTime(2026, 10, 12), DateTime(2026, 10, 13), [
        _order('1', amount: 15000),
        _order('2', amount: 10000, method: PaymentMethod.cash, bw: true, size: PrintSize.strip2x6, copies: 2),
        _order('3', amount: 15000, status: OrderStatus.cancelled),
        _order('4', amount: 15000, status: OrderStatus.awaitingPayment),
        _order('5', amount: 0, method: PaymentMethod.reprint, reprintOf: '1'),
        _order('6', amount: 15000, status: OrderStatus.failed),
        _order('7', amount: 0, method: PaymentMethod.free),
      ]);
      expect(r.paidOrders, 4);
      expect(r.revenue, 40000);
      expect(r.upi, 30000);
      expect(r.cash, 10000);
      expect(r.reprints, 1);
      expect(r.freeOrders, 1);
      expect(r.pendingOrders, 1);
      expect(r.sheets, 1 + 2 + 1);
      expect(r.bySize['2×6 Strip']!.revenue, 10000);
      expect(r.byColour['Black & white']!.orders, 1);
    });
  });

  test('a 2x6 sheet gives two strips per copy', () {
    expect(_order('a', size: PrintSize.strip2x6, copies: 3).printsOut, 6);
    expect(_order('b', copies: 3).printsOut, 3);
  });
}
