import { htmlToMarkdown, requestUrl } from "obsidian";
import { decodeBody } from "./charset";
import { extractMeta, extractReadable, findContentFrame } from "./extract";
import type { ExtractedArticle } from "./types";

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class FetchError extends Error {
	constructor(message: string, public status?: number) {
		super(message);
	}
}

async function fetchDocument(url: string): Promise<{ doc: Document; finalUrl: string }> {
	const res = await requestUrl({
		url,
		method: "GET",
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
			"Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
		},
		throw: false,
	});
	if (res.status >= 400) throw new FetchError(`HTTP ${res.status}`, res.status);

	const contentType = headerValue(res.headers, "content-type");
	if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
		throw new FetchError(`Unsupported content type: ${contentType}`);
	}
	const html = decodeBody(res.arrayBuffer, contentType);
	const doc = new DOMParser().parseFromString(html, "text/html");
	return { doc, finalUrl: url };
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
	return key ? headers[key] : undefined;
}

/** Fetch a URL and return metadata, plus Markdown content when requested. */
export async function fetchArticle(url: string, withContent: boolean): Promise<ExtractedArticle> {
	let { doc, finalUrl } = await fetchDocument(url);
	const meta = extractMeta(doc, finalUrl);

	// Follow framed blogs (Naver Blog) to reach the real post.
	const frameUrl = findContentFrame(doc, finalUrl);
	if (frameUrl) {
		try {
			const framed = await fetchDocument(frameUrl);
			doc = framed.doc;
			finalUrl = framed.finalUrl;
			const inner = extractMeta(doc, finalUrl);
			// The inner page usually has better title/author/date; keep the public URL.
			meta.title = inner.title || meta.title;
			meta.author = inner.author || meta.author;
			meta.published = inner.published || meta.published;
			meta.description = meta.description || inner.description;
			meta.image = meta.image || inner.image;
		} catch {
			/* fall back to outer page */
		}
	}

	let contentMarkdown = "";
	let textLength = 0;
	const readable = extractReadable(doc, finalUrl);
	if (readable) {
		textLength = readable.textLength;
		if (!meta.author && readable.byline) meta.author = readable.byline.trim();
		if (!meta.description && readable.excerpt) meta.description = readable.excerpt.trim();
		if (withContent) contentMarkdown = tidyMarkdown(htmlToMarkdown(readable.element as HTMLElement));
	}

	return { ...meta, url, contentMarkdown, textLength };
}

function tidyMarkdown(md: string): string {
	return md
		.replace(/ /g, " ")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
