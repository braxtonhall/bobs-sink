import type { AddressInfo } from "node:net";
import { createAdaptorServer } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { AppRegistry } from "./apps/AppRegistry.js";
import type { Config } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { migrateDatabase } from "./db/migrate.js";
import { DocumentPersistence } from "./documents/DocumentPersistence.js";
import { DocumentRulesProvider } from "./documents/DocumentRules.js";
import { DocumentService } from "./documents/DocumentService.js";
import { LiveDocumentRegistry, type RegistrySettings } from "./documents/LiveDocumentRegistry.js";
import { createHttpApp } from "./http/createHttpApp.js";
import { ConnectionVerifier } from "./identity/ConnectionVerifier.js";
import { DeviceAuthorizationService } from "./identity/DeviceAuthorizationService.js";
import { DeviceKeyRepository } from "./identity/DeviceKeyRepository.js";
import { DeviceRevocationService } from "./identity/DeviceRevocationService.js";
import { PasskeyAssertionService } from "./identity/PasskeyAssertionService.js";
import { PasskeyCeremonies } from "./identity/PasskeyCeremonies.js";
import { RegistrationService } from "./identity/RegistrationService.js";
import { RequestVerifier } from "./identity/RequestVerifier.js";
import { OperatorSessions } from "./operator/OperatorSessions.js";
import { SsoClient } from "./operator/SsoClient.js";
import { DocumentExpiry } from "./lifecycle/DocumentExpiry.js";
import { RateLimiter } from "./limits/RateLimiter.js";
import type { Logger } from "./logger.js";
import { systemClock, type Clock } from "./shared/clock.js";
import { ActiveSessions } from "./sync/ActiveSessions.js";

const maxMessageBytes = 4 * 1024 * 1024;
const maintenanceIntervalMs = 60 * 60 * 1000;

const defaultRegistrySettings: RegistrySettings = {
	compaction: { maxUpdates: 500, idleMs: 30_000 },
	evictAfterMs: 60_000,
};

export type SinkOptions = {
	config: Config;
	logger: Logger;
	clock?: Clock;
	registry?: RegistrySettings;
};

export type Sink = {
	/** Starts listening; resolves with the bound address. */
	listen(): Promise<AddressInfo>;
	/** Stops accepting connections, compacts live documents, and closes the database. */
	close(): Promise<void>;
	expiry: DocumentExpiry;
	documents: DocumentService;
	/** Registers and unregisters apps, as the operator console does. */
	apps: AppRegistry;
};

/** Builds the whole service from its configuration. This is the only place dependencies are wired together. */
export function createSink(options: SinkOptions): Sink {
	const { config, logger } = options;
	const clock = options.clock ?? systemClock;

	const db = openDatabase(config.databasePath);
	migrateDatabase(db);
	const policies = AppRegistry.loadPolicies(db);

	const limiter = new RateLimiter(clock);
	const rules = new DocumentRulesProvider(policies);
	const registry = new LiveDocumentRegistry(
		new DocumentPersistence(db, clock),
		rules,
		options.registry ?? defaultRegistrySettings,
	);
	const activeSessions = new ActiveSessions();
	const deviceKeys = new DeviceKeyRepository(db);
	const ceremonies = new PasskeyCeremonies(config.allowLocalhost, clock);
	const assertions = new PasskeyAssertionService(db, ceremonies, clock);
	const documents = new DocumentService(db, registry, policies, rules, limiter, clock);
	const deviceRevocation = new DeviceRevocationService(db, assertions, (keys) => {
		activeSessions.closeForDeviceKeys(keys);
	});
	const expiry = new DocumentExpiry(db, registry, clock);
	const apps = new AppRegistry(db, policies, rules, registry, clock);
	const operatorSessions = new OperatorSessions(db, clock);

	const app = createHttpApp(
		{
			registration: new RegistrationService(db, ceremonies, policies, limiter, clock),
			deviceAuthorization: new DeviceAuthorizationService(db, assertions, clock),
			deviceRevocation,
			documents,
			deviceKeys,
			limiter,
			requestVerifier: new RequestVerifier(deviceKeys, clock),
			sync: {
				registry,
				documents,
				verifier: new ConnectionVerifier(deviceKeys, clock),
				activeSessions,
				limiter,
				logger,
			},
			logger,
			operator:
				config.operator === undefined
					? undefined
					: {
							apps,
							sessions: operatorSessions,
							sso: new SsoClient(config.operator),
							config: config.operator,
							logger,
						},
		},
		{ trustProxy: config.trustProxy, adminToken: config.adminToken, maxBodyBytes: maxMessageBytes },
	);

	const webSockets = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes });
	const server = createAdaptorServer({ fetch: app.fetch, websocket: { server: webSockets } });

	const maintenance = setInterval(() => {
		limiter.sweep();
		operatorSessions.deleteExpired();
		const expired = expiry.run();
		if (expired.documents > 0 || expired.archives > 0) {
			logger.info(expired, "expired documents and archives");
		}
	}, maintenanceIntervalMs);
	maintenance.unref();

	return {
		expiry,
		documents,
		apps,
		listen: () =>
			new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(config.port, config.host, () => {
					resolve(server.address() as AddressInfo);
				});
			}),
		close: async () => {
			clearInterval(maintenance);
			registry.closeAll();
			for (const client of webSockets.clients) {
				client.terminate();
			}
			await new Promise<void>((resolve) => {
				server.close(() => {
					resolve();
				});
				if ("closeIdleConnections" in server) {
					server.closeIdleConnections();
				}
			});
			db.$client.close();
		},
	};
}
