import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createSink } from "./server.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const sink = createSink({ config, logger });

const address = await sink.listen();
logger.info({ address: address.address, port: address.port }, "bobs-sink listening");

let stopping = false;
const stop = (signal: string): void => {
	if (stopping) {
		return;
	}
	stopping = true;
	logger.info({ signal }, "shutting down");
	sink.close().then(
		() => process.exit(0),
		(error: unknown) => {
			logger.error({ err: error }, "shutdown failed");
			process.exit(1);
		},
	);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
