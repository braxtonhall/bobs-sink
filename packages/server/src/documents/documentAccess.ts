import type { Visibility } from "@bobs-sink/protocol";
import type { DeviceAuthority } from "../identity/DeviceKeyRepository.js";

export type Access = "none" | "read" | "write";

/** What a device (or an anonymous viewer, when `authority` is undefined) may do with a document. */
export function documentAccess(
	document: { ownerId: string; visibility: Visibility },
	authority: DeviceAuthority | undefined,
): Access {
	if (authority?.identityId === document.ownerId) {
		return "write";
	}
	switch (document.visibility) {
		case "private":
			return "none";
		case "public-read":
			return "read";
		case "public-write":
			return authority === undefined ? "read" : "write";
	}
}
