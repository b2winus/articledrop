import { toIsoDate } from "./extract";

/**
 * Pure helpers for notes made by the Obsidian Web Clipper (no Obsidian imports).
 *
 * The Clipper's default template writes:
 *   title, source (URL), author ("[[Name]]" list), published, created, description, tags: [clippings]
 * and the page as Markdown in the body. Custom templates often add site, image, url, etc.
 */

export interface ClipData {
	url: string;
	title: string;
	author: string;
	site: string;
	published: string;
	saved: string;
	description: string;
	image: string;
	tags: string[];
	body: string;
}

/** Split a note into its YAML frontmatter source and body. */
export function splitFrontmatter(text: string): { yaml: string; body: string } {
	const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	if (!m) return { yaml: "", body: text };
	return { yaml: m[1], body: text.slice(m[0].length) };
}

/** "[[Jane Doe]]", "[[people/Jane Doe|Jane]]" → "Jane Doe" / "Jane" */
export function stripWikilink(s: string): string {
	return s
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, (_m, target: string) => target.split("/").pop() ?? target)
		.trim();
}

function text(v: unknown): string {
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
	return "";
}

function textList(v: unknown): string[] {
	if (Array.isArray(v)) return v.map(text).filter(Boolean);
	const s = text(v);
	return s ? [s] : [];
}

const URL_KEYS = ["source", "url", "link", "origin", "href"];

/** First http(s) URL among the usual Clipper/URL properties, or "". */
export function clipUrl(fm: Record<string, unknown>): string {
	for (const key of URL_KEYS) {
		const v = text(fm[key]);
		if (/^https?:\/\//i.test(v)) return v;
	}
	return "";
}

/** True when a note looks like an unprocessed clip: it has a source URL and is not yet an Articledrop note. */
export function isClip(fm: Record<string, unknown> | null | undefined): boolean {
	if (!fm) return false;
	if (fm.type === "article" || fm.type === "paper") return false;
	return !!clipUrl(fm);
}

export function parseClip(fm: Record<string, unknown>, body: string, fallbackTitle: string, today: string): ClipData {
	const authors = textList(fm.author ?? fm.authors ?? fm.creator).map(stripWikilink).filter(Boolean);
	const tags = textList(fm.tags)
		.flatMap((t) => t.split(/[,\s]+/))
		.map((t) => t.replace(/^#/, ""))
		.filter((t) => t && !/^clippings?$/i.test(t));
	return {
		url: clipUrl(fm),
		title: stripWikilink(text(fm.title)) || fallbackTitle,
		author: authors.join(", "),
		site: stripWikilink(text(fm.site ?? fm.publisher ?? fm.source_name)),
		published: toIsoDate(text(fm.published ?? fm.date)),
		saved: toIsoDate(text(fm.created ?? fm.clipped ?? fm.saved)) || today,
		description: text(fm.description ?? fm.summary),
		image: text(fm.image ?? fm.cover ?? fm.banner),
		tags,
		body: body.replace(/^\s+/, "").replace(/\s+$/, ""),
	};
}
