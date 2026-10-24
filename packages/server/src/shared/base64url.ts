export function toBase64Url(bytes: Uint8Array): string {
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64url");
}

export function fromBase64Url(text: string): Uint8Array {
	return new Uint8Array(Buffer.from(text, "base64url"));
}
