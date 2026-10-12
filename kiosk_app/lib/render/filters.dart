import 'dart:ui';

/// Retro photo filters as 4×5 colour matrices (offsets in 0–255 range, as Flutter expects).
class PhotoFilters {
  PhotoFilters._();

  static const names = <String, String>{
    'none': 'Natural',
    'warm_film': 'Warm film',
    'neon_pop': 'Neon pop',
    'poster': 'Poster colour',
    'sepia': 'Sepia',
    'vivid': 'Vivid',
    'classic_bw': 'Classic B&W',
    'fade': 'Faded',
    'cool': 'Cool',
  };

  static List<double> matrixFor(String filter) => switch (filter) {
        'warm_film' => _chain([_saturation(0.85), _contrast(0.92), _scale(1.08, 1.0, 0.86, 10, 4, 0), _lift(10)]),
        'neon_pop' => _chain([_saturation(1.45), _contrast(1.15), _scale(1.05, 0.97, 1.10, 0, 0, 6)]),
        'poster' => _chain([_saturation(1.35), _contrast(1.30), _scale(1.06, 1.0, 0.95, 4, 0, 0)]),
        'sepia' => _chain([_sepia(), _contrast(1.05)]),
        'vivid' => _chain([_saturation(1.30), _contrast(1.12), _lift(4)]),
        'classic_bw' => _chain([_neutralGrey(), _contrast(1.15)]),
        'fade' => _chain([_saturation(0.80), _contrast(0.85), _lift(20)]),
        'cool' => _chain([_scale(0.95, 1.0, 1.08, 0, 2, 6)]),
        _ => _identity(),
      };

  /// True black & white for dye-sublimation: R = G = B exactly, so the printer lays down
  /// no colour cast. A small contrast lift compensates for the soft look of dye-sub greys.
  static List<double> trueBlackAndWhite() => _chain([_neutralGrey(), _contrast(1.08)]);

  /// The matrix for a photo: template filter first, then B&W if chosen.
  static ColorFilter? photoFilter(String filter, {required bool bw}) {
    final m = bw ? _chain([matrixFor(filter), trueBlackAndWhite()]) : matrixFor(filter);
    if (_isIdentity(m)) return null;
    return ColorFilter.matrix(m);
  }

  static ColorFilter wholePrintBw() => ColorFilter.matrix(trueBlackAndWhite());

  // ---- matrix helpers (5×5 maths on 4×5 matrices) ----

  static List<double> _identity() => [
        1, 0, 0, 0, 0, //
        0, 1, 0, 0, 0, //
        0, 0, 1, 0, 0, //
        0, 0, 0, 1, 0, //
      ];

  static bool _isIdentity(List<double> m) {
    final id = _identity();
    for (var i = 0; i < 20; i++) {
      if ((m[i] - id[i]).abs() > 1e-6) return false;
    }
    return true;
  }

  static List<double> _saturation(double s) {
    const lr = 0.2126, lg = 0.7152, lb = 0.0722;
    final sr = (1 - s) * lr, sg = (1 - s) * lg, sb = (1 - s) * lb;
    return [
      sr + s, sg, sb, 0, 0, //
      sr, sg + s, sb, 0, 0, //
      sr, sg, sb + s, 0, 0, //
      0, 0, 0, 1, 0, //
    ];
  }

  static List<double> _contrast(double c) {
    final t = 128 * (1 - c);
    return [
      c, 0, 0, 0, t, //
      0, c, 0, 0, t, //
      0, 0, c, 0, t, //
      0, 0, 0, 1, 0, //
    ];
  }

  static List<double> _scale(double r, double g, double b, double ra, double ga, double ba) => [
        r, 0, 0, 0, ra, //
        0, g, 0, 0, ga, //
        0, 0, b, 0, ba, //
        0, 0, 0, 1, 0, //
      ];

  /// Lifts the black point (faded film look).
  static List<double> _lift(double amount) {
    final k = (255 - amount) / 255;
    return _scale(k, k, k, amount, amount, amount);
  }

  static List<double> _neutralGrey() {
    const lr = 0.2126, lg = 0.7152, lb = 0.0722;
    return [
      lr, lg, lb, 0, 0, //
      lr, lg, lb, 0, 0, //
      lr, lg, lb, 0, 0, //
      0, 0, 0, 1, 0, //
    ];
  }

  static List<double> _sepia() => [
        0.393, 0.769, 0.189, 0, 0, //
        0.349, 0.686, 0.168, 0, 0, //
        0.272, 0.534, 0.131, 0, 0, //
        0, 0, 0, 1, 0, //
      ];

  /// Applies matrices left to right (the first one is applied to the pixel first).
  static List<double> _chain(List<List<double>> ms) {
    var acc = _identity();
    for (final m in ms) {
      acc = _multiply(m, acc);
    }
    return acc;
  }

  /// Returns a∘b (apply b, then a).
  static List<double> _multiply(List<double> a, List<double> b) {
    final out = List<double>.filled(20, 0);
    for (var row = 0; row < 4; row++) {
      for (var col = 0; col < 5; col++) {
        var v = 0.0;
        for (var k = 0; k < 4; k++) {
          v += a[row * 5 + k] * b[k * 5 + col];
        }
        if (col == 4) v += a[row * 5 + 4];
        out[row * 5 + col] = v;
      }
    }
    return out;
  }
}
