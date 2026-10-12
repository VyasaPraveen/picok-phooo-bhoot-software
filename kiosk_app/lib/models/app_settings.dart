import 'print_size.dart';

/// Price for one print size, in paise (₹1 = 100 paise).
class SizePrice {
  const SizePrice({required this.colour, required this.bw, required this.extraCopy});

  /// Price of the first copy in colour.
  final int colour;

  /// Price of the first copy in black & white.
  final int bw;

  /// Price of each additional copy.
  final int extraCopy;

  SizePrice copyWith({int? colour, int? bw, int? extraCopy}) => SizePrice(
        colour: colour ?? this.colour,
        bw: bw ?? this.bw,
        extraCopy: extraCopy ?? this.extraCopy,
      );

  Map<String, dynamic> toJson() => {'colour': colour, 'bw': bw, 'extraCopy': extraCopy};

  static SizePrice fromJson(Map<String, dynamic> j, SizePrice fallback) => SizePrice(
        colour: _int(j['colour'], fallback.colour),
        bw: _int(j['bw'], fallback.bw),
        extraCopy: _int(j['extraCopy'], fallback.extraCopy),
      );
}

int _int(Object? v, int fallback) => v is num ? v.toInt() : fallback;
bool _bool(Object? v, bool fallback) => v is bool ? v : fallback;
String _str(Object? v, String fallback) => v is String ? v : fallback;

/// All booth settings. Persisted as JSON; every field has a safe default.
class AppSettings {
  AppSettings({
    this.businessName = 'Picok',
    this.eventName = '',
    this.eventDate = '',
    this.showEventOnPrint = true,
    this.clientLogoPath,
    this.logoStripBg = 'template',
    Map<String, SizePrice>? prices,
    this.maxCopies = 4,
    this.freeMode = false,
    this.bwWholePrint = false,
    this.loadedRoll = MediaRoll.r4x6,
    Set<String>? disabledSizes,
    this.printsRemaining = 700,
    this.lowPaperThreshold = 50,
    this.finish = 'gloss',
    this.countdownSeconds = 3,
    this.retakesAllowed = 1,
    this.mirrorPhotos = false,
    this.inactivitySeconds = 60,
    this.paymentTimeoutSeconds = 180,
    this.previewAutoPrintSeconds = 25,
    this.retentionMinutes = 30,
    this.bridgeHost = '',
    this.bridgePort = 8686,
    this.bridgeKey = '',
    this.cloudManifestUrl = '',
    this.acceptCloudSettings = false,
    this.cloudSettingsVersion = 0,
    this.lastCloudSync = '',
    List<String>? templateOrder,
    Set<String>? hiddenTemplates,
    this.adminPinHash = '',
    this.operatorPinHash = '',
    this.kioskEnabled = true,
    this.landscape = true,
    this.showConsent = true,
    this.consentText = defaultConsent,
  })  : prices = prices ?? Map.of(defaultPrices),
        disabledSizes = disabledSizes ?? <String>{},
        templateOrder = templateOrder ?? <String>[],
        hiddenTemplates = hiddenTemplates ?? <String>{};

  static const defaultConsent =
      'By using this booth you agree to have your photo taken and printed. '
      'Photos stay on this booth, are never uploaded, and are deleted automatically after printing.';

  /// Placeholder prices – the operator sets real prices in the admin panel.
  static const defaultPrices = <String, SizePrice>{
    '2x6': SizePrice(colour: 10000, bw: 10000, extraCopy: 5000),
    '4x6': SizePrice(colour: 15000, bw: 15000, extraCopy: 7000),
    '3.5x5': SizePrice(colour: 10000, bw: 10000, extraCopy: 5000),
    '5x7': SizePrice(colour: 25000, bw: 25000, extraCopy: 15000),
    '6x8': SizePrice(colour: 35000, bw: 35000, extraCopy: 20000),
  };

  String businessName;
  String eventName;
  String eventDate;
  bool showEventOnPrint;
  String? clientLogoPath;

  /// 'template' to follow the template's strip colour, otherwise a '#RRGGBB' colour.
  String logoStripBg;
  Map<String, SizePrice> prices;
  int maxCopies;
  bool freeMode;

  /// When true B&W converts the whole print (frame + logo); otherwise only the photos.
  bool bwWholePrint;
  MediaRoll loadedRoll;
  Set<String> disabledSizes;
  int printsRemaining;
  int lowPaperThreshold;
  String finish;
  int countdownSeconds;
  int retakesAllowed;
  bool mirrorPhotos;
  int inactivitySeconds;
  int paymentTimeoutSeconds;
  int previewAutoPrintSeconds;

  /// Minutes to keep photos after printing (for reprints). 0 = delete immediately.
  int retentionMinutes;
  String bridgeHost;
  int bridgePort;
  String bridgeKey;
  String cloudManifestUrl;
  bool acceptCloudSettings;
  int cloudSettingsVersion;
  String lastCloudSync;
  List<String> templateOrder;
  Set<String> hiddenTemplates;
  String adminPinHash;
  String operatorPinHash;
  bool kioskEnabled;
  bool landscape;
  bool showConsent;
  String consentText;

  SizePrice priceFor(PrintSize size) =>
      prices[size.key] ?? defaultPrices[size.key] ?? const SizePrice(colour: 0, bw: 0, extraCopy: 0);

  /// Sizes customers can pick right now: supported by the loaded roll and not disabled.
  List<PrintSize> get availableSizes =>
      loadedRoll.sizes.where((s) => !disabledSizes.contains(s.key)).toList();

  bool get bridgeConfigured => bridgeHost.trim().isNotEmpty && bridgeKey.trim().isNotEmpty;

  bool get paperLow => printsRemaining <= lowPaperThreshold;

  Map<String, dynamic> toJson() => {
        'businessName': businessName,
        'eventName': eventName,
        'eventDate': eventDate,
        'showEventOnPrint': showEventOnPrint,
        'clientLogoPath': clientLogoPath,
        'logoStripBg': logoStripBg,
        'prices': prices.map((k, v) => MapEntry(k, v.toJson())),
        'maxCopies': maxCopies,
        'freeMode': freeMode,
        'bwWholePrint': bwWholePrint,
        'loadedRoll': loadedRoll.key,
        'disabledSizes': disabledSizes.toList(),
        'printsRemaining': printsRemaining,
        'lowPaperThreshold': lowPaperThreshold,
        'finish': finish,
        'countdownSeconds': countdownSeconds,
        'retakesAllowed': retakesAllowed,
        'mirrorPhotos': mirrorPhotos,
        'inactivitySeconds': inactivitySeconds,
        'paymentTimeoutSeconds': paymentTimeoutSeconds,
        'previewAutoPrintSeconds': previewAutoPrintSeconds,
        'retentionMinutes': retentionMinutes,
        'bridgeHost': bridgeHost,
        'bridgePort': bridgePort,
        'bridgeKey': bridgeKey,
        'cloudManifestUrl': cloudManifestUrl,
        'acceptCloudSettings': acceptCloudSettings,
        'cloudSettingsVersion': cloudSettingsVersion,
        'lastCloudSync': lastCloudSync,
        'templateOrder': templateOrder,
        'hiddenTemplates': hiddenTemplates.toList(),
        'adminPinHash': adminPinHash,
        'operatorPinHash': operatorPinHash,
        'kioskEnabled': kioskEnabled,
        'landscape': landscape,
        'showConsent': showConsent,
        'consentText': consentText,
      };

  static AppSettings fromJson(Map<String, dynamic> j) {
    final d = AppSettings();
    final prices = Map.of(defaultPrices);
    final rawPrices = j['prices'];
    if (rawPrices is Map) {
      rawPrices.forEach((k, v) {
        if (k is String && v is Map) {
          prices[k] = SizePrice.fromJson(v.cast<String, dynamic>(), prices[k] ?? defaultPrices['4x6']!);
        }
      });
    }
    List<String> strList(Object? v) => v is List ? v.whereType<String>().toList() : <String>[];
    return AppSettings(
      businessName: _str(j['businessName'], d.businessName),
      eventName: _str(j['eventName'], d.eventName),
      eventDate: _str(j['eventDate'], d.eventDate),
      showEventOnPrint: _bool(j['showEventOnPrint'], d.showEventOnPrint),
      clientLogoPath: j['clientLogoPath'] as String?,
      logoStripBg: _str(j['logoStripBg'], d.logoStripBg),
      prices: prices,
      maxCopies: _int(j['maxCopies'], d.maxCopies).clamp(1, 10),
      freeMode: _bool(j['freeMode'], d.freeMode),
      bwWholePrint: _bool(j['bwWholePrint'], d.bwWholePrint),
      loadedRoll: MediaRoll.fromKey(j['loadedRoll'] as String?),
      disabledSizes: strList(j['disabledSizes']).toSet(),
      printsRemaining: _int(j['printsRemaining'], d.printsRemaining),
      lowPaperThreshold: _int(j['lowPaperThreshold'], d.lowPaperThreshold),
      finish: j['finish'] == 'matte' ? 'matte' : 'gloss',
      countdownSeconds: _int(j['countdownSeconds'], d.countdownSeconds).clamp(1, 10),
      retakesAllowed: _int(j['retakesAllowed'], d.retakesAllowed).clamp(0, 5),
      mirrorPhotos: _bool(j['mirrorPhotos'], d.mirrorPhotos),
      inactivitySeconds: _int(j['inactivitySeconds'], d.inactivitySeconds).clamp(20, 600),
      paymentTimeoutSeconds: _int(j['paymentTimeoutSeconds'], d.paymentTimeoutSeconds).clamp(60, 900),
      previewAutoPrintSeconds: _int(j['previewAutoPrintSeconds'], d.previewAutoPrintSeconds).clamp(5, 120),
      retentionMinutes: _int(j['retentionMinutes'], d.retentionMinutes).clamp(0, 1440),
      bridgeHost: _str(j['bridgeHost'], d.bridgeHost),
      bridgePort: _int(j['bridgePort'], d.bridgePort),
      bridgeKey: _str(j['bridgeKey'], d.bridgeKey),
      cloudManifestUrl: _str(j['cloudManifestUrl'], d.cloudManifestUrl),
      acceptCloudSettings: _bool(j['acceptCloudSettings'], d.acceptCloudSettings),
      cloudSettingsVersion: _int(j['cloudSettingsVersion'], d.cloudSettingsVersion),
      lastCloudSync: _str(j['lastCloudSync'], d.lastCloudSync),
      templateOrder: strList(j['templateOrder']),
      hiddenTemplates: strList(j['hiddenTemplates']).toSet(),
      adminPinHash: _str(j['adminPinHash'], d.adminPinHash),
      operatorPinHash: _str(j['operatorPinHash'], d.operatorPinHash),
      kioskEnabled: _bool(j['kioskEnabled'], d.kioskEnabled),
      landscape: _bool(j['landscape'], d.landscape),
      showConsent: _bool(j['showConsent'], d.showConsent),
      consentText: _str(j['consentText'], d.consentText),
    );
  }
}
