# Picok Booth: cloud contract (Firebase Realtime Database) v1

The kiosk PWA, the admin dashboard and the EPIXS Print Bridge all talk through the
Firebase Realtime Database (RTDB) of the booth's Firebase project. This works on the free **Spark** plan:
no Cloud Functions and no Cloud Storage are needed.

- Project (demo): `picok-booth`. Moving to the client's own project means changing these values in each app:
  - Database URL: `https://picok-booth-default-rtdb.asia-southeast1.firebasedatabase.app`
  - Web API key: `AIzaSyCbUHG0KYPy4j0MWDwioWtvgGEHKEP-HZg` (public by design; the security rules protect the data)
- Money is integer **paise**. Times are **epoch milliseconds** (numbers).
- `{b}` is a booth id, for example `booth-1`.

## Identities and pairing

| Who | Signs in with | Role |
|---|---|---|
| Admin (dashboard) | Email + password | `/admins/{uid} = true`. Only the owner email (hard-coded in the rules) may grant itself, and only once the address is verified (`email_verified`). Everyone else asks via `/adminRequests` |
| Kiosk (tablet PWA) | Anonymous auth | `/devices/{uid} = {boothId, role:"kiosk"}` |
| Print Bridge (Windows) | Anonymous auth (REST) | `/devices/{uid} = {boothId, role:"bridge"}` |

**Pairing a device** (kiosk or bridge):
1. The device signs in anonymously and picks a random 6-digit code.
2. It writes `/pairing/{code} = {uid, role, name, createdAt}`. The write fails if the code is already
   taken; pick another code and retry.
   - The rules allow only these four fields. `createdAt` must be the server timestamp (`{".sv":"timestamp"}`),
     `name` is at most 80 characters.
   - The kiosk renews its code every 10 minutes. The dashboard refuses a code older than 15 minutes.
3. It shows the code on screen and listens to `/devices/{uid}`.
4. The admin chooses what they are pairing (booth tablet or Print PC) and types the code into the
   dashboard (Devices → Pair). The dashboard refuses a code whose `role` doesn't match. It writes
   `/devices/{uid} = {boothId, role, name, pairedAt}` and deletes `/pairing/{code}`.
   - Pairing a Print PC also unpairs the booth's other bridges and clears `/booths/{b}/bridge/publicKey`,
     so the new PC can publish its key. One Print PC per booth.
5. When `/devices/{uid}` appears, the device is paired. It keeps its anonymous session (the refresh
   token) for good. To un-pair, the admin deletes `/devices/{uid}`.

### Bridge sign-in over REST
- **Sign up:** `POST https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=API_KEY`
  with body `{"returnSecureToken":true}`. It returns `idToken`, `refreshToken`, `localId` (the uid) and
  `expiresIn` (3600).
- **Refresh:** `POST https://securetoken.googleapis.com/v1/token?key=API_KEY` with form body
  `grant_type=refresh_token&refresh_token=…`. It returns `id_token`, `refresh_token`, `user_id` and
  `expires_in`.
- **Read and write:** `{DB}/path.json?auth={idToken}`, using `GET`, `PUT`, `PATCH` or `DELETE`.
- **Stream:** `GET {DB}/path.json?auth={idToken}` with header `Accept: text/event-stream` (server-sent
  events).
  - Events: `put` / `patch`, each with data `{"path": "...", "data": ...}`.
  - `keep-alive`.
  - `auth_revoked`: reconnect with a fresh token.
  - `cancel`: permission lost.

## Data layout

```
/admins/{uid}                     true
/adminProfiles/{uid}              {email}                      – written by each admin on sign-in; the Admins page lists emails
/adminRequests/{uid}              {email, createdAt}           – a signed-in email user asking for admin access (email must equal the sign-in email)
/pairing/{code}                   {uid, role, name, createdAt}
/devices/{uid}                    {boothId, role, name, pairedAt}
/booths/{b}/info                  {name, createdAt}
/booths/{b}/settings              see "Settings" (admin writes, devices read)
/booths/{b}/pins                  {adminHash, operatorHash}    – SHA-256 hex of "picok-booth::" + PIN
/booths/{b}/state                 {printsRemaining, loadedRoll, updatedAt}  – paper counter (kiosk + admin)
/booths/{b}/assets/{assetId}      {name, mime, data (base64), width, height, updatedAt}  – logo, PNG frames
/booths/{b}/customTemplates/{id}  TemplateDef JSON (same format as template_cloud/README.md)
/booths/{b}/counters/{yyyymmdd}   integer, the order number sequence (transaction)
/booths/{b}/orders/{orderId}      Order (see below)
/booths/{b}/payments/{orderId}    PaymentRequest – kiosk ⇄ bridge
/booths/{b}/jobs/{jobId}          PrintJob – kiosk ⇄ bridge
/booths/{b}/testPrints/{id}       {media, finish, status, message, createdAt, updatedAt} – admin ⇄ bridge
/booths/{b}/bridge                BridgeStatus – written by the bridge
```

### Settings (`/booths/{b}/settings`)
```json
{
  "businessName": "Picok", "eventName": "", "eventDate": "", "showEventOnPrint": true,
  "logoAssetId": null, "logoStripBg": "template",
  "prices": {"4x6": {"colour": 15000, "bw": 15000, "extraCopy": 7000}, "3_5x5": {...}},   // "3.5x5" is stored as "3_5x5" (RTDB keys cannot contain ".")
  "maxCopies": 4, "freeMode": false, "bwWholePrint": false,
  "loadedRoll": "4x6", "disabledSizes": [], "finish": "gloss", "lowPaperThreshold": 50,
  "countdownSeconds": 3, "retakesAllowed": 1, "mirrorPhotos": false,
  "inactivitySeconds": 60, "paymentTimeoutSeconds": 180, "previewAutoPrintSeconds": 25,
  "paymentMode": "demo",
  "printMode": "demo",
  "hiddenTemplates": [], "templateOrder": [],
  "showConsent": true, "consentText": "…"
}
```
- `paymentMode` is `demo` or `bridge`.
- `printMode` is `demo` or `bridge`.

### Order (`/booths/{b}/orders/{orderId}`)
`orderId` = `yyyymmdd-NNNN`.
```json
{"id":"20261013-0007","createdAt":0,"updatedAt":0,"size":"4x6","templateId":"retro_groovy_70s",
 "templateName":"Groovy '70s","photos":2,"bw":false,"copies":2,"amount":22000,
 "status":"awaiting_payment","paymentMethod":"none","paymentId":null,"payerVpa":null,
 "jobId":null,"error":null,"eventName":"","reprintOf":null,"deviceUid":"…"}
```
- `status` is one of `awaiting_payment`, `paid`, `printing`, `printed`, `failed`, `cancelled`.
- `paymentMethod` is one of `upi`, `cash`, `free`, `demo`, `reprint`, `none`.
- A refund is `status:"cancelled"` with `refundedAt` (set by an admin).
- What the kiosk may do (security rules):
  - It creates and updates orders but can't delete them, and can't change `createdAt` (so a reused id can't
    overwrite an old order).
  - It can't change a refunded order.
  - `amount` is 0 to 10,000,000 paise and `copies` is 1 to 20.
  - The day counter only goes up.

**Late payment safety net (kiosk):** the kiosk listens to `payments` where `state == "paid"`. If the order is
still `awaiting_payment` or `cancelled` (not refunded) and no payment screen is handling it, the kiosk marks
it `paid` with the `paymentId` and the note "Paid after the customer left". It then deletes the request.
Staff print the order from the operator panel.

When a customer leaves the payment screen, the kiosk writes `cancel` and waits up to 10 s for `closed`
or `paid`. If the bridge doesn't answer, the kiosk keeps the request, so a payment that arrives later is
still recovered by the safety net.

### PaymentRequest (`/booths/{b}/payments/{orderId}`): kiosk ⇄ bridge
The kiosk writes:
`{"amount":22000,"description":"Picok Booth 4x6 ×2","state":"requested","createdAt":0,"updatedAt":0}`

The bridge reacts to `state`:
| state (written by) | meaning |
|---|---|
| `requested` (kiosk) | The bridge creates the Razorpay QR, then writes `pending` with `qrId`, `upiString` (may be null), `imagePng` (base64 PNG of the QR) and `expiresAt` |
| `pending` (bridge) | The bridge keeps checking Razorpay (at most every 2 s). When paid, it writes `paid` with `paymentId` and `payerVpa` |
| `cancel` (kiosk) | The customer cancelled or the time ran out. The bridge closes the QR, checking once more for a payment, then writes `closed`, or `paid` if money arrived |
| `paid` / `expired` / `closed` | Final. The bridge stops working on it |
| `error` (bridge) | Not final. `message` explains; the bridge retries. The kiosk keeps listening |

Who may write which `state` (enforced by the security rules):
- The kiosk writes only `requested` (creating the node) and `cancel` (while the state is `requested`,
  `pending`, `error` or `cancel`). A `cancel` over `paid` is refused.
- Only the bridge (or an admin) writes `qrId`, `upiString`, `imagePng`, `expiresAt`, `paymentId`, `payerVpa`
  and `message`.
- Once the state is `cancel`, the bridge may only replace it with `closed`, `paid` or `expired`. Its
  `pending`/`error` would be refused, so:
  - If the kiosk cancels while the QR is being created, the bridge re-reads the request after creating
    the QR and closes it instead of showing it (writing `paid` if money already arrived).
  - When one of its writes is refused, the bridge does not retry it; it re-reads the request and acts on
    the current state. A `paid` is always retried until it is stored.
  - If the QR cannot be closed yet, the bridge keeps `cancel` and only updates `message`, retrying every 15 s.
- After a restart the bridge resumes checking the `qrId` stored in the request, but only if that QR was
  made for the same order. A request pointing at another order's QR is answered with `error`, or with
  `closed` if it was cancelled.

### PrintJob (`/booths/{b}/jobs/{jobId}`): kiosk ⇄ bridge
The kiosk writes:
```json
{"orderId":"20261013-0007","media":"4x6","finish":"gloss","copies":2,"reprint":false,
 "status":"queued","message":"","createdAt":0,"updatedAt":0,
 "enc":{"alg":"RSA-OAEP-256+A256GCM","key":"<b64>","iv":"<b64>","kid":"<16 hex>"},
 "mime":"image/jpeg","data":"<b64 ciphertext>"}
```
- `createdAt` is Firebase server time: the kiosk's clock corrected by `.info/serverTimeOffset`. A tablet
  with a wrong clock therefore never makes jobs look expired.
- `media` is one of `4x6`, `2x6`, `3.5x5`, `5x7` or `6x8`. For `2x6`, the image is a full 4×6 sheet
  (1200×1800) with two strips side by side.
- The print file is encrypted **end to end for the bridge**:
  - The kiosk makes a random 256-bit AES-GCM key and a 12-byte IV, and encrypts the JPEG.
    WebCrypto output = ciphertext followed by the 16-byte tag; `data` holds both.
  - The kiosk wraps the AES key with the bridge's RSA-OAEP (SHA-256) public key from
    `/booths/{b}/bridge/publicKey` (SPKI, base64), and stores it in `enc.key`.
  - Only the bridge holds the private key, protected with DPAPI on the PC. Firebase stores only
    ciphertext.
  - `enc.kid` names the key the job was encrypted for: the lowercase hex SHA-256 of the DER bytes of the
    SPKI public key (`SHA-256(base64decode(publicKey))`), first 16 hex characters. Kiosks older than
    bridge 1.1.1 leave it out.

What the bridge does:
1. It picks up every job with `status:"queued"`. It also re-checks queued jobs every 30 s, so a job
   whose claim failed is retried without waiting for a new event or a reconnect.
2. It skips a job whose `enc.kid` is present and is not its own key id. The job stays `queued` with its
   data; the bridge does not claim it, fail it or delete it. A job without `enc.kid` is processed as before.
3. It decrypts the file, then immediately claims the job: it PATCHes `data` and `enc` to `null` and sets
   `status:"printing"`. This keeps the photo in the cloud for seconds only. If the claim request times
   out, the bridge reads the job back to see whether the claim landed.
4. It prints, writing `status:"printing"`, then `"done"` or `"error"` with a `message`.
   - As in the LAN API, `error` is not final while the job is still in the Windows spooler.
   - If the job cannot be queued after the claim, it is marked `error`.
   - Once the kiosk has deleted the job node, the bridge writes no more status updates, so deleted nodes
     do not come back.
5. It does not print a job whose `createdAt` is more than 15 minutes old. It marks the job `error` with
   the message "Expired".
6. Print state is kept in memory only. After a restart, on the first full sync, the bridge marks jobs
   and test prints that are still `printing` from before the restart as `error`, with the message
   "The print PC restarted while printing – check whether it printed before reprinting".

### Housekeeping
The kiosk deletes `/payments/{orderId}` after it is final (`paid`, `closed` or `expired`). It deletes
`/jobs/{jobId}` once the job is `done`, or `error` after its 2-minute grace time. The order record keeps the
outcome. The bridge treats a deleted node as handled.

### BridgeStatus (`/booths/{b}/bridge`): written by the bridge
```json
{"name":"BOOTH-PC","version":"1.1.1","publicKey":"<SPKI b64>","lastSeen":0,
 "printer":{"name":"DS-RX1HS","state":"ready","message":"Ready","jobsInQueue":0},
 "payments":{"provider":"razorpay","ready":true,"message":"Razorpay live keys"}}
```
- The bridge updates `lastSeen` and `printer` every 30 s.
- `publicKey` is pinned by the rules. Once it is set, only the same value (or an admin) may be written.
  A heartbeat PATCH with a different key is refused as a whole. When the dashboard pairs a new Print PC,
  it clears `publicKey` and unpairs the other bridges.
- If its heartbeat is refused and `publicKey` holds another key, the bridge stops working on the booth.
  It shows "This booth is linked to another Print PC key – pair this PC again from the dashboard", and
  retries with backoff. It does not fail or delete jobs in this state. On that PC, **Pair with booth**
  then starts over with a new cloud identity and a new pairing code.
- Clients treat the bridge as offline when `lastSeen` is more than 90 s old.
- `printer.state` uses the LAN API values: `ready`, `printing`, `offline`, `paper_out`, `jammed`,
  `error` or `not_found`.

### TestPrint (`/booths/{b}/testPrints/{id}`): admin ⇄ bridge
The admin writes `{media, finish, status:"queued", createdAt}`. The bridge prints its built-in test sheet
and updates `status` (`printing`, then `done` or `error`) and `message`.
