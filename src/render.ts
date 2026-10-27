import type { ArticleMeta, CitationStyle } from "./types";

/** Pure helpers for citations, templates and file names (no Obsidian imports). */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MLA_MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

function parts(iso: string): [number, number, number] | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	return m ? [+m[1], +m[2], +m[3]] : null;
}

function koDate(iso: string): string {
	const p = parts(iso);
	return p ? `${p[0]}. ${p[1]}. ${p[2]}.` : "";
}

function longDate(iso: string): string {
	const p = parts(iso);
	return p ? `${MONTHS[p[1] - 1]} ${p[2]}, ${p[0]}` : "";
}

function mlaDate(iso: string): string {
	const p = parts(iso);
	return p ? `${p[2]} ${MLA_MONTHS[p[1] - 1]} ${p[0]}` : "";
}

function endDot(s: string): string {
	return /[.?!]$/.test(s) ? s : `${s}.`;
}

export function buildCitation(meta: ArticleMeta, style: CitationStyle, accessed: string): string {
	const url = meta.canonicalUrl || meta.url;
	const { author, title, site, published } = meta;
	const siteIsTitle = site && title && site === title;

	switch (style) {
		case "korean": {
			const out = [author, `“${title}”`, site && !siteIsTitle ? site : "", koDate(published), url].filter(Boolean).join(", ");
			return `${out} (접속일: ${koDate(accessed)}).`;
		}
		case "apa": {
			const p = parts(published);
			const date = p ? `(${p[0]}, ${MONTHS[p[1] - 1]} ${p[2]})` : "(n.d.)";
			const head = author ? `${endDot(author)} ${date}.` : `*${endDot(title)}* ${date}.`;
			const body = author ? ` *${endDot(title)}*` : "";
			const siteStr = site && !siteIsTitle ? ` ${endDot(site)}` : "";
			const retrieved = p ? "" : ` Retrieved ${longDate(accessed)}, from`;
			return `${head}${body}${siteStr}${retrieved} ${url}`;
		}
		case "mla": {
			const a = author ? `${endDot(author)} ` : "";
			const s = site && !siteIsTitle ? ` *${site}*,` : "";
			const d = published ? ` ${mlaDate(published)},` : "";
			return `${a}“${endDot(title)}”${s}${d} ${url}. Accessed ${mlaDate(accessed)}.`;
		}
		case "sbl": {
			// SBL Handbook (2nd ed.) §6.4.13: online articles follow Chicago; site italicised as the publication.
			const a = author ? `${endDot(author)} ` : "";
			const s = site && !siteIsTitle ? ` *${site}*` : "";
			const d = published ? `${s ? "," : ""} ${longDate(published)}` : "";
			const acc = published ? "" : ` Accessed ${longDate(accessed)}.`;
			return `${a}“${endDot(title)}”${s}${d}.${acc} ${url}.`.replace(/\.\./g, ".");
		}
		case "chicago":
		default: {
			const a = author ? `${endDot(author)} ` : "";
			const s = site && !siteIsTitle ? ` ${site}` : "";
			const d = published ? `${s ? "," : ""} ${longDate(published)}` : "";
			const acc = published ? "" : ` Accessed ${longDate(accessed)}.`;
			return `${a}“${endDot(title)}”${s}${d}.${acc} ${url}.`.replace(/\.\./g, ".");
		}
	}
}

/**
 * Tiny mustache-like renderer:
 *   {{key}}                 → value
 *   {{#key}}…{{/key}}       → block shown only when value is non-empty
 *   {{^key}}…{{/key}}       → block shown only when value is empty
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
	let out = template.replace(/\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/g, (_m, kind: string, key: string, inner: string) => {
		const has = !!(vars[key] ?? "").trim();
		return (kind === "#" ? has : !has) ? inner : "";
	});
	out = out.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? "");
	return out.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function sanitizeFileName(name: string, max = 120): string {
	let s = name
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\p{Cc}/gu, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "");
	if (s.length > max) s = s.slice(0, max).trim();
	return s || "Untitled article";
}

export function splitList(input: string): string[] {
	return input
		.split(/[,，\n]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Obsidian tags cannot contain spaces or most punctuation. */
export function toTag(s: string): string {
	return s
		.replace(/^#/, "")
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[^\p{L}\p{N}_\-/]/gu, "");
}

export function uniq<T>(arr: T[]): T[] {
	return Array.from(new Set(arr));
}

/** Local date as YYYY-MM-DD. */
export function today(d: Date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Ratings, note sections, footnotes
// ---------------------------------------------------------------------------

export function stars(rating: number): string {
	const n = Math.max(0, Math.min(5, Math.round(rating)));
	return n ? "★".repeat(n) + "☆".repeat(5 - n) : "";
}

const PLACEHOLDER_LINE = /^\s*(?:[-*]|>)\s*$/;

/**
 * Append `entry` at the end of the `## heading` section of a note.
 * - Empty placeholder lines ("- " or "> ") left by the template are removed.
 * - If the section is missing it is created before `beforeMarker`'s heading (e.g. the
 *   saved article body) or at the end of the note.
 * - `separate` puts a blank line between entries (needed for separate blockquotes).
 */
export function appendToSection(text: string, heading: string, entry: string, opts: { beforeMarker?: string; separate?: boolean } = {}): string {
	const lines = text.split("\n");
	const isHeading = (l: string) => /^#{1,6}\s/.test(l);
	const target = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#{1,6}\s+/, "").trim() === heading);

	if (target === -1) {
		const block = ["", `## ${heading}`, entry, ""];
		let at = lines.length;
		if (opts.beforeMarker) {
			const marker = lines.findIndex((l) => l.includes(opts.beforeMarker as string));
			if (marker !== -1) {
				at = marker;
				for (let i = marker - 1; i >= 0; i--) {
					if (isHeading(lines[i])) {
						at = i;
						break;
					}
					if (lines[i].trim()) break;
				}
			}
		}
		const out = [...lines.slice(0, at)];
		while (out.length && !out[out.length - 1].trim()) out.pop();
		out.push(...block, ...lines.slice(at));
		return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
	}

	let end = lines.length;
	for (let i = target + 1; i < lines.length; i++) {
		if (isHeading(lines[i]) || (opts.beforeMarker && lines[i].includes(opts.beforeMarker))) {
			end = i;
			break;
		}
	}
	const body = lines.slice(target + 1, end).filter((l) => !PLACEHOLDER_LINE.test(l));
	while (body.length && !body[body.length - 1].trim()) body.pop();
	while (body.length && !body[0].trim()) body.shift();
	if (body.length && opts.separate) body.push("");
	body.push(...entry.split("\n"));
	const after = lines.slice(end);
	const out = [...lines.slice(0, target + 1), ...body, ...(after.length ? [""] : []), ...after];
	return out.join("\n");
}

export function memoEntry(text: string, date: string): string {
	const [first, ...rest] = text.trim().split("\n");
	return [`- ${date} ${first}`, ...rest.map((l) => `  ${l}`)].join("\n");
}

export function quoteEntry(text: string, locator: string, date: string): string {
	const body = text
		.trim()
		.split("\n")
		.map((l) => `> ${l}`.trimEnd());
	const loc = locator.trim();
	const where = loc ? (/^\d+([-–]\d+)?$/.test(loc) ? `p. ${loc}` : loc) : "";
	body.push(`> — ${[where, date].filter(Boolean).join(" · ")}`);
	return body.join("\n");
}

/** Next free numeric footnote label in a note. */
export function nextFootnote(text: string): number {
	let max = 0;
	const re = /\[\^(\d+)\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) max = Math.max(max, +m[1]);
	return max + 1;
}

/** Folder paths matching a keyword: folder-name prefix first, then name contains, then path contains; shorter first. */
export function rankFolders(paths: string[], query: string): string[] {
	const q = query.trim().toLowerCase();
	const name = (p: string) => (p.split("/").pop() ?? p).toLowerCase();
	const hits = q ? paths.filter((p) => p.toLowerCase().includes(q)) : [...paths];
	const rank = (p: string) => (name(p).startsWith(q) ? 0 : name(p).includes(q) ? 1 : 2);
	return hits.sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b));
}
