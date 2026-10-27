import type { CitationStyle, Paper, PaperAuthor, PaperSource } from "./types";

/**
 * Pure helpers for scholarly metadata: identifier detection, API response
 * parsers (OpenAlex, Crossref, arXiv, KCI), citations and BibTeX.
 * No Obsidian imports, so everything here is unit-tested with jsdom.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+)/i;

/** Return a bare, lower-case DOI from a DOI, a doi.org URL or "doi:" string; "" if none. */
export function normalizeDoi(input: string): string {
	if (!input) return "";
	let s = input.trim();
	try {
		s = decodeURIComponent(s);
	} catch {
		/* keep as is */
	}
	const m = DOI_RE.exec(s);
	if (!m) return "";
	let doi = m[1].replace(/[.,;:\]]+$/, "");
	// Drop a trailing ")" only when it is unbalanced, e.g. "(see 10.1/x)" but keep "10.1002/(sici)…(1999)".
	const count = (c: string) => doi.split(c).length - 1;
	while (doi.endsWith(")") && count(")") > count("(")) doi = doi.slice(0, -1).replace(/[.,;:]+$/, "");
	return doi.toLowerCase();
}

const ARXIV_NEW = /(?:arxiv\.org\/(?:abs|pdf|html)\/|arxiv:\s*|^)(\d{4}\.\d{4,5})(v\d+)?(?:\.pdf)?\s*$/i;
const ARXIV_OLD = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*|^)([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i;

export function parseArxivId(input: string): string {
	const s = input.trim();
	const m = ARXIV_NEW.exec(s) ?? ARXIV_OLD.exec(s);
	return m ? m[1] : "";
}

export type Identifier = { kind: "doi" | "arxiv"; value: string } | { kind: "query"; value: string };

/** Decide whether user input is a DOI, an arXiv id/URL, or a free-text search. */
export function detectIdentifier(input: string): Identifier {
	const s = input.trim();
	const arxiv = parseArxivId(s);
	if (arxiv) return { kind: "arxiv", value: arxiv };
	// arXiv's own DOIs (10.48550/arXiv.2101.00001) → treat as arXiv.
	const doi = normalizeDoi(s);
	if (doi) {
		const ax = /^10\.48550\/arxiv\.(.+)$/i.exec(doi);
		if (ax) return { kind: "arxiv", value: ax[1] };
		// Only treat as DOI when the input is essentially just the DOI / DOI URL.
		if (/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)?10\./i.test(s) || /doi\.org\//i.test(s)) return { kind: "doi", value: doi };
	}
	return { kind: "query", value: s };
}

// ---------------------------------------------------------------------------
// Small utils
// ---------------------------------------------------------------------------

function str(v: unknown): string {
	if (v === null || v === undefined) return "";
	if (Array.isArray(v)) return str(v[0]);
	if (typeof v === "string") return v.trim();
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return "";
}

/** Strip HTML/JATS tags and collapse whitespace, keeping paragraph breaks. */
export function stripMarkup(s: string): string {
	return s
		.replace(/<\/(?:jats:)?p>\s*/gi, "\n\n")
		.replace(/<(?:jats:)?title>[^<]*<\/(?:jats:)?title>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/[ \t\r]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function reconstructAbstract(inv: Record<string, number[]> | null | undefined): string {
	if (!inv) return "";
	const words: string[] = [];
	for (const [word, positions] of Object.entries(inv)) for (const p of positions) words[p] = word;
	return words.filter((w) => w !== undefined).join(" ").trim();
}

function splitName(name: string): PaperAuthor {
	const clean = name.replace(/\s+/g, " ").trim();
	return { name: clean };
}

function pages(first: string, last: string): string {
	if (!first) return "";
	if (!last || last === first) return first;
	return `${first}-${last}`;
}

function emptyPaper(source: PaperSource): Paper {
	return {
		title: "",
		authors: [],
		year: "",
		published: "",
		journal: "",
		publisher: "",
		volume: "",
		issue: "",
		pages: "",
		doi: "",
		arxivId: "",
		url: "",
		pdfUrl: "",
		abstract: "",
		keywords: [],
		citedBy: null,
		kind: "",
		lang: "",
		source,
	};
}

// ---------------------------------------------------------------------------
// Safe access to untyped JSON (API responses are `unknown` until checked)
// ---------------------------------------------------------------------------

export type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read a nested property: get(x, "a", "b") ≈ x?.a?.b */
function get(v: unknown, ...path: (string | number)[]): unknown {
	let cur: unknown = v;
	for (const key of path) {
		if (typeof key === "number") cur = Array.isArray(cur) ? (cur[key] as unknown) : undefined;
		else cur = isObj(cur) ? cur[key] : undefined;
		if (cur === undefined || cur === null) return undefined;
	}
	return cur;
}

function list(v: unknown): unknown[] {
	return Array.isArray(v) ? (v as unknown[]) : [];
}

function num(v: unknown): number | null {
	return typeof v === "number" && isFinite(v) ? v : null;
}

function invertedIndex(v: unknown): Record<string, number[]> | null {
	if (!isObj(v)) return null;
	const out: Record<string, number[]> = {};
	for (const [word, positions] of Object.entries(v)) out[word] = list(positions).filter((n): n is number => typeof n === "number");
	return out;
}

// ---------------------------------------------------------------------------
// OpenAlex
// ---------------------------------------------------------------------------

export function parseOpenAlexWork(w: unknown): Paper {
	const p = emptyPaper("openalex");
	p.title = stripMarkup(str(get(w, "display_name") ?? get(w, "title")));
	p.authors = list(get(w, "authorships"))
		.map((a) => splitName(str(get(a, "author", "display_name") ?? get(a, "raw_author_name"))))
		.filter((a) => a.name);
	p.year = str(get(w, "publication_year"));
	p.published = str(get(w, "publication_date"));
	const loc = get(w, "primary_location");
	p.journal = str(get(loc, "source", "display_name"));
	p.publisher = str(get(loc, "source", "host_organization_name"));
	p.volume = str(get(w, "biblio", "volume"));
	p.issue = str(get(w, "biblio", "issue"));
	p.pages = pages(str(get(w, "biblio", "first_page")), str(get(w, "biblio", "last_page")));
	p.doi = normalizeDoi(str(get(w, "doi")));
	p.url = p.doi ? `https://doi.org/${p.doi}` : str(get(loc, "landing_page_url")) || str(get(w, "id"));
	p.pdfUrl = str(get(w, "best_oa_location", "pdf_url")) || str(get(loc, "pdf_url"));
	p.abstract = reconstructAbstract(invertedIndex(get(w, "abstract_inverted_index")));
	p.keywords = list(get(w, "keywords"))
		.map((k) => str(get(k, "display_name")))
		.filter(Boolean)
		.slice(0, 8);
	p.citedBy = num(get(w, "cited_by_count"));
	p.kind = str(get(w, "type"));
	p.lang = str(get(w, "language"));
	const ax = /arxiv\.org\/abs\/([^\s?#]+)/i.exec(str(get(loc, "landing_page_url")));
	if (ax) p.arxivId = parseArxivId(ax[1]) || ax[1];
	if (!p.journal && p.arxivId) p.journal = "arXiv";
	return p;
}

export function parseOpenAlexSearch(json: unknown): Paper[] {
	return list(get(json, "results"))
		.map(parseOpenAlexWork)
		.filter((p) => p.title);
}

// ---------------------------------------------------------------------------
// Crossref
// ---------------------------------------------------------------------------

function crossrefDate(m: unknown): string {
	const raw = ["published-print", "published-online", "issued", "published"]
		.map((k) => get(m, k, "date-parts", 0))
		.find((v) => Array.isArray(v) && typeof v[0] === "number");
	const parts = list(raw).filter((n): n is number => typeof n === "number");
	if (!parts[0]) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return [String(parts[0]), parts[1] ? pad(parts[1]) : "", parts[2] ? pad(parts[2]) : ""].filter(Boolean).join("-");
}

export function parseCrossrefWork(m: unknown): Paper {
	const p = emptyPaper("crossref");
	p.title = stripMarkup([str(get(m, "title")), str(get(m, "subtitle"))].filter(Boolean).join(": "));
	p.authors = list(get(m, "author"))
		.map((a): PaperAuthor => {
			const given = str(get(a, "given"));
			const family = str(get(a, "family"));
			const name = str(get(a, "name")) || [given, family].filter(Boolean).join(" ");
			return { name, given: given || undefined, family: family || undefined };
		})
		.filter((a) => a.name);
	p.published = crossrefDate(m);
	p.year = p.published.slice(0, 4);
	p.journal = stripMarkup(str(get(m, "container-title")));
	p.publisher = str(get(m, "publisher"));
	p.volume = str(get(m, "volume"));
	p.issue = str(get(m, "issue"));
	p.pages = str(get(m, "page")).replace(/[–—]/g, "-");
	p.doi = normalizeDoi(str(get(m, "DOI")));
	p.url = p.doi ? `https://doi.org/${p.doi}` : str(get(m, "URL"));
	p.abstract = stripMarkup(str(get(m, "abstract")));
	p.keywords = list(get(m, "subject")).map(str).filter(Boolean).slice(0, 8);
	p.citedBy = num(get(m, "is-referenced-by-count"));
	p.kind = str(get(m, "type"));
	p.lang = str(get(m, "language"));
	// Crossref PDF links are often paywalled; open-access PDFs come from OpenAlex/arXiv.
	return p;
}

export function parseCrossrefSearch(json: unknown): Paper[] {
	return list(get(json, "message", "items"))
		.map(parseCrossrefWork)
		.filter((p) => p.title);
}

// ---------------------------------------------------------------------------
// arXiv (Atom)
// ---------------------------------------------------------------------------

function childText(el: Element, local: string): string {
	for (const c of Array.from(el.children)) if (c.localName === local) return (c.textContent ?? "").replace(/\s+/g, " ").trim();
	return "";
}

export function parseArxivFeed(doc: Document): Paper[] {
	return Array.from(doc.getElementsByTagNameNS("*", "entry"))
		.map((e) => {
			const p = emptyPaper("arxiv");
			p.title = childText(e, "title");
			const idUrl = childText(e, "id");
			p.arxivId = parseArxivId(idUrl.replace(/v\d+$/, "")) || idUrl.split("/abs/")[1] || "";
			p.authors = Array.from(e.children)
				.filter((c) => c.localName === "author")
				.map((a) => splitName(childText(a, "name")))
				.filter((a) => a.name);
			p.published = childText(e, "published").slice(0, 10);
			p.year = p.published.slice(0, 4);
			p.abstract = childText(e, "summary");
			p.doi = normalizeDoi(childText(e, "doi"));
			const journalRef = childText(e, "journal_ref");
			p.journal = journalRef || "arXiv";
			p.url = p.arxivId ? `https://arxiv.org/abs/${p.arxivId}` : idUrl;
			const pdf = Array.from(e.children).find((c) => c.localName === "link" && c.getAttribute("title") === "pdf");
			p.pdfUrl = pdf?.getAttribute("href") ?? (p.arxivId ? `https://arxiv.org/pdf/${p.arxivId}` : "");
			if (p.pdfUrl.startsWith("http:")) p.pdfUrl = "https:" + p.pdfUrl.slice(5);
			p.keywords = Array.from(e.children)
				.filter((c) => c.localName === "category")
				.map((c) => c.getAttribute("term") ?? "")
				.filter(Boolean);
			p.kind = "preprint";
			return p;
		})
		.filter((p) => p.title && !/^Error$/i.test(p.title));
}

// ---------------------------------------------------------------------------
// KCI (Korea Citation Index) — open.kci.go.kr articleSearch
// ---------------------------------------------------------------------------

function firstTag(root: Element, name: string, attr?: [string, string]): Element | null {
	const els = Array.from(root.getElementsByTagName(name));
	if (attr) return els.find((e) => e.getAttribute(attr[0]) === attr[1]) ?? els[0] ?? null;
	return els[0] ?? null;
}

function tagText(root: Element, name: string, attr?: [string, string]): string {
	return (firstTag(root, name, attr)?.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function parseKci(doc: Document): Paper[] {
	const out: Paper[] = [];
	for (const art of Array.from(doc.getElementsByTagName("articleInfo"))) {
		const record = art.parentElement ?? art;
		const journal = firstTag(record, "journalInfo") ?? record;
		const p = emptyPaper("kci");
		p.title = tagText(art, "article-title", ["lang", "original"]);
		p.authors = Array.from(art.getElementsByTagName("author"))
			.map((a) => splitName((a.textContent ?? "").replace(/\s*\(.*?\)\s*$/, "")))
			.filter((a) => a.name);
		p.year = tagText(journal, "pub-year");
		const mon = tagText(journal, "pub-mon");
		p.published = p.year && mon ? `${p.year}-${mon.padStart(2, "0")}` : p.year;
		p.journal = tagText(journal, "journal-name");
		p.publisher = tagText(journal, "publisher-name");
		p.volume = tagText(journal, "volume");
		p.issue = tagText(journal, "issue");
		p.pages = pages(tagText(art, "fpage"), tagText(art, "lpage"));
		p.doi = normalizeDoi(tagText(art, "doi"));
		p.url = tagText(art, "url") || (p.doi ? `https://doi.org/${p.doi}` : "");
		p.abstract = tagText(art, "abstract", ["lang", "original"]);
		const cites = tagText(art, "citation-count");
		p.citedBy = cites && !isNaN(+cites) ? +cites : null;
		p.kind = "journal-article";
		p.lang = /[가-힣]/.test(p.title) ? "ko" : "";
		if (p.title) out.push(p);
	}
	return out;
}

export function kciError(doc: Document): string {
	const result = doc.getElementsByTagName("result")[0];
	const msg = result ? tagText(result, "resultMsg") || tagText(result, "message") : "";
	return msg;
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

/** Fill gaps in `a` from `b` (a wins), keeping the larger citation count. */
export function mergePapers(a: Paper, b: Paper | null): Paper {
	if (!b) return a;
	const out: Paper = { ...a };
	for (const k of Object.keys(out) as (keyof Paper)[]) {
		const v = out[k];
		const empty = v === "" || v === null || (Array.isArray(v) && v.length === 0);
		if (empty) (out as unknown as Record<string, unknown>)[k] = b[k];
	}
	// Prefer structured author names (given/family) when the other side has them.
	if (!a.authors.some((x) => x.family) && b.authors.some((x) => x.family) && b.authors.length >= a.authors.length) out.authors = b.authors;
	if (a.citedBy !== null && b.citedBy !== null) out.citedBy = Math.max(a.citedBy, b.citedBy);
	if (!out.pdfUrl && b.pdfUrl) out.pdfUrl = b.pdfUrl;
	if (b.abstract.length > out.abstract.length * 1.5) out.abstract = b.abstract;
	return out;
}

// ---------------------------------------------------------------------------
// Names, citations, BibTeX
// ---------------------------------------------------------------------------

const LATIN = /^[\p{Script=Latin}\s.'’\-,]+$/u;

function familyGiven(a: PaperAuthor): { family: string; given: string; latin: boolean } {
	const latin = LATIN.test(a.name);
	if (a.family) return { family: a.family, given: a.given ?? "", latin };
	if (!latin) return { family: a.name, given: "", latin };
	if (a.name.includes(",")) {
		const [f, g] = a.name.split(",", 2);
		return { family: f.trim(), given: (g ?? "").trim(), latin };
	}
	const parts = a.name.split(" ");
	const family = parts.pop() ?? a.name;
	return { family, given: parts.join(" "), latin };
}

function initials(given: string): string {
	return given
		.split(/[\s]+/)
		.filter(Boolean)
		.map((g) => g.split("-").map((x) => `${x.charAt(0).toUpperCase()}.`).join("-"))
		.join(" ");
}

export function firstAuthorFamily(p: Paper): string {
	return p.authors[0] ? familyGiven(p.authors[0]).family : "";
}

function apaName(a: PaperAuthor): string {
	const { family, given, latin } = familyGiven(a);
	if (!latin || !given) return family || a.name;
	return `${family}, ${initials(given)}`;
}

function invertedName(a: PaperAuthor): string {
	const { family, given, latin } = familyGiven(a);
	if (!latin || !given) return a.name;
	return `${family}, ${given}`;
}

function joinWith(list: string[], last: string, serialComma = true): string {
	if (list.length <= 1) return list.join("");
	if (list.length === 2) return `${list[0]}${last}${list[1]}`;
	return `${list.slice(0, -1).join(", ")}${serialComma ? "," : ""}${last}${list[list.length - 1]}`;
}

function endDot(s: string): string {
	return /[.?!]$/.test(s) ? s : `${s}.`;
}

function link(p: Paper): string {
	return p.doi ? `https://doi.org/${p.doi}` : p.url;
}

export function buildPaperCitation(p: Paper, style: CitationStyle): string {
	const year = p.year || "n.d.";
	const isArxivOnly = !p.doi && p.arxivId && (!p.journal || p.journal === "arXiv");
	const container = isArxivOnly ? `arXiv:${p.arxivId}` : p.journal;

	switch (style) {
		case "korean": {
			const names = p.authors.map((a) => a.name);
			const who = names.length > 3 ? `${names[0]} 외 ${names.length - 1}인` : names.join(", ");
			const volIssue = [p.volume ? `${p.volume}권` : "", p.issue ? `${p.issue}호` : ""].filter(Boolean).join(" ");
			const venue = container ? `『${container}』${volIssue ? ` ${volIssue}` : ""}` : "";
			const head = [who, `“${p.title}”`, venue].filter(Boolean).join(", ");
			const tail = `${p.year ? ` (${p.year})` : ""}${p.pages ? `: ${p.pages}` : ""}`;
			return `${head}${tail}.${link(p) ? ` ${link(p)}` : ""}`;
		}
		case "apa": {
			const names = p.authors.map(apaName);
			const who =
				names.length > 20 ? `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}` : joinWith(names, names.length === 2 ? ", & " : " & ");
			const vol = p.volume ? `, *${p.volume}*${p.issue ? `(${p.issue})` : ""}` : "";
			const pg = p.pages ? `, ${p.pages}` : "";
			const venue = container ? ` *${container}*${vol}${pg}.` : "";
			const head = who ? `${endDot(who)} (${year}).` : `${endDot(p.title)} (${year}).`;
			const title = who ? ` ${endDot(p.title)}` : "";
			return `${head}${title}${venue}${link(p) ? ` ${link(p)}` : ""}`;
		}
		case "mla": {
			const n = p.authors;
			let who = "";
			if (n.length === 1) who = invertedName(n[0]);
			else if (n.length === 2) who = `${invertedName(n[0])}, and ${n[1].name}`;
			else if (n.length > 2) who = `${invertedName(n[0])}, et al`;
			const parts = [
				container ? `*${container}*` : "",
				p.volume ? `vol. ${p.volume}` : "",
				p.issue ? `no. ${p.issue}` : "",
				p.year,
				p.pages ? `pp. ${p.pages}` : "",
			].filter(Boolean);
			const l = p.doi ? `https://doi.org/${p.doi}` : p.url;
			return `${who ? `${endDot(who)} ` : ""}“${endDot(p.title)}” ${parts.join(", ")}${l ? `, ${l}` : ""}.`;
		}
		case "sbl": {
			// SBL Handbook of Style (2nd ed.) bibliography: Journal vol.issue (year): pages.
			const n = p.authors;
			const names = n.map((a, i) => (i === 0 ? invertedName(a) : a.name));
			const who = n.length > 10 ? `${names.slice(0, 7).join(", ")}, et al` : joinWith(names, ", and ", false);
			const vi = p.volume ? ` ${p.volume}${p.issue ? `.${p.issue}` : ""}` : "";
			const yr = p.year ? ` (${p.year})` : "";
			const pg = p.pages ? `: ${p.pages.replace(/-/g, "–")}` : "";
			const venue = container ? ` *${container}*${vi}${yr}${pg}.` : `${yr}.`;
			return `${who ? `${endDot(who)} ` : ""}“${endDot(p.title)}”${venue}${link(p) ? ` ${link(p)}.` : ""}`;
		}
		case "chicago":
		default: {
			const n = p.authors;
			const names =
				n.length > 10
					? [invertedName(n[0]), ...n.slice(1, 7).map((a) => a.name), "et al"]
					: n.map((a, i) => (i === 0 ? invertedName(a) : a.name));
			const who = n.length > 10 ? names.join(", ") : names.length === 2 ? `${names[0]}, and ${names[1]}` : joinWith(names, " and ");
			const vol = p.volume ? ` ${p.volume}` : "";
			const no = p.issue ? `, no. ${p.issue}` : "";
			const yr = p.year ? ` (${p.year})` : "";
			const pg = p.pages ? `: ${p.pages}` : "";
			const venue = container ? ` *${container}*${vol}${no}${yr}${pg}.` : `${yr}.`;
			return `${who ? `${endDot(who)} ` : ""}“${endDot(p.title)}”${venue}${link(p) ? ` ${link(p)}.` : ""}`;
		}
	}
}

/** citekey like "piwowar2018state" (latin) or "홍명희2020" */
export function citeKey(p: Paper): string {
	const fam = (firstAuthorFamily(p) || "anon").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
	const word =
		p.title
			.toLowerCase()
			.split(/\s+/)
			.map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
			.find((w) => w.length > 3 && !STOP.has(w)) ?? "";
	return `${fam}${p.year || ""}${LATIN.test(word) ? word : ""}`;
}

const STOP = new Set(["the", "and", "with", "from", "into", "that", "this", "their", "about", "toward", "towards", "using", "over", "under", "between"]);

function bibEscape(s: string): string {
	return s.replace(/([&%$#_])/g, "\\$1");
}

export function toBibTeX(p: Paper): string {
	const type = /book-chapter/.test(p.kind) ? "incollection" : /book/.test(p.kind) ? "book" : /proceedings|conference/.test(p.kind) ? "inproceedings" : p.arxivId && !p.doi ? "misc" : "article";
	const authors = p.authors
		.map((a) => {
			const { family, given } = familyGiven(a);
			return given ? `${family}, ${given}` : `{${family}}`;
		})
		.join(" and ");
	const fields: [string, string][] = [
		["title", `{${bibEscape(p.title)}}`], // double braces keep capitalisation
		["author", authors],
		[type === "inproceedings" || type === "incollection" ? "booktitle" : "journal", p.journal && p.journal !== "arXiv" ? bibEscape(p.journal) : ""],
		["year", p.year],
		["volume", p.volume],
		["number", p.issue],
		["pages", p.pages.replace(/-/g, "--")],
		["publisher", type === "book" ? bibEscape(p.publisher) : ""],
		["doi", p.doi],
		["eprint", p.arxivId],
		["archivePrefix", p.arxivId ? "arXiv" : ""],
		["url", p.doi ? "" : p.url],
	];
	const body = fields
		.filter(([, v]) => v && v !== "{}")
		.map(([k, v]) => `  ${k} = {${v}}`)
		.join(",\n");
	return `@${type}{${citeKey(p)},\n${body}\n}`;
}
