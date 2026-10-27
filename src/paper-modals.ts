import { App, ButtonComponent, DropdownComponent, Modal, Setting, TextComponent, setIcon } from "obsidian";
import { t } from "./i18n";
import { ListSuggest, addRatingSetting } from "./modals";
import { splitList } from "./render";
import type { Paper, PaperSaveOptions, PaperSource } from "./types";

export interface PaperSearchContext {
	initialQuery?: string;
	defaultSource: PaperSource;
	hasKciKey: boolean;
	search: (query: string, source: PaperSource, fromYear?: number) => Promise<Paper[]>;
	isSaved: (p: Paper) => boolean;
	/** Called when the user picks a result. Resolve true when it was saved. */
	onPick: (p: Paper) => Promise<boolean>;
}

const SOURCES: [PaperSource, string][] = [
	["openalex", "OpenAlex"],
	["crossref", "Crossref"],
	["arxiv", "arXiv"],
	["kci", "KCI"],
];

export class PaperSearchModal extends Modal {
	private query = "";
	private source: PaperSource;
	private fromYear = "";
	private resultsEl!: HTMLElement;
	private busy = false;

	constructor(app: App, private ctx: PaperSearchContext) {
		super(app);
		this.query = ctx.initialQuery ?? "";
		this.source = ctx.defaultSource === "kci" && !ctx.hasKciKey ? "openalex" : ctx.defaultSource;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText(t("paper.searchTitle"));
		this.modalEl.addClass("articledrop-paper-search");

		const bar = contentEl.createDiv({ cls: "articledrop-search-bar" });
		const input = new TextComponent(bar).setPlaceholder(t("paper.queryPlaceholder")).setValue(this.query);
		input.inputEl.addClass("articledrop-search-input");
		input.onChange((v) => (this.query = v));

		const opts = contentEl.createDiv({ cls: "articledrop-search-options" });
		opts.createSpan({ text: t("paper.source"), cls: "articledrop-label" });
		const dd = new DropdownComponent(opts);
		for (const [id, label] of SOURCES) dd.addOption(id, label);
		dd.setValue(this.source).onChange((v) => {
			this.source = v as PaperSource;
			if (this.source === "kci" && !this.ctx.hasKciKey) this.showMessage(t("paper.kciNoKey"));
		});

		opts.createSpan({ text: t("paper.fromYear"), cls: "articledrop-label" });
		const year = new TextComponent(opts).setPlaceholder("2015").setValue(this.fromYear);
		year.inputEl.type = "number";
		year.inputEl.addClass("articledrop-year");
		year.onChange((v) => (this.fromYear = v));

		new ButtonComponent(opts).setButtonText(t("paper.search")).setCta().onClick(() => void this.run());

		this.resultsEl = contentEl.createDiv({ cls: "articledrop-results" });

		this.scope.register([], "Enter", (evt) => {
			evt.preventDefault();
			const result = (evt.target as HTMLElement | null)?.closest?.(".articledrop-result");
			if (result instanceof HTMLElement) result.click();
			else void this.run();
		});

		window.setTimeout(() => input.inputEl.focus(), 10);
		if (this.query.trim()) void this.run();
	}

	private showMessage(text: string) {
		this.resultsEl.empty();
		this.resultsEl.createDiv({ text, cls: "articledrop-empty" });
	}

	private async run() {
		const q = this.query.trim();
		if (!q || this.busy) return;
		if (this.source === "kci" && !this.ctx.hasKciKey) return this.showMessage(t("paper.kciNoKey"));
		this.busy = true;
		this.showMessage(t("paper.searching"));
		try {
			const y = parseInt(this.fromYear, 10);
			const results = await this.ctx.search(q, this.source, isNaN(y) ? undefined : y);
			this.render(results);
		} catch (e) {
			this.showMessage(t("paper.searchFailed", { error: e instanceof Error ? e.message : String(e) }));
		} finally {
			this.busy = false;
		}
	}

	private render(results: Paper[]) {
		this.resultsEl.empty();
		if (!results.length) return this.showMessage(t("paper.noResults"));

		for (const p of results) {
			const item = this.resultsEl.createDiv({ cls: "articledrop-result" });
			item.setAttr("tabindex", "0");
			item.createDiv({ text: p.title, cls: "articledrop-result-title" });

			const authors = p.authors.map((a) => a.name);
			const who = authors.length > 4 ? `${authors.slice(0, 3).join(", ")} +${authors.length - 3}` : authors.join(", ");
			const line = [who, p.year, p.journal].filter(Boolean).join(" · ");
			if (line) item.createDiv({ text: line, cls: "articledrop-result-meta" });

			const badges = item.createDiv({ cls: "articledrop-result-badges" });
			if (p.pdfUrl) badges.createSpan({ text: t("paper.oa"), cls: "articledrop-badge articledrop-badge-oa" });
			if (p.citedBy) badges.createSpan({ text: t("paper.citedBy", { n: p.citedBy }), cls: "articledrop-badge" });
			if (p.doi) badges.createSpan({ text: `DOI ${p.doi}`, cls: "articledrop-badge articledrop-badge-muted" });
			const savedBadge = badges.createSpan({ cls: "articledrop-badge articledrop-badge-saved" });
			const markSaved = () => {
				savedBadge.empty();
				setIcon(savedBadge.createSpan(), "check");
				savedBadge.appendText(" " + t("paper.saved"));
				item.addClass("is-saved");
			};
			if (this.ctx.isSaved(p)) markSaved();

			if (p.abstract) {
				const snippet = p.abstract.length > 260 ? `${p.abstract.slice(0, 260)}…` : p.abstract;
				item.createDiv({ text: snippet, cls: "articledrop-result-abstract" });
			}

			const pick = async () => {
				if (item.hasClass("is-busy")) return;
				item.addClass("is-busy");
				try {
					if (await this.ctx.onPick(p)) markSaved();
				} finally {
					item.removeClass("is-busy");
				}
			};
			item.addEventListener("click", () => void pick());
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------

export interface PaperSaveContext {
	paper: Paper;
	defaultTags: string;
	statuses: string[];
	defaultStatus: string;
	defaultDownloadPdf: boolean;
	knownTags: () => string[];
	knownProjects: () => string[];
	onSubmit: (opts: PaperSaveOptions) => Promise<boolean>;
	onDone?: (saved: boolean) => void;
}

export class PaperSaveModal extends Modal {
	private saved = false;

	constructor(app: App, private ctx: PaperSaveContext) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		const p = this.ctx.paper;
		this.titleEl.setText(t("paper.saveTitle"));
		contentEl.addClass("articledrop-modal");

		const head = contentEl.createDiv({ cls: "articledrop-paper-head" });
		head.createDiv({ text: p.title, cls: "articledrop-result-title" });
		const meta = [p.authors.map((a) => a.name).slice(0, 6).join(", "), p.year, p.journal].filter(Boolean).join(" · ");
		if (meta) head.createDiv({ text: meta, cls: "articledrop-result-meta" });

		const opts: PaperSaveOptions = {
			tags: [],
			project: "",
			status: this.ctx.defaultStatus,
			rating: 0,
			downloadPdf: this.ctx.defaultDownloadPdf && !!p.pdfUrl,
		};

		let tagsValue = "";
		new Setting(contentEl)
			.setName(t("modal.tags"))
			.setDesc(t("modal.tagsDesc"))
			.addText((tx) => {
				tx.setPlaceholder(this.ctx.defaultTags).onChange((v) => (tagsValue = v));
				new ListSuggest(this.app, tx.inputEl, this.ctx.knownTags);
			});

		new Setting(contentEl)
			.setName(t("modal.project"))
			.setDesc(t("modal.projectDesc"))
			.addText((tx) => {
				tx.onChange((v) => (opts.project = v));
				new ListSuggest(this.app, tx.inputEl, this.ctx.knownProjects);
				window.setTimeout(() => tx.inputEl.focus(), 10);
			});

		new Setting(contentEl).setName(t("modal.status")).addDropdown((dd) => {
			for (const st of this.ctx.statuses) dd.addOption(st, st);
			dd.setValue(opts.status).onChange((v) => (opts.status = v));
		});

		addRatingSetting(contentEl, 0, (n) => (opts.rating = n));

		new Setting(contentEl)
			.setName(t("paper.downloadPdf"))
			.setDesc(p.pdfUrl ? t("paper.downloadPdfDesc") : t("paper.noPdf"))
			.addToggle((tg) => {
				tg.setValue(opts.downloadPdf).onChange((v) => (opts.downloadPdf = v));
				tg.setDisabled(!p.pdfUrl);
			});

		let button: ButtonComponent | undefined;
		const submit = async () => {
			button?.setDisabled(true).setButtonText(t("modal.saving"));
			opts.tags = splitList(tagsValue);
			const ok = await this.ctx.onSubmit(opts);
			if (ok) {
				this.saved = true;
				this.close();
			} else button?.setDisabled(false).setButtonText(t("modal.save"));
		};
		new Setting(contentEl).addButton((b) => {
			button = b;
			b.setButtonText(t("modal.save")).setCta().onClick(submit);
		});
		this.scope.register([], "Enter", (evt) => {
			if (activeDocument.querySelector(".suggestion-container")) return;
			evt.preventDefault();
			void submit();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		this.ctx.onDone?.(this.saved);
	}
}

// ---------------------------------------------------------------------------

export class IdentifierModal extends Modal {
	constructor(app: App, private onSubmit: (value: string) => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(t("paper.idTitle"));
		let value = "";
		const go = () => {
			if (!value.trim()) return;
			this.close();
			this.onSubmit(value.trim());
		};
		new Setting(this.contentEl).setName(t("paper.idLabel")).addText((tx) => {
			tx.setPlaceholder(t("paper.idPlaceholder")).onChange((v) => (value = v));
			tx.inputEl.addClass("articledrop-url");
			window.setTimeout(() => tx.inputEl.focus(), 10);
		});
		new Setting(this.contentEl).addButton((b) => b.setButtonText(t("modal.save")).setCta().onClick(go));
		this.scope.register([], "Enter", (evt) => {
			evt.preventDefault();
			go();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
