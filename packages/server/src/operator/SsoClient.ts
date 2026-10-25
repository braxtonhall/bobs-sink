import { z } from "zod";
import type { OperatorConfig } from "../config.js";
import type { Operator } from "./OperatorSessions.js";

const exchangeResponseSchema = z.object({ sub: z.string().min(1), email: z.string().min(1) });
const exchangeTimeoutMs = 10_000;

export type ExchangeResult = { ok: true; operator: Operator } | { ok: false; status: number };

/** Signs operators in through bobs-server SSO: a redirect out, then a server-to-server code exchange. */
export class SsoClient {
	constructor(private readonly config: OperatorConfig) {}

	/** Where bobs-server sends the browser back to. Must be in bobs-server's `SSO_REDIRECTS`. */
	get callbackUrl(): string {
		return `${this.config.publicUrl}/operator/callback`;
	}

	signInUrl(state: string): string {
		const url = new URL(this.config.ssoUrl);
		url.searchParams.set("redirect", this.callbackUrl);
		url.searchParams.set("state", state);
		return url.toString();
	}

	/** Trades a one-time code for who signed in. Throws only if bobs-server can't be reached or answers nonsense. */
	async exchange(code: string): Promise<ExchangeResult> {
		const response = await fetch(this.config.ssoExchangeUrl, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${this.config.ssoExchangeSecret}` },
			body: JSON.stringify({ code, redirect: this.callbackUrl }),
			signal: AbortSignal.timeout(exchangeTimeoutMs),
		});
		if (!response.ok) {
			return { ok: false, status: response.status };
		}
		const { sub, email } = exchangeResponseSchema.parse(await response.json());
		return { ok: true, operator: { subject: sub, email } };
	}
}
