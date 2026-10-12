import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'flow/flow_host.dart';
import 'services/booth.dart';
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final booth = await Booth.init();

  await SystemChrome.setPreferredOrientations(booth.s.landscape
      ? [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]
      : [DeviceOrientation.portraitUp]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  unawaited(WakelockPlus.enable());
  if (booth.s.kioskEnabled) unawaited(booth.kiosk.start());

  unawaited(booth.housekeeping());
  booth.cloud.startAutoSync();

  runApp(const PicokBoothApp());
}

class PicokBoothApp extends StatelessWidget {
  const PicokBoothApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Picok Booth',
        debugShowCheckedModeBanner: false,
        theme: buildPicokTheme(),
        // Booth text is sized for arm's length; ignore the system font scale so layouts stay intact.
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.noScaling),
          child: child!,
        ),
        home: const FlowHost(),
      );
}
