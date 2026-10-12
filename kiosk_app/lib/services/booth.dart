import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';

import '../models/app_settings.dart';
import '../models/order.dart';
import '../models/print_size.dart';
import '../render/template_renderer.dart';
import '../templates/template_def.dart';
import 'brand_assets.dart';
import 'bridge_client.dart';
import 'kiosk.dart';
import 'order_db.dart';
import 'photo_store.dart';
import 'settings_store.dart';
import 'template_cloud.dart';
import 'template_repository.dart';

/// App-wide services. Created once in main() and reachable via [Booth.I].
class Booth {
  Booth._({required this.settings, required this.templates, required this.brand});

  static late Booth I;

  final SettingsStore settings;
  final TemplateRepository templates;
  final BrandAssets brand;
  late final OrderDb db;
  late final PhotoStore photos;
  late final TemplateCloud cloud;
  final kiosk = KioskMode();

  static Future<Booth> init() async {
    final settings = await SettingsStore.load();
    final templates = await TemplateRepository.open();
    final brand = BrandAssets(settings);
    await brand.refresh();
    final b = Booth._(settings: settings, templates: templates, brand: brand)
      ..db = await OrderDb.open();
    b
      ..photos = await PhotoStore.open(b.db)
      ..cloud = TemplateCloud(settings, templates);
    return I = b;
  }

  /// Booth without the order database, for widget tests of screens that don't take orders.
  @visibleForTesting
  static Future<Booth> initForTesting() async {
    final settings = await SettingsStore.load();
    final templates = await TemplateRepository.open();
    final brand = BrandAssets(settings);
    await brand.refresh();
    return I = Booth._(settings: settings, templates: templates, brand: brand);
  }

  AppSettings get s => settings.value;

  BridgeClient? get bridge =>
      s.bridgeConfigured ? BridgeClient(host: s.bridgeHost, port: s.bridgePort, key: s.bridgeKey) : null;

  // ---- pricing ----

  /// Total in paise for an order.
  int priceFor(PrintSize size, {required bool bw, required int copies}) {
    if (s.freeMode) return 0;
    final p = s.priceFor(size);
    final first = bw ? p.bw : p.colour;
    return first + (copies - 1).clamp(0, 9) * p.extraCopy;
  }

  /// Lowest first-copy price for a size (shown on the size cards).
  int fromPrice(PrintSize size) {
    if (s.freeMode) return 0;
    final p = s.priceFor(size);
    return p.colour < p.bw ? p.colour : p.bw;
  }

  // ---- composing ----

  /// Renders the print-ready PNG for [template] with the customer's photos.
  /// For 2×6 strips the result is the full 4×6 sheet holding two strips.
  Future<Uint8List> composePrint(TemplateDef template, List<String> photoPaths, {required bool bw}) async {
    final photos = <ui.Image>[];
    try {
      for (final path in photoPaths) {
        photos.add(await TemplateRenderer.decode(await File(path).readAsBytes(), maxDimension: 2400));
      }
      final layerImages = await TemplateRenderer.loadLayerImages(template);
      final img = await TemplateRenderer.render(RenderRequest(
        template: template,
        photos: photos,
        logo: brand.logo,
        logoOnLight: brand.logoOnLight,
        eventName: s.showEventOnPrint ? s.eventName : '',
        eventDate: s.showEventOnPrint ? s.eventDate : '',
        bw: bw,
        bwWholePrint: s.bwWholePrint,
        mirror: s.mirrorPhotos,
        logoBgOverride: s.logoStripBg == 'template' ? null : s.logoStripBg,
        layerImages: layerImages,
      ));
      if (!template.size.isStrip) {
        try {
          return await TemplateRenderer.encodePng(img);
        } finally {
          img.dispose();
        }
      }
      final sheet = await TemplateRenderer.stripSheet(img);
      img.dispose();
      try {
        return await TemplateRenderer.encodePng(sheet);
      } finally {
        sheet.dispose();
      }
    } finally {
      for (final p in photos) {
        p.dispose();
      }
    }
  }

  // ---- printing ----

  /// Checks the print PC and printer before taking money.
  Future<String?> readinessProblem({int sheets = 1}) async {
    if (s.printsRemaining < sheets) return 'The printer is out of paper.';
    final b = bridge;
    if (b == null) return 'The booth printer is not set up yet.';
    try {
      final st = await b.status();
      if (!st.printer.canPrint) return 'Printer: ${st.printer.message.isEmpty ? st.printer.state : st.printer.message}';
      return null;
    } on BridgeException catch (e) {
      return e.message;
    }
  }

  /// Sends the order's print file to the bridge and follows it until it finishes.
  /// [onStatus] receives `queued`, `printing`, or `error:<message>` while a printer problem
  /// is waiting to be fixed. Returns the final job status.
  Future<PrintJobStatus> printOrder(BoothOrder order, {void Function(String status)? onStatus}) async {
    final b = bridge;
    final file = order.printFile;
    if (b == null) throw BridgeException('The booth printer is not set up yet.');
    if (file == null || !await File(file).exists()) {
      throw BridgeException('The photos for this order were already deleted for privacy.');
    }
    order.status = OrderStatus.printing;
    order.error = null;
    await db.save(order);

    late PrintJobStatus result;
    try {
      onStatus?.call('queued');
      final jobId = await b.print(
        png: await File(file).readAsBytes(),
        orderId: order.id,
        media: order.size.key,
        finish: s.finish,
        copies: order.copies,
        reprint: order.isReprint,
      );
      order.printJobId = jobId;
      await db.save(order);
      result = await _follow(b, jobId, onStatus);
    } on BridgeException catch (e) {
      result = PrintJobStatus(jobId: order.printJobId ?? '', status: 'error', message: e.message);
    }

    if (result.status == 'done') {
      order.status = OrderStatus.printed;
      await settings.update((st) => st.printsRemaining = (st.printsRemaining - order.sheets).clamp(0, 99999));
      if (s.retentionMinutes == 0) {
        await photos.deleteOrderFiles(order);
      }
    } else {
      order.status = OrderStatus.failed;
      order.error = result.message;
    }
    await db.save(order);
    return result;
  }

  Future<PrintJobStatus> _follow(BridgeClient b, String jobId, void Function(String)? onStatus) async {
    final deadline = DateTime.now().add(const Duration(minutes: 4));
    var misses = 0;
    PrintJobStatus? lastError;
    DateTime? errorSince;
    while (DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 1500));
      try {
        final st = await b.job(jobId);
        misses = 0;
        if (st.status == 'done') return st;
        if (st.status == 'error') {
          // A printer problem (paper out, jam) is reported as error, but the job can still
          // finish once staff fix it – keep following it for a while before giving up.
          lastError = st;
          errorSince ??= DateTime.now();
          onStatus?.call('error:${st.message}');
          if (DateTime.now().difference(errorSince) > const Duration(minutes: 2)) return st;
        } else {
          errorSince = null;
          onStatus?.call(st.status);
        }
      } on BridgeException catch (e) {
        if (++misses >= 6) return PrintJobStatus(jobId: jobId, status: 'error', message: e.message);
      }
    }
    return lastError ?? PrintJobStatus(jobId: jobId, status: 'error', message: 'Printer took too long. Check the printer.');
  }

  /// Creates a free reprint of [original] (logged separately; no revenue).
  Future<BoothOrder> createReprint(BoothOrder original, {int? copies}) async {
    final now = DateTime.now();
    final o = BoothOrder(
      id: await db.nextOrderId(now),
      createdAt: now,
      updatedAt: now,
      size: original.size,
      templateId: original.templateId,
      templateName: original.templateName,
      photos: original.photos,
      bw: original.bw,
      copies: copies ?? original.copies,
      amount: 0,
      status: OrderStatus.paid,
      paymentMethod: PaymentMethod.reprint,
      eventName: original.eventName,
      reprintOf: original.id,
      photoDir: original.photoDir,
      printFile: original.printFile,
    );
    await db.save(o);
    return o;
  }

  /// Housekeeping run whenever the booth returns to the start screen.
  Future<void> housekeeping() async {
    await photos.purge(s.retentionMinutes);
  }
}
