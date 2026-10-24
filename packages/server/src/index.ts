// Entry point for embedding the service, e.g. in other packages' tests. The process entry point is main.ts.
export { AppPolicies } from "./apps/AppPolicies.js";
export type { Config } from "./config.js";
export { createLogger } from "./logger.js";
export { createSink, type Sink, type SinkOptions } from "./server.js";
