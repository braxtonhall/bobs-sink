import { z } from "zod";

const booleanFlag = z
	.enum(["true", "false", ""])
	.default("false")
	.transform((value) => value === "true");

const optionalString = z
	.string()
	.optional()
	.transform((value) => (value === "" ? undefined : value));

const optionalUrl = optionalString.pipe(z.url({ protocol: /^https?$/ }).optional());

const configSchema = z.object({
	PORT: z.coerce.number().int().min(0).max(65535).default(8080),
	HOST: z.string().default("0.0.0.0"),
	DATABASE_PATH: z.string().default("./data/sink.sqlite"),
	TRUST_PROXY: booleanFlag,
	ALLOW_LOCALHOST: booleanFlag,
	ADMIN_TOKEN: optionalString,
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
	PUBLIC_URL: optionalUrl.refine((url) => url === undefined || new URL(url).origin === url, {
		message: "must be an origin, e.g. https://sink.example.com, with no path or trailing slash",
	}),
	SSO_URL: optionalUrl,
	SSO_EXCHANGE_URL: optionalUrl,
	SSO_EXCHANGE_SECRET: optionalString,
	OPERATOR_EMAILS: optionalString,
});

/** Settings for the operator console, which is mounted only when all of them are set. */
export type OperatorConfig = {
	/** The service's own origin, for building the SSO callback URL and checking `Origin` on changes. */
	publicUrl: string;
	/** bobs-server's sign-in page, e.g. `https://bobs-server.net/sso`. */
	ssoUrl: string;
	/** bobs-server's code exchange, reached over the internal network. */
	ssoExchangeUrl: string;
	ssoExchangeSecret: string;
	/** Lowercased email addresses allowed into the console. */
	operatorEmails: ReadonlySet<string>;
};

export type Config = {
	port: number;
	host: string;
	databasePath: string;
	trustProxy: boolean;
	allowLocalhost: boolean;
	adminToken: string | undefined;
	logLevel: z.infer<typeof configSchema>["LOG_LEVEL"];
	operator: OperatorConfig | undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const parsed = configSchema.parse(env);
	return {
		port: parsed.PORT,
		host: parsed.HOST,
		databasePath: parsed.DATABASE_PATH,
		trustProxy: parsed.TRUST_PROXY,
		allowLocalhost: parsed.ALLOW_LOCALHOST,
		adminToken: parsed.ADMIN_TOKEN,
		logLevel: parsed.LOG_LEVEL,
		operator: operatorConfig(parsed),
	};
}

function operatorConfig(parsed: z.infer<typeof configSchema>): OperatorConfig | undefined {
	const settings = {
		PUBLIC_URL: parsed.PUBLIC_URL,
		SSO_URL: parsed.SSO_URL,
		SSO_EXCHANGE_URL: parsed.SSO_EXCHANGE_URL,
		SSO_EXCHANGE_SECRET: parsed.SSO_EXCHANGE_SECRET,
		OPERATOR_EMAILS: parsed.OPERATOR_EMAILS,
	};
	const missing = Object.entries(settings).flatMap(([name, value]) => (value === undefined ? [name] : []));
	if (missing.length === Object.keys(settings).length) {
		return undefined;
	}
	const { PUBLIC_URL, SSO_URL, SSO_EXCHANGE_URL, SSO_EXCHANGE_SECRET, OPERATOR_EMAILS } = settings;
	if (
		PUBLIC_URL === undefined ||
		SSO_URL === undefined ||
		SSO_EXCHANGE_URL === undefined ||
		SSO_EXCHANGE_SECRET === undefined ||
		OPERATOR_EMAILS === undefined
	) {
		throw new Error(`the operator console needs all of its settings; missing ${missing.join(", ")}`);
	}
	return {
		publicUrl: PUBLIC_URL,
		ssoUrl: SSO_URL,
		ssoExchangeUrl: SSO_EXCHANGE_URL,
		ssoExchangeSecret: SSO_EXCHANGE_SECRET,
		operatorEmails: parseEmails(OPERATOR_EMAILS),
	};
}

/** A comma-separated list of addresses, compared case-insensitively. */
export function parseEmails(list: string): ReadonlySet<string> {
	return new Set(
		list
			.split(",")
			.map((email) => email.trim().toLowerCase())
			.filter((email) => email !== ""),
	);
}
