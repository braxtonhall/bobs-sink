import { Ajv, type ValidateFunction } from "ajv";
import type { AppPolicies } from "../apps/AppPolicies.js";
import type { AppPolicy } from "../apps/AppPolicy.js";
import type { RootType } from "@bobs-sink/protocol";
import { SinkError } from "../shared/errors.js";

/** What every update to an app's documents is checked against. */
export type DocumentRules = {
	maxBytes: number;
	/** Declared root types; undefined means the app has no schema and any roots are allowed. */
	roots: Readonly<Record<string, RootType>> | undefined;
	validateJson: ValidateFunction | undefined;
};

/** Compiles and caches each app's document rules from its policy. */
export class DocumentRulesProvider {
	private readonly cache = new Map<string, DocumentRules>();

	constructor(private readonly policies: AppPolicies) {}

	get(appId: string): DocumentRules {
		const cached = this.cache.get(appId);
		if (cached !== undefined) {
			return cached;
		}
		const rules = DocumentRulesProvider.compile(this.policies.get(appId));
		this.cache.set(appId, rules);
		return rules;
	}

	/** Replaces an app's cached rules after its policy changes. */
	replace(appId: string, rules: DocumentRules): void {
		this.cache.set(appId, rules);
	}

	/** Compiles a policy's rules, refusing a JSON Schema that strict Ajv won't accept. */
	static compile(policy: AppPolicy): DocumentRules {
		return {
			maxBytes: policy.maxDocumentBytes,
			roots: policy.schema?.roots,
			validateJson: policy.schema?.jsonSchema === undefined ? undefined : compileJsonSchema(policy.schema.jsonSchema),
		};
	}
}

function compileJsonSchema(jsonSchema: Record<string, unknown>): ValidateFunction {
	// A fresh Ajv for each schema, so a `$id` can't collide with an app's earlier schema or another app's.
	const ajv = new Ajv({ allErrors: false, strict: true });
	try {
		return ajv.compile(jsonSchema);
	} catch (error) {
		throw new SinkError(
			"bad_request",
			`invalid JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
