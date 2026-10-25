import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { closeCodes } from "@bobs-sink/protocol";
import { waitFor } from "@bobs-sink/test-support";
import { TestDevice } from "../helpers/TestDevice.js";
import { testApp, TestSink } from "../helpers/TestSink.js";
import { TestSyncClient } from "../helpers/TestSyncClient.js";

const items = (client: TestSyncClient) => client.doc.getMap("items").toJSON();

describe("sync", () => {
	let sink: TestSink;
	const clients: TestSyncClient[] = [];

	beforeEach(async () => {
		sink = await TestSink.start({
			apps: { [testApp]: { schema: { roots: { items: "map" } } } },
			registry: { compaction: { maxUpdates: 2, idleMs: 50 }, evictAfterMs: 50 },
		});
	});

	afterEach(async () => {
		for (const client of clients.splice(0)) {
			client.close();
		}
		await sink.stop();
	});

	function connect(documentId: string, device: TestDevice, doc?: Y.Doc, epoch: number | null = null) {
		const client = new TestSyncClient(sink.wsUrl, documentId, device, doc, epoch);
		clients.push(client);
		return client.settled();
	}

	it("syncs edits between two signed-in devices", async () => {
		const first = await sink.register();
		const second = await sink.signIn(first.passkey);
		const { id } = await sink.createDocument(first.device);

		const a = await connect(id, first.device);
		const b = await connect(id, second.device);
		expect(a.ready).toEqual({ type: "ready", epoch: 0, access: "write" });

		a.doc.getMap("items").set("from-a", 1);
		b.doc.getMap("items").set("from-b", 2);

		await waitFor(() => Object.keys(items(a)).length === 2 && Object.keys(items(b)).length === 2);
		expect(items(a)).toEqual({ "from-a": 1, "from-b": 2 });
	});

	it("brings an offline device's edits in on reconnect, after compaction and eviction", async () => {
		const { device } = await sink.register();
		const { id } = await sink.createDocument(device);
		const offline = new Y.Doc();

		const first = await connect(id, device, offline);
		const other = await connect(id, device);
		offline.getMap("items").set("before", 1);
		await waitFor(() => other.doc.getMap("items").has("before"));
		first.close();
		await waitFor(() => first.closed !== undefined);
		offline.getMap("items").set("while-offline", 2);

		for (let index = 0; index < 5; index++) {
			other.doc.getMap("items").set(`other-${index}`, index);
		}
		await waitFor(() => Object.keys(items(other)).length === 6);
		other.close();
		await new Promise((resolve) => setTimeout(resolve, 150)); // compacted and evicted

		const back = await connect(id, device, offline);
		await waitFor(() => Object.keys(items(back)).length === 7);
		const fresh = await connect(id, device);
		await waitFor(() => Object.keys(items(fresh)).length === 7);
		expect(items(fresh)).toMatchObject({ before: 1, "while-offline": 2 });
	});

	it("rejects updates that break the schema without sending them on", async () => {
		const { device } = await sink.register();
		const { id } = await sink.createDocument(device);
		const sender = await connect(id, device);
		const watcher = await connect(id, device);

		sender.doc.getMap("not-allowed").set("x", 1);
		await waitFor(() => sender.rejections.length === 1);
		expect(sender.rejections).toEqual(["unknown_root"]);

		// Later edits from the same Y.Doc build on the rejected one, so they are rejected too.
		sender.doc.getMap("items").set("after", 1);
		await waitFor(() => sender.rejections.length === 2);
		expect(sender.rejections[1]).toBe("missing_dependencies");

		// Starting over from the server's state works.
		const restarted = await connect(id, device);
		restarted.doc.getMap("items").set("restarted", 1);
		await waitFor(() => watcher.doc.getMap("items").get("restarted") === 1);
		expect(watcher.doc.share.has("not-allowed")).toBe(false);
	});

	it("closes connections that can't authenticate", async () => {
		const { device } = await sink.register();
		const { id } = await sink.createDocument(device);

		const stranger = await connect(id, new TestDevice());

		expect(stranger.closed?.code).toBe(closeCodes.unauthorized);
	});

	it("hides private documents from other identities", async () => {
		const owner = await sink.register();
		const other = await sink.register();
		const { id } = await sink.createDocument(owner.device);

		const client = await connect(id, other.device);

		expect(client.closed?.code).toBe(closeCodes.notFound);
	});

	it("turns away clients whose state belongs to an old epoch", async () => {
		const { device } = await sink.register();
		const { id } = await sink.createDocument(device);
		sink.sink.documents.startNewEpoch(id);

		const stale = await connect(id, device, undefined, 0);

		expect(stale.closed).toEqual({ code: closeCodes.epochChanged, reason: "1" });
	});

	it("disconnects subscribers when the document is rebuilt", async () => {
		const { device } = await sink.register();
		const { id } = await sink.createDocument(device);
		const client = await connect(id, device);

		sink.sink.documents.startNewEpoch(id);

		await waitFor(() => client.closed !== undefined);
		expect(client.closed).toEqual({ code: closeCodes.epochChanged, reason: "1" });
	});

	it("disconnects subscribers when the document is deleted", async () => {
		const { device } = await sink.register();
		const { id } = await sink.createDocument(device);
		const client = await connect(id, device);

		await sink.signed(device, "DELETE", `/v1/documents/${id}`);

		await waitFor(() => client.closed !== undefined);
		expect(client.closed?.code).toBe(closeCodes.gone);
	});

	it("disconnects a device whose key is revoked", async () => {
		const { device } = await sink.register();
		const { id } = await sink.createDocument(device);
		const client = await connect(id, device);

		await sink.signed(device, "DELETE", "/v1/me/device-key");

		await waitFor(() => client.closed !== undefined);
		expect(client.closed?.code).toBe(closeCodes.unauthorized);
	});
});
