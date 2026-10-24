import { waitFor } from "@bobs-sink/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SinkClient } from "../../src/SinkClient.js";
import { items, TestDevice } from "../helpers/devices.js";
import { TestServer } from "../helpers/TestServer.js";

describe("signing in on another device", () => {
	let server: TestServer;
	let laptop: TestDevice;
	let laptopClient: SinkClient;
	let documentId: string;
	const open: SinkClient[] = [];

	async function openOn(device: TestDevice): Promise<SinkClient> {
		const client = await device.open();
		open.push(client);
		return client;
	}

	/** A second device with local data from before signing in. */
	async function phoneWithLocalData(entries: Record<string, unknown>): Promise<SinkClient> {
		const phone = await openOn(new TestDevice(server, laptop.passkey));
		for (const [key, value] of Object.entries(entries)) {
			phone.doc.getMap("items").set(key, value);
		}
		return phone;
	}

	beforeEach(async () => {
		server = await TestServer.start();
		laptop = new TestDevice(server);
		laptopClient = await openOn(laptop);
		laptopClient.doc.getMap("items").set("laptop", 1);
		laptopClient.doc.getMap("items").set("shared", "laptop");
		documentId = (await laptopClient.enableCloudSaves()).id;
		await waitFor(() => laptopClient.sync === "synced");
	});

	afterEach(async () => {
		await Promise.all(open.splice(0).map((client) => client.close()));
		await server.stop();
	});

	it("merges local data into a remote document, keeping remote values by default", async () => {
		const phone = await phoneWithLocalData({ phone: 2, shared: "phone" });

		await phone.signIn();
		await phone.mergeLocalInto(documentId);

		const expected = { laptop: 1, phone: 2, shared: "laptop" };
		expect(items(phone)).toEqual(expected);
		await expect.poll(() => items(laptopClient)).toEqual(expected);
		expect(phone.document).toEqual({ documentId, epoch: 0 });
	});

	it("merges with an app-supplied conflict resolver", async () => {
		const phone = await phoneWithLocalData({ shared: "phone" });

		await phone.signIn();
		await phone.mergeLocalInto(documentId, (conflict) => (conflict.local === "phone" ? "local" : "remote"));

		await waitFor(() => items(laptopClient)["shared"] === "phone");
	});

	it("can keep local data as a separate document", async () => {
		const phone = await phoneWithLocalData({ phone: 2 });

		await phone.signIn();
		const created = await phone.createDocumentFromLocal();
		await waitFor(() => phone.sync === "synced");

		expect(created.id).not.toBe(documentId);
		expect((await phone.listDocuments()).map((document) => document.id).sort()).toEqual(
			[documentId, created.id].sort(),
		);
		expect(items(phone)).toEqual({ phone: 2 });
		expect(items(laptopClient)).toEqual({ laptop: 1, shared: "laptop" });
	});

	it("can discard local data and use a remote document", async () => {
		const phone = await phoneWithLocalData({ phone: 2 });
		const replaced: unknown[] = [];
		phone.on("doc", (doc) => replaced.push(doc));

		await phone.signIn();
		await phone.useRemote(documentId);

		expect(replaced).toEqual([phone.doc]);
		expect(items(phone)).toEqual({ laptop: 1, shared: "laptop" });
	});

	it("asks for sign-in once a device key is revoked, then resumes with edits made meanwhile", async () => {
		const phone = await openOn(new TestDevice(server, laptop.passkey));
		await phone.signIn();
		await phone.useRemote(documentId);
		const identities: string[] = [];
		laptopClient.on("identity", (status) => identities.push(status.kind));

		expect(await phone.revokeOtherDevices()).toBe(1);
		await waitFor(() => laptopClient.identity.kind === "needs-sign-in");
		expect(laptopClient.sync).toBe("stopped");
		laptopClient.doc.getMap("items").set("whileSignedOut", 1);

		const outcome = await laptopClient.signIn();

		expect(outcome.resumed).toBe(true);
		expect(identities).toEqual(["needs-sign-in", "signed-in"]);
		await waitFor(() => items(phone)["whileSignedOut"] === 1);
	});

	it("needs sign-in after a reload once its key has been revoked", async () => {
		const phone = await openOn(new TestDevice(server, laptop.passkey));
		await phone.signIn();
		await laptopClient.close();
		open.splice(open.indexOf(laptopClient), 1);
		await phone.revokeOtherDevices();

		const reloaded = await openOn(laptop);

		await waitFor(() => reloaded.identity.kind === "needs-sign-in");
		expect(items(reloaded)).toEqual({ laptop: 1, shared: "laptop" });
	});
});
