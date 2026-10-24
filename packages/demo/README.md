# @bobs-sink/demo

A page for trying the client against a local service.

```sh
npm run demo   # from the repo root
```

This starts the service on http://localhost:8080 (from source, data in `packages/demo/.data/`) and the page on
both http://localhost:5173 and http://localhost:5174. Passkeys work on `localhost` without https.

The two ports are two devices: browser storage is per origin, so each has its own local doc and device key,
but the passkey RP ID is just `localhost`, so a passkey created on one works on the other. Any passkey store
works, including one that doesn't sync (e.g. Chrome's own profile store, or a security key).

Things to try:

- Add items before turning on cloud saves, reload, then turn on cloud saves: they're uploaded.
- Sign in elsewhere and pick merge, use remote, or keep separate.
- Type in Notes in both browsers at once, or with one offline (DevTools → Network → Offline).
- Revoke other devices from one browser; the other asks to sign in again and keeps its offline edits.
- Rebuild a document into a new epoch while a browser is offline, then bring it back online:
  `curl -X POST -H "authorization: Bearer demo" http://localhost:8080/admin/documents/<id>/epochs`
  with the document ID from the page's status.
