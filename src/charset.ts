/**
 * Decode an HTTP response body to text, honouring the declared charset.
 * Many Korean sites still serve EUC-KR / CP949, which `response.text`
 * would mangle because it always assumes UTF-8.
 */
export function detectCharset(bytes: Uint8Array, contentType: string | undefined): string {
	const fromHeader = matchCharset(contentType ?? "");
	if (fromHeader) return fromHeader;

	// Sniff the first few KB as latin1 for <meta charset> / http-equiv.
	const head = latin1(bytes.subarray(0, 4096));
	const metaCharset = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head);
	if (metaCharset) return normalize(metaCharset[1]);

	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
	return "utf-8";
}

export function decodeBody(buffer: ArrayBuffer, contentType: string | undefined): string {
	const bytes = new Uint8Array(buffer);
	const charset = detectCharset(bytes, contentType);
	try {
		return new TextDecoder(charset).decode(bytes);
	} catch {
		return new TextDecoder("utf-8").decode(bytes);
	}
}

function matchCharset(value: string): string | null {
	const m = /charset\s*=\s*["']?([\w-]+)/i.exec(value);
	return m ? normalize(m[1]) : null;
}

function normalize(charset: string): string {
	const c = charset.toLowerCase();
	if (c === "ks_c_5601-1987" || c === "cp949" || c === "x-windows-949" || c === "ksc5601") return "euc-kr";
	return c;
}

function latin1(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
	return out;
}
