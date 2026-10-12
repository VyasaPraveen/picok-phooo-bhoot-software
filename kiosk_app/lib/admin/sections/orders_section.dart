import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../models/order.dart';
import '../../services/booth.dart';
import '../../ui/theme.dart';
import '../admin_widgets.dart';

/// Paid orders needing attention (resume / reprint) and the recent order log.
class OrdersSection extends StatefulWidget {
  const OrdersSection({super.key});

  @override
  State<OrdersSection> createState() => _OrdersSectionState();
}

class _OrdersSectionState extends State<OrdersSection> {
  late Future<(List<BoothOrder>, List<BoothOrder>)> _data = _load();

  Future<(List<BoothOrder>, List<BoothOrder>)> _load() async {
    final db = Booth.I.db;
    return (await db.needingAttention(), await db.recent(limit: 150));
  }

  void _refresh() => setState(() => _data = _load());

  Future<void> _resume(BoothOrder o) async {
    if (!await confirm(context, 'Continue order ${o.id}?',
        'The booth will continue this paid order where it stopped (photos or printing).', ok: 'Continue')) {
      return;
    }
    if (mounted) Navigator.of(context).pop(o);
  }

  Future<void> _reprint(BoothOrder o) async {
    var copies = o.copies;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: Text('Reprint ${o.id}'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('A reprint is logged separately and is not counted as revenue.'),
            const SizedBox(height: 16),
            IntStepper(value: copies, min: 1, max: 10, suffix: ' copies', onChanged: (v) => set(() => copies = v)),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Reprint')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    final reprint = await Booth.I.createReprint(o, copies: copies);
    if (mounted) Navigator.of(context).pop(reprint);
  }

  Future<void> _refunded(BoothOrder o) async {
    if (!await confirm(context, 'Mark ${o.id} as refunded?',
        'Use this only after refunding the customer from your payment gateway dashboard. '
        'The order is removed from revenue and its photos are deleted.',
        ok: 'Mark refunded')) {
      return;
    }
    o.status = OrderStatus.cancelled;
    o.error = 'Refunded by operator';
    await Booth.I.db.save(o);
    await Booth.I.photos.deleteOrderFiles(o);
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder(
      future: _data,
      builder: (context, snap) {
        if (!snap.hasData) return const Center(child: CircularProgressIndicator());
        final (attention, recent) = snap.data!;
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            AdminSection(
              title: 'Needs attention',
              subtitle: 'Paid orders that are not printed yet, or whose print failed',
              trailing: IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh), tooltip: 'Refresh'),
              children: [
                if (attention.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(8),
                    child: Text('All paid orders are printed. 🎉', style: TextStyle(color: PicokColors.textDim)),
                  ),
                for (final o in attention)
                  _OrderTile(
                    order: o,
                    actions: [
                      FilledButton.icon(onPressed: () => _resume(o), icon: const Icon(Icons.play_arrow_rounded), label: const Text('Resume / print')),
                      TextButton(onPressed: () => _refunded(o), child: const Text('Refunded')),
                    ],
                  ),
              ],
            ),
            AdminSection(
              title: 'Recent orders',
              subtitle: 'Reprint after a paper jam. Photos are kept for ${Booth.I.s.retentionMinutes} min after printing.',
              children: [
                if (recent.isEmpty) const Text('No orders yet.', style: TextStyle(color: PicokColors.textDim)),
                for (final o in recent)
                  _OrderTile(
                    order: o,
                    actions: [
                      if (o.status.isPaid && !o.filesDeleted && o.printFile != null)
                        OutlinedButton.icon(onPressed: () => _reprint(o), icon: const Icon(Icons.print_rounded), label: const Text('Reprint')),
                      if (o.status.isPaid && o.filesDeleted)
                        const Tooltip(message: 'Photos deleted for privacy', child: Icon(Icons.lock_clock, color: PicokColors.textDim)),
                    ],
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _OrderTile extends StatelessWidget {
  const _OrderTile({required this.order, required this.actions});
  final BoothOrder order;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final o = order;
    final colour = switch (o.status) {
      OrderStatus.printed => PicokColors.peacock,
      OrderStatus.failed => PicokColors.danger,
      OrderStatus.paid || OrderStatus.printing => PicokColors.orange,
      _ => PicokColors.textDim,
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(color: PicokColors.surfaceHigh, borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          Container(width: 10, height: 10, decoration: BoxDecoration(color: colour, shape: BoxShape.circle)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                '${o.id}  ·  ${DateFormat('dd MMM, HH:mm').format(o.createdAt)}  ·  ${o.status.label}${o.isReprint ? '  ·  reprint of ${o.reprintOf}' : ''}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              Text(
                '${o.size.shortLabel} · ${o.templateName} · ${o.bw ? 'B&W' : 'Colour'} · ×${o.copies} · '
                '${rupees(o.amount)} ${o.paymentMethod.label}${o.paymentId != null ? ' · ${o.paymentId}' : ''}',
                style: const TextStyle(fontSize: 13, color: PicokColors.textDim),
              ),
              if (o.error != null) Text(o.error!, style: const TextStyle(fontSize: 13, color: PicokColors.danger)),
            ]),
          ),
          ...actions.expand((a) => [const SizedBox(width: 8), a]),
        ],
      ),
    );
  }
}
