import { defaultRegisteredPolicy, type AppPolicy, type AppPolicyOverrides } from "../apps/AppPolicy.js";

type LimitName = Exclude<keyof AppPolicy, "schema">;

export const limitFields: readonly { name: LimitName; label: string; bytes?: boolean }[] = [
	{ name: "maxDocumentBytes", label: "Largest document (bytes)", bytes: true },
	{ name: "maxDocumentsPerIdentity", label: "Documents per identity" },
	{ name: "maxStorageBytes", label: "Total storage (bytes)", bytes: true },
	{ name: "identitiesPerHour", label: "New identities per hour" },
	{ name: "documentsPerHour", label: "New documents per hour" },
];

/** The form's fields as typed, so a refused form can be shown again unchanged. */
export type AppFormValues = {
	rpId: string;
	limits: Partial<Record<LimitName, string>>;
	/** JSON of the app's `schema` (`roots` and `jsonSchema`); blank for none. */
	schema: string;
};

export type ParsedAppForm = { ok: true; overrides: AppPolicyOverrides } | { ok: false; error: string };

export function formValues(rpId: string, overrides: AppPolicyOverrides | undefined): AppFormValues {
	const limits: AppFormValues["limits"] = {};
	for (const { name } of limitFields) {
		const value = overrides?.[name];
		if (value !== undefined) {
			limits[name] = String(value);
		}
	}
	const schema = overrides?.schema === undefined ? "" : JSON.stringify(overrides.schema, null, 2);
	return { rpId, limits, schema };
}

export function readFormValues(body: Record<string, unknown>, rpId: string): AppFormValues {
	const text = (name: string) => {
		const value = body[name];
		return typeof value === "string" ? value.trim() : "";
	};
	const limits: AppFormValues["limits"] = {};
	for (const { name } of limitFields) {
		limits[name] = text(name);
	}
	return { rpId, limits, schema: text("schema") };
}

/** Turns the form into overrides: a blank limit means the default, a blank schema means none. */
export function parseAppForm(values: AppFormValues): ParsedAppForm {
	const overrides: AppPolicyOverrides = {};
	for (const { name, label } of limitFields) {
		const raw = values.limits[name] ?? "";
		if (raw === "") {
			continue;
		}
		const value = Number(raw);
		if (!Number.isSafeInteger(value) || value <= 0) {
			return { ok: false, error: `${label} must be a positive whole number` };
		}
		overrides[name] = value;
	}
	if (values.schema !== "") {
		try {
			overrides.schema = JSON.parse(values.schema) as AppPolicyOverrides["schema"];
		} catch {
			return { ok: false, error: "the schema isn't valid JSON" };
		}
	}
	return { ok: true, overrides };
}

export function defaultLimit(name: LimitName): number {
	return defaultRegisteredPolicy[name];
}
