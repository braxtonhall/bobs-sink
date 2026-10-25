import type { EpochArchiveResult } from "@bobs-sink/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { toBase64Url } from "../../src/shared/base64url.js";
import { json, testApp, TestSink } from "../helpers/TestSink.js";

describe("documents", () => {
	let sink: TestSink;

	beforeEach(async () => {
		sink = await TestSink.start({
			apps: {
				[testApp]: { maxDocumentsPerIdentity: 2, maxDocumentBytes: 4096, schema: { roots: { items: "map" } } },
			},
		});
	});

	afterEach(async () => {
		await sink.stop();
	});

	it("creates private, ephemeral documents and lists only the owner's", async () => {
		const alice = await sink.register();
		const bob = await sink.register();

		const created = await sink.createDocument(alice.device);

		expect(created).toMatchObject({ visibility: "private", lifecycle: "ephemeral", epoch: 0 });
		const aliceDocs = await json<{ documents: unknown[] }>(await sink.signed(alice.device, "GET", "/v1/documents"));
		const bobDocs = await json<{ documents: unknown[] }>(await sink.signed(bob.device, "GET", "/v1/documents"));
		expect(aliceDocs.documents).toHaveLength(1);
		expect(bobDocs.documents).toHaveLength(0);
	});

	it("seeds a new document from local state", async () => {
		const { device } = await sink.register();
		const local = new Y.Doc();
		local.getMap("items").set("found", true);

		const created = await sink.createDocument(device, toBase64Url(Y.encodeStateAsUpdate(local)));

		const empty = await sink.createDocument(device);
		expect(created.sizeBytes).toBeGreaterThan(empty.sizeBytes);
	});

	it("rejects initial state that breaks the app's schema", async () => {
		const { device } = await sink.register();
		const local = new Y.Doc();
		local.getMap("unexpected").set("x", 1);

		const response = await sink.signed(device, "POST", "/v1/documents", {
			initialState: toBase64Url(Y.encodeStateAsUpdate(local)),
		});
		expect(response.status).toBe(400);
	});

	it("limits documents per identity", async () => {
		const { device } = await sink.register();
		await sink.createDocument(device);
		await sink.createDocument(device);

		expect((await sink.signed(device, "POST", "/v1/documents", {})).status).toBe(403);
	});

	it("lets only the owner delete, and hides private documents from others", async () => {
		const alice = await sink.register();
		const bob = await sink.register();
		const { id } = await sink.createDocument(alice.device);

		expect((await sink.signed(bob.device, "DELETE", `/v1/documents/${id}`)).status).toBe(404);
		expect((await sink.signed(alice.device, "DELETE", `/v1/documents/${id}`)).status).toBe(204);
		const remaining = await json<{ documents: unknown[] }>(await sink.signed(alice.device, "GET", "/v1/documents"));
		expect(remaining.documents).toHaveLength(0);
	});

	it("serves an ended epoch's final snapshot to the owner", async () => {
		const { device } = await sink.register();
		const { id } = await sink.createDocument(device);

		const rebuild = await fetch(`${sink.baseUrl}/admin/documents/${id}/epochs`, {
			method: "POST",
			headers: { authorization: "Bearer test-admin-token" },
		});
		expect(await json<{ epoch: number }>(rebuild)).toEqual({ epoch: 1 });

		const archive = await json<EpochArchiveResult>(await sink.signed(device, "GET", `/v1/documents/${id}/epochs/0`));
		expect(archive.epoch).toBe(0);
		expect((await sink.signed(device, "GET", `/v1/documents/${id}/epochs/1`)).status).toBe(404);
	});

	it("requires the admin token for admin routes", async () => {
		const { device } = await sink.register();
		const { id } = await sink.createDocument(device);

		const response = await fetch(`${sink.baseUrl}/admin/documents/${id}/epochs`, {
			method: "POST",
			headers: { authorization: "Bearer wrong" },
		});
		expect(response.status).toBe(401);
	});
});
