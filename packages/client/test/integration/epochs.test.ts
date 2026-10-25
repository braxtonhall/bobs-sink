import { waitFor } from "@bobs-sink/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { SinkClient } from "../../src/SinkClient.js";
import { items, TestDevice } from "../helpers/devices.js";
import { TestServer } from "../helpers/TestServer.js";

describe("epoch rebuilds", () => {
	let server: TestServer;
	let laptop: TestDevice;
	let laptopClient: SinkClient;
	let phone: SinkClient;
	let documentId: string;
	const open: SinkClient[] = [];

	async function openOn(device: TestDevice): Promise<SinkClient> {
		const client = await device.open();
		open.push(client);
		return client;
	}

	beforeEach(async () => {
		server = await TestServer.start();
		laptop = new TestDevice(server);
		laptopClient = await openOn(laptop);
		const entries = laptopClient.doc.getMap("items");
		entries.set("kept", 1);
		entries.set("deletedOffline", 1);
		entries.set("editedOffline", new Y.Map([["note", new Y.Text("draft")]]));
		entries.set("readded", 1);
		entries.delete("readded");
		documentId = (await laptopClient.enableCloudSaves()).id;
		await waitFor(() => laptopClient.sync === "synced");
		phone = await openOn(new TestDevice(server, laptop.passkey));
		await phone.signIn({ unmatched: "choose" });
		await phone.useRemote(documentId);
	});

	afterEach(async () => {
		await Promise.all(open.splice(0).map((client) => client.close()));
		await server.stop();
	});

	it("moves online clients to the new epoch", async () => {
		const epoch = await server.rebuild(documentId);

		await waitFor(() => laptopClient.document?.epoch === epoch && phone.document?.epoch === epoch);
		await waitFor(() => laptopClient.sync === "synced");
		laptopClient.doc.getMap("items").set("afterRebuild", 1);
		await waitFor(() => items(phone)["afterRebuild"] === 1);
	});

	it("re-applies an offline client's unsynced edits and deletions in the new epoch", async () => {
		laptop.network.goOffline();
		await waitFor(() => laptopClient.sync === "offline");
		const entries = laptopClient.doc.getMap("items");
		entries.set("addedOffline", 2);
		entries.delete("deletedOffline");
		((entries.get("editedOffline") as Y.Map<unknown>).get("note") as Y.Text).insert(5, "!");
		const epoch = await server.rebuild(documentId);
		await waitFor(() => phone.document?.epoch === epoch && phone.sync === "synced");
		// Re-adding a key that was deleted long before the rebuild must survive the stale client's recovery.
		phone.doc.getMap("items").set("readded", "phone");
		phone.doc.getMap("items").set("phoneAfterRebuild", 3);
		const docs: Y.Doc[] = [];
		laptopClient.on("doc", (doc) => docs.push(doc));

		laptop.network.goOnline();

		const expected = {
			kept: 1,
			editedOffline: { note: "draft!" },
			addedOffline: 2,
			readded: "phone",
			phoneAfterRebuild: 3,
		};
		await waitFor(() => laptopClient.document?.epoch === epoch && laptopClient.sync === "synced");
		expect(docs).toHaveLength(1);
		expect(items(laptopClient)).toEqual(expected);
		await expect.poll(() => items(phone)).toEqual(expected);
	});
});
