import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { DocumentService } from "../documents/DocumentService.js";
import type { DeviceKeyRepository } from "../identity/DeviceKeyRepository.js";
import type { RequestVerifier } from "../identity/RequestVerifier.js";
import { requestHeaders } from "@bobs-sink/protocol";
import type { Logger } from "../logger.js";
import type { SyncSessionDependencies } from "../sync/SyncSession.js";
import { errorResponse } from "./errorResponse.js";
import type { HttpEnv } from "./HttpEnv.js";
import { clientIp } from "./middleware/clientIp.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import { requireDevice } from "./middleware/requireDevice.js";
import { adminRoutes } from "./routes/adminRoutes.js";
import { documentRoutes } from "./routes/documentRoutes.js";
import { identityRoutes, type IdentityRouteServices } from "./routes/identityRoutes.js";
import { meRoutes } from "./routes/meRoutes.js";
import { syncRoute } from "./routes/syncRoute.js";

export type HttpServices = IdentityRouteServices & {
	documents: DocumentService;
	deviceKeys: DeviceKeyRepository;
	requestVerifier: RequestVerifier;
	sync: SyncSessionDependencies;
	logger: Logger;
};

export type HttpOptions = {
	trustProxy: boolean;
	adminToken: string | undefined;
	maxBodyBytes: number;
};

export function createHttpApp(services: HttpServices, options: HttpOptions) {
	const app = new Hono<HttpEnv>();
	app.onError(errorResponse(services.logger));
	app.notFound((c) => c.json({ error: "not_found", message: "no such route" }, 404));

	app.use(clientIp(options.trustProxy));
	// Any site may use the service, and requests carry no cookies, so every origin is allowed.
	app.use(
		"/v1/*",
		cors({
			origin: (origin) => origin,
			allowMethods: ["GET", "POST", "DELETE"],
			allowHeaders: ["content-type", ...Object.values(requestHeaders)],
			maxAge: 86_400,
		}),
	);
	app.use(bodyLimit({ maxSize: options.maxBodyBytes }));

	app.get("/healthz", (c) => c.json({ ok: true }));

	const v1 = new Hono<HttpEnv>();
	v1.route("/", identityRoutes(services));
	v1.get("/sync/:id", ...syncRoute(services.sync));
	const signed = requireDevice(services.requestVerifier, services.limiter);
	v1.route("/me", meRoutes(services, signed));
	v1.route("/documents", documentRoutes(services.documents, signed));
	app.route("/v1", v1);

	if (options.adminToken !== undefined) {
		app.use("/admin/*", requireAdmin(options.adminToken));
		app.route("/admin", adminRoutes(services.documents));
	}

	return app;
}
