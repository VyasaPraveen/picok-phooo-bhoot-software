/// Print sizes supported by the DNP DS-RX1HS, with their pixel sizes at 300 dpi.
enum PrintSize {
  strip2x6('2x6', '2 × 6 Photo Strip', '51 × 152 mm', 600, 1800, [3, 4]),
  p4x6('4x6', '4 × 6 Postcard', '101 × 152 mm', 1200, 1800, [1, 2, 3, 4]),
  p35x5('3.5x5', '3.5 × 5 Print', '89 × 127 mm', 1050, 1500, [1, 2, 4]),
  p5x7('5x7', '5 × 7 Print', '127 × 178 mm', 1500, 2100, [1, 2, 4]),
  p6x8('6x8', '6 × 8 Print', '152 × 203 mm', 1800, 2400, [1, 2, 4]);

  const PrintSize(this.key, this.label, this.mm, this.widthPx, this.heightPx, this.photoCounts);

  /// Key shared with the Print Bridge (`media` field) and template JSON.
  final String key;
  final String label;
  final String mm;

  /// Portrait canvas size in pixels at 300 dpi.
  final int widthPx;
  final int heightPx;

  /// Photo counts offered for this size.
  final List<int> photoCounts;

  /// A 2×6 strip is printed as a pair on one 4×6 sheet and cut by the printer.
  bool get isStrip => this == PrintSize.strip2x6;

  String get shortLabel => switch (this) {
        PrintSize.strip2x6 => '2×6 Strip',
        PrintSize.p4x6 => '4×6',
        PrintSize.p35x5 => '3.5×5',
        PrintSize.p5x7 => '5×7',
        PrintSize.p6x8 => '6×8',
      };

  String get blurb => switch (this) {
        PrintSize.strip2x6 => 'Classic photo strip · you get 2 strips',
        PrintSize.p4x6 => 'Our most popular postcard size',
        PrintSize.p35x5 => 'Smaller print, lower price',
        PrintSize.p5x7 => 'Large frame-ready print',
        PrintSize.p6x8 => 'Extra large print',
      };

  static PrintSize? fromKey(String? key) {
    for (final s in PrintSize.values) {
      if (s.key == key) return s;
    }
    return null;
  }
}

/// The media roll currently loaded in the printer. The DNP holds one roll at a time.
enum MediaRoll {
  r4x6('4x6', '4×6 media (prints 4×6 and 2×6 strips)', 700, [PrintSize.p4x6, PrintSize.strip2x6]),
  r35x5('3.5x5', '3.5×5 media', 700, [PrintSize.p35x5]),
  r5x7('5x7', '5×7 media', 400, [PrintSize.p5x7]),
  r6x8('6x8', '6×8 media', 350, [PrintSize.p6x8]);

  const MediaRoll(this.key, this.label, this.capacity, this.sizes);

  final String key;
  final String label;

  /// Prints per roll (DNP RX1HS media set = 2 rolls of this many prints).
  final int capacity;
  final List<PrintSize> sizes;

  static MediaRoll fromKey(String? key) =>
      MediaRoll.values.firstWhere((m) => m.key == key, orElse: () => MediaRoll.r4x6);
}
