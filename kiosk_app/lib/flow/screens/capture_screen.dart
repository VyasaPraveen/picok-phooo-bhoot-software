import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import '../../services/booth.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../session.dart';

enum _Phase { starting, ready, countdown, flash, review, error }

/// Step 6 · Smile! 3 · 2 · 1 — countdown, screen flash, one shot per photo slot, retakes as set.
class CaptureScreen extends StatefulWidget {
  const CaptureScreen({super.key, required this.session, required this.onDone, required this.onAbandoned});
  final BoothSession session;
  final VoidCallback onDone;

  /// Customer never started the shoot. The paid order stays saved for the operator to resume.
  final VoidCallback onAbandoned;

  @override
  State<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends State<CaptureScreen> with WidgetsBindingObserver {
  CameraController? _cam;
  _Phase _phase = _Phase.starting;
  String _error = '';
  int _index = 0;
  int _count = 0;
  int _retakesLeft = 0;
  String? _reviewPath;
  Timer? _timer;
  int _reviewSeconds = 0;
  bool _disposed = false;

  BoothSession get s => widget.session;
  int get _total => s.template!.photos;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    s.photos.clear();
    _retakesLeft = Booth.I.s.retakesAllowed;
    _initCamera();
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _cam?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final cam = _cam;
    if (cam == null) return;
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      _cam = null;
      cam.dispose();
    } else if (state == AppLifecycleState.resumed) {
      _initCamera(keepPhase: true);
    }
  }

  Future<void> _initCamera({bool keepPhase = false}) async {
    try {
      final cams = await availableCameras();
      if (cams.isEmpty) throw CameraException('none', 'No camera found');
      final front = cams.firstWhere((c) => c.lensDirection == CameraLensDirection.front, orElse: () => cams.first);
      final cam = CameraController(front, ResolutionPreset.max, enableAudio: false, imageFormatGroup: ImageFormatGroup.jpeg);
      await cam.initialize();
      try {
        await cam.setFlashMode(FlashMode.off);
      } catch (_) {}
      if (_disposed) {
        await cam.dispose();
        return;
      }
      setState(() {
        _cam = cam;
        if (!keepPhase || _phase == _Phase.starting) _phase = _Phase.ready;
      });
      if (!keepPhase) _armAbandon();
    } on CameraException catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.error;
        _error = e.code == 'CameraAccessDenied' || e.code == 'CameraAccessDeniedWithoutPrompt'
            ? 'Camera permission is off. The operator can allow it in Android settings.'
            : 'The camera could not start (${e.description ?? e.code}).';
      });
    }
  }

  void _armAbandon() {
    _timer?.cancel();
    final secs = math.max(90, Booth.I.s.inactivitySeconds * 2);
    _timer = Timer(Duration(seconds: secs), () {
      if (mounted && _phase == _Phase.ready && _index == 0) widget.onAbandoned();
    });
  }

  Future<void> _shoot() async {
    _timer?.cancel();
    final secs = Booth.I.s.countdownSeconds;
    for (var n = secs; n >= 1; n--) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.countdown;
        _count = n;
      });
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    final cam = _cam;
    if (!mounted || cam == null || !cam.value.isInitialized) return;
    setState(() => _phase = _Phase.flash);
    // Let the white flash reach the screen so it lights the faces.
    await Future<void>.delayed(const Duration(milliseconds: 120));
    try {
      final shot = await cam.takePicture();
      final path = await Booth.I.photos.keepPhoto(s.order!.id, _index, shot.path);
      if (!mounted) return;
      setState(() {
        _reviewPath = path;
        _phase = _Phase.review;
        _reviewSeconds = 5;
      });
      _timer = Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted) return;
        if (--_reviewSeconds <= 0) {
          t.cancel();
          _keep();
        } else {
          setState(() {});
        }
      });
    } on CameraException catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.error;
        _error = 'Could not take the photo (${e.description ?? e.code}).';
      });
    }
  }

  void _retake() {
    _timer?.cancel();
    if (_retakesLeft <= 0) return;
    _retakesLeft--;
    final p = _reviewPath;
    if (p != null) File(p).delete().ignore();
    _reviewPath = null;
    _shoot();
  }

  Future<void> _keep() async {
    _timer?.cancel();
    final p = _reviewPath;
    if (p == null) return;
    _reviewPath = null;
    s.photos.add(p);
    _index++;
    if (_index >= _total) {
      final o = s.order!;
      o.photoDir = File(p).parent.path;
      await Booth.I.db.save(o);
      if (mounted) widget.onDone();
      return;
    }
    _retakesLeft = Booth.I.s.retakesAllowed;
    await _shoot();
  }

  @override
  Widget build(BuildContext context) {
    final slot = s.template!.slots[math.min(_index, _total - 1)];
    return Stack(
      children: [
        Column(
          children: [
            StepHeader(
              step: 6,
              title: _phase == _Phase.review ? 'How does that look?' : 'Smile!',
              subtitle: 'Photo ${math.min(_index + 1, _total)} of $_total',
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(32, 4, 32, 16),
                child: Row(
                  children: [
                    Expanded(child: Center(child: _viewport(slot.aspect))),
                    SizedBox(width: 300, child: _sidePanel()),
                  ],
                ),
              ),
            ),
          ],
        ),
        if (_phase == _Phase.flash)
          const Positioned.fill(child: ColoredBox(color: Colors.white)),
      ],
    );
  }

  Widget _viewport(double aspect) {
    final cam = _cam;
    Widget inner;
    if (_phase == _Phase.review && _reviewPath != null) {
      inner = Transform.flip(
        flipX: Booth.I.s.mirrorPhotos,
        child: Image.file(File(_reviewPath!), fit: BoxFit.cover, width: double.infinity, height: double.infinity),
      );
    } else if (cam != null && cam.value.isInitialized) {
      final ps = cam.value.previewSize ?? const Size(1920, 1080);
      final landscape = MediaQuery.orientationOf(context) == Orientation.landscape;
      final w = landscape ? math.max(ps.width, ps.height) : math.min(ps.width, ps.height);
      final h = landscape ? math.min(ps.width, ps.height) : math.max(ps.width, ps.height);
      inner = FittedBox(fit: BoxFit.cover, clipBehavior: Clip.hardEdge, child: SizedBox(width: w, height: h, child: CameraPreview(cam)));
    } else if (_phase == _Phase.error) {
      inner = Container(
        color: PicokColors.surface,
        padding: const EdgeInsets.all(24),
        child: Center(
          child: Text('$_error\nYour order is saved — please call the operator.',
              textAlign: TextAlign.center, style: const TextStyle(fontSize: 22)),
        ),
      );
    } else {
      inner = const ColoredBox(color: PicokColors.surface, child: Center(child: CircularProgressIndicator()));
    }
    return AspectRatio(
      aspectRatio: aspect,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: PicokColors.cyan.withValues(alpha: 0.7), width: 4),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          fit: StackFit.expand,
          children: [
            inner,
            if (_phase == _Phase.countdown)
              Center(
                child: TweenAnimationBuilder<double>(
                  key: ValueKey(_count),
                  tween: Tween(begin: 1.6, end: 1.0),
                  duration: const Duration(milliseconds: 600),
                  curve: Curves.easeOutBack,
                  builder: (_, v, child) => Transform.scale(scale: v, child: child),
                  child: Text(
                    '$_count',
                    style: const TextStyle(
                      fontSize: 220,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      shadows: [Shadow(color: Colors.black54, blurRadius: 30)],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _sidePanel() {
    switch (_phase) {
      case _Phase.ready:
        return Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text('We’ll take $_total photo${_total == 1 ? '' : 's'}.', textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          const Text('Look at the camera at the top of the screen.', textAlign: TextAlign.center, style: TextStyle(fontSize: 18, color: PicokColors.textDim)),
          const SizedBox(height: 32),
          BigButton(label: 'I’m ready!', icon: Icons.camera_alt_rounded, onPressed: _shoot),
        ]);
      case _Phase.review:
        return Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          BigButton(
            label: _index + 1 >= _total ? 'Looks great!' : 'Next photo',
            icon: Icons.check_rounded,
            onPressed: _keep,
          ),
          const SizedBox(height: 10),
          Text('Continuing in $_reviewSeconds s', style: const TextStyle(color: PicokColors.textDim, fontSize: 16)),
          const SizedBox(height: 24),
          if (_retakesLeft > 0)
            GhostButton(label: 'Retake ($_retakesLeft left)', icon: Icons.refresh_rounded, onPressed: _retake),
        ]);
      case _Phase.error:
        return Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          GhostButton(label: 'Back to start', icon: Icons.home_rounded, onPressed: widget.onAbandoned),
        ]);
      default:
        return const SizedBox();
    }
  }
}
