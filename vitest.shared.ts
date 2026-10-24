import { defaultServerConditions } from "vite";

/** Resolve workspace packages to their TypeScript sources (see tsconfig.source.json). */
export const sourceConditions = ["source", ...defaultServerConditions];
