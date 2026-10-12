# EPIXS Print Bridge

A Windows app that runs on the photo booth PC. The kiosk tablet sends finished photos to it over the
local network. The bridge prints them on the **DNP DS-RX1HS** and creates the UPI QR codes for payment.
The payment gateway secret stays on this PC and never reaches the tablet.

- Program: `EpixsPrintBridge.exe`, a single file that needs no installer or .NET runtime.
- Settings: `C:\ProgramData\EPIXS\PrintBridge\settings.json`
- Logs: `C:\ProgramData\EPIXS\PrintBridge\logs\bridge-yyyyMMdd.log`, one file per day, kept for 60 days
- Photos waiting to print are kept in `%LOCALAPPDATA%\EPIXS\PrintBridge\incoming`. Each one is deleted
  as soon as its job finishes or fails. Anything left over after a crash is deleted at the next start.
- The API contract for the tablet is in `../docs/BRIDGE_API.md`.

---

## 1. Install the DNP printer driver

1. Download the **DS-RX1HS** Windows driver from the DNP Photo Imaging website for your region.
2. Install it with the printer **switched off**. Connect the USB cable and switch the printer on when
   the installer asks you to.
3. Open *Settings → Devices → Printers & scanners* and check that the printer is listed (for example,
   "DP-DS-RX1HS"). Print a Windows test page once.
4. Load a media set (ribbon + paper) that matches the size you sell. Use the 4×6 set for 4×6 and 2×6
   strips. Use the 2S (perforated) set only when you want perforated prints.

## 2. Start the bridge

1. Copy `EpixsPrintBridge.exe` to a permanent folder, for example `C:\EPIXS\`, and double-click it.
2. The window opens on the **Status** tab. Closing the window does **not** stop the bridge. It keeps
   running in the notification area next to the clock (blue "P" icon). To stop it, right-click the
   icon and choose **Exit**.
3. Open **Settings** and tick **Start EPIXS Print Bridge when I sign in to Windows**. The bridge then
   starts automatically, minimised to the tray.

Only one copy runs at a time. Starting it again just brings the existing window to the front.

## 3. Set up the printer profiles (important)

Open the **Printer profiles** tab. There is one row for each print size and finish:
4×6, 2×6 strips, 3.5×5, 5×7 and 6×8, each in Gloss and Matte.

For every size you sell:

1. **Printer:** choose the DNP printer.
2. Click **Driver settings…**. This opens the DNP driver's own settings dialog. In it:
   - set the **paper size** to the media for this row. 2×6 strips are printed on a 4×6 sheet, so pick
     the 4×6 size for them.
   - **2×6 rows only:** turn on the **2-inch cut** option. The tablet sends a 4×6 sheet with two strips
     side by side, and the printer cuts it into two 2×6 strips.
   - **Overcoat / finish:** choose **Glossy** for the Gloss rows and **Matte** for the Matte rows.
   - click **OK**. The row now shows **captured ✓**, which means the bridge has stored these driver
     settings and will use them for every print with this profile.
3. Leave **Paper size** on *auto – match size* when you set the paper in the driver dialog. Pick a paper
   size here only if you want to override the driver setting.
4. Click **Test print** on the row. The test sheet shows colour bars, a grey ramp, a 1-inch square with
   a ruler, and red corner marks. If all four red corners and the black edge line are cut off evenly, the
   print is borderless. On 2×6 sheets a red dashed line marks where the 2-inch cut should be.

Notes:
- If you change the printer of a row, its driver settings are cleared. Click **Driver settings…** again.
- **Clear** removes the profile. A size without a profile prints on the **Windows default printer**, using
  the closest matching paper size. To be safe, set up every size you sell, or make the DNP the Windows
  default printer.
- The Status tab and the tablet show the state of the printer used for **4×6 Gloss**. If that profile
  is not set, they show the Windows default printer. Possible states are ready, printing, out of paper,
  jammed, offline and error.

## 4. Allow the tablet through Windows Firewall

Open **Settings** and click **Allow through Windows Firewall**, then approve the Windows administrator
prompt. This adds inbound rules for the HTTP port (TCP 8686 by default) and discovery (UDP 8687).
If you change the HTTP port later, click the button again.

The PC and the tablet must be on the same Wi-Fi/LAN. A *Guest* Wi-Fi with "client isolation" blocks
them from seeing each other. Set the PC's network to **Private** in Windows.

## 5. Pair the tablet

The **Status** tab shows, in large letters:

- **Bridge address**, for example `192.168.1.20:8686`
- **Pairing key**, for example `K7MPX4`. It is 6 characters and never uses 0, O, 1 or I.

On the tablet, open the kiosk app's print bridge settings. Either let it **find the PC automatically**
(UDP discovery, on by default), or type in the address. Then enter the pairing key. **Copy address**
copies the address to the clipboard.

To lock out a tablet, open **Settings → Regenerate** to create a new key. Every tablet then needs the
new key.

Give the PC a fixed IP address (a DHCP reservation in the router) so the address never changes.

## 6. Payments

Open the **Payments** tab and choose a provider, then click **Save**.

### Simulator (testing and demos)
- **Provider: Simulator.** The QR codes look real but no money moves. Do **not** use this with paying
  customers.
- A QR becomes "paid" after **Simulator auto-pay** seconds (default 8). Set this to 0 to pay only by
  hand: select the QR in the list and click **Mark paid (simulator)**.

### Razorpay (real payments)
Before you start:
- The Razorpay account must be **activated (KYC complete)**.
- The **QR Codes** feature must be enabled on the account. If it isn't, ask Razorpay support to enable
  "QR Codes / UPI QR". Without it, creating a QR fails with a Razorpay error.

Setup:
1. In the Razorpay Dashboard go to *Account & Settings → API Keys* and generate a key. Use **Test mode**
   keys (`rzp_test_…`) for trials and **Live mode** keys (`rzp_live_…`) for real customers.
2. In the bridge choose **Provider: Razorpay** and enter the **Key Id** and **Key Secret**.
   - The secret is encrypted with Windows (DPAPI, tied to the current Windows user). It is never shown
     again and never written to the log. To replace it, type a new one. Leave the box empty to keep
     the saved secret.
3. **Business name** is shown to the customer in their UPI app.
4. **QR valid for** sets how long the customer has to pay (default 300 s). Razorpay needs at least 180 s.
5. Click **Save**, then **Test Razorpay keys**. You should see "Keys accepted by Razorpay".

Every QR is single-use and for the exact amount. The bridge checks Razorpay for the payment at most
every 2 seconds per QR. When the customer cancels, the bridge closes the QR and checks one last time,
so a payment that arrives at the last moment is never lost. Every created, paid, expired and closed QR
is written to the log with its order number, amount and payment id. Use the log to reconcile with the
Razorpay dashboard.

## 7. Everyday use and troubleshooting

- **Jobs** tab: every print from the last 24 hours, with its status (queued, printing, done, error)
  and message, such as "Printer out of paper".
- If a job shows "Printer out of paper" or "Paper jam", fix the printer. The job finishes on its own,
  and the bridge waits up to 5 minutes.
- **Status** tab shows "Port 8686 is already in use": another program is using the port. Choose a
  different port in **Settings**, click **Apply**, update the tablet, and allow the new port through the
  firewall.
- The tablet cannot connect: check that both devices are on the same network, the firewall step is
  done, the Windows network is Private, and the address and key match the Status tab.
- Logs: **Settings → Open settings and logs folder**.

---

## For developers

Build (requires the .NET 10 SDK):

```
dotnet build
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o dist
```

The code is split into these folders:

| Folder | Contents |
|---|---|
| `Api/` | Kestrel minimal-API host (`ApiServer`), endpoints, models, UDP discovery |
| `Printing/` | Profile resolution, DEVMODE capture/restore (`DevModeHelper`), borderless rendering (`PhotoPrinter`), spooler tracking, queue status, test sheet, job worker |
| `Payments/` | `IPaymentProvider`, `RazorpayProvider`, `SimulatorProvider`, `PaymentService` (sessions, rate limiting, expiry) |
| `UI/` | WinForms window, tabs, tray |
| `Core/` | Settings (JSON + DPAPI), logging, pairing key, paths, network, Windows integration |
