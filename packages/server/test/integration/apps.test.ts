import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "@bobs-sink/test-support";
import { defaultImplicitPolicy } from "../../src/apps/AppPolicy.js";
import { testApp, TestSink } from "../helpers/TestSink.js";
import { TestSyncClient } from "../helpers/TestSyncClient.js";

describe("apps", () => {
	const started: TestSink[] = [];
	const clients: TestSyncClient[] = [];
	const directories: string[] = [];

	async function start(options: Parameters<typeof TestSink.start>[0] = {}): Promise<TestSink> {
		const sink = await TestSink.start(options);
		started.push(sink);
		return sink;
	}

	afterEach(async () => {
		for (const client of clients.splice(0)) {
			client.close();
		}
		for (const sink of started.splice(0)) {
			await sink.stop();
		}
		for (const directory of directories.splice(0)) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("keeps registered apps in the database across restarts", async () => {
		const directory = await mkdtemp(join(tmpdir(), "bobs-sink-apps-"));
		directories.push(directory);
		const config = { databasePath: join(directory, "sink.sqlite") };

		const first = await start({ config, apps: { [testApp]: { maxDocumentsPerIdentity: 1 } } });
		await first.stop();
		started.pop();

		const second = await start({ config });
		const { device } = await second.register();
		await second.createDocument(device);
		const refused = await second.signed(device, "POST", "/v1/documents", {});
		expect(refused.status).toBe(403);
		expect(second.sink.apps.find(testApp)).toMatchObject({ policy: { maxDocumentsPerIdentity: 1 }, documents: 1 });
	});

	it("lists registered apps first, with their usage", async () => {
		const sink = await start({ apps: { "registered.example": {} } });
		const { device } = await sink.register();
		await sink.createDocument(device);

		expect(sink.sink.apps.list()).toMatchObject([
			{ rpId: "registered.example", policy: {}, identities: 0, documents: 0, storageBytes: 0 },
			{ rpId: testApp, policy: undefined, identities: 1, documents: 1 },
		]);
	});

	it("refuses invalid RP IDs, limits and JSON Schemas without saving them", async () => {
		const sink = await start();
		const apps = sink.sink.apps;

		expect(() => {
			apps.register("https://example.com", {});
		}).toThrow(/RP ID/);
		expect(() => {
			apps.register(testApp, { maxDocumentBytes: -1 });
		}).toThrow(/maxDocumentBytes/);
		expect(() => {
			apps.register(testApp, { schema: { roots: { items: "map" }, jsonSchema: { type: "object", madeUp: true } } });
		}).toThrow(/invalid JSON Schema/);
		expect(apps.list()).toEqual([]);
	});

	it("applies a new schema to documents that are already loaded", async () => {
		const sink = await start({ apps: { [testApp]: { schema: { roots: { items: "map" } } } } });
		const { device } = await sink.register();
		const { id } = await sink.createDocument(device);
		const client = new TestSyncClient(sink.wsUrl, id, device);
		clients.push(client);
		await client.settled();

		client.doc.getMap("items").set("first", 1);
		const watcher = new TestSyncClient(sink.wsUrl, id, device);
		clients.push(watcher);
		await watcher.settled();
		await waitFor(() => watcher.doc.getMap("items").get("first") === 1);

		sink.sink.apps.register(testApp, {
			schema: {
				roots: { items: "map" },
				jsonSchema: { type: "object", properties: { items: { type: "object", maxProperties: 1 } } },
			},
		});
		client.doc.getMap("items").set("second", 2);
		await waitFor(() => client.rejections.length === 1);
		expect(client.rejections).toEqual(["schema_violation"]);
	});

	it("falls back to the implicit limits when unregistered, keeping documents", async () => {
		const sink = await start({ apps: { [testApp]: { maxDocumentsPerIdentity: 10 } } });
		const { device } = await sink.register();
		for (let i = 0; i < defaultImplicitPolicy.maxDocumentsPerIdentity + 1; i++) {
			await sink.createDocument(device);
		}

		sink.sink.apps.unregister(testApp);

		const refused = await sink.signed(device, "POST", "/v1/documents", {});
		expect(refused.status).toBe(403);
		const listed = await sink.signed(device, "GET", "/v1/documents");
		expect(((await listed.json()) as { documents: unknown[] }).documents.length).toBe(
			defaultImplicitPolicy.maxDocumentsPerIdentity + 1,
		);
		expect(sink.sink.apps.find(testApp)?.policy).toBeUndefined();
	});
});
