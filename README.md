# Picok Booth: self-service photo booth software

Software for **Picok** (Mr. Srinivas), built by EPIXS Media to quotation EPX/2026/PBS-01.

Customers use the booth like this:

1. Pick a size.
2. Pick a layout and a retro template.
3. Choose colour or black & white, and the number of copies.
4. Pay by UPI.
5. Smile for the camera.
6. Get a print with the client's brand logo in about 12 seconds.

| Folder | What it is | Runs on |
| --- | --- | --- |
| [`kiosk_app/`](kiosk_app/) | Flutter kiosk app: the customer flow, camera, templates, UPI payment and the admin panel | Samsung Galaxy Tab A11+ (Android 16) |
| [`print_bridge/`](print_bridge/) | EPIXS Print Bridge: a LAN print server for the DNP driver, plus Razorpay QR payments | Windows 10/11 PC attached to the DNP DS-RX1HS |
| [`template_cloud/`](template_cloud/) | Remote template packs (festival and event) on Firebase Hosting | Firebase Hosting |
| [`docs/`](docs/) | [Setup and go-live guide](docs/SETUP.md) and the [Bridge API contract](docs/BRIDGE_API.md) | — |

## Scope delivered (quotation Section 07)

**Customer flow**

- The 8-step booth flow: tap to start → size → layout & template → colour/B&W & copies → UPI → 3·2·1
  capture → preview → print.
  - The booth returns to the start screen when a customer walks away before paying.
- Print sizes 2×6 (two strips on a 4×6 sheet, cut by the printer), 4×6 (portrait or landscape) and
  3.5×5, with 1–4 photo layouts.
  - 5×7 and 6×8 are supported too.
  - Customers only see the sizes the loaded roll can print.
- Colour or B&W and copies, with live pricing. B&W is a true neutral grey for dye-sub, with no colour
  tint.

**Payment**

- UPI payment with a single-use dynamic QR for the exact amount (Razorpay), confirmed automatically.
- The booth checks the printer before taking money.
- A paid order is never lost. The operator can resume or reprint it with a PIN.
- Cash mode, free-event mode, and reprints are each logged separately.

**Camera and prints**

- Camera with countdown, white screen flash, retakes, and a preview that matches the print exactly.
- The client's brand logo strip on every print, plus the event name and date, changeable per event.

**Templates**

- The **6 AI Retro templates**, each with its own filter: Groovy '70s, Neon '80s Synthwave, Bollywood
  Retro Poster, Vintage Film Strip, '90s Pop Comic and Old Times Newspaper.
- Standard layouts for every size.
- Remote template updates, plus festival packs with date ranges that switch on and off by themselves.
- Show, hide and reorder templates, and upload your own PNG frames.

**Admin, privacy and printing**

- PIN-protected admin and operator panel: prices, logo, templates, loaded media, paper counter with
  low-paper warning, sales report (by day, size and colour, with UPI payment IDs) and Excel export.
- Kiosk lock (Android lock-task; device-owner mode for full lock-down).
- Photos stay on the booth and are deleted automatically after printing.
- EPIXS Print Bridge for Windows:
  - DNP driver profiles for paper size, 2-inch cut and gloss/matte
  - borderless print fitting
  - job tracking
  - printer status
  - UDP discovery and key-based pairing

## Quick start

```bash
cd kiosk_app && flutter test && flutter build apk --release
cd print_bridge && dotnet build
```

Next, follow [docs/SETUP.md](docs/SETUP.md).
