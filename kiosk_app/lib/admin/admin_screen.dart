import 'dart:async';

import 'package:flutter/material.dart';

import '../services/booth.dart';
import '../services/settings_store.dart';
import '../ui/theme.dart';
import 'sections/booth_section.dart';
import 'sections/branding_section.dart';
import 'sections/orders_section.dart';
import 'sections/paper_section.dart';
import 'sections/prices_section.dart';
import 'sections/sales_section.dart';
import 'sections/templates_section.dart';

class _Tab {
  const _Tab(this.label, this.icon, this.adminOnly, this.builder);
  final String label;
  final IconData icon;
  final bool adminOnly;
  final Widget Function() builder;
}

/// PIN-protected admin and operator panel. Pops with a paid order to resume, if chosen.
class AdminScreen extends StatefulWidget {
  const AdminScreen({super.key, required this.role});
  final PinRole role;

  @override
  State<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends State<AdminScreen> {
  int _index = 0;
  Timer? _idle;

  late final List<_Tab> _tabs = [
    _Tab('Orders', Icons.receipt_long_rounded, false, () => const OrdersSection()),
    _Tab('Paper & media', Icons.layers_rounded, false, () => const PaperSection()),
    _Tab('Event & brand', Icons.branding_watermark_rounded, true, () => const BrandingSection()),
    _Tab('Prices', Icons.currency_rupee_rounded, true, () => const PricesSection()),
    _Tab('Templates', Icons.dashboard_customize_rounded, true, () => const TemplatesSection()),
    _Tab('Sales report', Icons.insights_rounded, true, () => const SalesSection()),
    _Tab('Booth setup', Icons.settings_rounded, true, () => const BoothSection()),
  ].where((t) => widget.role == PinRole.admin || !t.adminOnly).toList();

  @override
  void initState() {
    super.initState();
    _armIdle();
  }

  @override
  void dispose() {
    _idle?.cancel();
    super.dispose();
  }

  /// Closes the panel after 5 idle minutes so it is never left open for guests.
  void _armIdle() {
    _idle?.cancel();
    _idle = Timer(const Duration(minutes: 5), () {
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    });
  }

  @override
  Widget build(BuildContext context) {
    final defaultPins = Booth.I.settings.usingDefaultPins;
    return Listener(
      onPointerDown: (_) => _armIdle(),
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: PicokColors.surface,
          title: Row(children: [
            Image.asset('assets/brand/picok_logo_transparent.png', height: 30),
            const SizedBox(width: 16),
            Text(widget.role == PinRole.admin ? 'Admin panel' : 'Operator panel'),
          ]),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: FilledButton.icon(
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.storefront_rounded),
                label: const Text('Back to booth'),
              ),
            ),
          ],
        ),
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: _index,
              onDestinationSelected: (i) => setState(() => _index = i),
              labelType: NavigationRailLabelType.all,
              backgroundColor: PicokColors.surface,
              destinations: [
                for (final t in _tabs) NavigationRailDestination(icon: Icon(t.icon), label: Text(t.label)),
              ],
            ),
            Expanded(
              child: Column(
                children: [
                  if (defaultPins && widget.role == PinRole.admin)
                    MaterialBanner(
                      backgroundColor: PicokColors.orange.withValues(alpha: 0.2),
                      content: const Text('The default PINs are still in use. Change them in Booth setup → PINs.'),
                      actions: [
                        TextButton(onPressed: () => setState(() => _index = _tabs.length - 1), child: const Text('Change now')),
                      ],
                    ),
                  Expanded(
                    child: KeyedSubtree(key: ValueKey(_index), child: _tabs[_index].builder()),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
