import {
	defaultImplicitPolicy,
	defaultRegisteredPolicy,
	type AppPolicy,
	type AppPolicyOverrides,
} from "./AppPolicy.js";

/**
 * Resolves the policy for any RP ID: registered apps get their overrides on the registered defaults, everything
 * else is implicit. Held in memory because lookups are on the synchronous update path; `AppRegistry` keeps it in
 * step with the database.
 */
export class AppPolicies {
	private readonly registered = new Map<string, AppPolicy>();

	constructor(registered: Iterable<[string, AppPolicyOverrides]> = []) {
		for (const [rpId, overrides] of registered) {
			this.set(rpId, overrides);
		}
	}

	static resolve(overrides: AppPolicyOverrides): AppPolicy {
		return { ...defaultRegisteredPolicy, ...overrides };
	}

	get(rpId: string): AppPolicy {
		return this.registered.get(rpId) ?? defaultImplicitPolicy;
	}

	isRegistered(rpId: string): boolean {
		return this.registered.has(rpId);
	}

	/** Registers or updates an app; undefined makes it implicit again. */
	set(rpId: string, overrides: AppPolicyOverrides | undefined): void {
		if (overrides === undefined) {
			this.registered.delete(rpId);
		} else {
			this.registered.set(rpId, AppPolicies.resolve(overrides));
		}
	}
}
