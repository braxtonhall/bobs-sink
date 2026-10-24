import { waitFor } from "@bobs-sink/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RejectionReason } from "@bobs-sink/protocol";
import type { SinkClient } from "../../src/SinkClient.js";
import { items, TestDevice } from "../helpers/devices.js";
import { TestServer } from "../helpers/TestServer.js";

describe("rejected updates", () => {
	let server: TestServer;
	let client: SinkClient;

	beforeEach(async () => {
		server = await TestServer.start({
			jsonSchema: {
				type: "object",
				properties: { items: { type: "object", additionalProperties: { type: "number" } } },
			},
		});
		client = await new TestDevice(server).open();
		client.doc.getMap("items").set("valid", 1);
		await client.enableCloudSaves();
		await waitFor(() => client.sync === "synced");
	});

	afterEach(async () => {
		await client.close();
		await server.stop();
	});

	it("resets the working copy to the service's state, and keeps syncing", async () => {
		const rejections: RejectionReason[] = [];
		client.on("rejected", (reason) => rejections.push(reason));
		const rejectedDoc = client.doc;

		rejectedDoc.getMap("items").set("invalid", "not a number");

		await waitFor(() => client.doc !== rejectedDoc && client.sync === "synced");
		expect(rejections).toEqual(["schema_violation"]);
		expect(items(client)).toEqual({ valid: 1 });
		client.doc.getMap("items").set("later", 2);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(rejections).toHaveLength(1);
	});
});
