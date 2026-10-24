# @bobs-sink/client

Browser client for [bobs-sink](../../README.md). It keeps one working [Yjs](https://yjs.dev) document saved in
IndexedDB, and, once the user turns on cloud saves with a passkey, syncs it to a document on the service.

```ts
import { SinkClient } from "@bobs-sink/client";

const sink = await SinkClient.open({
	serviceUrl: "https://sink.example.com",
	// Must match the app's schema on the service.
	roots: { items: "map", meta: "map" },
});

render(sink.doc);
// Some flows replace the working doc (rebuilds, rejections, sign-in choices); always use the latest one.
sink.on("doc", (doc) => render(doc));
sink.on("sync", (status) => showSyncStatus(status)); // local | connecting | synced | offline | stopped
sink.on("identity", (status) => {
	if (status.kind === "needs-sign-in") {
		offerSignInOnce();
	}
});

// "Turn on cloud saves": registers a passkey and uploads what's there so far.
await sink.enableCloudSaves();

// On another device:
const { documents, resumed } = await sink.signIn();
if (!resumed) {
	if (documents.length === 0) {
		await sink.createDocumentFromLocal();
	} else {
		// Or: sink.useRemote(id) to discard local data, or createDocumentFromLocal() to keep it separately.
		await sink.mergeLocalInto(documents[0].id, ({ local, remote }) => pickNewer(local, remote));
	}
}
```

`app` defaults to the page's hostname and is the passkey RP ID. `passkeys`, `fetch` and `WebSocket` can be
replaced, e.g. in tests.

Design notes, including what happens on epoch rebuilds and rejected updates, are in
[docs/design.md](../../docs/design.md) (§5 and §7).
