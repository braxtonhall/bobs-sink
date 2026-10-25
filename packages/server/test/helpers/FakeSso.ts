import type { AddressInfo } from "node:net";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import { randomId } from "../../src/shared/randomId.js";

/** Stands in for bobs-server's SSO: hands out one-time codes and exchanges them, like `POST /api/sso/exchange`. */
export class FakeSso {
	private constructor(
		private readonly server: ReturnType<typeof createAdaptorServer>,
		readonly baseUrl: string,
		private readonly codes: Map<string, { sub: string; email: string; redirect: string }>,
		/** Every exchange request's body. */
		readonly exchanges: unknown[],
	) {}

	static async start(secret: string): Promise<FakeSso> {
		const codes = new Map<string, { sub: string; email: string; redirect: string }>();
		const exchanges: unknown[] = [];
		const app = new Hono();
		app.post("/api/sso/exchange", async (c) => {
			const body = await c.req.json<{ code: string; redirect: string }>();
			exchanges.push(body);
			if (c.req.header("authorization") !== `Bearer ${secret}`) {
				return c.json({ error: "unauthorized" }, 401);
			}
			const issued = codes.get(body.code);
			codes.delete(body.code);
			if (issued?.redirect !== body.redirect) {
				return c.json({ error: "invalid_code" }, 400);
			}
			return c.json({ sub: issued.sub, email: issued.email });
		});
		const server = createAdaptorServer({ fetch: app.fetch });
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		return new FakeSso(server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, codes, exchanges);
	}

	get ssoUrl(): string {
		return `${this.baseUrl}/sso`;
	}

	get exchangeUrl(): string {
		return `${this.baseUrl}/api/sso/exchange`;
	}

	/** What `GET /sso` does once the person is signed in: a code bound to the callback it will redirect to. */
	issue(email: string, redirect: string): string {
		const code = randomId();
		this.codes.set(code, { sub: `sub-${email}`, email, redirect });
		return code;
	}

	stop(): Promise<void> {
		return new Promise((resolve) => {
			this.server.close(() => {
				resolve();
			});
		});
	}
}
