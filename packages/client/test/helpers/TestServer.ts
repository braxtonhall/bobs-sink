import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, createSink, type Config, type Sink } from "@bobs-sink/server";

export const testApp = "example.com";
export const testOrigin = `https://${testApp}`;
export const testRoots = { items: "map", notes: "text" } as const;
const adminToken = "test-admin-token";

/** A real service on a random port, backed by a database file so it can be restarted. */
export class TestServer {
	private constructor(
		private sink: Sink,
		private readonly config: Config,
		private readonly directory: string,
		readonly baseUrl: string,
	) {}

	/** `jsonSchema` constrains the example app's documents, e.g. to provoke rejections. */
	static async start(options: { jsonSchema?: Record<string, unknown> } = {}): Promise<TestServer> {
		const directory = await mkdtemp(join(tmpdir(), "bobs-sink-client-"));
		const config: Config = {
			port: 0,
			host: "127.0.0.1",
			databasePath: join(directory, "sink.sqlite"),
			trustProxy: false,
			allowLocalhost: false,
			adminToken,
			logLevel: "silent",
			operator: undefined,
		};
		const sink = createSink({ config, logger: createLogger("silent") });
		// Registered apps live in the database, so a restart keeps this.
		sink.apps.register(testApp, {
			schema: { roots: testRoots, ...(options.jsonSchema === undefined ? {} : { jsonSchema: options.jsonSchema }) },
		});
		const { port } = await sink.listen();
		return new TestServer(sink, { ...config, port }, directory, `http://127.0.0.1:${port}`);
	}

	/** Stops and starts the service on the same port and database, as a deploy would. */
	async restart(): Promise<void> {
		await this.sink.close();
		this.sink = createSink({ config: this.config, logger: createLogger("silent") });
		await this.sink.listen();
	}

	/** Rebuilds a document into a new epoch; returns the new epoch. */
	async rebuild(documentId: string): Promise<number> {
		const response = await fetch(`${this.baseUrl}/admin/documents/${documentId}/epochs`, {
			method: "POST",
			headers: { authorization: `Bearer ${adminToken}` },
		});
		if (!response.ok) {
			throw new Error(`rebuild failed: ${response.status}`);
		}
		return ((await response.json()) as { epoch: number }).epoch;
	}

	async stop(): Promise<void> {
		await this.sink.close();
		await rm(this.directory, { recursive: true, force: true });
	}
}
