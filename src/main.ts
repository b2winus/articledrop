import { Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin, TFile, TFolder, getAllTags, normalizePath, stringifyYaml } from "obsidian";
import { fetchArticle } from "./fetcher";
import { findUrls, isHttpUrl, normalizeUrl } from "./extract";
import { setLanguage, t } from "./i18n";
import { BatchModal, BatchItem, SaveModal, StatusModal } from "./modals";
import { appendToSection, buildCitation, memoEntry, nextFootnote, quoteEntry, renderTemplate, sanitizeFileName, splitList, stars, toTag, today, uniq } from "./render";
import { EntryKind, EntryModal, RatingModal, SourceItem, SourcePickerModal } from "./research-modals";
import { ArticledropSettingTab, defaultSettings } from "./settings";
import type { ArticledropSettings, ExtractedArticle, Paper, PaperSaveOptions, PaperSource, SaveOptions } from "./types";
import { buildPaperCitation, citeKey, detectIdentifier, firstAuthorFamily, normalizeDoi, parseArxivId, toBibTeX } from "./scholar";
import { ScholarConfig, downloadPdf, enrichPaper, lookupArxiv, lookupDoi, searchPapers } from "./scholar-api";
import { IdentifierModal, PaperSaveModal, PaperSearchModal } from "./paper-modals";

const CONTENT_START = "<!-- articledrop:content -->";
const CONTENT_END = "<!-- /articledrop:content -->";

export default class ArticledropPlugin extends Plugin {
	settings!: ArticledropSettings;
	/** Paths this plugin is writing, so our own creates are not treated as "shared" notes. */
	private ownWrites = new Set<string>();
	private recentlyCreated = new Map<string, number>();
	private handledShared = new Set<string>();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ArticledropSettingTab(this.app, this));

		this.addRibbonIcon("newspaper", t("ribbon"), () => this.openSaveModal());

		this.addCommand({ id: "save-url", name: t("cmd.save"), callback: () => this.openSaveModal() });
		this.addCommand({ id: "save-clipboard", name: t("cmd.clipboard"), callback: () => this.saveFromClipboard() });

		this.addCommand({
			id: "save-links-in-note",
			name: t("cmd.batch"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.openBatchModal(file);
				return true;
			},
		});

		this.addCommand({
			id: "set-status",
			name: t("cmd.status"),
			checkCallback: (checking) => {
				const file = this.activeArticle();
				if (!file) return false;
				if (!checking) this.changeStatus(file);
				return true;
			},
		});

		this.addCommand({
			id: "refetch-content",
			name: t("cmd.refetch"),
			checkCallback: (checking) => {
				const file = this.activeArticle();
				if (!file || this.activePaper()) return false;
				if (!checking) void this.refetchContent(file);
				return true;
			},
		});

		this.addCommand({
			id: "copy-citation",
			name: t("cmd.copyCitation"),
			checkCallback: (checking) => {
				const file = this.activeArticle();
				if (!file) return false;
				if (!checking) void this.copyCitation(file);
				return true;
			},
		});

		this.addCommand({ id: "open-index", name: t("cmd.index"), callback: () => this.openIndex() });

		// Reading & writing with sources
		this.addCommand({
			id: "rate",
			name: t("cmd.rate"),
			checkCallback: (checking) => {
				const file = this.activeArticle();
				if (!file) return false;
				if (!checking) this.rate(file);
				return true;
			},
		});
		this.addCommand({ id: "add-memo", name: t("cmd.addMemo"), callback: () => this.openEntry("memo") });
		this.addCommand({ id: "add-quote", name: t("cmd.addQuote"), callback: () => this.openEntry("quote") });
		this.addCommand({
			id: "insert-citation",
			name: t("cmd.insertCitation"),
			editorCallback: (editor, view) => this.insertCitation(editor, view),
		});
		this.addCommand({
			id: "insert-bibliography",
			name: t("cmd.insertBibliography"),
			editorCallback: (editor, view) => this.insertBibliography(editor, view),
		});

		// Papers
		this.addRibbonIcon("graduation-cap", t("cmd.searchPapers"), () => this.openPaperSearch());
		this.addCommand({ id: "search-papers", name: t("cmd.searchPapers"), callback: () => this.openPaperSearch() });
		this.addCommand({
			id: "save-paper-by-id",
			name: t("cmd.savePaperId"),
			callback: () => new IdentifierModal(this.app, (v) => void this.savePaperFromInput(v)).open(),
		});
		this.addCommand({
			id: "copy-bibtex",
			name: t("cmd.copyBibtex"),
			checkCallback: (checking) => {
				const file = this.activePaper();
				if (!file) return false;
				if (!checking) void this.copyBibtex(file);
				return true;
			},
		});
		this.addCommand({
			id: "download-pdf",
			name: t("cmd.attachPdf"),
			checkCallback: (checking) => {
				const file = this.activePaper();
				if (!file) return false;
				if (!checking) void this.attachPdf(file);
				return true;
			},
		});

		// obsidian://articledrop?url=...
		this.registerObsidianProtocolHandler("articledrop", (params) => {
			if (params.paper !== undefined) return this.openPaperSearch(params.paper);
			const url = (params.url ?? "").trim();
			if (!isHttpUrl(url)) return this.openSaveModal();
			if (this.settings.contentMode === "ask") this.openSaveModal(url);
			else void this.saveArticle(this.quickOptions(url));
		});

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on("create", (f) => {
					if (!(f instanceof TFile) || f.extension !== "md") return;
					if (!this.settings.convertSharedNotes || this.ownWrites.has(f.path)) return;
					this.recentlyCreated.set(f.path, Date.now());
					window.setTimeout(() => void this.checkSharedNote(f), 1500);
				})
			);
			this.registerEvent(
				this.app.vault.on("modify", (f) => {
					const created = this.recentlyCreated.get(f.path);
					if (f instanceof TFile && created && Date.now() - created < 15000) void this.checkSharedNote(f);
				})
			);
		});
	}

	// -------------------------------------------------------------------------
	// Settings
	// -------------------------------------------------------------------------

	async loadSettings() {
		const data = ((await this.loadData()) ?? {}) as Partial<ArticledropSettings>;
		setLanguage(data.language ?? "auto");
		this.settings = Object.assign(defaultSettings(), data);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private wantsContentByDefault(): boolean {
		return this.settings.contentMode !== "metadata";
	}

	private quickOptions(url: string): SaveOptions {
		return {
			url,
			includeContent: this.wantsContentByDefault(),
			tags: [],
			project: "",
			status: this.settings.defaultStatus,
			rating: 0,
		};
	}

	// -------------------------------------------------------------------------
	// Lookups
	// -------------------------------------------------------------------------

	/** Article and paper notes made by this plugin. */
	private articleFiles(): TFile[] {
		const a = this.folderPrefix();
		const p = this.folderPrefix(this.settings.paperFolder);
		return this.app.vault.getMarkdownFiles().filter((f) => {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			return (
				!!fm &&
				typeof fm.url === "string" &&
				(fm.type === "article" || fm.type === "paper" || (a && f.path.startsWith(a)) || (p && f.path.startsWith(p)))
			);
		});
	}

	private folderPrefix(folder: string = this.settings.folder): string {
		const f = normalizePath(folder);
		return f === "/" ? "" : `${f}/`;
	}

	private findExisting(url: string): TFile | null {
		const id = detectIdentifier(url);
		const target = normalizeUrl(url);
		for (const f of this.articleFiles()) {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (!fm) continue;
			if (normalizeUrl(String(fm.url)) === target) return f;
			if (fm.canonical && normalizeUrl(String(fm.canonical)) === target) return f;
			if (id.kind === "doi" && fm.doi && normalizeDoi(String(fm.doi)) === id.value) return f;
			if (id.kind === "arxiv" && fm.arxiv && String(fm.arxiv) === id.value) return f;
		}
		return null;
	}

	private findExistingPaper(p: Paper): TFile | null {
		for (const f of this.articleFiles()) {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (!fm) continue;
			if (p.doi && fm.doi && normalizeDoi(String(fm.doi)) === p.doi) return f;
			if (p.arxivId && fm.arxiv && String(fm.arxiv) === p.arxivId) return f;
			if (p.url && normalizeUrl(String(fm.url)) === normalizeUrl(p.url)) return f;
		}
		return null;
	}

	private knownTags = (): string[] => {
		// Public API only: collect tags from every note's cache.
		const tags: string[] = [];
		for (const f of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(f);
			if (cache) for (const tag of getAllTags(cache) ?? []) tags.push(tag.replace(/^#/, ""));
		}
		return uniq([...splitList(this.settings.defaultTags), ...tags]).sort();
	};

	private knownProjects = (): string[] => {
		const out: string[] = [];
		for (const f of this.articleFiles()) {
			const p: unknown = this.app.metadataCache.getFileCache(f)?.frontmatter?.project;
			if (Array.isArray(p)) out.push(...p.map(String));
			else if (typeof p === "string" && p) out.push(p);
		}
		return uniq(out).sort();
	};

	private activePaper(): TFile | null {
		const file = this.activeArticle();
		if (!file) return null;
		return this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "paper" ? file : null;
	}

	private activeArticle(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!file) return null;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return fm && typeof fm.url === "string" ? file : null;
	}

	// -------------------------------------------------------------------------
	// Entry points
	// -------------------------------------------------------------------------

	openSaveModal(url?: string, target?: TFile) {
		new SaveModal(this.app, {
			url,
			askContent: this.settings.contentMode === "ask",
			defaultContent: this.wantsContentByDefault(),
			defaultTags: this.settings.defaultTags,
			statuses: this.settings.statuses,
			defaultStatus: this.settings.defaultStatus,
			knownTags: this.knownTags,
			knownProjects: this.knownProjects,
			onSubmit: async (opts) => !!(await this.saveArticle(opts, target)),
		}).open();
	}

	private async saveFromClipboard() {
		let text = "";
		try {
			text = (await navigator.clipboard.readText()).trim();
		} catch {
			/* clipboard permission denied */
		}
		const url = findUrls(text)[0];
		if (!url) {
			new Notice(t("notice.clipboardEmpty"));
			this.openSaveModal();
			return;
		}
		if (this.settings.contentMode === "ask") this.openSaveModal(url);
		else await this.saveArticle(this.quickOptions(url));
	}

	private async openBatchModal(source: TFile) {
		const text = await this.app.vault.cachedRead(source);
		const items: BatchItem[] = findIdentifiers(text).map((url) => {
			const existing = !!this.findExisting(url);
			return { url, existing, selected: !existing };
		});
		new BatchModal(this.app, {
			items,
			askContent: this.settings.contentMode === "ask",
			defaultContent: this.wantsContentByDefault(),
			defaultTags: this.settings.defaultTags,
			statuses: this.settings.statuses,
			defaultStatus: this.settings.defaultStatus,
			knownTags: this.knownTags,
			knownProjects: this.knownProjects,
			onSubmit: (urls, opts) => void this.runBatch(source, urls, opts),
		}).open();
	}

	private async runBatch(source: TFile, urls: string[], opts: Omit<SaveOptions, "url">) {
		const progress = new Notice(t("batch.progress", { i: 0, n: urls.length }), 0);
		const saved = new Map<string, TFile>();
		let fail = 0;
		for (let i = 0; i < urls.length; i++) {
			progress.setMessage(t("batch.progress", { i: i + 1, n: urls.length }));
			const file = await this.saveArticle({ ...opts, url: urls[i] }, undefined, { quiet: true });
			if (file) saved.set(urls[i], file);
			else fail++;
		}
		progress.hide();
		new Notice(t("batch.done", { ok: saved.size, fail }));

		if (this.settings.batchLinkBack && saved.size) {
			await this.app.vault.process(source, (text) =>
				text
					.split("\n")
					.map((line) => {
						for (const [url, file] of saved) {
							if (!line.includes(url)) continue;
							const link = this.app.fileManager.generateMarkdownLink(file, source.path);
							if (!line.includes(link)) line = `${line} → ${link}`;
						}
						return line;
					})
					.join("\n")
			);
		}
	}

	private async checkSharedNote(file: TFile) {
		if (this.handledShared.has(file.path) || this.ownWrites.has(file.path)) return;
		const created = this.recentlyCreated.get(file.path);
		if (!created || Date.now() - created > 15000) return;
		const text = (await this.app.vault.read(file)).trim();
		if (!text || text.length > 600 || /^#{1,6}\s|^---/m.test(text)) return;
		const urls = findUrls(text);
		if (urls.length !== 1) return;

		this.handledShared.add(file.path);
		this.recentlyCreated.delete(file.path);
		new Notice(t("notice.sharedConverted"));
		this.openSaveModal(urls[0], file);
	}

	// -------------------------------------------------------------------------
	// Saving
	// -------------------------------------------------------------------------

	async saveArticle(opts: SaveOptions, target?: TFile, flags: { quiet?: boolean } = {}): Promise<TFile | null> {
		if (!isHttpUrl(opts.url)) {
			new Notice(t("notice.invalidUrl"));
			return null;
		}

		// DOI / arXiv links are papers.
		const id = detectIdentifier(opts.url);
		if (id.kind !== "query") {
			return this.savePaperFromIdentifier(id.kind, id.value, this.paperOptionsFrom(opts), target, flags);
		}

		const existing = this.findExisting(opts.url);
		if (existing && !target) {
			if (!flags.quiet) {
				new Notice(t("notice.duplicate"));
				await this.app.workspace.getLeaf(false).openFile(existing);
			}
			return existing;
		}

		const fetching = flags.quiet ? null : new Notice(t("notice.fetching"), 0);
		let article: ExtractedArticle;
		try {
			article = await fetchArticle(opts.url, opts.includeContent);
		} catch (e) {
			fetching?.hide();
			new Notice(t("notice.failed", { error: e instanceof Error ? e.message : String(e) }), 8000);
			return null;
		}
		fetching?.hide();

		// A journal's article page: save it as a paper with full scholarly metadata.
		if (article.doi && article.scholarly) {
			try {
				const paper = await lookupDoi(article.doi, this.scholarConfig());
				if (paper) {
					if (!flags.quiet) new Notice(t("paper.detected"));
					return this.savePaper(paper, this.paperOptionsFrom(opts), target, flags);
				}
			} catch {
				/* fall back to saving as an article */
			}
		}

		if (opts.includeContent && !article.contentMarkdown && !flags.quiet) new Notice(t("notice.noContent"));

		const text = this.buildNote(article, opts);
		let file: TFile;

		if (target) {
			this.ownWrites.add(target.path);
			await this.app.vault.process(target, () => text);
			const desired = this.uniquePath(this.fileNameFor(article), target.path);
			if (desired !== target.path) {
				await this.ensureFolder();
				await this.app.fileManager.renameFile(target, desired);
			}
			file = target;
		} else {
			await this.ensureFolder();
			const path = this.uniquePath(this.fileNameFor(article));
			this.ownWrites.add(path);
			file = await this.app.vault.create(path, text);
		}

		if (!flags.quiet) {
			new Notice(t("notice.saved", { title: article.title }));
			if (this.settings.openAfterSave) await this.app.workspace.getLeaf(false).openFile(file);
		}
		return file;
	}

	private buildNote(a: ExtractedArticle, opts: SaveOptions): string {
		const saved = today();
		const tags = uniq([...splitList(this.settings.defaultTags), ...opts.tags].map(toTag).filter(Boolean));
		const projects = splitList(opts.project);
		const citation = buildCitation(a, this.settings.citationStyle, saved);

		const fm: Record<string, unknown> = {
			title: a.title,
			author: a.author || undefined,
			site: a.site || undefined,
			url: a.url,
			canonical: a.canonicalUrl && normalizeUrl(a.canonicalUrl) !== normalizeUrl(a.url) ? a.canonicalUrl : undefined,
			published: a.published || undefined,
			saved,
			description: a.description || undefined,
			image: a.image || undefined,
			lang: a.lang || undefined,
			type: "article",
			status: opts.status || this.settings.defaultStatus,
			rating: opts.rating > 0 ? opts.rating : undefined,
			project: projects,
			tags,
			citation,
		};
		for (const k of Object.keys(fm)) if (fm[k] === undefined) delete fm[k];

		const content = a.contentMarkdown ? `${CONTENT_START}\n${a.contentMarkdown}\n${CONTENT_END}` : "";
		const body = renderTemplate(this.settings.bodyTemplate, {
			title: a.title,
			url: a.url,
			site: a.site,
			author: a.author,
			published: a.published,
			saved,
			description: a.description,
			image: a.image,
			citation,
			content,
			tags: tags.map((x) => `#${x}`).join(" "),
			project: projects.join(", "),
			status: String(fm.status),
			rating: stars(opts.rating),
		});

		return `---\n${stringifyYaml(fm)}---\n\n${body}`;
	}

	private fileNameFor(a: ExtractedArticle): string {
		const name = this.settings.fileNameTemplate
			.replace(/\{\{title\}\}/g, a.title)
			.replace(/\{\{site\}\}/g, a.site)
			.replace(/\{\{author\}\}/g, a.author)
			.replace(/\{\{published\}\}/g, a.published)
			.replace(/\{\{saved\}\}/g, today());
		return sanitizeFileName(name);
	}

	private uniquePath(baseName: string, currentPath?: string, folder: string = this.settings.folder, ext = "md"): string {
		const prefix = this.folderPrefix(folder);
		let path = normalizePath(`${prefix}${baseName}.${ext}`);
		let n = 2;
		while (path !== currentPath && this.app.vault.getAbstractFileByPath(path)) {
			path = normalizePath(`${prefix}${baseName} (${n++}).${ext}`);
		}
		return path;
	}

	private async ensureFolder(path: string = this.settings.folder) {
		const folder = normalizePath(path);
		if (folder === "/" || this.app.vault.getAbstractFileByPath(folder) instanceof TFolder) return;
		// Create parents one level at a time (createFolder is not recursive on every platform).
		let cur = "";
		for (const part of folder.split("/")) {
			cur = cur ? `${cur}/${part}` : part;
			if (this.app.vault.getAbstractFileByPath(cur)) continue;
			try {
				await this.app.vault.createFolder(cur);
			} catch {
				/* already exists (race) */
			}
		}
	}

	// -------------------------------------------------------------------------
	// Article note actions
	// -------------------------------------------------------------------------

	private changeStatus(file: TFile) {
		const current = String(this.app.metadataCache.getFileCache(file)?.frontmatter?.status ?? "");
		new StatusModal(this.app, this.settings.statuses, current, (status) => {
			void this.app.fileManager
				.processFrontMatter(file, (fm: Record<string, unknown>) => {
					fm.status = status;
				})
				.then(() => new Notice(t("notice.statusSet", { status })));
		}).open();
	}

	private async refetchContent(file: TFile) {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm?.url) return new Notice(t("notice.noArticle"));
		const notice = new Notice(t("notice.fetching"), 0);
		try {
			const a = await fetchArticle(String(fm.url), true);
			notice.hide();
			if (!a.contentMarkdown) return new Notice(t("notice.noContent"));
			const block = `${CONTENT_START}\n${a.contentMarkdown}\n${CONTENT_END}`;
			await this.app.vault.process(file, (text) => {
				const start = text.indexOf(CONTENT_START);
				const end = text.indexOf(CONTENT_END);
				if (start !== -1 && end > start) return text.slice(0, start) + block + text.slice(end + CONTENT_END.length);
				return `${text.trimEnd()}\n\n## ${t("note.content")}\n\n${block}\n`;
			});
			new Notice(t("notice.refetched"));
		} catch (e) {
			notice.hide();
			new Notice(t("notice.failed", { error: e instanceof Error ? e.message : String(e) }), 8000);
		}
	}

	private async copyCitation(file: TFile) {
		await navigator.clipboard.writeText(this.citationFor(file));
		new Notice(t("notice.citationCopied"));
	}

	/** Citation in the *current* style, rebuilt from the note's properties. */
	private citationFor(file: TFile): string {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		if (fm.type === "paper") return buildPaperCitation(this.paperFromFrontmatter(file), this.settings.citationStyle);
		if (!fm.url && typeof fm.citation === "string") return fm.citation;
		return buildCitation(
			{
				url: String(fm.url ?? ""),
				canonicalUrl: String(fm.canonical ?? fm.url ?? ""),
				title: String(fm.title ?? file.basename),
				author: String(fm.author ?? ""),
				site: String(fm.site ?? ""),
				published: String(fm.published ?? ""),
				description: "",
				image: "",
				lang: "",
				type: "article",
				doi: "",
				scholarly: false,
			},
			this.settings.citationStyle,
			String(fm.saved ?? today())
		);
	}

	// -------------------------------------------------------------------------
	// Rating, memos, quotes
	// -------------------------------------------------------------------------

	private rate(file: TFile) {
		const current = Number(this.app.metadataCache.getFileCache(file)?.frontmatter?.rating ?? 0) || 0;
		new RatingModal(this.app, current, (n) => {
			void this.app.fileManager
				.processFrontMatter(file, (fm: Record<string, unknown>) => {
					if (n > 0) fm.rating = n;
					else delete fm.rating;
				})
				.then(() => new Notice(n ? t("notice.ratingSet", { stars: stars(n) }) : t("notice.ratingCleared")));
		}).open();
	}

	private sourceItems(): SourceItem[] {
		return this.articleFiles()
			.map((file): SourceItem => {
				const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
				const paper = fm.type === "paper";
				const authors = Array.isArray(fm.authors) ? fm.authors.map(String) : [];
				const who = paper ? (authors.length > 2 ? `${authors[0]} +${authors.length - 1}` : authors.join(", ")) : String(fm.author ?? fm.site ?? "");
				const when = paper ? String(fm.year ?? "") : String(fm.published ?? "").slice(0, 4);
				return {
					file,
					title: String(fm.title ?? file.basename),
					kind: paper ? "paper" : "article",
					byline: [who, paper ? fm.journal : fm.site !== who ? fm.site : "", when].filter(Boolean).join(" · "),
					status: String(fm.status ?? ""),
					rating: Number(fm.rating ?? 0) || 0,
				};
			})
			.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
	}

	/** Use the current note if it is a source, otherwise ask which source. */
	private withSource(placeholder: string, run: (file: TFile) => void) {
		const active = this.activeArticle();
		if (active) return run(active);
		const items = this.sourceItems();
		if (!items.length) return void new Notice(t("notice.noSources"));
		new SourcePickerModal(this.app, items, placeholder, (s) => run(s.file)).open();
	}

	private openEntry(kind: EntryKind) {
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		const selection = editor?.getSelection().trim() ?? "";
		this.withSource(t("pick.source"), (file) => {
			const title = String(this.app.metadataCache.getFileCache(file)?.frontmatter?.title ?? file.basename);
			new EntryModal(this.app, title, { kind, text: kind === "quote" ? selection : "" }, async (r) => {
				const date = today();
				await this.app.vault.process(file, (text) =>
					r.kind === "memo"
						? appendToSection(text, t("note.notes"), memoEntry(r.text, date), { beforeMarker: CONTENT_START })
						: appendToSection(text, t("note.quotes"), quoteEntry(r.text, r.locator, date), { beforeMarker: CONTENT_START, separate: true })
				);
				new Notice(t("notice.entryAdded", { title }));
			}).open();
		});
	}

	// -------------------------------------------------------------------------
	// Citing while writing
	// -------------------------------------------------------------------------

	private insertCitation(editor: Editor, view: MarkdownView | MarkdownFileInfo) {
		const items = this.sourceItems();
		if (!items.length) return void new Notice(t("notice.noSources"));
		const here = view.file?.path ?? "";
		new SourcePickerModal(this.app, items, t("pick.cite"), (s) => {
			const citation = this.citationFor(s.file);
			const link = this.app.fileManager.generateMarkdownLink(s.file, here);
			const arrow = this.app.fileManager.generateMarkdownLink(s.file, here, undefined, "↗");
			switch (this.settings.insertMode) {
				case "citation":
					editor.replaceSelection(citation);
					break;
				case "link":
					editor.replaceSelection(link);
					break;
				case "citation-link":
					editor.replaceSelection(`${citation} ${arrow}`);
					break;
				case "footnote":
				default: {
					const n = nextFootnote(editor.getValue());
					editor.replaceSelection(`[^${n}]`);
					const lastLine = editor.lastLine();
					const lastText = editor.getLine(lastLine);
					const gap = /^\[\^[^\]]+\]:/.test(lastText) ? "\n" : lastText.trim() ? "\n\n" : "\n";
					editor.replaceRange(`${gap}[^${n}]: ${citation} ${arrow}`, { line: lastLine, ch: lastText.length });
				}
			}
		}).open();
	}

	private insertBibliography(editor: Editor, view: MarkdownView | MarkdownFileInfo) {
		const path = view.file?.path;
		if (!path) return;
		const targets = Object.keys(this.app.metadataCache.resolvedLinks[path] ?? {});
		const sources = new Set(this.articleFiles().map((f) => f.path));
		const files = targets
			.filter((p) => sources.has(p))
			.map((p) => this.app.vault.getAbstractFileByPath(p))
			.filter((f): f is TFile => f instanceof TFile);
		if (!files.length) return void new Notice(t("notice.noLinkedSources"), 8000);

		const entries = files.map((f) => this.citationFor(f)).sort((a, b) => a.localeCompare(b, this.settings.citationStyle === "korean" ? "ko" : "en"));
		const block = `## ${this.settings.bibliographyHeading}\n\n${entries.map((e) => `- ${e}`).join("\n")}\n`;
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		editor.replaceSelection(`${lineText.trim() && cursor.ch > 0 ? "\n\n" : ""}${block}`);
		new Notice(t("notice.bibInserted", { n: entries.length }));
	}

	// -------------------------------------------------------------------------
	// Index (.base)
	// -------------------------------------------------------------------------

	private async openIndex() {
		await this.ensureFolder();
		const path = normalizePath(`${this.folderPrefix()}${sanitizeFileName(this.settings.indexFileName)}.base`);
		const existing = this.app.vault.getAbstractFileByPath(path);
		let file: TFile;
		if (existing instanceof TFile) file = existing;
		else {
			file = await this.app.vault.create(path, this.indexYaml());
			new Notice(t("notice.indexCreated"));
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	private indexYaml(): string {
		const ko = this.settings.statuses.includes("읽을 것") || /[가-힣]/.test(this.settings.indexFileName);
		const label = (k: string, e: string) => (ko ? k : e);
		const sort = () => [{ property: "note.saved", direction: "DESC" }];
		const common = ["file.name", "note.type", "note.status", "note.rating", "note.project", "note.tags", "note.saved"];
		const articleCols = ["file.name", "note.site", "note.author", "note.published", "note.status", "note.rating", "note.project", "note.tags", "note.saved"];
		const paperCols = ["file.name", "note.authors", "note.year", "note.journal", "note.cited_by", "note.status", "note.rating", "note.project", "note.pdf", "note.saved"];

		const inFolder = (f: string) => (normalizePath(f) === "/" ? "" : `file.inFolder(${JSON.stringify(normalizePath(f))})`);
		const scope = [inFolder(this.settings.folder), inFolder(this.settings.paperFolder)].filter(Boolean);

		const base = {
			filters: {
				and: [
					'file.ext == "md"',
					scope.length ? { or: [...scope, 'note.type == "article"', 'note.type == "paper"'] } : { or: ['note.type == "article"', 'note.type == "paper"'] },
				],
			},
			properties: {
				"file.name": { displayName: label("제목", "Title") },
				type: { displayName: label("종류", "Type") },
				site: { displayName: label("사이트", "Site") },
				author: { displayName: label("저자", "Author") },
				authors: { displayName: label("저자", "Authors") },
				published: { displayName: label("발행일", "Published") },
				year: { displayName: label("연도", "Year") },
				journal: { displayName: label("학술지", "Journal") },
				cited_by: { displayName: label("피인용", "Cited by") },
				rating: { displayName: label("별점", "Rating") },
				pdf: { displayName: "PDF" },
				status: { displayName: label("상태", "Status") },
				project: { displayName: label("주제/프로젝트", "Project") },
				tags: { displayName: label("태그", "Tags") },
				saved: { displayName: label("저장일", "Saved") },
			},
			views: [
				{ type: "table", name: label("전체", "All"), order: [...common], sort: sort() },
				{ type: "table", name: label("아티클", "Articles"), filters: { and: ['note.type == "article"'] }, order: [...articleCols], sort: sort() },
				{ type: "table", name: label("논문", "Papers"), filters: { and: ['note.type == "paper"'] }, order: [...paperCols], sort: sort() },
				...this.settings.statuses.map((st) => ({
					type: "table",
					name: st,
					filters: { and: [`note.status == ${JSON.stringify(st)}`] },
					order: [...common],
					sort: sort(),
				})),
				{
					type: "cards",
					name: label("카드", "Cards"),
					image: "note.image",
					order: ["file.name", "note.type", "note.site", "note.journal", "note.status"],
					sort: sort(),
				},
			],
		};
		return stringifyYaml(base);
	}

	// -------------------------------------------------------------------------
	// Papers
	// -------------------------------------------------------------------------

	private scholarConfig(): ScholarConfig {
		return { contactEmail: this.settings.contactEmail, openAlexKey: this.settings.openAlexKey, kciKey: this.settings.kciKey };
	}

	private paperOptionsFrom(opts: { tags: string[]; project: string; status: string; rating?: number }): PaperSaveOptions {
		return { tags: opts.tags, project: opts.project, status: opts.status, rating: opts.rating ?? 0, downloadPdf: this.settings.downloadPdf };
	}

	openPaperSearch(initialQuery?: string) {
		new PaperSearchModal(this.app, {
			initialQuery,
			defaultSource: this.settings.paperSource,
			hasKciKey: !!this.settings.kciKey,
			search: (q, source, fromYear) => this.searchOrLookup(q, source, fromYear),
			isSaved: (p) => !!this.findExistingPaper(p),
			onPick: (p) => this.pickPaper(p),
		}).open();
	}

	private async searchOrLookup(q: string, source: PaperSource, fromYear?: number): Promise<Paper[]> {
		const id = detectIdentifier(q);
		const cfg = this.scholarConfig();
		if (id.kind === "doi") return [await lookupDoi(id.value, cfg)].filter((x): x is Paper => !!x);
		if (id.kind === "arxiv") return [await lookupArxiv(id.value, cfg)].filter((x): x is Paper => !!x);
		return searchPapers({ query: q, source, fromYear }, cfg);
	}

	/** From a search hit: fetch the full record, then ask for tags/project/status. */
	private async pickPaper(hit: Paper): Promise<boolean> {
		const existing = this.findExistingPaper(hit);
		if (existing) {
			new Notice(t("notice.duplicate"));
			await this.app.workspace.getLeaf(false).openFile(existing);
			return true;
		}
		const loading = new Notice(t("paper.loading"), 0);
		const paper = await enrichPaper(hit, this.scholarConfig());
		loading.hide();
		return new Promise<boolean>((resolve) => {
			new PaperSaveModal(this.app, {
				paper,
				defaultTags: this.settings.defaultPaperTags,
				statuses: this.settings.statuses,
				defaultStatus: this.settings.defaultStatus,
				defaultDownloadPdf: this.settings.downloadPdf,
				knownTags: this.knownTags,
				knownProjects: this.knownProjects,
				onSubmit: async (opts) => !!(await this.savePaper(paper, opts, undefined, { keepModal: true })),
				onDone: resolve,
			}).open();
		});
	}

	private async savePaperFromInput(input: string) {
		const id = detectIdentifier(input);
		if (id.kind === "query") return this.openPaperSearch(input);
		const loading = new Notice(t("paper.loading"), 0);
		let paper: Paper | null = null;
		try {
			paper = id.kind === "doi" ? await lookupDoi(id.value, this.scholarConfig()) : await lookupArxiv(id.value, this.scholarConfig());
		} catch (e) {
			loading.hide();
			new Notice(t("notice.failed", { error: e instanceof Error ? e.message : String(e) }), 8000);
			return;
		}
		loading.hide();
		if (!paper) return void new Notice(t("paper.notFound"));
		await this.pickPaper(paper);
	}

	private async savePaperFromIdentifier(
		kind: "doi" | "arxiv",
		value: string,
		opts: PaperSaveOptions,
		target?: TFile,
		flags: { quiet?: boolean } = {}
	): Promise<TFile | null> {
		const loading = flags.quiet ? null : new Notice(t("paper.loading"), 0);
		try {
			const paper = kind === "doi" ? await lookupDoi(value, this.scholarConfig()) : await lookupArxiv(value, this.scholarConfig());
			loading?.hide();
			if (!paper) {
				if (!flags.quiet) new Notice(t("paper.notFound"));
				return null;
			}
			return await this.savePaper(paper, opts, target, flags);
		} catch (e) {
			loading?.hide();
			new Notice(t("notice.failed", { error: e instanceof Error ? e.message : String(e) }), 8000);
			return null;
		}
	}

	async savePaper(paper: Paper, opts: PaperSaveOptions, target?: TFile, flags: { quiet?: boolean; keepModal?: boolean } = {}): Promise<TFile | null> {
		const existing = this.findExistingPaper(paper);
		if (existing && !target) {
			if (!flags.quiet) {
				new Notice(t("notice.duplicate"));
				await this.app.workspace.getLeaf(false).openFile(existing);
			}
			return existing;
		}

		let pdfLink = "";
		if (opts.downloadPdf && paper.pdfUrl) {
			pdfLink = (await this.savePdf(paper, flags.quiet)) ?? "";
		}

		const text = this.buildPaperNote(paper, opts, pdfLink);
		const baseName = this.paperFileName(paper);
		let file: TFile;
		await this.ensureFolder(this.settings.paperFolder);
		if (target) {
			this.ownWrites.add(target.path);
			await this.app.vault.process(target, () => text);
			const desired = this.uniquePath(baseName, target.path, this.settings.paperFolder);
			if (desired !== target.path) await this.app.fileManager.renameFile(target, desired);
			file = target;
		} else {
			const path = this.uniquePath(baseName, undefined, this.settings.paperFolder);
			this.ownWrites.add(path);
			file = await this.app.vault.create(path, text);
		}

		if (!flags.quiet) {
			new Notice(t("notice.saved", { title: paper.title }));
			if (this.settings.openAfterSave && !flags.keepModal) await this.app.workspace.getLeaf(false).openFile(file);
			else if (this.settings.openAfterSave) await this.app.workspace.getLeaf("tab").openFile(file, { active: false });
		}
		return file;
	}

	/** Download the open-access PDF; returns a wikilink to it, or the remote URL if the download fails. */
	private async savePdf(paper: Paper, quiet?: boolean): Promise<string | null> {
		try {
			const data = await downloadPdf(paper.pdfUrl, this.scholarConfig());
			if (!data) throw new Error("not a PDF");
			await this.ensureFolder(this.settings.pdfFolder);
			const name = sanitizeFileName(citeKey(paper) || paper.title, 80);
			const path = this.uniquePath(name, undefined, this.settings.pdfFolder, "pdf");
			const file = await this.app.vault.createBinary(path, data);
			return `[[${file.path}|PDF]]`;
		} catch {
			if (!quiet) new Notice(t("paper.pdfFailed"));
			return `[PDF](${paper.pdfUrl})`;
		}
	}

	private paperFileName(p: Paper): string {
		const name = this.settings.paperFileNameTemplate
			.replace(/\{\{title\}\}/g, p.title)
			.replace(/\{\{firstAuthor\}\}/g, firstAuthorFamily(p))
			.replace(/\{\{year\}\}/g, p.year)
			.replace(/\{\{journal\}\}/g, p.journal)
			.replace(/\{\{citekey\}\}/g, citeKey(p))
			.replace(/\(\s*\)/g, "")
			.trim();
		return sanitizeFileName(name);
	}

	private buildPaperNote(p: Paper, opts: PaperSaveOptions, pdfLink: string): string {
		const saved = today();
		const tags = uniq([...splitList(this.settings.defaultPaperTags), ...opts.tags].map(toTag).filter(Boolean));
		const projects = splitList(opts.project);
		const citation = buildPaperCitation(p, this.settings.citationStyle);
		const key = citeKey(p);

		const fm: Record<string, unknown> = {
			title: p.title,
			authors: p.authors.map((a) => a.name),
			year: p.year ? Number(p.year) || p.year : undefined,
			published: p.published || undefined,
			journal: p.journal || undefined,
			volume: p.volume || undefined,
			issue: p.issue || undefined,
			pages: p.pages || undefined,
			publisher: p.publisher || undefined,
			doi: p.doi || undefined,
			arxiv: p.arxivId || undefined,
			url: p.url || (p.doi ? `https://doi.org/${p.doi}` : ""),
			pdf: pdfLink || p.pdfUrl || undefined,
			keywords: p.keywords.length ? p.keywords : undefined,
			cited_by: p.citedBy ?? undefined,
			lang: p.lang || undefined,
			type: "paper",
			kind: p.kind || undefined,
			citekey: key,
			saved,
			status: opts.status || this.settings.defaultStatus,
			rating: opts.rating > 0 ? opts.rating : undefined,
			project: projects,
			tags,
			citation,
		};
		for (const k of Object.keys(fm)) if (fm[k] === undefined) delete fm[k];

		const body = renderTemplate(this.settings.paperTemplate, {
			title: p.title,
			authors: p.authors.map((a) => a.name).join(", "),
			year: p.year,
			journal: p.journal,
			volume: p.volume,
			issue: p.issue,
			pages: p.pages,
			doi: p.doi,
			url: String(fm.url),
			pdf: pdfLink || (p.pdfUrl ? `[PDF](${p.pdfUrl})` : ""),
			abstract: p.abstract,
			keywords: p.keywords.join(", "),
			citedBy: p.citedBy ? String(p.citedBy) : "",
			citation,
			citekey: key,
			tags: tags.map((x) => `#${x}`).join(" "),
			project: projects.join(", "),
			status: String(fm.status),
			rating: stars(opts.rating),
			saved,
		});
		return `---\n${stringifyYaml(fm)}---\n\n${body}`;
	}

	private paperFromFrontmatter(file: TFile): Paper {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const one = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
		const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(one).filter(Boolean) : one(v) ? [one(v)] : []);
		return {
			title: String(fm.title ?? file.basename),
			authors: list(fm.authors ?? fm.author).map((name) => ({ name })),
			year: String(fm.year ?? ""),
			published: String(fm.published ?? ""),
			journal: String(fm.journal ?? ""),
			publisher: String(fm.publisher ?? ""),
			volume: String(fm.volume ?? ""),
			issue: String(fm.issue ?? ""),
			pages: String(fm.pages ?? ""),
			doi: normalizeDoi(String(fm.doi ?? "")),
			arxivId: parseArxivId(String(fm.arxiv ?? "")) || String(fm.arxiv ?? ""),
			url: String(fm.url ?? ""),
			pdfUrl: "",
			abstract: "",
			keywords: list(fm.keywords),
			citedBy: typeof fm.cited_by === "number" ? fm.cited_by : null,
			kind: String(fm.kind ?? ""),
			lang: String(fm.lang ?? ""),
			source: "openalex",
		};
	}

	private async copyBibtex(file: TFile) {
		await navigator.clipboard.writeText(toBibTeX(this.paperFromFrontmatter(file)));
		new Notice(t("paper.bibtexCopied"));
	}

	private async attachPdf(file: TFile) {
		const local = this.paperFromFrontmatter(file);
		const loading = new Notice(t("paper.loading"), 0);
		let paper: Paper | null = local;
		try {
			if (local.doi) paper = (await lookupDoi(local.doi, this.scholarConfig())) ?? local;
			else if (local.arxivId) paper = (await lookupArxiv(local.arxivId, this.scholarConfig())) ?? local;
		} catch {
			/* use what we have */
		}
		loading.hide();
		if (!paper?.pdfUrl) return void new Notice(t("paper.noPdf"));
		const link = await this.savePdf({ ...local, pdfUrl: paper.pdfUrl });
		if (!link) return;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm.pdf = link;
		});
		if (link.startsWith("[[")) new Notice(t("paper.pdfSaved"));
	}
}

/** URLs plus bare DOIs ("10.1234/…") and arXiv ids ("arXiv:2101.00001") found in text. */
function findIdentifiers(text: string): string[] {
	const out = findUrls(text);
	const seenDoi = new Set(out.map((u) => normalizeDoi(u)).filter(Boolean));
	const doiRe = /(?:^|[\s([<"'])(?:doi:\s*)?(10\.\d{4,9}\/[^\s"'<>\])]+)/gi;
	let m: RegExpExecArray | null;
	while ((m = doiRe.exec(text))) {
		const doi = normalizeDoi(m[1]);
		if (doi && !seenDoi.has(doi)) {
			seenDoi.add(doi);
			out.push(`https://doi.org/${doi}`);
		}
	}
	const axRe = /arxiv:\s*(\d{4}\.\d{4,5})/gi;
	while ((m = axRe.exec(text))) {
		const url = `https://arxiv.org/abs/${m[1]}`;
		if (!out.includes(url)) out.push(url);
	}
	return out;
}
