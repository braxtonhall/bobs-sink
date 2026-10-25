import type { Child } from "hono/jsx";
import type { AppSummary } from "../apps/AppRepository.js";
import { defaultLimit, limitFields, type AppFormValues } from "./appForm.js";
import type { Operator } from "./OperatorSessions.js";

const style = `
:root { color-scheme: light dark; --muted: #6b6b6b; --line: #d4d4d4; --accent: #2f5fd0; --bad: #b3261e; --note: #8a5a00; }
@media (prefers-color-scheme: dark) { :root { --muted: #a0a0a0; --line: #3a3a3a; --accent: #8fb0ff; --bad: #ff8a80; --note: #f0c060; } }
body { font: 15px/1.5 system-ui, sans-serif; max-width: 56rem; margin: 0 auto; padding: 1rem; }
header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; border-bottom: 1px solid var(--line); padding-bottom: .5rem; margin-bottom: 1rem; }
header form { display: inline; }
a { color: var(--accent); }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid var(--line); }
td.number, th.number { text-align: right; font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.error { color: var(--bad); }
.note { color: var(--note); }
label { display: block; margin-top: .75rem; }
input[type=text], input[type=number], textarea { display: block; width: 100%; box-sizing: border-box; font: inherit; padding: .3rem .4rem; }
textarea { font-family: ui-monospace, monospace; font-size: 13px; min-height: 14rem; }
button { font: inherit; margin-top: 1rem; padding: .35rem .9rem; cursor: pointer; }
.actions { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
.scroll { overflow-x: auto; }
`;

function Layout(props: { title: string; operator?: Operator; children: Child }) {
	return (
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>{props.title} · bobs-sink</title>
				<style>{style}</style>
			</head>
			<body>
				<header>
					<strong>
						<a href="/operator">bobs-sink operator</a>
					</strong>
					{props.operator !== undefined && (
						<span>
							<span class="muted">{props.operator.email}</span>{" "}
							<form method="post" action="/operator/sign-out">
								<button type="submit" style="margin: 0">
									Sign out
								</button>
							</form>
						</span>
					)}
				</header>
				{props.children}
			</body>
		</html>
	);
}

export function AppsPage(props: { operator: Operator; apps: AppSummary[] }) {
	return (
		<Layout title="Apps" operator={props.operator}>
			<div class="actions">
				<h1>Apps</h1>
				<a href="/operator/register">Register an app</a>
			</div>
			{props.apps.length === 0 ? (
				<p class="muted">The service hasn't seen any apps yet.</p>
			) : (
				<div class="scroll">
					<table>
						<thead>
							<tr>
								<th>RP ID</th>
								<th>Status</th>
								<th class="number">Identities</th>
								<th class="number">Documents</th>
								<th class="number">Storage</th>
							</tr>
						</thead>
						<tbody>
							{props.apps.map((app) => (
								<tr>
									<td>
										<a href={appPath(app.rpId)}>{app.rpId}</a>
									</td>
									<td>{app.policy === undefined ? <span class="muted">implicit</span> : "registered"}</td>
									<td class="number">{app.identities}</td>
									<td class="number">{app.documents}</td>
									<td class="number">{formatBytes(app.storageBytes)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</Layout>
	);
}

/** The form for registering a new app (`app` undefined) or editing one the service has seen. */
export function AppPage(props: {
	operator: Operator;
	app: AppSummary | undefined;
	values: AppFormValues;
	error?: string;
	saved?: boolean;
}) {
	const { app, values } = props;
	const isNew = app === undefined;
	const registered = app?.policy !== undefined;
	return (
		<Layout title={isNew ? "Register an app" : values.rpId} operator={props.operator}>
			<p>
				<a href="/operator">← Apps</a>
			</p>
			<h1>{isNew ? "Register an app" : values.rpId}</h1>
			{app !== undefined && (
				<p class="muted">
					{registered ? "Registered" : "Implicit"} · {app.identities} identities · {app.documents} documents ·{" "}
					{formatBytes(app.storageBytes)}
				</p>
			)}
			{props.saved === true && <p>Saved.</p>}
			{props.error !== undefined && <p class="error">{props.error}</p>}
			<form method="post" action={isNew ? "/operator/apps" : appPath(values.rpId)}>
				{isNew && (
					<label>
						RP ID (the site's domain)
						<input type="text" name="rpId" value={values.rpId} placeholder="example.com" required />
					</label>
				)}
				{limitFields.map((field) => (
					<label>
						{field.label}
						<input
							type="number"
							name={field.name}
							min="1"
							step="1"
							value={values.limits[field.name] ?? ""}
							placeholder={`default: ${defaultLimit(field.name)}${field.bytes === true ? ` (${formatBytes(defaultLimit(field.name))})` : ""}`}
						/>
					</label>
				))}
				<label>
					Schema (JSON with <code>roots</code> and optional <code>jsonSchema</code>; blank for none)
					<textarea name="schema" placeholder={schemaPlaceholder}>
						{values.schema}
					</textarea>
				</label>
				{app !== undefined && app.documents > 0 && (
					<p class="note">
						This app has {app.documents} documents. A schema change doesn't re-check them: a stricter schema can leave a
						document that rejects every update until it's fixed.
					</p>
				)}
				<button type="submit">{registered ? "Save" : "Register"}</button>
			</form>
			{registered && (
				<form method="post" action={`${appPath(values.rpId)}/unregister`}>
					<p class="muted">
						Unregistering returns the app to the implicit defaults. Its documents are kept, even above the implicit
						limits.
					</p>
					<button type="submit" style="margin-top: 0">
						Unregister
					</button>
				</form>
			)}
		</Layout>
	);
}

export function MessagePage(props: { title: string; message: string; link?: { href: string; text: string } }) {
	return (
		<Layout title={props.title}>
			<h1>{props.title}</h1>
			<p>{props.message}</p>
			{props.link !== undefined && (
				<p>
					<a href={props.link.href}>{props.link.text}</a>
				</p>
			)}
		</Layout>
	);
}

export function appPath(rpId: string): string {
	return `/operator/apps/${encodeURIComponent(rpId)}`;
}

const schemaPlaceholder = JSON.stringify(
	{ roots: { items: "map", notes: "text" }, jsonSchema: { type: "object" } },
	null,
	2,
);

function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? "B"}`;
}
