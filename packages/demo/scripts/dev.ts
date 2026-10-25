import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLogger, createSink, loadConfig } from "@bobs-sink/server";

/**
 * Runs the service (from source, with demo settings) and the page twice, on two ports. Browser storage is per
 * origin but the passkey RP ID ("localhost") isn't, so the two ports act as two devices sharing one passkey.
 */

const demoDirectory = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${demoDirectory}/.data`, { recursive: true });

const sinkEnvironment = {
	...process.env,
	PORT: "8080",
	HOST: "127.0.0.1",
	ALLOW_LOCALHOST: "true",
	DATABASE_PATH: ".data/sink.sqlite",
	ADMIN_TOKEN: "demo",
	LOG_LEVEL: "info",
};

// Register the demo's app in its database, as an operator would from the console, before the service starts.
const setup = createSink({
	config: loadConfig({ ...sinkEnvironment, DATABASE_PATH: `${demoDirectory}/.data/sink.sqlite` }),
	logger: createLogger("silent"),
});
setup.apps.register("localhost", { schema: { roots: { items: "map", notes: "text" } } });
await setup.close();

const sink = spawn("tsx", ["--conditions=source", "../server/src/main.ts"], {
	cwd: demoDirectory,
	env: sinkEnvironment,
	stdio: ["ignore", "pipe", "inherit"],
});
const pretty = spawn("pino-pretty", ["--ignore", "pid,hostname"], { stdio: ["pipe", "inherit", "inherit"] });
sink.stdout.pipe(pretty.stdin);
const pages = ["5173", "5174"].map((port) => spawn("vite", ["--port", port], { cwd: demoDirectory, stdio: "inherit" }));

const children: ChildProcess[] = [sink, pretty, ...pages];
let stopping = false;

function stop(code: number): void {
	if (stopping) {
		return;
	}
	stopping = true;
	for (const child of children) {
		child.kill("SIGTERM");
	}
	process.exitCode = code;
}

for (const child of children) {
	child.on("exit", (code) => {
		stop(code ?? 0);
	});
}
process.on("SIGINT", () => {
	stop(0);
});
process.on("SIGTERM", () => {
	stop(0);
});
