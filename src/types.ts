export type ContentMode = "ask" | "full" | "metadata";
export type CitationStyle = "korean" | "chicago" | "sbl" | "apa" | "mla";
export type InsertMode = "footnote" | "citation" | "link" | "citation-link";

export interface ArticleMeta {
	url: string;
	canonicalUrl: string;
	title: string;
	author: string;
	site: string;
	published: string; // ISO date (YYYY-MM-DD) or ""
	description: string;
	image: string;
	lang: string;
	type: string;
	/** DOI found in the page (citation_doi etc.), "" if none. */
	doi: string;
	/** True when the page declares itself a scholarly article (citation_journal_title / citation_title). */
	scholarly: boolean;
}

export interface ExtractedArticle extends ArticleMeta {
	/** Article body converted to Markdown, or "" when not extracted. */
	contentMarkdown: string;
	/** Rough length of the readable text, in characters. */
	textLength: number;
}

export interface SaveOptions {
	url: string;
	includeContent: boolean;
	tags: string[];
	project: string;
	status: string;
	rating: number; // 0 = not rated
	folder: string; // where the note goes; "" = the default folder
}

export interface ArticledropSettings {
	folder: string;
	fileNameTemplate: string;
	contentMode: ContentMode;
	citationStyle: CitationStyle;
	statuses: string[];
	defaultStatus: string;
	defaultTags: string;
	bodyTemplate: string;
	openAfterSave: boolean;
	batchLinkBack: boolean;
	convertSharedNotes: boolean;
	indexFileName: string;
	language: "auto" | "ko" | "en";
	insertMode: InsertMode;
	bibliographyHeading: string;

	// Papers
	paperFileNameTemplate: string;
	paperTemplate: string;
	paperSource: PaperSource;
	contactEmail: string;
	openAlexKey: string;
	kciKey: string;
	downloadPdf: boolean;
	pdfFolder: string;
	defaultPaperTags: string;
}

export type PaperSource = "openalex" | "crossref" | "arxiv" | "kci";

export interface PaperAuthor {
	/** Full display name, e.g. "Heather Piwowar" or "홍명희". */
	name: string;
	given?: string;
	family?: string;
}

export interface Paper {
	title: string;
	authors: PaperAuthor[];
	year: string;
	published: string; // YYYY-MM-DD or YYYY-MM or ""
	journal: string;
	publisher: string;
	volume: string;
	issue: string;
	pages: string;
	doi: string; // bare DOI, lower-case, no https://doi.org/
	arxivId: string;
	url: string;
	pdfUrl: string;
	abstract: string;
	keywords: string[];
	citedBy: number | null;
	kind: string; // journal-article, preprint, book-chapter…
	lang: string;
	source: PaperSource;
}

export interface PaperSaveOptions {
	folder: string;
	rating: number;
	tags: string[];
	project: string;
	status: string;
	downloadPdf: boolean;
}
