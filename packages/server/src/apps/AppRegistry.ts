import { z } from "zod";
import type { Database } from "../db/connection.js";
import { DocumentRulesProvider, type DocumentRules } from "../documents/DocumentRules.js";
import type { LiveDocumentRegistry } from "../documents/LiveDocumentRegistry.js";
import type { Clock } from "../shared/clock.js";
import { SinkError } from "../shared/errors.js";
import { AppPolicies } from "./AppPolicies.js";
import { appPolicyOverridesSchema, type AppPolicyOverrides } from "./AppPolicy.js";
import { AppRepository, type AppSummary } from "./AppRepository.js";
import { isValidRpId } from "./rpId.js";

/**
 * Registers and unregisters apps. The database is the source of truth; saving also updates the in-memory
 * policies, the cached document rules, and the rules of the app's loaded documents.
 */
export class AppRegistry {
	constructor(
		private readonly db: Database,
		private readonly policies: AppPolicies,
		private readonly rules: DocumentRulesProvider,
		private readonly registry: LiveDocumentRegistry,
		private readonly clock: Clock,
	) {}

	/** Loads the registered apps' policies from the database. */
	static loadPolicies(db: Database): AppPolicies {
		return new AppPolicies(new AppRepository(db).listRegistered());
	}

	list(): AppSummary[] {
		return new AppRepository(this.db).summaries();
	}

	find(rpId: string): AppSummary | undefined {
		return this.list().find((app) => app.rpId === rpId);
	}

	/** Registers an app, or replaces a registered app's overrides. Refuses invalid overrides and JSON Schemas. */
	register(rpId: string, overrides: AppPolicyOverrides): void {
		if (!isValidRpId(rpId)) {
			throw new SinkError("bad_request", "not a valid RP ID: use a lowercase hostname, without scheme or port");
		}
		const parsed = appPolicyOverridesSchema.safeParse(overrides);
		if (!parsed.success) {
			throw new SinkError("bad_request", z.prettifyError(parsed.error));
		}
		const rules = DocumentRulesProvider.compile(AppPolicies.resolve(parsed.data));
		new AppRepository(this.db).register(rpId, parsed.data, this.clock.now());
		this.policies.set(rpId, parsed.data);
		this.applyRules(rpId, rules);
	}

	/** Makes an app implicit again. Its documents are kept, even above the implicit limits. */
	unregister(rpId: string): void {
		new AppRepository(this.db).unregister(rpId, this.clock.now());
		this.policies.set(rpId, undefined);
		this.applyRules(rpId, DocumentRulesProvider.compile(this.policies.get(rpId)));
	}

	private applyRules(rpId: string, rules: DocumentRules): void {
		this.rules.replace(rpId, rules);
		this.registry.replaceRules(rpId, rules);
	}
}
