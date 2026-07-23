# Canvas Jewelry — Ordering API

NestJS + PostgreSQL (TypeORM) backend for the custom-jewelry ordering flow: phone
verification by SMS one-time code, then an authenticated STL upload that creates
an order.

## Stack

| Concern    | Choice                                                  |
| ---------- | ------------------------------------------------------- |
| Framework  | NestJS 11 (Express platform)                            |
| Database   | PostgreSQL via TypeORM 1.x, schema managed by migrations |
| SMS        | Twilio, wrapped in `SmsService` (logs to console in dev) |
| Uploads    | Multer, in-memory, 25 MB cap                            |
| STL storage | AWS S3 (`StlStorageService`); downloads via presigned URL |
| Tokens     | JWT (`@nestjs/jwt`) + a DB record that makes it single-use |

## Setup

```bash
npm install
cp .env.example .env      # then fill in the values below
npm run migration:run
npm run start:dev
```

Requires a reachable PostgreSQL instance. Create the database first:

```bash
createdb canvas_jewelry
```

### Environment

| Variable                                        | Required | Notes                                                    |
| ----------------------------------------------- | -------- | -------------------------------------------------------- |
| `DB_HOST` `DB_PORT` `DB_USERNAME` `DB_PASSWORD` `DB_DATABASE` | no | Standard Postgres connection settings.        |
| `DB_SYNCHRONIZE`                                | no       | Keep `false`. Use migrations.                            |
| `JWT_SECRET`                                    | **yes**  | Min 32 chars. Signs verification tokens and hashes OTP codes. `openssl rand -hex 32` |
| `STAFF_API_KEY`                                 | **yes**  | Min 16 chars. Guards every staff endpoint and is the admin dashboard's sign-in credential. |
| `TWILIO_ACCOUNT_SID` `TWILIO_AUTH_TOKEN` `TWILIO_FROM` | no | All three unset ⇒ dev mode: codes are logged, not sent.  |
| `AWS_REGION` `S3_BUCKET` `AWS_ACCESS_KEY_ID` `AWS_SECRET_ACCESS_KEY` | **yes** | S3 for STL storage. No local-disk fallback — the app fails to boot without these. |
| `S3_PREFIX`                                     | no       | Object key prefix, e.g. `stl/`. Default none.            |
| `S3_ENDPOINT`                                   | no       | Custom S3 endpoint for LocalStack/MinIO in dev (path-style). |
| `S3_PRESIGN_TTL_SEC`                            | no       | Presigned download URL lifetime. Default `300`.          |
| `CORS_ORIGIN`                                   | no       | Comma-separated origins. Unset allows any origin. Must include the admin dashboard's origin (`http://localhost:5175` in dev). |
| `PORT`                                          | no       | Defaults to `5050`.                                      |

Startup fails fast with a readable error if `JWT_SECRET` or `STAFF_API_KEY` is
missing or too short.

## Migrations

```bash
npm run migration:run       # apply
npm run migration:revert    # roll back the last one
npm run migration:generate -- src/database/migrations/<Name>
```

Tables: `otps`, `verification_tokens`, `orders`, `status_changes`.

## API

All errors return `{ "message": string }`. The client branches on status:
`401` bad code / bad token, `429` rate limited, `4xx` validation, `5xx` server.

### `POST /otp/request`

```json
{ "phone": "+37455123456" }
```

→ `200 { "expiresInSec": 300 }`

Generates a 6-digit code, stores only its HMAC-SHA256 hash, and sends it by SMS.
Any previously live code for that phone is invalidated. Limits: 3 per phone and
10 per IP in a 15-minute window → `429`.

### `POST /otp/verify`

```json
{ "phone": "+37455123456", "code": "123456" }
```

→ `200 { "verificationToken": "<jwt>" }`

The token expires in 15 minutes and is bound to the phone. Wrong or expired
code → `401` with a deliberately generic message. After 5 wrong guesses the code
is burned and further attempts return `429`.

### `POST /orders`

`multipart/form-data`:

| Field               | Type   |
| ------------------- | ------ |
| `stl`               | file, ≤ 25 MB, must be real STL |
| `phone`             | E.164 string |
| `verificationToken` | from `/otp/verify` |
| `options`           | JSON string (schema below) |

→ `201 { "id": "<uuid>", "status": "received" }`

The token must be valid, match `phone`, and be unused — otherwise `401`. It is
consumed on success, so it cannot create a second order. Validation runs before
the token is consumed, so a malformed request doesn't force the user to
re-verify.

STL files are uploaded to S3 under the object key `<S3_PREFIX>[phone]-[barcode].stl`
(e.g. `+37455123456-0042317.stl`); the client's filename is recorded but never
used as a key. The key is built only from the validated phone and the generated
barcode. Downloads are served as short-lived presigned GET URLs (see below), so
the bucket stays private and STL bytes never pass through this server.

#### `options` schema

```jsonc
{
  "product": "mountains" | "skyline" | "pendant",
  "place": { "name": string, "lat": number, "lng": number },
  "jewelryType": "pendant" | "ring" | "bracelet",
  "shape": "rectangle" | "heart" | "circle",
  "metal": "gold" | "silver" | "platinum",
  "width": number, "relief": number, "thickness": number,
  "areaKm": number, "smooth": number,            // smooth is an integer >= 0
  "hangPlace": number, "hangSize": number, "hangRotation": number,
  "hangHorizontal": boolean, "ringRotation": number,
  "engraving": string,                           // trimmed, <= 40 chars, "" if none
  "overlays": { "buildings": boolean, "streets": boolean },
  "estimate": { "amd": number, "grams": number } | null
}
```

`product`, `jewelryType`, `shape`, and `metal` are validated against the enums
above; unknown values are rejected. Numbers must be JSON numbers — `"25"` is
refused, so the client can't smuggle a type coercion through. `smooth` must be a
non-negative integer.

**Unknown/extra keys are kept, not rejected.** Known fields are validated, but a
field the frontend adds later still ingests and round-trips rather than 400-ing
the order. The exact JSON string received is also stored verbatim in
`orders.rawOptions` (never serialised back to clients), so nothing is lost even
if the parsed view changes shape.

`estimate` is persisted for support context only and is **never** read back for
billing; recompute price server-side at fulfilment. Content type on the upload is
sanity-checked, but the real STL gate is a binary/ASCII byte sniff, not the
declared MIME type.

### Staff endpoints

Every endpoint below requires an `x-api-key: $STAFF_API_KEY` header and returns
`401 { "message": "Invalid API key" }` without one. `stlPath` is an absolute
server filesystem path and is **never** serialised — responses are built from an
explicit `OrderResponseDto`, so a column added to `orders` later cannot leak by
default.

#### `GET /orders`

| Query    | Default          | Notes                                             |
| -------- | ---------------- | ------------------------------------------------- |
| `limit`  | `50`             | Capped at 200 rather than rejected.               |
| `offset` | `0`              |                                                   |
| `status` | —                | Exact match: `received`, `in_production`, `shipped`, `cancelled`. |
| `phone`  | —                | Partial, case-insensitive. LIKE wildcards in the term are escaped. |
| `sort`   | `createdAt:desc` | Or `createdAt:asc`.                               |

→ `200`

```jsonc
{ "items": OrderResponse[], "total": number, "limit": number, "offset": number }
```

This replaced a bare `Order[]`. The only consumer is the admin dashboard, so
there is no deprecation path.

#### `GET /orders/:id`

→ `200` — one order plus `statusChanges`, its audit trail oldest-first.
`404 { "message": "Order not found" }` otherwise.

#### `GET /orders/:id/stl`

→ `200 { "url": string, "expiresInSec": number }`

Returns a short-lived presigned S3 GET URL; the browser downloads straight from
S3. The URL forces a download named `[phone]-[barcode].stl` (via
`response-content-disposition`) with `Content-Type: model/stl`. The object key is
re-derived from the order's own phone and barcode — the stored `stlPath` is
deliberately not trusted.

- `404 { "message": "Order not found" }` — no such order.
- `404 { "message": "STL file is no longer available" }` — the row exists but the
  S3 object does not (a HEAD check runs before presigning). Logged as an error:
  storage has drifted from the database and someone needs to know.

This endpoint itself needs the `x-api-key` header; the returned S3 URL does not
(the presignature is the credential). For the bucket to allow the browser to
download cross-origin, add the admin origin to the bucket's CORS config.

#### `DELETE /orders/:id`

→ `204 No Content`. Permanently deletes the order, its `status_changes` rows
(via the foreign key's `ON DELETE CASCADE`), and its STL object in S3.

Allowed from **any** status. There is no soft-delete and nothing to restore
from — the dashboard gates this behind a typed confirmation.

The database row is deleted first, then the S3 object. The reverse order would
leave a row whose object is missing if the second step failed: an order that
looks fine in the list but 404s on download. An orphaned object is the safer
failure — harmless, logged, and reclaimable. The object key is re-derived from
the order's phone and barcode; the stored `stlPath` is never used.

Because deletion leaves no audit row behind, each one is logged at `warn` with
the id, phone, status, and filename — the only remaining trace that the order
existed.

- `404 { "message": "Order not found" }` — no such order.

#### `PATCH /orders/:id/status`

```json
{ "status": "in_production" }
```

→ `200` — the updated order with its audit trail.

Legal transitions, enforced server-side inside a transaction with a row lock so
two concurrent requests cannot both be accepted:

| From            | To                        |
| --------------- | ------------------------- |
| `received`      | `in_production`, `cancelled` |
| `in_production` | `shipped`, `cancelled`    |
| `shipped`       | terminal                  |
| `cancelled`     | terminal                  |

An unknown status is `400`. A known but illegal one — including a no-op
self-transition — is `409` with a message naming both ends, e.g.
`Cannot change status from "shipped" to "received"`. Every accepted change
appends a row to `status_changes`.

## Testing

```bash
npm test        # unit tests — no database needed
npm run test:e2e  # requires a live PostgreSQL
npm run lint
npm run build
```

Unit tests cover STL content sniffing, `options` validation, the OTP state
machine (rate limits, attempt caps, expiry, replay), the order status state
machine (every ordered pair of statuses, legal and illegal), the barcode
collision-retry, and the S3 storage service (upload key, presign, missing-object
404) — all against mocked repositories and a mocked S3 client.

## Admin dashboard

Staff-facing order dashboard, in the sibling `canvas-jewlery-admin/` repository.
It is the only consumer of the staff endpoints. See its README for setup; two
things must line up on this side:

1. `CORS_ORIGIN` includes the dashboard's origin (`http://localhost:5175` in dev).
2. CORS allows `PATCH` and `DELETE` — set in `src/config/cors.config.ts` and
   pinned by tests, because **each fails invisibly**: the browser reports an
   opaque error and the server logs nothing.
   - Without `PATCH` in `methods`, the status control dies at the preflight.
   - Without `DELETE` in `methods`, deleting an order dies the same way.

The STL download now returns a presigned S3 URL as JSON, so the admin fetches
`{ url }` and navigates to it — the bucket (not this API) must allow that
cross-origin GET. The admin download code needs updating for this contract
change; see the note handed over separately.

## Security notes

- OTP codes are stored as HMAC-SHA256 keyed with `JWT_SECRET`, never plaintext;
  comparison is constant-time and the phone is mixed into the hash so a hash
  can't be replayed against another number.
- Verification tokens are single-use. Consumption is a conditional `UPDATE ...
  WHERE consumedAt IS NULL`, so two concurrent requests can't both spend one.
- The staff API key is compared in constant time.
- STL detection parses the binary header's triangle count and checks it against
  the file length, falling back to an ASCII-facet check. Extension alone is not
  trusted — and neither is a leading `solid`, since binary STL headers often
  start with it too.
