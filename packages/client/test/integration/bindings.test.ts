import { waitFor } from "@bobs-sink/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type * as Y from "yjs";
import type { SinkClient } from "../../src/SinkClient.js";
import { TestDevice } from "../helpers/devices.js";
import { TestServer } from "../helpers/TestServer.js";

describe("binding to the working copy", () => {
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

	it("re-runs setup with each replacement, tearing down first while the old doc still works", async () => {
		const client = await openOn(new TestDevice(server));
		const events: string[] = [];
		const docs: Y.Doc[] = [];
		client.bind((doc) => {
			docs.push(doc);
			events.push("setup");
			return () => {
				events.push(doc.isDestroyed ? "teardown after destroy" : "teardown");
			};
		});

		await client.signOut();

		expect(events).toEqual(["setup", "teardown", "setup"]);
		expect(docs[1]).toBe(client.doc);
	});

	it("stops after unbinding", async () => {
		const client = await openOn(new TestDevice(server));
		let setups = 0;
		let teardowns = 0;
		const unbind = client.bind(() => {
			setups++;
			return () => {
				teardowns++;
			};
		});

		unbind();
		await client.signOut();

		expect({ setups, teardowns }).toEqual({ setups: 1, teardowns: 1 });
	});

	it("reports a throwing setup as an error without stopping other bindings", async () => {
		const client = await openOn(new TestDevice(server));
		const errors: unknown[] = [];
		client.on("error", (error) => errors.push(error));
		let first = true;
		client.bind(() => {
			if (!first) {
				throw new Error("boom");
			}
			first = false;
			return undefined;
		});
		const seen: Y.Doc[] = [];
		client.bind((doc) => {
			seen.push(doc);
			return undefined;
		});

		await client.signOut();

		expect(errors).toHaveLength(1);
		expect(seen.at(-1)).toBe(client.doc);
	});

	it("observes changes, local and synced, across replacements", async () => {
		const laptop = new TestDevice(server);
		const laptopClient = await openOn(laptop);
		laptopClient.doc.getMap("items").set("laptop", 1);
		await laptopClient.enableCloudSaves();
		await waitFor(() => laptopClient.sync === "synced");
		const phone = await openOn(new TestDevice(server, laptop.passkey));
		let seen: Record<string, unknown> = {};
		phone.observe((doc) => {
			seen = doc.getMap("items").toJSON();
		});

		phone.doc.getMap("items").set("phone", 2);
		expect(seen).toEqual({ phone: 2 });
		await phone.signIn();
		expect(seen).toEqual({ laptop: 1, phone: 2 });
		laptopClient.doc.getMap("items").set("later", 3);
		await waitFor(() => seen["later"] === 3);
	});
});
