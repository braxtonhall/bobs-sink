import {
	startAuthentication,
	startRegistration,
	type AuthenticationResponseJSON,
	type PublicKeyCredentialCreationOptionsJSON,
	type PublicKeyCredentialRequestOptionsJSON,
	type RegistrationResponseJSON,
} from "@simplewebauthn/browser";

/** Creates and uses passkeys. The browser implementation prompts the user; tests substitute a software one. */
export type PasskeyAuthenticator = {
	register(options: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON>;
	authenticate(options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON>;
};

export const browserPasskeys: PasskeyAuthenticator = {
	register: (optionsJSON) => startRegistration({ optionsJSON }),
	authenticate: (optionsJSON) => startAuthentication({ optionsJSON }),
};
