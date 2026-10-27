import { Readability } from "@mozilla/readability";
import type { ArticleMeta } from "./types";
import { normalizeDoi } from "./scholar";

/**
 * Pure DOM helpers — no Obsidian imports, so they can be unit-tested with jsdom.
 */

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_[a-z]+|igshid|ref_src|spm|_hsenc|_hsmi)$/i;

export function normalizeUrl(raw: string): string {
	try {
		const u = new URL(raw.trim());
		u.hash = "";
		const drop: string[] = [];
		u.searchParams.forEach((_v, k) => {
			if (TRACKING_PARAMS.test(k)) drop.push(k);
		});
		drop.forEach((k) => u.searchParams.delete(k));
		u.hostname = u.hostname.toLowerCase();
		if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
		return u.toString();
	} catch {
		return raw.trim();
	}
}

export function isHttpUrl(s: string): boolean {
	try {
		const u = new URL(s.trim());
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

/** Find http(s) URLs in a block of markdown/plain text, in order, de-duplicated. */
export function findUrls(text: string): string[] {
	const re = /https?:\/\/[^\s<>"'`)\]]+/g;
	const seen = new Set<string>();
	const out: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const url = m[0].replace(/[.,;:!?]+$/, "");
		if (!seen.has(url)) {
			seen.add(url);
			out.push(url);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function meta(doc: Document, ...keys: string[]): string {
	for (const key of keys) {
		const el =
			doc.querySelector(`meta[property="${key}"]`) ??
			doc.querySelector(`meta[name="${key}"]`) ??
			doc.querySelector(`meta[itemprop="${key}"]`);
		const v = el?.getAttribute("content")?.trim();
		if (v) return v;
	}
	return "";
}

function metaAll(doc: Document, key: string): string[] {
	return Array.from(doc.querySelectorAll(`meta[name="${key}"], meta[property="${key}"]`))
		.map((el) => el.getAttribute("content")?.trim() ?? "")
		.filter(Boolean);
}

type Json = Record<string, unknown>;

const ARTICLE_TYPES = /article|posting|report|blog|news|webpage|scholarly/i;

function jsonLdNodes(doc: Document): Json[] {
	const nodes: Json[] = [];
	const visit = (v: unknown) => {
		if (Array.isArray(v)) v.forEach(visit);
		else if (v && typeof v === "object") {
			const o = v as Json;
			nodes.push(o);
			if (o["@graph"]) visit(o["@graph"]);
		}
	};
	doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
		try {
			visit(JSON.parse(s.textContent ?? ""));
		} catch {
			/* malformed JSON-LD is common; ignore */
		}
	});
	return nodes;
}

function pickArticleLd(nodes: Json[]): Json | null {
	const typeOf = (n: Json) => [n["@type"]].flat().join(" ");
	return (
		nodes.find((n) => /article|posting|report/i.test(typeOf(n))) ??
		nodes.find((n) => ARTICLE_TYPES.test(typeOf(n)) && (n.headline || n.name)) ??
		null
	);
}

function ldName(v: unknown): string {
	if (!v) return "";
	if (typeof v === "string") return v;
	if (Array.isArray(v)) return v.map(ldName).filter(Boolean).join(", ");
	if (typeof v === "object") return ldName((v as Json).name);
	return "";
}

function ldImage(v: unknown): string {
	if (!v) return "";
	if (typeof v === "string") return v;
	if (Array.isArray(v)) return ldImage(v[0]);
	if (typeof v === "object") return ldImage((v as Json).url);
	return "";
}

/** Normalise many date shapes to YYYY-MM-DD, keeping the publisher's local date. */
export function toIsoDate(raw: string): string {
	if (!raw) return "";
	const s = raw.trim();
	const ymd = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(s);
	if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
	if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
	const d = new Date(s);
	if (!isNaN(d.getTime())) {
		const p = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	}
	return "";
}

function absolutize(href: string, base: string): string {
	if (!href) return "";
	try {
		return new URL(href, base).toString();
	} catch {
		return href;
	}
}

function cleanAuthor(a: string): string {
	if (!a || /^https?:\/\//i.test(a)) return "";
	return a
		.replace(/\s+/g, " ")
		.replace(/^(by|글|기자)\s*[:：]?\s*/i, "")
		.trim();
}

function hostLabel(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
	} catch {
		return "";
	}
}

/** Remove a trailing " | Site" / " - Site" from a <title> when we already know the site. */
function stripSiteSuffix(title: string, site: string): string {
	if (!site) return title;
	const parts = title.split(/\s+[|\-–—:·]\s+/);
	if (parts.length > 1) {
		const last = parts[parts.length - 1].toLowerCase();
		if (site.toLowerCase().includes(last) || last.includes(site.toLowerCase())) {
			return parts.slice(0, -1).join(" - ");
		}
	}
	return title;
}

export function extractMeta(doc: Document, url: string): ArticleMeta {
	const ld = pickArticleLd(jsonLdNodes(doc));
	const canonicalHref =
		doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? meta(doc, "og:url");
	const canonicalUrl = canonicalHref ? absolutize(canonicalHref, url) : url;

	const site =
		meta(doc, "og:site_name", "application-name", "twitter:app:name:iphone") ||
		ldName(ld?.publisher) ||
		hostLabel(url);

	const rawTitle =
		meta(doc, "og:title", "twitter:title", "citation_title", "dc.title", "DC.title") ||
		(typeof ld?.headline === "string" ? ld.headline : "") ||
		doc.querySelector("title")?.textContent?.trim() ||
		doc.querySelector("h1")?.textContent?.trim() ||
		hostLabel(url);
	const title = stripSiteSuffix(rawTitle.replace(/\s+/g, " ").trim(), site);

	const citationAuthors = metaAll(doc, "citation_author");
	const author = cleanAuthor(
		(citationAuthors.length ? citationAuthors.join(", ") : "") ||
			ldName(ld?.author) ||
			meta(doc, "author", "article:author", "og:article:author", "dable:author", "parsely-author", "sailthru.author", "dc.creator", "DC.creator", "byl") ||
			doc.querySelector('[rel="author"]')?.textContent?.trim() ||
			""
	);

	const published = toIsoDate(
		meta(doc, "article:published_time", "og:article:published_time", "citation_publication_date", "citation_date", "datePublished", "pubdate", "publishdate", "date", "dc.date", "DC.date", "parsely-pub-date", "sailthru.date") ||
			(typeof ld?.datePublished === "string" ? ld.datePublished : "") ||
			doc.querySelector("time[datetime]")?.getAttribute("datetime") ||
			""
	);

	const description = (
		meta(doc, "og:description", "description", "twitter:description", "dc.description") ||
		(typeof ld?.description === "string" ? ld.description : "")
	)
		.replace(/\s+/g, " ")
		.trim();

	const image = absolutize(meta(doc, "og:image", "og:image:url", "twitter:image", "twitter:image:src") || ldImage(ld?.image), url);

	const lang = (doc.documentElement.getAttribute("lang") || meta(doc, "og:locale") || "").split(/[-_]/)[0].toLowerCase();

	return {
		url,
		canonicalUrl,
		title,
		author,
		site,
		published,
		description,
		image,
		lang,
		type: meta(doc, "og:type") || "article",
		doi: normalizeDoi(meta(doc, "citation_doi", "prism.doi", "bepress_citation_doi", "dc.identifier", "DC.identifier", "DC.Identifier")),
		scholarly: !!meta(doc, "citation_journal_title", "citation_conference_title", "citation_arxiv_id") || (!!meta(doc, "citation_title") && citationAuthors.length > 0),
	};
}

// ---------------------------------------------------------------------------
// Readable content
// ---------------------------------------------------------------------------

/** Naver Blog (and similar) wrap the post in an iframe. Return the frame URL to follow. */
export function findContentFrame(doc: Document, url: string): string | null {
	const host = hostLabel(url);
	const frame = doc.querySelector<HTMLIFrameElement>("iframe#mainFrame, frame#mainFrame");
	if (frame && /naver\.com$/.test(host)) {
		const src = frame.getAttribute("src");
		if (src) return absolutize(src, url);
	}
	return null;
}

const LAZY_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-lazy", "data-url", "data-actualsrc"];

function prepareDocument(doc: Document, url: string) {
	// Make every link and image absolute up front, so the result does not depend on the
	// parsed document's base URL (which would be the Obsidian app, not the article).
	doc.querySelectorAll("base").forEach((b) => b.remove());

	doc.querySelectorAll("img").forEach((img) => {
		const src = img.getAttribute("src") ?? "";
		const looksPlaceholder = !src || src.startsWith("data:") || /blank|placeholder|spacer|loading/i.test(src);
		if (!looksPlaceholder) return;
		for (const attr of LAZY_ATTRS) {
			const v = img.getAttribute(attr);
			if (v) {
				img.setAttribute("src", v);
				break;
			}
		}
	});

	doc.querySelectorAll("script, style, noscript, iframe[src*='ads'], .ad, .ads, .advertisement").forEach((el) => el.remove());
	if (doc.body) absolutizeTree(doc.body, url);
}

function absolutizeTree(root: Element, url: string) {
	root.querySelectorAll("[href]").forEach((el) => {
		const v = el.getAttribute("href") ?? "";
		if (v && !v.startsWith("#") && !/^(mailto|tel|javascript):/i.test(v)) el.setAttribute("href", absolutize(v, url));
		if (/^javascript:/i.test(v)) el.removeAttribute("href");
	});
	root.querySelectorAll("[src]").forEach((el) => {
		el.setAttribute("src", absolutize(el.getAttribute("src") ?? "", url));
	});
	root.querySelectorAll("[srcset]").forEach((el) => el.removeAttribute("srcset"));
}

export interface ReadableResult {
	element: Element;
	textLength: number;
	byline: string;
	title: string;
	excerpt: string;
}

export function extractReadable(doc: Document, url: string): ReadableResult | null {
	const clone = doc.cloneNode(true) as Document;
	prepareDocument(clone, url);
	// The serializer hands back the live element instead of an HTML string,
	// so we never need innerHTML.
	const parsed = new Readability<Element>(clone, {
		charThreshold: 200,
		keepClasses: false,
		serializer: (el: Node) => el as Element,
	}).parse();
	if (!parsed || !parsed.content) return null;

	const holder = parsed.content;
	absolutizeTree(holder, url);

	// Empty paragraphs / wrapper noise
	holder.querySelectorAll("p, div, span").forEach((el) => {
		if (!el.textContent?.trim() && !el.querySelector("img, video, iframe, table, pre, code")) el.remove();
	});

	return {
		element: holder,
		textLength: parsed.textContent?.replace(/\s+/g, " ").trim().length ?? 0,
		byline: parsed.byline ?? "",
		title: parsed.title ?? "",
		excerpt: parsed.excerpt ?? "",
	};
}
