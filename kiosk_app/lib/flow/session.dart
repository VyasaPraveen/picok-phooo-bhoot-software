import '../models/order.dart';
import '../models/print_size.dart';
import '../services/booth.dart';
import '../templates/template_def.dart';

/// Choices made by the current customer, from "Tap to start" to the print.
class BoothSession {
  PrintSize? size;
  TemplateDef? template;
  bool bw = false;
  int copies = 1;
  BoothOrder? order;
  final List<String> photos = [];

  int get total => size == null ? 0 : Booth.I.priceFor(size!, bw: bw, copies: copies);

  String get description {
    final t = template;
    final parts = [
      size?.shortLabel ?? '',
      if (t != null) t.name,
      bw ? 'B&W' : 'Colour',
      '×$copies',
    ];
    return parts.where((p) => p.isNotEmpty).join(' · ');
  }

  /// Rebuilds a session from a saved order, so the operator can resume it.
  static BoothSession fromOrder(BoothOrder o) {
    final s = BoothSession()
      ..size = o.size
      ..template = Booth.I.templates.byId(o.templateId)
      ..bw = o.bw
      ..copies = o.copies
      ..order = o;
    return s;
  }
}
