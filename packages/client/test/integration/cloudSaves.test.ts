import { waitFor } from "@bobs-sink/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SinkClient } from "../../src/SinkClient.js";
import { items, TestDevice } from "../helpers/devices.js";
import { TestServer } from "../helpers/TestServer.js";

describe("cloud saves", () => {
	let server: TestServer;
	const open: SinkClient[] = [];

	async function openOn(device: TestDevice): Promise<SinkClient> {
		const client = await device.open();
		open.push(client);
		return client;
	}

	beforeEach(async () => {
		server = await TestServer.start();
	});

	afterEach(async () => {
		await Promise.all(open.splice(0).map((client) => client.close()));
		await server.stop();
	});

	it("keeps a local doc across reloads before cloud saves are on", async () => {
		const device = new TestDevice(server);
		const first = await device.open();
		first.doc.getMap("items").set("a", 1);
		await first.close();

		const reloaded = await openOn(device);

		expect(items(reloaded)).toEqual({ a: 1 });
		expect(reloaded.identity).toEqual({ kind: "anonymous" });
		expect(reloaded.sync).toBe("local");
	});

	it("uploads the local doc when cloud saves are turned on, and syncs from then on", async () => {
		const laptop = new TestDevice(server);
		const client = await openOn(laptop);
		client.doc.getMap("items").set("before", 1);

		const created = await client.enableCloudSaves();
		await waitFor(() => client.sync === "synced");
		client.doc.getMap("items").set("after", 2);

		const phone = await openOn(new TestDevice(server, laptop.passkey));
		const outcome = await phone.signIn();
		expect(outcome).toMatchObject({ resumed: false, documents: [{ id: created.id }] });
		await phone.useRemote(created.id);

		expect(items(phone)).toEqual({ before: 1, after: 2 });
		phone.doc.getMap("items").set("fromPhone", 3);
		await waitFor(() => items(client)["fromPhone"] === 3);
		expect(client.identity).toEqual({ kind: "signed-in", identityId: outcome.identityId });
	});

	it("resumes syncing after a reload", async () => {
		const device = new TestDevice(server);
		const first = await device.open();
		const created = await first.enableCloudSaves();
		await first.close();

		const reloaded = await openOn(device);
		reloaded.doc.getMap("items").set("afterReload", true);
		await waitFor(() => reloaded.sync === "synced");

		const other = await openOn(new TestDevice(server, device.passkey));
		await other.signIn();
		await other.useRemote(created.id);
		await waitFor(() => items(other)["afterReload"] === true);
		expect(reloaded.document).toEqual({ documentId: created.id, epoch: 0 });
	});

	it("saves edits made offline and sends them when the network comes back", async () => {
		const laptop = new TestDevice(server);
		const client = await openOn(laptop);
		const created = await client.enableCloudSaves();
		await waitFor(() => client.sync === "synced");
		const phone = await openOn(new TestDevice(server, laptop.passkey));
		await phone.signIn();
		await phone.useRemote(created.id);

		laptop.network.goOffline();
		await waitFor(() => client.sync === "offline");
		client.doc.getMap("items").set("offline", 1);
		phone.doc.getMap("items").set("meanwhile", 2);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(items(phone)).toEqual({ meanwhile: 2 });

		laptop.network.goOnline();
		await waitFor(() => items(phone)["offline"] === 1 && items(client)["meanwhile"] === 2);
	});

	it("reconnects after the service restarts", async () => {
		const device = new TestDevice(server);
		const client = await openOn(device);
		await client.enableCloudSaves();
		await waitFor(() => client.sync === "synced");

		await server.restart();
		await waitFor(() => client.sync === "synced");
		client.doc.getMap("items").set("afterRestart", 1);

		const other = await openOn(new TestDevice(server, device.passkey));
		const { documents } = await other.signIn();
		await other.useRemote(documents[0]?.id ?? "");
		await waitFor(() => items(other)["afterRestart"] === 1);
	});

	it("signs out by deleting the device's copy and key", async () => {
		const device = new TestDevice(server);
		const client = await openOn(device);
		client.doc.getMap("items").set("a", 1);
		await client.enableCloudSaves();
		const replaced: unknown[] = [];
		client.on("doc", (doc) => replaced.push(doc));

		await client.signOut();

		expect(replaced).toHaveLength(1);
		expect(items(client)).toEqual({});
		expect(client.identity).toEqual({ kind: "anonymous" });
		expect(client.document).toBeUndefined();
		expect(client.sync).toBe("local");
	});
});
