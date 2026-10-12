# Picok Booth: setup and go-live guide

This guide is for the EPIXS engineer installing the booth and for the booth operator. It follows the
deployment days in the quotation (Days 7–10).

## What is at the booth

```
Galaxy Tab A11+ (kiosk app) ──Wi-Fi / 5G hotspot──▶ Windows PC (EPIXS Print Bridge) ──USB 2.0──▶ DNP DS-RX1HS
         │                                                   │
         └─ EPIXS template cloud (HTTPS, templates only)     └─ Razorpay (UPI QR payments, HTTPS)
```

- **Tablet:** the customer app. It handles the order, payment, camera, templates, preview and the admin
  panel. Photos are kept only on the tablet.
- **Windows PC:** runs the EPIXS Print Bridge. The DNP driver only works on Windows, so the PC is
  required. The bridge also holds the Razorpay keys and creates the QR codes, so the tablet never holds
  the gateway secret.

## 1. Windows PC and printer

Follow `print_bridge/README.md` for the details. In short:

1. Install the DNP DS-RX1HS driver for Windows 10/11. Connect the printer by USB, load the media, and
   check that Windows can print a test page.
2. Copy `print_bridge/dist/EpixsPrintBridge.exe` to the PC and run it. It is self-contained, so .NET is
   not needed.
3. **Printer profiles tab.** For every size you will sell (gloss and/or matte), pick the DNP printer and
   its paper size, then open **Driver settings…** and set:
   - **4x6:** PC 4x6 paper, overcoat Glossy or Matte.
   - **2x6:** 4x6 paper with **2 inch cut ON**, overcoat as wanted. The tablet sends two strips side by
     side on one 4×6 sheet, and the cut separates them.
   - **3.5x5:** only when the 3.5×5 roll is loaded.
4. **Settings tab:** tick *Start with Windows* and click **Allow through Windows Firewall**.
5. **Payments tab:** enter the Razorpay **Key Id** and **Key Secret** (Live keys). The client's Razorpay
   account must be KYC-complete with **QR Codes** enabled. Click **Test Razorpay keys**.
   - Use **Simulator** mode for rehearsals: QR codes "pay" themselves after 8 seconds.

## 2. Tablet

### Install

1. On the tablet, turn on **Settings → About tablet → Software information → tap Build number 7×**, then
   **Developer options → USB debugging**.
2. From this PC: `adb install -r kiosk_app/build/app/outputs/flutter-apk/app-release.apk`.
   You can also copy the APK to the tablet and open it.
3. Open **Picok Booth** once and allow **Camera** access.

### Full kiosk lock (recommended)

Device-owner mode gives a silent, complete lock:

- no status bar, Home or Recents
- the app is the launcher and opens on boot
- the screen stays on while the tablet is charging

Android allows a device owner only on a tablet **with no accounts on it**. Do this before adding a Google
or Samsung account, or remove those accounts first under **Settings → Accounts and backup**.

```bash
adb shell dpm set-device-owner com.epixs.picok_booth/.KioskAdminReceiver
```

To undo it (for example, before handing the tablet back):

```bash
adb shell dpm remove-active-admin com.epixs.picok_booth/.KioskAdminReceiver
```

If you skip device owner, the app falls back to Android **screen pinning**. Turn it on under
**Settings → Security and privacy → More security settings → Pin app**.

### Pair the tablet with the print PC

1. Connect the tablet and the PC to the same network. For outdoor events, switch on the tablet's **5G
   hotspot** and join it from the PC.
2. On the start screen, **tap the top-left corner 5 times** and enter the admin PIN.
3. Go to **Booth setup → Print PC → Find print PC**, or type the address shown in the bridge window.
4. Enter the **pairing key** from the bridge's Status tab, then tap **Test connection**. It should show
   the printer as ready and payments as ready.

### Default PINs

Change both on day one: **Booth setup → PINs**.

| Role | Default | Can do |
| --- | --- | --- |
| Admin | `2580` | Everything |
| Operator | `1470` | Orders, reprints and resume, cash release, paper and media |

After 5 wrong PIN attempts, PIN entry locks for 60 seconds.

## 3. Configure the event

In the admin panel:

1. **Event & brand:** upload the client logo (a transparent PNG is best), and set the event name and
   date. The preview shows exactly how prints will look.
2. **Prices:** set colour, B&W and extra-copy prices per size, plus the maximum copies. Use **Free event**
   for prepaid corporate events.
3. **Paper & media:** choose the roll that is loaded and tap **New roll loaded**. Pick gloss or matte.
4. **Templates:** hide designs that don't suit the event and drag to reorder. Use **Add your own frame**
   to add a Canva/Photoshop PNG frame. The dialog shows the exact pixel size and photo windows.
5. **Templates → EPIXS template cloud:** set the manifest URL (see `template_cloud/README.md`).

## 4. Go-live checklist (Day 9–10)

- [ ] Test print on every enabled size: **Paper & media → Send test print**.
- [ ] Colour and B&W prints: check that B&W prints are neutral grey, with no tint.
- [ ] A 2×6 order comes out as **two cut strips**.
- [ ] One **live ₹1 UPI payment** end to end, confirmed automatically. Refund it from the Razorpay
      dashboard.
- [ ] Cancel at the QR screen: the order shows as *Cancelled* in **Orders**.
- [ ] Cash release with the operator PIN: logged as *Cash*.
- [ ] Pull the paper or open the printer during a print: the customer sees "printer needs attention".
      After you fix it, the print completes. Otherwise use **Orders → Resume / print**.
- [ ] **Sales report → Export to Excel** opens the share sheet.
- [ ] Kiosk lock: Home, Back and Recents do nothing, and only the PIN gets into the admin panel.
- [ ] Change the default PINs, and hand them over to the client after the final payment.

## Everyday operation

- **Paper low warning:** load a new roll, then **Paper & media → New roll loaded**.
- **Paper jam or failed print:** **Orders → Needs attention → Resume / print**, or use **Reprint** on any
  recent order. Reprints are logged separately and don't count as revenue.
- **Customer paid and walked away:** the order stays in **Needs attention**. Use **Resume** to take the
  photos when they come back.
- **Refunds:** refund from the Razorpay dashboard, then mark the order **Refunded**.
- **Privacy:** photos are deleted automatically after printing. The default is 30 minutes, so reprints
  are still possible; you can change this under **Booth setup → Photo privacy**. Nothing is uploaded.

## Building from source

```bash
# Tablet app (Flutter 3.29+)
cd kiosk_app
flutter test
flutter build apk --release

# Print Bridge (.NET 10 SDK)
cd print_bridge
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o dist
```

Before the first client hand-over, sign the release APK with EPIXS's own keystore. It is currently signed
with the debug key; see `kiosk_app/android/app/build.gradle.kts`.
