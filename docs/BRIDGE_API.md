# EPIXS Print Bridge – LAN API contract (v1)

The kiosk tablet (Flutter app) talks to the Windows PC running **EPIXS Print Bridge** over the local
network. The bridge prints to the DNP DS-RX1HS through the Windows driver and also talks to the payment
gateway (Razorpay), so the gateway secret never lives on the tablet.

- Default HTTP port: **8686** (configurable). Base path `/api`.
- Every request except `GET /api/ping` must carry header **`X-Bridge-Key: <pairing key>`**.
  Wrong/missing key → `401 {"error":"Invalid bridge key"}`.
- All bodies are JSON (UTF-8) unless stated. Errors: `4xx/5xx` with `{"error":"<human readable>"}`.
- Timestamps are ISO-8601 UTC strings with second precision (`2026-10-12T10:20:00Z`). Money is integer **paise** (₹1 = 100).

## Discovery (UDP)
Client broadcasts the ASCII datagram `EPIXS_BRIDGE_DISCOVER` to `255.255.255.255:8687`.
Bridge replies (unicast to the sender's address/port) with JSON:
```json
{"app":"EPIXS Print Bridge","name":"BOOTH-PC","port":8686,"version":"1.0.0"}
```

## Endpoints

### `GET /api/ping` (no key)
```json
{"app":"EPIXS Print Bridge","version":"1.0.0","name":"BOOTH-PC","requiresKey":true}
```

### `GET /api/status`
```json
{
  "printer": {"name":"DS-RX1HS","online":true,
              "state":"ready|printing|offline|paper_out|jammed|error|not_found",
              "message":"Ready","jobsInQueue":0},
  "payments": {"provider":"razorpay|simulator|none","ready":true,"message":"Razorpay live keys"},
  "profiles": ["4x6|gloss","2x6|gloss","3.5x5|matte"]
}
```

### `POST /api/print` (multipart/form-data)
Parts:
- `image` – the print-ready file (PNG or JPEG) rendered at 300 dpi. For `2x6` the image is a full
  4×6 portrait sheet (1200×1800) containing two strips side by side; the printer's 2-inch cut splits it.
- `meta` – JSON string:
```json
{"orderId":"20261012-0007","media":"4x6|2x6|3.5x5|5x7|6x8","finish":"gloss|matte",
 "copies":2,"reprint":false}
```
`copies` 1–10. Response `202`:
```json
{"jobId":"j_8f2c…","status":"queued"}
```

### `GET /api/jobs/{jobId}`
```json
{"jobId":"j_8f2c…","orderId":"20261012-0007","status":"queued|printing|done|error",
 "message":"Printed 2 copies","copies":2,"updatedAt":"2026-10-12T10:20:00Z"}
```
`done` = the job has left the Windows spooler without error. `error` carries a message such as
"Printer out of paper". **`error` is not final while the job is still in the spooler**: once staff fix
the printer the same job can move on to `done`. Clients keep polling; the bridge gives up after 5 minutes.
For `2x6`, one copy = one 4×6 sheet = two strips after the cut.

### `POST /api/test-print`
Body `{"media":"4x6","finish":"gloss"}` → prints a calibration/test sheet. Response as `/api/print`.

### `POST /api/payments/qr`
Creates a single-use dynamic UPI QR for an exact amount.
```json
{"orderId":"20261012-0007","amount":15000,"description":"Picok Booth 4x6 x1"}
```
Response `200`:
```json
{"qrId":"qr_N4…","provider":"razorpay","amount":15000,
 "upiString":"upi://pay?…" ,            // may be null – then show imageUrl
 "imageUrl":"/api/payments/qr/qr_N4…/image",   // relative to bridge base URL, PNG
 "expiresAt":"2026-10-12T10:25:00Z"}
```

### `GET /api/payments/qr/{qrId}`
```json
{"qrId":"qr_N4…","status":"pending|paid|expired|closed|error",
 "paymentId":"pay_N4…","method":"upi","amount":15000,"payerVpa":"abc@okaxis","message":null}
```

`error` is not final either (gateway unreachable); keep polling until `paid`, `expired` or `closed`.

### `GET /api/payments/qr/{qrId}/image` → `image/png`
Requires the `X-Bridge-Key` header like every other call.

### `POST /api/payments/qr/{qrId}/close`
Closes the QR (customer cancelled / timed out). The bridge checks for a payment one last time before
closing: if money arrived the response is `status:"paid"` and the tablet must continue the order.
Response body as `GET /api/payments/qr/{qrId}`.
