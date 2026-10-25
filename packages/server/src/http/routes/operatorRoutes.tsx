import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import type { Child } from "hono/jsx";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppRegistry } from "../../apps/AppRegistry.js";
import type { OperatorConfig } from "../../config.js";
import type { Logger } from "../../logger.js";
import { formValues, parseAppForm, readFormValues, type AppFormValues } from "../../operator/appForm.js";
import { operatorSessionMs, type OperatorSessions } from "../../operator/OperatorSessions.js";
import { AppPage, appPath, AppsPage, MessagePage } from "../../operator/pages.js";
import type { SsoClient } from "../../operator/SsoClient.js";
import { SinkError } from "../../shared/errors.js";
import { randomId } from "../../shared/randomId.js";
import { statusByKind } from "../errorResponse.js";
import type { HttpEnv } from "../HttpEnv.js";
import { operatorSessionCookie, requireOperator } from "../middleware/requireOperator.js";
import { requireSameOrigin } from "../middleware/requireSameOrigin.js";

export type OperatorRouteServices = {
	apps: AppRegistry;
	sessions: OperatorSessions;
	sso: SsoClient;
	config: OperatorConfig;
	logger: Logger;
};

const stateCookie = "sink_operator_state";
const stateMaxAgeSeconds = 10 * 60;
const cookieOptions = { path: "/operator", httpOnly: true, secure: true, sameSite: "Lax" } as const;

/** The operator console: server-rendered pages for registering apps, behind bobs-server SSO. */
export function operatorRoutes(services: OperatorRouteServices) {
	const { apps, sessions, sso, config, logger } = services;
	const app = new Hono<HttpEnv>();

	app.onError((error, c) => {
		if (error instanceof SinkError) {
			return render(c, <MessagePage title="Can't do that" message={error.message} />, statusByKind[error.kind]);
		}
		logger.error({ err: error, path: c.req.path }, "operator request failed");
		return render(c, <MessagePage title="Something went wrong" message="The error has been logged." />, 500);
	});
	app.use(async (c, next) => {
		await next();
		c.header(
			"content-security-policy",
			"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
		);
		// Not "no-referrer": under it, browsers send `Origin: null` on form posts, which requireSameOrigin refuses.
		c.header("referrer-policy", "same-origin");
		c.header("cache-control", "no-store");
	});
	app.use(requireSameOrigin(config.publicUrl));

	app.get("/sign-in", (c) => {
		// Ties the callback to this browser, so nobody can sign someone else in to their own session.
		const state = randomId();
		setCookie(c, stateCookie, state, { ...cookieOptions, maxAge: stateMaxAgeSeconds });
		return c.redirect(sso.signInUrl(state));
	});

	app.get("/callback", async (c) => {
		const code = c.req.query("code");
		const state = c.req.query("state");
		const expected = getCookie(c, stateCookie);
		deleteCookie(c, stateCookie, cookieOptions);
		const retry = { href: "/operator/sign-in", text: "Sign in again" };
		if (code === undefined || state === undefined || expected === undefined || !sameString(state, expected)) {
			return render(
				c,
				<MessagePage title="Sign-in expired" message="The sign-in didn't start from this browser." link={retry} />,
				400,
			);
		}
		const result = await sso.exchange(code).catch((error: unknown) => {
			logger.error({ err: error }, "SSO exchange failed");
			return undefined;
		});
		if (result === undefined) {
			return render(
				c,
				<MessagePage title="Sign-in failed" message="bobs-server couldn't be reached." link={retry} />,
				502,
			);
		}
		if (!result.ok) {
			logger.warn({ status: result.status }, "SSO exchange refused");
			return render(
				c,
				<MessagePage title="Sign-in failed" message="bobs-server refused the sign-in." link={retry} />,
				400,
			);
		}
		const { operator } = result;
		if (!config.operatorEmails.has(operator.email.toLowerCase())) {
			logger.warn({ email: operator.email }, "non-operator tried to sign in");
			return render(
				c,
				<MessagePage title="Not an operator" message={`${operator.email} isn't an operator of this service.`} />,
				403,
			);
		}
		setCookie(c, operatorSessionCookie, sessions.create(operator), {
			...cookieOptions,
			maxAge: operatorSessionMs / 1000,
		});
		logger.info({ email: operator.email }, "operator signed in");
		return c.redirect("/operator", 303);
	});

	app.post("/sign-out", (c) => {
		const token = getCookie(c, operatorSessionCookie);
		if (token !== undefined) {
			sessions.delete(token);
		}
		deleteCookie(c, operatorSessionCookie, cookieOptions);
		return c.redirect("/operator/signed-out", 303);
	});

	app.get("/signed-out", (c) =>
		render(
			c,
			<MessagePage title="Signed out" message="You're signed out." link={{ href: "/operator", text: "Sign in" }} />,
		),
	);

	const signedIn = requireOperator(sessions, config.operatorEmails);

	app.get("/", signedIn, (c) => render(c, <AppsPage operator={c.var.operator} apps={apps.list()} />));

	app.get("/register", signedIn, (c) =>
		render(c, <AppPage operator={c.var.operator} app={undefined} values={formValues("", undefined)} />),
	);

	app.post("/apps", signedIn, async (c) => {
		const body = await c.req.parseBody();
		const rpId = typeof body.rpId === "string" ? body.rpId.trim().toLowerCase() : "";
		const values = readFormValues(body, rpId);
		if (apps.find(rpId)?.policy !== undefined) {
			const error = `${rpId} is registered already; edit it from its page instead`;
			return render(c, <AppPage operator={c.var.operator} app={undefined} values={values} error={error} />, 400);
		}
		return save(c, values, undefined);
	});

	app.get("/apps/:rpId", signedIn, (c) => {
		const rpId = c.req.param("rpId");
		const found = apps.find(rpId);
		if (found === undefined) {
			const link = { href: "/operator/register", text: "Register it" };
			return render(
				c,
				<MessagePage title="Unknown app" message={`The service hasn't seen ${rpId}.`} link={link} />,
				404,
			);
		}
		const saved = c.req.query("saved") !== undefined;
		return render(
			c,
			<AppPage operator={c.var.operator} app={found} values={formValues(rpId, found.policy)} saved={saved} />,
		);
	});

	app.post("/apps/:rpId", signedIn, async (c) => {
		const rpId = c.req.param("rpId");
		return save(c, readFormValues(await c.req.parseBody(), rpId), apps.find(rpId));
	});

	app.post("/apps/:rpId/unregister", signedIn, (c) => {
		const rpId = c.req.param("rpId");
		apps.unregister(rpId);
		logger.info({ rpId, operator: c.var.operator.email }, "app unregistered");
		return c.redirect(`${appPath(rpId)}?saved`, 303);
	});

	function save(c: Context<HttpEnv>, values: AppFormValues, existing: ReturnType<AppRegistry["find"]>) {
		const refuse = (error: string) =>
			render(c, <AppPage operator={c.var.operator} app={existing} values={values} error={error} />, 400);
		const parsed = parseAppForm(values);
		if (!parsed.ok) {
			return refuse(parsed.error);
		}
		try {
			apps.register(values.rpId, parsed.overrides);
		} catch (error) {
			if (error instanceof SinkError) {
				return refuse(error.message);
			}
			throw error;
		}
		logger.info({ rpId: values.rpId, operator: c.var.operator.email }, "app registered");
		return c.redirect(`${appPath(values.rpId)}?saved`, 303);
	}

	return app;
}

function render(c: Context, page: Child, status: ContentfulStatusCode = 200) {
	return c.html(html`<!doctype html>${page}`, status);
}

function sameString(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
