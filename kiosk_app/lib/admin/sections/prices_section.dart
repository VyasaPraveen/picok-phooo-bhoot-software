import 'package:flutter/material.dart';

import '../../models/app_settings.dart';
import '../../models/print_size.dart';
import '../../services/booth.dart';
import '../../ui/theme.dart';
import '../admin_widgets.dart';

/// Price per size, per extra copy, and for colour or B&W; copy limit; free-event switch.
class PricesSection extends StatefulWidget {
  const PricesSection({super.key});

  @override
  State<PricesSection> createState() => _PricesSectionState();
}

class _PricesSectionState extends State<PricesSection> {
  Future<void> _update(void Function(AppSettings s) f) async {
    await Booth.I.settings.update(f);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final s = Booth.I.s;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        AdminSection(
          title: 'Free event',
          subtitle: 'For prepaid corporate events: customers skip payment entirely',
          trailing: Switch(value: s.freeMode, onChanged: (v) => _update((s) => s.freeMode = v)),
          children: [
            if (s.freeMode)
              const Text('Free mode is ON — no payment is asked. Orders are logged as “Free event”.',
                  style: TextStyle(color: PicokColors.orange)),
          ],
        ),
        AdminSection(
          title: 'Prices (₹)',
          subtitle: 'Total = first copy (colour or B&W) + extra copies × extra-copy price',
          children: [
            const Row(children: [
              Expanded(flex: 3, child: Text('Size', style: TextStyle(color: PicokColors.textDim))),
              Expanded(flex: 2, child: Text('Colour', style: TextStyle(color: PicokColors.textDim))),
              Expanded(flex: 2, child: Text('B&W', style: TextStyle(color: PicokColors.textDim))),
              Expanded(flex: 2, child: Text('Each extra copy', style: TextStyle(color: PicokColors.textDim))),
            ]),
            const Divider(),
            for (final size in PrintSize.values) _priceRow(size, s),
          ],
        ),
        AdminSection(
          title: 'Copies',
          children: [
            SettingRow(
              label: 'Maximum copies per order',
              help: 'Customers choose between 1 and this number',
              child: IntStepper(value: s.maxCopies, min: 1, max: 10, onChanged: (v) => _update((s) => s.maxCopies = v)),
            ),
          ],
        ),
      ],
    );
  }

  Widget _priceRow(PrintSize size, AppSettings s) {
    final p = s.priceFor(size);
    final onRoll = s.loadedRoll.sizes.contains(size);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(children: [
        Expanded(
          flex: 3,
          child: Text('${size.label}${onRoll ? '' : '  (other roll)'}',
              style: TextStyle(fontSize: 16, color: onRoll ? PicokColors.text : PicokColors.textDim)),
        ),
        Expanded(flex: 2, child: Align(alignment: Alignment.centerLeft, child: RupeeField(paise: p.colour, onChanged: (v) => _update((s) => s.prices[size.key] = p.copyWith(colour: v))))),
        Expanded(flex: 2, child: Align(alignment: Alignment.centerLeft, child: RupeeField(paise: p.bw, onChanged: (v) => _update((s) => s.prices[size.key] = p.copyWith(bw: v))))),
        Expanded(flex: 2, child: Align(alignment: Alignment.centerLeft, child: RupeeField(paise: p.extraCopy, onChanged: (v) => _update((s) => s.prices[size.key] = p.copyWith(extraCopy: v))))),
      ]),
    );
  }
}
