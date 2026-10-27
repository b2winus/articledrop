import { requestUrl } from "obsidian";
import {
	kciError,
	mergePapers,
	parseArxivFeed,
	parseCrossrefSearch,
	parseCrossrefWork,
	parseKci,
	parseOpenAlexSearch,
	parseOpenAlexWork,
} from "./scholar";
import type { Paper, PaperSource } from "./types";

export interface ScholarConfig {
	contactEmail: string;
	openAlexKey: string;
	kciKey: string;
}

export interface SearchParams {
	query: string;
	source: PaperSource;
	fromYear?: number;
	limit?: number;
}

export class ScholarError extends Error {}

function ua(cfg: ScholarConfig): string {
	return `Articledrop-Obsidian/0.2.0${cfg.contactEmail ? ` (mailto:${cfg.contactEmail})` : ""}`;
}

async function getJson(url: string, cfg: ScholarConfig): Promise<Record<string, unknown> | null> {
	const res = await requestUrl({ url, headers: { "User-Agent": ua(cfg), Accept: "application/json" }, throw: false });
	if (res.status === 404) return null;
	if (res.status === 429) throw new ScholarError("429 — rate limited. Try again later or add an API key.");
	if (res.status >= 400) throw new ScholarError(`HTTP ${res.status}`);
	return res.json as Record<string, unknown>;
}

async function getXml(url: string, cfg: ScholarConfig): Promise<Document> {
	const res = await requestUrl({ url, headers: { "User-Agent": ua(cfg) }, throw: false });
	if (res.status >= 400) throw new ScholarError(`HTTP ${res.status}`);
	return new DOMParser().parseFromString(res.text, "application/xml");
}

function openAlexParams(cfg: ScholarConfig): string {
	let s = "";
	if (cfg.openAlexKey) s += `&api_key=${encodeURIComponent(cfg.openAlexKey)}`;
	if (cfg.contactEmail) s += `&mailto=${encodeURIComponent(cfg.contactEmail)}`;
	return s;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchPapers(p: SearchParams, cfg: ScholarConfig): Promise<Paper[]> {
	const q = p.query.trim();
	const n = p.limit ?? 20;
	if (!q) return [];

	switch (p.source) {
		case "openalex": {
			const filter = p.fromYear ? `&filter=from_publication_date:${p.fromYear}-01-01` : "";
			const json = await getJson(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${n}${filter}${openAlexParams(cfg)}`, cfg);
			return json ? parseOpenAlexSearch(json) : [];
		}
		case "crossref": {
			const filter = p.fromYear ? `&filter=from-pub-date:${p.fromYear}` : "";
			const mail = cfg.contactEmail ? `&mailto=${encodeURIComponent(cfg.contactEmail)}` : "";
			const json = await getJson(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}&rows=${n}${filter}${mail}`, cfg);
			return json ? parseCrossrefSearch(json) : [];
		}
		case "arxiv": {
			const terms = q
				.split(/\s+/)
				.filter(Boolean)
				.map((w) => `all:${w.replace(/[():"]/g, "")}`)
				.join(" AND ");
			const doc = await getXml(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(terms)}&start=0&max_results=${n}&sortBy=relevance`, cfg);
			let results = parseArxivFeed(doc);
			if (p.fromYear) results = results.filter((r) => +r.year >= (p.fromYear ?? 0));
			return results;
		}
		case "kci": {
			if (!cfg.kciKey) throw new ScholarError("KCI API key is not set.");
			const from = p.fromYear ? `&dateFrom=${p.fromYear}01` : "";
			const doc = await getXml(
				`https://open.kci.go.kr/po/openapi/openApiSearch.kci?apiCode=articleSearch&key=${encodeURIComponent(cfg.kciKey)}&title=${encodeURIComponent(q)}&displayCount=${n}${from}`,
				cfg
			);
			const results = parseKci(doc);
			if (!results.length) {
				const err = kciError(doc);
				if (err) throw new ScholarError(`KCI: ${err}`);
			}
			return results;
		}
	}
}

// ---------------------------------------------------------------------------
// Lookup by identifier (merges sources for the richest record)
// ---------------------------------------------------------------------------

export async function lookupDoi(doi: string, cfg: ScholarConfig): Promise<Paper | null> {
	const enc = encodeURIComponent(doi);
	const mail = cfg.contactEmail ? `?mailto=${encodeURIComponent(cfg.contactEmail)}` : "";
	const [cr, oa] = await Promise.allSettled([
		getJson(`https://api.crossref.org/works/${enc}${mail}`, cfg),
		getJson(`https://api.openalex.org/works/doi:${doi}?${openAlexParams(cfg).slice(1)}`, cfg),
	]);
	const crossref = cr.status === "fulfilled" && cr.value?.message ? parseCrossrefWork(cr.value.message as Record<string, unknown>) : null;
	const openalex = oa.status === "fulfilled" && oa.value ? parseOpenAlexWork(oa.value) : null;
	if (!crossref && !openalex) {
		const reason = [cr, oa].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
		if (reason) throw reason.reason;
		return null;
	}
	// Crossref is authoritative for bibliographic fields; OpenAlex adds abstract, OA PDF, keywords.
	if (!crossref) return openalex as Paper;
	const merged = mergePapers(crossref, openalex);
	// OpenAlex keywords describe the paper; Crossref "subjects" describe the journal.
	if (openalex?.keywords.length) merged.keywords = openalex.keywords;
	return merged;
}

export async function lookupArxiv(id: string, cfg: ScholarConfig): Promise<Paper | null> {
	const doc = await getXml(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, cfg);
	const paper = parseArxivFeed(doc)[0] ?? null;
	if (paper?.doi) {
		try {
			const published = await lookupDoi(paper.doi, cfg);
			if (published) return mergePapers(published, paper);
		} catch {
			/* keep arXiv record */
		}
	}
	return paper;
}

/** Enrich a search hit (which may be partial) before saving. */
export async function enrichPaper(p: Paper, cfg: ScholarConfig): Promise<Paper> {
	try {
		if (p.doi) {
			const full = await lookupDoi(p.doi, cfg);
			if (full) return mergePapers(full, p);
		} else if (p.arxivId && p.source !== "arxiv") {
			const full = await lookupArxiv(p.arxivId, cfg);
			if (full) return mergePapers(full, p);
		}
	} catch {
		/* the hit itself is good enough */
	}
	return p;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Download an open-access PDF. Returns null when the URL does not serve a PDF. */
export async function downloadPdf(url: string, cfg: ScholarConfig): Promise<ArrayBuffer | null> {
	const res = await requestUrl({ url, headers: { "User-Agent": ua(cfg), Accept: "application/pdf" }, throw: false });
	if (res.status >= 400) return null;
	const head = new Uint8Array(res.arrayBuffer.slice(0, 5));
	const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
	return isPdf ? res.arrayBuffer : null;
}
