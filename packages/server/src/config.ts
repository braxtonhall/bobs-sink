import { z } from "zod";

const booleanFlag = z
	.enum(["true", "false", ""])
	.default("false")
	.transform((value) => value === "true");

const optionalString = z
	.string()
	.optional()
	.transform((value) => (value === "" ? undefined : value));

const configSchema = z.object({
	PORT: z.coerce.number().int().min(0).max(65535).default(8080),
	HOST: z.string().default("0.0.0.0"),
	DATABASE_PATH: z.string().default("./data/sink.sqlite"),
	APPS_FILE: optionalString,
	TRUST_PROXY: booleanFlag,
	ALLOW_LOCALHOST: booleanFlag,
	ADMIN_TOKEN: optionalString,
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = {
	port: number;
	host: string;
	databasePath: string;
	appsFile: string | undefined;
	trustProxy: boolean;
	allowLocalhost: boolean;
	adminToken: string | undefined;
	logLevel: z.infer<typeof configSchema>["LOG_LEVEL"];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const parsed = configSchema.parse(env);
	return {
		port: parsed.PORT,
		host: parsed.HOST,
		databasePath: parsed.DATABASE_PATH,
		appsFile: parsed.APPS_FILE,
		trustProxy: parsed.TRUST_PROXY,
		allowLocalhost: parsed.ALLOW_LOCALHOST,
		adminToken: parsed.ADMIN_TOKEN,
		logLevel: parsed.LOG_LEVEL,
	};
}
