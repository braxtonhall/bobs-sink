import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { OperatorSessions } from "../../operator/OperatorSessions.js";
import type { HttpEnv } from "../HttpEnv.js";

export const operatorSessionCookie = "sink_operator";

/**
 * Requires a signed-in operator whose email is still on the whitelist, so removing an address takes effect on
 * the next request. Anyone else is sent to sign in.
 */
export function requireOperator(sessions: OperatorSessions, operatorEmails: ReadonlySet<string>) {
	return createMiddleware<HttpEnv>(async (c, next) => {
		const token = getCookie(c, operatorSessionCookie);
		const operator = token === undefined ? undefined : sessions.find(token);
		if (operator === undefined || !operatorEmails.has(operator.email.toLowerCase())) {
			return c.redirect("/operator/sign-in", 303);
		}
		c.set("operator", operator);
		await next();
	});
}
