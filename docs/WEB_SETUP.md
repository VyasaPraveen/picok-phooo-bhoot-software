# Picok Booth (web): setup guide

The booth is a **web app (PWA)** hosted on Firebase:

| What | URL | Runs on |
|---|---|---|
| Booth kiosk | https://picok-booth.web.app | Galaxy Tab A11+ (Chrome, installed as an app) |
| Admin dashboard | https://picok-booth.web.app/admin | Any phone or laptop |
| EPIXS Print Bridge 1.1 | `print_bridge/dist/EpixsPrintBridge.exe` | The Windows PC connected to the Citizen JR10-M01 printer |

Everything talks through the Firebase **Realtime Database**, on the free Spark plan. Print files travel
**end-to-end encrypted**: the tablet encrypts each print with the PC's public key, and the PC deletes it from
Firebase seconds after receiving it. UPI payments are created by the Print Bridge, which holds the Razorpay
keys. The contract is in [CLOUD_API.md](CLOUD_API.md).

## 0. One-time Firebase setup (already done for `picok-booth`)
1. Firebase console → **Authentication → Get started**, then enable **Email/Password** and **Anonymous**.
2. Database rules and hosting are deployed with `cd web && npm run deploy`.

## 1. Admin account
1. Open https://picok-booth.web.app/admin and choose **First time? Create an account** with the owner email
   (`praveenkrishna548@gmail.com`, set in `web/database.rules.json` and `web/src/shared/firebase.ts`).
2. Tap **Send verification email**, open the link in that email, then tap **I've verified**. This proves
   the address is yours, so nobody else can register the owner email and take over.
3. Tap **Activate admin access**. The booth is created with safe defaults:
   - **Demo mode** is on.
   - The PINs are admin `2580` and operator `1470`.
4. Other people create an account and tap **Request admin access**. You approve them under **Admins**,
   which lists every admin by email.
5. Change both PINs straight away (**Booth settings → Booth PINs**). The Overview shows a red warning
   until you do.

## 2. Booth tablet
1. In the dashboard, open **Devices**. Scan the QR code with the tablet, or open https://picok-booth.web.app in Chrome.
2. Chrome menu ⋮ → **Install app**. Open **Picok Booth** from the home screen and allow the camera.
3. The tablet shows a 6-digit code. In **Devices → Pair a device**, choose **Booth tablet** and type the
   code. Codes renew every 10 minutes, and the dashboard refuses a code older than 15 minutes.
4. Lock the tablet to the booth: **Settings → Security and privacy → More security settings → Pin app** on,
   then open Recents and pin Picok Booth. Unpinning needs the tablet's PIN.
5. Staff menu: tap the top-left corner of the start screen **5 times** and enter the operator PIN. From there you can:
   - resume or reprint orders
   - reset the paper counter with **New roll loaded**
   - see the printer status

## 3. Print PC
1. Install the Citizen JR10-M01 driver and set up the printer profiles as described in `print_bridge/README.md`.
2. Run `EpixsPrintBridge.exe`. On the **Cloud** tab, click **Pair with booth**. In
   **Devices → Pair a device**, choose **Print PC** and type the code it shows. A booth has one Print PC:
   pairing a new one unpairs the old one and resets the encryption key.
3. On the **Payments** tab, enter the Razorpay Key Id and Key Secret. The Razorpay account must be
   KYC-complete with QR Codes enabled.
4. In the dashboard, go to **Paper & printer → Send test print**.

## 4. Camera, theme, designs and paper
- **Canon EOS R50:**
  - On the R50, turn on its streaming (webcam / UVC) mode, then connect it to the tablet's USB-C port.
  - **Booth settings → Camera → Auto** uses the R50 whenever it is connected, and falls back to the tablet camera.
  - Staff can pick a camera on the tablet (staff menu → Camera).
  - Test once on the Galaxy Tab: the tablet must accept the R50 as a USB camera.
- **Theme:** **Event & brand → Booth theme**, Dark or Light, per event.
  - The booth screens, the standard print style and the logo version all follow it.
  - For a client logo, also upload its dark-text version for light backgrounds.
- **Six AI designs** (**Templates**):
  1. Retro: choose one. 2×6 strips always use Vintage Film Strip.
  2. Festival: switches by date automatically.
  3. to 6. Upload the client's four designs.
  - Under **Sample photos for previews**, upload up to 4 sample photos. They replace the silhouettes in the
    design previews, for example the Film strip.
- **Paper (Citizen JR10-M01):** in **Paper & printer → Loaded media**, choose the roll that is in the printer.
  - The 5-inch roll prints 3.5×5 and 5×7.
  - The 6-inch roll prints 4×6, 6×8 and 2×6 strips.
  - Customers only see the sizes of the loaded roll.
  - The Citizen driver must be installed on the Print PC. Its documentation lists Windows XP/7. Test on the Print PC's Windows version before the event.

## 5. Go live
In the dashboard, open **Booth settings → Live or demo** and switch **Payments** to *Live (Razorpay)* and
**Printing** to *Live (printer)*. Then:
- Set the real prices (**Prices**).
- Upload the client's logo and event name (**Event & brand**).
- Change both PINs (**Booth settings → Booth PINs**).
- Make one live ₹1 payment end to end, and refund it from the Razorpay dashboard.

## 6. Demo mode (for showing the client)
- No print PC or Razorpay account is needed.
- The payment QR is marked DEMO and confirms itself after a few seconds, or when you tap **Simulate payment**.
- Instead of printing, the booth shows the finished print with a **Download print** button.
- Demo orders appear in the dashboard but are never counted as revenue.

## Moving to the client's own Firebase project
1. Create the project and the default Realtime Database (asia-southeast1), add a Web app, and enable Email/Password and Anonymous sign-in.
2. Put the new web config in `web/src/shared/firebase.ts` and `web/.firebaserc`, and the owner email in
   `web/src/shared/firebase.ts` and `web/database.rules.json`.
3. `cd web && npm install && npm run deploy`.
4. Print Bridge: **Cloud → Advanced**, then enter the new database URL and API key and pair again.
5. Pair the tablet again by opening the new URL.

## Development
```bash
cd web
npm install
npm run dev          # kiosk at http://localhost:5173, admin at /admin/
npm run typecheck
npm run build
# Against local emulators (from a folder with firebase.json emulator config):
#   firebase emulators:start --only auth,database
#   VITE_EMULATORS=127.0.0.1:9099,127.0.0.1:9000 npm run dev
```
- The template renderer (`web/src/render`) is a port of the Flutter renderer. Its output matches pixel for pixel.
- Preview every template at `/dev/render-preview.html` while `npm run dev` is running.
- Festival packs are published from `web/public/cloud`, in the same format as `template_cloud/`.
