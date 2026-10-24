import { Ajv, type ValidateFunction } from "ajv";
import type { AppPolicies } from "../apps/AppPolicies.js";
import type { RootType } from "@bobs-sink/protocol";

/** What every update to an app's documents is checked against. */
export type DocumentRules = {
	maxBytes: number;
	/** Declared root types; undefined means the app has no schema and any roots are allowed. */
	roots: Readonly<Record<string, RootType>> | undefined;
	validateJson: ValidateFunction | undefined;
};

/** Compiles and caches each app's document rules from its policy. */
export class DocumentRulesProvider {
	private readonly ajv = new Ajv({ allErrors: false, strict: true });
	private readonly cache = new Map<string, DocumentRules>();

	constructor(private readonly policies: AppPolicies) {}

	get(appId: string): DocumentRules {
		const cached = this.cache.get(appId);
		if (cached !== undefined) {
			return cached;
		}
		const policy = this.policies.get(appId);
		const rules: DocumentRules = {
			maxBytes: policy.maxDocumentBytes,
			roots: policy.schema?.roots,
			validateJson: policy.schema?.jsonSchema === undefined ? undefined : this.ajv.compile(policy.schema.jsonSchema),
		};
		this.cache.set(appId, rules);
		return rules;
	}
}
