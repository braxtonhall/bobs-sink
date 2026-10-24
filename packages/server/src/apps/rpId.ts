const hostnamePattern =
	/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Whether `rpId` is a plausible WebAuthn RP ID: a lowercase hostname with no scheme or port. */
export function isValidRpId(rpId: string): boolean {
	return hostnamePattern.test(rpId) && !/^\d+(\.\d+){3}$/.test(rpId);
}

/**
 * Whether a browser origin may use passkeys for `rpId`: the origin's host must be the RP ID or a subdomain
 * of it. Origins must be https, except http://localhost when `allowLocalhost` is set.
 */
export function originMatchesRpId(origin: string, rpId: string, allowLocalhost: boolean): boolean {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	if (url.origin !== origin) {
		return false;
	}
	const hostMatches = url.hostname === rpId || url.hostname.endsWith(`.${rpId}`);
	if (!hostMatches) {
		return false;
	}
	if (url.protocol === "https:") {
		return true;
	}
	return allowLocalhost && url.protocol === "http:" && rpId === "localhost";
}
