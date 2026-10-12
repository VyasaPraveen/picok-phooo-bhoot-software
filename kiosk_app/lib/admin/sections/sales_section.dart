import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import '../../services/booth.dart';
import '../../services/report_service.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../admin_widgets.dart';

enum _Range { today, yesterday, week, month, thisMonth, custom }

/// Orders, prints and revenue by day, size and colour, with UPI payment IDs. Export to Excel.
class SalesSection extends StatefulWidget {
  const SalesSection({super.key});

  @override
  State<SalesSection> createState() => _SalesSectionState();
}

class _SalesSectionState extends State<SalesSection> {
  _Range _range = _Range.today;
  DateTimeRange? _custom;
  late Future<SalesReport> _report = _load();
  bool _exporting = false;

  (DateTime, DateTime) _bounds() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final tomorrow = today.add(const Duration(days: 1));
    return switch (_range) {
      _Range.today => (today, tomorrow),
      _Range.yesterday => (today.subtract(const Duration(days: 1)), today),
      _Range.week => (today.subtract(const Duration(days: 6)), tomorrow),
      _Range.month => (today.subtract(const Duration(days: 29)), tomorrow),
      _Range.thisMonth => (DateTime(now.year, now.month), tomorrow),
      _Range.custom => (
          _custom?.start ?? today,
          (_custom?.end ?? today).add(const Duration(days: 1)),
        ),
    };
  }

  Future<SalesReport> _load() {
    final (from, to) = _bounds();
    return SalesReport.build(Booth.I.db, from, to);
  }

  Future<void> _pick(_Range r) async {
    if (r == _Range.custom) {
      final now = DateTime.now();
      final picked = await showDateRangePicker(
        context: context,
        firstDate: DateTime(now.year - 3),
        lastDate: now,
        initialDateRange: _custom,
      );
      if (picked == null) return;
      _custom = picked;
    }
    setState(() {
      _range = r;
      _report = _load();
    });
  }

  Future<void> _export(SalesReport r) async {
    setState(() => _exporting = true);
    try {
      final file = await r.exportExcel();
      await SharePlus.instance.share(ShareParams(
        files: [XFile(file.path, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')],
        subject: 'Picok booth sales report',
      ));
    } catch (e) {
      if (mounted) showToast(context, 'Export failed: $e', error: true);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const labels = {
      _Range.today: 'Today',
      _Range.yesterday: 'Yesterday',
      _Range.week: 'Last 7 days',
      _Range.month: 'Last 30 days',
      _Range.thisMonth: 'This month',
      _Range.custom: 'Custom…',
    };
    return FutureBuilder<SalesReport>(
      future: _report,
      builder: (context, snap) {
        final r = snap.data;
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Row(children: [
              Expanded(
                child: Wrap(spacing: 8, children: [
                  for (final e in labels.entries)
                    ChoiceChip(label: Text(e.value), selected: _range == e.key, onSelected: (_) => _pick(e.key)),
                ]),
              ),
              FilledButton.icon(
                onPressed: r == null || _exporting ? null : () => _export(r),
                icon: const Icon(Icons.grid_on_rounded),
                label: const Text('Export to Excel'),
              ),
            ]),
            const SizedBox(height: 16),
            if (r == null)
              const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()))
            else ...[
              Text(
                '${DateFormat('d MMM yyyy').format(r.from)} – ${DateFormat('d MMM yyyy').format(r.to.subtract(const Duration(seconds: 1)))}',
                style: const TextStyle(color: PicokColors.textDim),
              ),
              const SizedBox(height: 12),
              Wrap(spacing: 16, runSpacing: 16, children: [
                _Stat('Revenue', rupees(r.revenue), PicokColors.yellow),
                _Stat('Paid orders', '${r.paidOrders}', PicokColors.cyan),
                _Stat('Prints (sheets)', '${r.sheets}', PicokColors.pink),
                _Stat('UPI', rupees(r.upi), PicokColors.blue),
                _Stat('Cash', rupees(r.cash), PicokColors.peacock),
                _Stat('Reprints', '${r.reprints}', PicokColors.orange),
                if (r.freeOrders > 0) _Stat('Free-event orders', '${r.freeOrders}', PicokColors.purple),
                if (r.pendingOrders > 0) _Stat('Paid, not printed', '${r.pendingOrders}', PicokColors.danger),
              ]),
              const SizedBox(height: 20),
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: _BucketTable(title: 'By size', data: r.bySize)),
                const SizedBox(width: 16),
                Expanded(child: _BucketTable(title: 'By colour', data: r.byColour)),
              ]),
              _BucketTable(title: 'By day', data: r.byDay),
              AdminSection(
                title: 'Payments',
                subtitle: 'UPI payment IDs can be matched in your gateway dashboard',
                children: [
                  for (final o in r.orders.where((o) => o.status.isPaid && !o.isReprint))
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(children: [
                        SizedBox(width: 130, child: Text(o.id)),
                        SizedBox(width: 120, child: Text(DateFormat('d MMM HH:mm').format(o.createdAt), style: const TextStyle(color: PicokColors.textDim))),
                        SizedBox(width: 90, child: Text(rupees(o.amount))),
                        SizedBox(width: 90, child: Text(o.paymentMethod.label)),
                        Expanded(child: SelectableText(o.paymentId ?? '—', style: const TextStyle(color: PicokColors.textDim))),
                      ]),
                    ),
                ],
              ),
            ],
          ],
        );
      },
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value, this.color);
  final String label, value;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        width: 200,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: PicokColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border(left: BorderSide(color: color, width: 4)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: PicokColors.textDim)),
          Text(value, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
        ]),
      );
}

class _BucketTable extends StatelessWidget {
  const _BucketTable({required this.title, required this.data});
  final String title;
  final Map<String, ReportBucket> data;

  @override
  Widget build(BuildContext context) {
    final keys = data.keys.toList()..sort();
    return AdminSection(
      title: title,
      children: [
        if (keys.isEmpty) const Text('No sales in this period.', style: TextStyle(color: PicokColors.textDim)),
        if (keys.isNotEmpty)
          Table(
            columnWidths: const {0: FlexColumnWidth(2)},
            children: [
              const TableRow(children: [
                Text('', style: TextStyle(color: PicokColors.textDim)),
                Text('Orders', style: TextStyle(color: PicokColors.textDim)),
                Text('Prints', style: TextStyle(color: PicokColors.textDim)),
                Text('Revenue', style: TextStyle(color: PicokColors.textDim)),
              ]),
              for (final k in keys)
                TableRow(children: [
                  Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Text(k)),
                  Text('${data[k]!.orders}'),
                  Text('${data[k]!.sheets}'),
                  Text(rupees(data[k]!.revenue)),
                ]),
            ],
          ),
      ],
    );
  }
}
