import { upgradeWebSocket } from "@hono/node-server";
import { createMiddleware } from "hono/factory";
import { rateRules } from "../../limits/rateRules.js";
import { SinkError } from "../../shared/errors.js";
import { SyncSession, type SyncSessionDependencies } from "../../sync/SyncSession.js";
import type { HttpEnv } from "../HttpEnv.js";

/** Upgrades to a sync WebSocket for one document. Authentication happens inside the connection. */
export function syncRoute(deps: SyncSessionDependencies) {
	const limitConnections = createMiddleware<HttpEnv>(async (c, next) => {
		if (!deps.limiter.tryTake(`connections:${c.get("clientIp")}`, rateRules.connectionsPerIp)) {
			throw new SinkError("rate_limited", "too many connections");
		}
		await next();
	});

	const upgrade = upgradeWebSocket((c) => {
		const documentId = c.req.param("id") ?? "";
		let session: SyncSession | undefined;
		return {
			onOpen: (_event, ws) => {
				const socket = {
					send: (data: string | Uint8Array<ArrayBuffer>) => {
						ws.send(data);
					},
					close: (code: number, reason?: string) => {
						ws.close(code, reason);
					},
				};
				session = new SyncSession(socket, documentId, deps);
			},
			onMessage: (event, ws) => {
				// MessageEvent is a DOM type; this project doesn't load the DOM lib, so read `data` explicitly.
				const { data } = event as { data: unknown };
				if (typeof data === "string" || data instanceof ArrayBuffer) {
					session?.receive(data);
				} else {
					ws.close(4400, "unsupported frame");
				}
			},
			onClose: () => session?.disconnected(),
			onError: () => session?.disconnected(),
		};
	});

	return [limitConnections, upgrade] as const;
}
