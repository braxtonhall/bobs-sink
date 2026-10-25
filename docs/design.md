# bobs-sink — Design Overview

A small, self-hostable CRDT document service. It starts as anonymous cloud saves for my websites and grows into a general managed document service for people I know.

Status: Phases 1 (the service, `packages/server`) and 2 (the client library, `packages/client`) are implemented in this repo. Next is the operator console (§12, registering apps from a page instead of the apps file, with operators signed in through bobs-server SSO, §13), together with the bobs-server SSO endpoints and the deployment (§14). After that, the first site integration (findcalvinandhobbes.com) is designed separately. Notes marked **Implemented:** record decisions made while building; notes marked **Planned:** are designed but not built.

---

## 1. Goals

- **Zero-account cloud saves** for my websites: a visitor turns on "cloud saves" in settings and it just works, across devices.
- **Sharing:** public documents and friend comparisons, not only private data.
- **Managed documents** (later): signed-in users create documents and manage visibility, permissions, and schemas.
- **Shared public documents** (later): one document every visitor of a site can edit.
- **Forkable:** other people can host forks of my sites, using my instance or their own.
- **Bounded growth:** size limits, history compaction, and automatic deletion of abandoned anonymous data.

Non-goals for v1: end-to-end encryption, billing, a full OAuth/OIDC provider, site-specific UX.

---

## 2. Key decisions

| Decision               | Choice                                                                   | Why                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Build vs. use existing | Build                                                                    | Evolu, Jazz, Google Drive, etc. each miss something (public data, no-account UX, background sync, fork-friendliness). |
| Identity               | Passkeys + per-device signing keys                                       | Passkey sync (iCloud / Google) replaces QR codes and link tokens.                                                     |
| CRDT library           | Yjs                                                                      | Compaction is merge-safe by default; already familiar.                                                                |
| History management     | Snapshot + op-log compaction, `gc: true`, epoch rebuilds as escape hatch | Bounded storage without breaking offline devices.                                                                     |
| One service or two     | One service, with **apps** as the unifying concept                       | Anonymous vs. managed becomes configuration, not two systems.                                                         |
| Forks                  | Implicit apps + self-hostable server                                     | Forks work with zero setup; anyone can run their own instance.                                                        |
| Managed-account login  | Redirect SSO via bobs-server                                             | Don't reimplement email auth; keep the new service decoupled.                                                         |
| bobs-server rewrite    | Not first; extract gradually behind Caddy                                | Ship the docs service sooner; let real use shape the auth service.                                                    |
| Client                 | General-purpose client library, built after the service                  | Sites share identity, sync, and merge logic; site UX is designed per site later.                                      |

---

## 3. Core concepts

**App.** A site that uses the service, identified by its passkey RP ID (e.g. `findcalvinandhobbes.com`). An app has an owner (me, or implicit), a schema, quotas, and a lifecycle policy. Every document belongs to an app or a managed account, so nothing is truly ownerless.

**Identity.** A person, as seen through a passkey. Stable ID stored in the passkey's `userHandle` (≤ 64 bytes). One identity can own several documents per app.

**Passkey.** WebAuthn credential (public key + credential ID) attached to an identity. An identity may have multiple passkeys (backup).

**Device key.** A non-extractable WebCrypto Ed25519 keypair held by one browser. Authorized by a passkey; signs everyday traffic silently.

**Document.** A Yjs document with:

- **readers / writers:** identities, accounts, or `public`
- **lifecycle:** `ephemeral` (deleted after 1 year unused) or `pinned` (kept until deleted)
- **quota:** 2 MB for ephemeral documents; larger for pinned
- **schema:** its own, or inherited from its app
- **epoch:** integer, bumped on a full rebuild
- **compactable:** whether the server can read and compact it (false for future encrypted docs)

**Account.** (Managed side.) A signed-in user, granted by me. Logs in through bobs-server SSO.

---

## 4. Identity and device flows

Passkeys can't sign silently (every signature prompts Face ID / fingerprint), so the passkey only _authorizes_ device keys, and device keys sign everything else.

### First use ("turn on cloud saves")

1. Site registers a passkey (RP ID = site domain, `userHandle` = new identity ID).
2. Site generates a device keypair.
3. One passkey-signed request: create identity, authorize this device key.
4. If the identity has no document for this app, the client creates the first one, **seeded from the local doc's state** (`Y.encodeStateAsUpdate(localDoc)`), so nothing done before enabling cloud saves is lost.

### Background sync

- WebSocket connections authenticate once per connection: the server sends a random challenge, the client signs it (plus document ID and epoch) with its device key. Messages on that connection are not signed individually; TLS protects them in transit.
- Signed HTTP requests (outside the WebSocket) cover document ID, timestamp or nonce, and payload hash (and version where relevant), so captured requests can't be replayed.

### Signing in on another device

1. User taps "Sign in with passkey"; the synced passkey appears.
2. Server **looks up the credential by credential ID**, verifies the assertion against that credential's stored public key, then checks that the returned `userHandle` equals the identity the credential belongs to. `userHandle` is never used as the lookup key.
3. On success, the assertion authorizes the new device key.
4. Server returns the identity's documents for this app; the client decides what to do (§5).

### Lost device keys

Device keys live in IndexedDB, which browsers may evict. Safari's ITP deletes script-writable storage for a site after ~7 days without a visit. Losing a device key is a normal case, not an error:

- On startup, the client checks that its device key exists and is still authorized (a cheap signed ping).
- If the key is missing or rejected, sync stops and the client asks the site to show one "sign in again" prompt (passkey assertion → new device key). It doesn't prompt repeatedly; if dismissed, it waits until the user asks.
- The client calls `navigator.storage.persist()` where available to reduce eviction.
- Local unsynced edits survive only if the local doc survived; if it did, it's merged after sign-in like any other device.

### Revocation and backup

- Any passkey-signed request can remove a device key.
- Allow additional passkeys per identity, so a single non-syncing device isn't a single point of failure.

### Verification rules

- Verify full WebAuthn data: origin, RP ID hash, challenge, signature, and credential-to-identity binding (above).
- Record each document's app (RP ID) at creation; only return documents for the requesting app.
- **Security note:** the RP ID check does not prove a request came from that website (anyone can fabricate a software "passkey" for any RP ID). It keeps real browser passkeys separated between sites. Don't treat "came from RP ID X" as access control between apps, and don't let it bypass per-app limits (§10).

---

## 5. Client library

A general-purpose browser library, built after the service. Site-specific UX (wording, counts, prompts) is out of scope until a site integration is designed.

Responsibilities:

- **Identity:** passkey registration and assertion, device key generation and storage, lost-key detection (§4).
- **Sync:** a Yjs provider over the authenticated WebSocket, plus local persistence (IndexedDB).
- **Epochs:** detect an epoch bump and run the rebuild flow (§7).
- **Sign-in result:** after sign-in, expose the identity's documents for this app and the local doc, and let the site choose:
  - no documents → create one seeded from local state (§4);
  - one or more → **merge local into a remote doc**, **use a remote doc and discard local**, or **keep local as a separate new document**.

### Merging two documents

The local doc and a remote doc are separate Yjs docs with unrelated histories, so applying one's update to the other is not a meaningful merge. Merging is an app-level copy: the library walks the local doc's top-level maps and writes each entry into the remote doc as new edits, inside one transaction. This works well with keyed maps (§6): union by key, with a per-app hook to resolve keys present in both (default: keep remote). "Use remote" simply destroys the local doc.

### Implemented

`@bobs-sink/client` (`packages/client`) exposes one class, `SinkClient`, around one working `Y.Doc`:

- **Storage:** the working copy is persisted with y-indexeddb in a database of its own, named randomly per replica. Replacing the working copy (epoch rebuild, rejection, merge, sign-out) creates a fresh replica and deletes the old one in the background, because IndexedDB deletes wait while another tab holds the database open. Client state (identity, device key pair, the document the working copy belongs to) is a small key-value store beside it. Device keys are non-extractable WebCrypto Ed25519 keys, stored as `CryptoKey`s.
- **Sign-in result:** `signIn()` resumes automatically when the working copy already belongs to one of the identity's documents (it shares that document's history, so syncing merges exactly). Otherwise the site picks `createDocumentFromLocal`, `mergeLocalInto(id, resolve?)` or `useRemote(id)`. Merging needs the app's root types (`roots`), since a doc loaded from storage doesn't know them.
- **Lost keys:** there is no separate startup ping; the WebSocket's signed challenge is the check. A 4401 stops syncing and reports `needs-sign-in` once; local edits keep being saved, and signing in resumes with them.
- **Rejections:** the client reports the reason and resets the working copy to the service's state (see the sync protocol). Unsynced local edits are lost, so sites should validate locally.
- **Doc replacement:** several flows replace the working `Y.Doc`; the client emits `doc` with the new one. Sites must re-bind to it.
- **Sync:** local updates are batched briefly and merged into one update (the server rate-limits updates per device). Reconnects use exponential backoff with jitter, and reconnect immediately on the browser's `online` event. Close codes that need a decision (unauthorized, gone, epoch changed, bad message) stop syncing instead of retrying.
- **Sign-out** deletes the device's working copy and key. Without acknowledgements in the sync protocol the client can't tell whether every edit reached the server, so edits made just before signing out can be lost.
- **Multiple tabs** each sync on their own connection over the same stored replica, which converges through the server. Two tabs recovering from the same epoch rebuild both re-apply their edits; that's harmless but duplicates work.

---

## 6. Documents and data model

### Guidance for app schemas

Use maps keyed by ID, not lists (lists are where merges get surprising).

```ts
// example: a collection of items keyed by ID
doc.getMap("items"); // key: item ID
// value: Y.Map { at: number, note: Y.Text }
doc.getMap("meta"); // display name, settings, etc.
```

- **Text fields:** `Y.Text`, so concurrent edits on two offline devices both survive (possibly interleaved) rather than one silently winning.
- **Counts:** derive from map size; never store counters (concurrent increments get lost).
- **Writes are "set" operations,** not toggles, so repeating them is safe.

### Conflict behavior

- Different keys / fields: merge cleanly.
- Same `Y.Text`: character-level merge.
- Same plain value: last writer wins.
- Deletes: tombstoned, merged safely.

---

## 7. Sync and persistence

### Transport

WebSocket with the server as hub, authenticated per connection (§4). On connect, client and server exchange state vectors and send each other only missing updates. Updates broadcast to other connected clients.

### Live documents

The server keeps an in-memory `Y.Doc({ gc: true })` for each active document (loaded on first connection, evicted after idle). It is the source of truth while loaded; the database is its durable copy.

### Storage: snapshot + op log

Tables (Drizzle, SQLite; see `packages/server/src/db/schema/`):

- `documents`: id, app, owner, visibility, lifecycle, epoch, `snapshot` (Y.encodeStateAsUpdate at last compaction), `snapshotSeq`, `sizeBytes`, timestamps.
- `operations`: (document, seq) primary key, Yjs update payload, the device key that sent it.
- `epoch_archives`: (document, epoch) primary key, the server's final state for that epoch as an encoded `Y.Snapshot` (state vector and delete set).

- The op log is a write-ahead log: each accepted update is appended to `operations` before it's applied to the live doc or broadcast.
- **Implemented:** no explicit lock. One process owns each live doc, and the whole update path (validate, append, apply, broadcast) is synchronous, because better-sqlite3 is synchronous. Each update runs to completion before the next starts, which gives the same guarantee a per-document mutex would. `nextSeq` is derived on load (last op seq, or `snapshotSeq`, plus one) rather than stored. If storage ever becomes async, this needs a real lock.
- **Compaction** runs in one DB transaction: write `snapshot = Y.encodeStateAsUpdate(liveDoc)` and `snapshotSeq = nextSeq - 1`, then delete operations with `seq <= snapshotSeq`.
- **Trigger:** compact on idle (no updates for a short period) or after N updates, whichever comes first, and always on eviction.
- Loading a document: apply the snapshot, then operations with `seq > snapshotSeq`.

### Why compaction is safe for offline devices

A Yjs snapshot keeps every item's identity (`{clientId, clock}`) and the state vector. A device that was offline across many compactions reconnects, exchanges state vectors, and its old edits merge normally. Compaction removes duplication, not causal information.

This is different from **history discarding** (Loro shallow snapshots, dropping Automerge changes, or a Yjs rebuild), which does break merges for stale devices.

### Growth over time

Compacted Yjs docs still grow slowly from:

- placeholders for deleted items (collapsed into ranges per client),
- **client IDs:** each page load creates a new one, adding state-vector entries and fragmentation (don't reuse IDs per device; concurrent tabs would corrupt the doc),
- per-item metadata for live entries (proportional to real content).

Personal documents should stay far under 2 MB. Measure with `Y.encodeStateAsUpdate(doc).byteLength` on realistic test data.

### Epoch rebuilds (escape hatch)

**Implemented:** rebuilding copies each declared root into a fresh `Y.Doc` (nested types are cloned, so `Y.Text` stays `Y.Text`), so it needs an app schema that declares roots. It's triggered by `POST /admin/documents/:id/epochs`.

Server side:

1. Record the live doc's snapshot (state vector and delete set) in `EpochArchive` for the ending epoch.
2. Create a fresh `Y.Doc` from the current JSON, bump `epoch`, replace snapshot and clear the op log.

Client side, on seeing a newer epoch:

1. Fetch the old epoch's archived snapshot.
2. Compute its unsynced changes: `Y.encodeStateAsUpdate(localDoc, archivedStateVector)`.
3. If empty, just replace the local doc with the new epoch's doc.
4. Otherwise, apply those changes to a copy of the old local doc and diff its JSON against the new doc's JSON (or, simpler, run the merge copy in §5 for the touched keys), writing the differences into the new doc as fresh edits.
5. Replace the local doc with the new one.

**Implemented:** the archive is a full `Y.Snapshot`, not just the state vector. A Yjs update always carries the document's entire delete set, so the state vector alone can't separate deletions made offline from ones the server already had; replaying all of them would delete keys that another device re-added after the rebuild. With the snapshot, the client's unsynced changes are the items created past the server's state vector plus the items the server had that the client deleted since (`unsyncedChanges.ts`). Each change is attributed to its top-level key, and in the new epoch the client overwrites (or deletes) exactly those keys with its local value (`copyChanges.ts`); array and text roots are replaced whole. So recovery is "local wins, per top-level key, for keys edited offline." If the archive is gone, the new epoch's state wins.

Keep archives for at least the ephemeral lifetime (1 year), so a device offline that long can still recover its edits.

Build the `epoch` field into the format from day one. Routine (e.g. monthly) for large public-write docs; emergency-only for small personal ones.

---

## 8. Schemas and validation

- Every document resolves a schema: its own (managed) or its app's.
- Schema language for v1: **JSON Schema over `doc.toJSON()`**.
- Server applies each incoming update to a scratch copy, then checks:
  - **no pending data:** after applying, `scratch.store.pendingStructs` and `scratch.store.pendingDs` must be null. An update with missing dependencies would otherwise sit unapplied, pass validation, and be applied later by an unrelated update, bypassing every check. Clients resend from their state vector, so a rejected out-of-order update arrives again in order.
  - schema, size quota (`Y.encodeStateAsUpdate(scratch).byteLength`), and banned keys.
- **root shapes:** roots received in updates carry no type, and Yjs casts an untyped root to whatever type is asked for, so text sent under a root declared as a map would just be invisible to the schema check. The server checks each root's stored content matches its declared kind before casting (`packages/server/src/documents/rootShape.ts`).
- Reject whole updates (Yjs updates can't be partially accepted).
- **A rejection is permanent for that Y.Doc.** Later updates from the same doc build on the rejected one, so they fail with missing dependencies. The client must discard the doc, start a new one from the server's state, and re-apply what it wants to keep. The client library should validate locally so this stays rare.
- **Cost:** validation applies the update to a full scratch copy, O(document size) per update. That's fine for small personal docs; large public-write docs may need something cheaper.
- Only possible for server-readable (`compactable`) documents.

---

## 9. Visibility and permissions

| Mode         | Read            | Write           | Notes                                                 |
| ------------ | --------------- | --------------- | ----------------------------------------------------- |
| private      | owner's devices | owner's devices | v1: server-readable. Later: E2E (below).              |
| public-read  | anyone          | owner's devices | Public documents, sharing with friends, leaderboards. |
| public-write | anyone          | anyone          | Shared site-wide documents (§11).                     |

### Future: end-to-end encrypted private docs

- Passkey **PRF extension** derives the same secret on every synced device → AES key. Good support on recent Chrome, Safari, Android; patchier elsewhere.
- Fallback: envelope encryption. Random data key per document, wrapped to each device's X25519 key; wrapped copies stored with the doc. Revocation = new data key, re-encrypt, re-wrap.
- Encrypted docs are opaque update logs: the server can't validate or compact them, so clients must snapshot.
- Read revocation in encrypted CRDTs is hard; read Ink & Switch's **Keyhive** work before designing this.

---

## 10. Lifecycle and quotas

- **Ephemeral:** deleted after 1 year without use. Use means a device synced it, or (for public-read and public-write docs) anyone read it. A shared link that people still open keeps the document alive.
- **Pinned:** kept until the owner deletes it. Managed accounts only, all granted by me.
- **Claiming (later):** an identity linked to an account can adopt its ephemeral docs and pin them, with no data migration.
- **Quotas:** 2 MB per ephemeral document; configurable per app and per account.
- **Abuse:** passkey registration doesn't prove a human, and RP IDs are self-asserted, so anyone can create identities and documents under any app, including registered ones. Limits apply at every level:
  - per device key and per IP: document creation and update frequency;
  - **per app:** identity creation rate, document creation rate, and total storage;
  - **per identity:** maximum documents per app (small, e.g. 10).

---

## 11. Shared public-write documents (another site)

- Created and owned by me as a pinned document under that site's app; visibility `public-write`.
- Signatures provide accountability, not permission: rate limits, attribution, bans per device key.
- Server-side validation rejects schema violations, oversize updates, and banned keys.
- Periodic server snapshots allow rollback after vandalism (rebuild + epoch bump).
- Scheduled epoch rebuilds, since every visitor adds client-ID metadata.
- If it grows large, split into several documents (per room / region / day) so visitors load only what they need.
- Rate-limit updates per key so one visitor can't flood all connections.

---

## 12. Apps, forks, and self-hosting

- **Registered apps:** I configure schema, quotas, lifecycle.
- **Implicit apps:** the first request from an unknown RP ID auto-creates an app with a default policy (small quotas, ephemeral, default or no schema, tight per-app limits from §10). Forks work with zero setup.
- **Self-hosting:** open-source server; the service URL is a config setting in each site. Forks can run their own instance; mine is the default.
- Fork users get their own passkeys and data (passkeys are domain-bound). Related Origin Requests don't scale to arbitrary forks.
- Public-read documents can still be read from any site, so cross-fork sharing of public documents is possible.

### Registering apps: the operator console

**Planned.** Today registered apps are listed in a JSON file (`APPS_FILE`) read at startup. They move into the database and are managed from a small server-rendered page on the service, so registering `findcalvinandhobbes.com` doesn't need a file edit and a restart.

- **Storage:** the `apps` table (today: every RP ID the service has seen) gains a nullable `policy` column holding the app's overrides (the same shape as one entry of the apps file: limits and `schema`) and `registeredAt` / `updatedAt`. A row with a policy is registered; without one it is implicit. Registering an RP ID the service hasn't seen yet inserts the row.
- **Defaults:** the registered and implicit defaults stay in code (`AppPolicy.ts`). `APPS_FILE` is removed rather than kept beside the database, so there is one source of truth.
- **Resolution:** `AppPolicies` loads every registered app at startup into memory (policy lookups are on the synchronous update path) and is updated in place when the operator saves. Saving also drops the app's cached `DocumentRules`, and live documents of that app swap to the new rules (a `LiveDocument` captures its rules when it loads, so without this they'd keep the old ones until evicted).
- **Validation on save:** the policy is parsed with the existing zod schema, and its JSON Schema is compiled with the same strict Ajv the rules use, so a bad schema is refused at the form rather than failing at the next update.
- **Changing a schema doesn't re-check existing documents.** Tightening it can leave a document that rejects every update until it's fixed. The page warns when the app has documents.
- **Unregistering** clears the policy; the app falls back to the implicit defaults. Existing documents are kept, even above the implicit limits.
- **Page:** `/operator` lists apps (registered first, then implicit ones the service has seen, with document counts and storage). Each app has a form for its limits (blank means default) and a JSON field for `schema` (`roots` and `jsonSchema`). Registering takes an RP ID plus the same form.
- **Tests and the demo** register apps without the page: `Sink` exposes the app registry (`sink.apps.register(rpId, policy)`), and the demo's dev script registers `localhost` in its database before starting the service.
- The admin token route (`POST /admin/documents/:id/epochs`) stays. Moving it onto the page is a later convenience.

### Operators

**Planned.** Only operators can open the console. For now that's me: `OPERATOR_EMAILS` is a comma-separated list of email addresses (compared case-insensitively), set in the service's environment.

- Operators sign in through bobs-server SSO (§13), which proves the email address; bobs-sink checks it against `OPERATOR_EMAILS`. bobs-server only says who the person is; the whitelist lives here.
- The whitelist is checked at sign-in and again on every request, so removing an address takes effect immediately.
- **Sessions:** a random token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `/operator`, stored hashed in an `operator_sessions` table with the email and an expiry (12 hours). Signing out deletes the row.
- **CSRF:** every change is a form `POST`, which `SameSite=Lax` already keeps cross-site requests from carrying the cookie on; the server also requires the `Origin` header to match `PUBLIC_URL`.
- **Login CSRF:** the SSO `state` is random, set in a short-lived cookie when sign-in starts, and must match on the callback.
- **Configuration:** `PUBLIC_URL` (the service's own origin, e.g. `https://sink.bobs-server.net`, to build the callback URL), `SSO_URL` (`https://bobs-server.net/sso`), `SSO_EXCHANGE_URL` (internal, see §13), `SSO_EXCHANGE_SECRET` and `OPERATOR_EMAILS`. The console is mounted only when all are set; setting some but not all is a startup error.

---

## 13. Managed accounts: login via bobs-server SSO

bobs-server today: email one-time link / password → HS256 JWT in a host-scoped `access_token` cookie, refresh tokens in the DB. Don't share `JWT_SECRET` with the new service.

The first user of this flow is the operator console (§12), ahead of managed accounts: bobs-sink only needs `{ sub, email }` to check the operator whitelist. Managed accounts reuse it later.

**Flow:**

1. docs service → `https://bobs-server.net/sso?redirect=<allowlisted callback>&state=<random>`
2. bobs-server runs its existing email login if needed, then redirects back with a one-time `code` (random, single-use, ~60 s) and `state`. The code is stored with the `redirect` it was issued for.
3. docs service verifies `state`, then exchanges `code` server-to-server for `{ sub, email }`, sending the same `redirect`. bobs-server rejects the exchange if `redirect` doesn't match.
4. docs service creates its own session, keyed to bobs-server `Email.id`.

**Exchange transport:** the two services talk over the internal Docker network (e.g. `http://server/api/sso/exchange`), not `localhost`. The exchange endpoint requires a shared secret (`SSO_EXCHANGE_SECRET` in both services' env), and Caddy also blocks it from outside. Either control alone should be enough to stop external callers. It lives under `/api` because bobs-server's plain-HTTP listener redirects everything else to https.

**Implemented (bobs-server, see its `docs/sso.md`):**

- `GET /sso?redirect=…&state=…` sits behind the existing `enforceLoggedIn`, so a signed-out visitor goes through `/login` and comes back via `next`. `redirect` must exactly match an entry in `SSO_REDIRECTS` (comma-separated callback URLs, e.g. `https://sink.bobs-server.net/operator/callback`); otherwise 400, never a redirect. `state` is required and length-bounded.
- The code is a `Token` row with type `sso`, a random 256-bit value, 60 s expiry, and a new nullable `redirect` column. The existing expired-token cleanup job removes stale ones.
- `POST /api/sso/exchange` `{ code, redirect }` with `Authorization: Bearer <SSO_EXCHANGE_SECRET>` (compared in constant time). It consumes the code first (mark invalid where still valid and unexpired, in one statement), then checks `redirect`, so a code is never usable twice even when the check fails. Returns `{ sub, email }`.
- SSO is off (both routes 404) unless `SSO_REDIRECTS` and `SSO_EXCHANGE_SECRET` are set.

Alternative to keep in mind: managed accounts as passkey identities I've granted via invite link, with bobs-server login only for attaching email or recovery.

---

## 14. Imminent bobs-server changes

1. **Add the SSO endpoints:**
   - `GET /sso` — validate `redirect` against an allowlist, require login (reuse existing flow), issue a one-time code bound to `redirect`, redirect back with `code` + `state`.
   - `POST /sso/exchange` — internal only, requires the shared secret; consume code, check `redirect` matches, return `{ sub, email }`.
   - Storage: add `TokenType.SSO` to the existing `Token` table (store `redirect` alongside), or a small dedicated table.
2. **Caddy + compose:** route `sink.bobs-server.net` to the new service; put both services on a shared internal network; block `/api/sso/exchange` from outside.
   - Today bobs-server binds 80 and 443 itself and terminates TLS with certificate files mounted from the host. Caddy takes over both ports and the certificates (automatic HTTPS for `bobs-server.net`, `www.`, `api.` and `sink.`), and proxies to each container over the internal network.
   - bobs-server needs a mode for running behind a proxy: plain HTTP on one port, no certificate files, and Express `trust proxy` set, so `req.ip` (used by its login slow-down) is the visitor's address rather than Caddy's.
   - bobs-sink runs with `TRUST_PROXY=true`, a volume for its database, and its own `.env` (`ADMIN_TOKEN`, the SSO and operator settings from §12).
   - DNS: a `sink.bobs-server.net` record (CNAME to `bobs-server.net`, like `api.` and `www.`).
   - Deploys: bobs-server's workflow rebuilds only the `server` service; bobs-sink gets its own, or is rebuilt by hand at first.
   - **Implemented** in bobs-server: proxy mode (no certificate paths → plain HTTP; `TRUST_PROXY`), a `caddy` service and `Caddyfile`, a `sink` service built from the bobs-sink GitHub repo with `sink.env`, and the rollout steps in its `docs/server-setup.md`.
3. **No rewrite yet.** Later, extract auth into its own service once the docs service has shaped its API; peel off other parts of bobs-server only when there's a reason to touch them. Keep it to three or four services total.

---

## 15. Roadmap

**Phase 1 — the service** (implemented)

- Service skeleton (this becomes the template for future services)
- Passkey + device-key identity, apps (registered + implicit), per-app limits
- Authenticated Yjs WebSocket sync, live docs, snapshot/op-log compaction, epochs + archives
- JSON Schema validation, pending-update rejection, 2 MB quota, ephemeral lifecycle

**Phase 2 — the client library** (implemented)

- Identity and device-key management, lost-key recovery
- Yjs provider + local persistence
- Sign-in result handling, merge / discard / keep-separate, epoch rebuild flow

**Phase 2b — operating it** (planned, next)

- bobs-server: SSO endpoints, a mode for running behind a proxy (§13, §14)
- Deployment: Caddy in front of both services, `sink.bobs-server.net` (§14)
- bobs-sink: operator console with apps in the database, operator whitelist via SSO (§12); then register findcalvinandhobbes.com from it

**Phase 3 — first site integration**

- Design findcalvinandhobbes cloud saves (UX, schema, merge rules) once Phases 1–2 are merged.

**Phase 4 — sharing**

- Public-read documents, share links, friend comparison

**Phase 5 — managed side**

- Accounts (on the SSO from Phase 2b), pinned documents, permissions UI, schemas per document, claiming

**Phase 6 — extras**

- Public-write shared documents, E2E private docs, auth extracted from bobs-server

---

## 16. Open questions

- Default policy for implicit apps: no schema, or reject writes above a tiny quota until registered?
- How public documents are addressed (`/u/<id>`, read-only share links, both).
- Recovery story for users with a single non-syncing passkey.
- Values for compaction N and idle period, live-doc eviction time, and per-app limits (set after load testing).

### Resolved

- **WebSocket auth:** one device-signed challenge per connection, not per-message signatures (§4).
- **Schema language:** JSON Schema over `doc.toJSON()` for v1 (§8).
- **Compaction trigger:** on idle or after N updates, whichever comes first (§7).

---

## Appendix: alternatives considered

- **Evolu:** closest match (E2E, mnemonic or passkey owner, free relay). Rejected: fully encrypted so no public data or discovery; free relay is testing-only with no retention guarantee; no hosted tier.
- **Jazz:** polished hosted local-first sync, generous free tier. Rejected: v2 is a recent rewrite; less control.
- **Google Drive `appDataFolder`:** free and durable. Rejected for sync: needs a Google account, short-lived browser tokens break background sync, no live updates.
- **Nostr, remoteStorage, Solid, jsonbin/kvdb:** each covers part of the idea (signed events, user-owned storage, simple JSON stores) but not the whole.
