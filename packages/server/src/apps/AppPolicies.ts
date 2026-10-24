import { readFileSync } from "node:fs";
import { z } from "zod";
import { appPolicySchema, defaultImplicitPolicy, defaultRegisteredPolicy, type AppPolicy } from "./AppPolicy.js";
import { isValidRpId } from "./rpId.js";

const appsFileSchema = z.object({
	/** Overrides for every registered app. */
	registered: appPolicySchema.partial().optional(),
	/** Overrides for apps that aren't listed. */
	implicit: appPolicySchema.partial().optional(),
	/** Registered apps by RP ID, each overriding the registered defaults. */
	apps: z
		.record(z.string().refine(isValidRpId, { message: "not a valid RP ID" }), appPolicySchema.partial())
		.default({}),
});
export type AppsFile = z.input<typeof appsFileSchema>;

/** Resolves the policy for any RP ID: registered apps from the apps file, everything else implicit. */
export class AppPolicies {
	private readonly registered: ReadonlyMap<string, AppPolicy>;
	private readonly implicit: AppPolicy;

	constructor(file: AppsFile = {}) {
		const parsed = appsFileSchema.parse(file);
		const registeredDefaults = { ...defaultRegisteredPolicy, ...parsed.registered };
		this.implicit = { ...defaultImplicitPolicy, ...parsed.implicit };
		this.registered = new Map(
			Object.entries(parsed.apps).map(([rpId, overrides]) => [rpId, { ...registeredDefaults, ...overrides }]),
		);
	}

	static fromFile(path: string | undefined): AppPolicies {
		if (path === undefined) {
			return new AppPolicies();
		}
		return new AppPolicies(JSON.parse(readFileSync(path, "utf8")) as AppsFile);
	}

	get(rpId: string): AppPolicy {
		return this.registered.get(rpId) ?? this.implicit;
	}

	isRegistered(rpId: string): boolean {
		return this.registered.has(rpId);
	}
}
