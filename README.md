# bobs-sink

A small, self-hostable CRDT document service. Sites get zero-account cloud saves: a visitor registers a
passkey once, and their browser syncs a [Yjs](https://yjs.dev) document across every device that passkey
reaches. See [docs/design.md](docs/design.md) for the full design.

This repo is an npm workspace:

| Package                                            | Purpose                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| [`@bobs-sink/server`](packages/server)             | The service                                                           |
| [`@bobs-sink/client`](packages/client)             | Browser library: passkeys, device keys, local persistence, Yjs sync   |
| [`@bobs-sink/protocol`](packages/protocol)         | The wire protocol both share: signed strings, sync messages, API JSON |
| [`@bobs-sink/test-support`](packages/test-support) | Private test helpers, e.g. a software passkey                         |

## Running

```sh
npm install
npm run dev          # runs the server from source, listens on :8080
npm test             # every package
npm run typecheck && npm run lint
npm run build && npm start
npm run demo         # the service plus a demo page on http://localhost:5173, see packages/demo
```

Packages import each other's TypeScript sources during development and tests (the `source` export
condition, see [tsconfig.source.json](tsconfig.source.json)), so nothing needs building first. `npm run build`
compiles everything to `dist/` with project references.

Configuration is environment variables; see [.env.sample](.env.sample). With Docker:

```sh
docker build -t bobs-sink .
docker run -p 8080:8080 -v sink-data:/data bobs-sink
```

Run it behind a reverse proxy that terminates TLS (and set `TRUST_PROXY=true`). Passkeys need a secure
context, so sites must be served over https; `ALLOW_LOCALHOST=true` permits `http://localhost` for development.

## Apps

An app is a site, identified by its passkey RP ID (its domain). Any site can use the service without
registering; unlisted RP IDs get tight default limits. Registered apps are listed in a JSON file named by
`APPS_FILE`:

```json
{
	"registered": { "maxDocumentBytes": 2097152 },
	"implicit": { "maxDocumentsPerIdentity": 3 },
	"apps": {
		"example.com": {
			"maxDocumentsPerIdentity": 5,
			"schema": {
				"roots": { "items": "map", "meta": "map" },
				"jsonSchema": { "type": "object" }
			}
		}
	}
}
```

Every field is optional. `registered` and `implicit` override the built-in defaults in
[AppPolicy.ts](packages/server/src/apps/AppPolicy.ts). With a `schema`, updates may only create the declared roots,
and `{ [root]: root.toJSON() }` must satisfy `jsonSchema`. Rebuilding a document into a new epoch requires
declared roots.

## API

Unsigned requests come from a page on the app's origin (the `Origin` header must be the RP ID or a subdomain).
Signed requests carry `Sink-Key`, `Sink-Timestamp`, `Sink-Nonce` and `Sink-Signature` headers; the signed
string is defined in [signedMessages.ts](packages/protocol/src/signedMessages.ts).

| Request                                                  | Auth          | Purpose                                                           |
| -------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| `POST /v1/registrations` `{ app, deviceKey, userName? }` | origin        | Start creating an identity; returns WebAuthn options              |
| `POST /v1/registrations/:ceremonyId` `{ response }`      | passkey       | Finish: create the identity and authorize `deviceKey`             |
| `POST /v1/sign-ins` `{ app, deviceKey }`                 | origin        | Start signing in on a new device                                  |
| `POST /v1/sign-ins/:ceremonyId` `{ response }`           | passkey       | Finish: authorize `deviceKey`; returns the identity's documents   |
| `POST /v1/revocations` `{ app, deviceKeys }`             | origin        | Start revoking device keys                                        |
| `POST /v1/revocations/:ceremonyId` `{ response }`        | passkey       | Finish: revoke them and close their connections                   |
| `GET /v1/me`                                             | signed        | The identity and its device keys; also checks the key still works |
| `DELETE /v1/me/device-key`                               | signed        | Sign this device out                                              |
| `GET /v1/documents`                                      | signed        | The identity's documents                                          |
| `POST /v1/documents` `{ initialState? }`                 | signed        | Create a document, optionally from a base64url Yjs update         |
| `DELETE /v1/documents/:id`                               | signed        | Delete a document                                                 |
| `GET /v1/documents/:id/epochs/:epoch`                    | signed        | An ended epoch's final Yjs snapshot                               |
| `GET /v1/sync/:id`                                       | in-band       | WebSocket sync; see [sync.ts](packages/protocol/src/sync.ts)      |
| `POST /admin/documents/:id/epochs`                       | `ADMIN_TOKEN` | Rebuild a document into a new epoch                               |

## Client

See [packages/client/README.md](packages/client/README.md).

## Layout

```
packages/
  protocol/      wire protocol shared by server and client
  server/
    src/
      apps/        app policies, the apps file, RP ID and origin rules
      db/          Drizzle schema (one file per table), connection, migrations
      documents/   persistence, validation, live documents, epochs
      identity/    passkey ceremonies, device keys, signed requests
      http/        Hono app, middleware, routes
      sync/        WebSocket sync sessions
      lifecycle/   expiry of abandoned documents
      limits/      rate limiting
      server.ts    wires everything together
      main.ts      process entry point
    drizzle/     generated SQL migrations (npm run db:generate -w @bobs-sink/server after schema changes)
    test/        unit and integration tests
  client/
    src/
      api/         typed HTTP calls and request signing
      identity/    device keys and passkeys
      storage/     IndexedDB: client state and replicas of the working doc
      documents/   merging, and finding unsynced changes across epochs
      sync/        WebSocket connection and reconnecting provider
      SinkClient.ts  the public API
    test/        unit tests, and integration tests against a real server
  test-support/  software passkey, polling helper
```
