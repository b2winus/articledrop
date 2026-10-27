import { AbstractInputSuggest, App, ButtonComponent, Modal, Setting, SuggestModal, TFolder, TextComponent } from "obsidian";
import { t } from "./i18n";
import { isHttpUrl } from "./extract";
import { rankFolders, splitList, stars } from "./render";
import type { SaveOptions } from "./types";

/** Suggests values for a comma-separated input, completing only the last item. */
export class ListSuggest extends AbstractInputSuggest<string> {
	constructor(app: App, private input: HTMLInputElement, private source: () => string[]) {
		super(app, input);
	}

	protected getSuggestions(query: string): string[] {
		const items = query.split(",");
		const last = (items.pop() ?? "").trim().toLowerCase();
		const chosen = new Set(items.map((s) => s.trim()));
		return this.source()
			.filter((v) => !chosen.has(v) && v.toLowerCase().includes(last))
			.slice(0, 30);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		const items = this.input.value.split(",").map((s) => s.trim());
		items.pop();
		items.push(value);
		const next = items.filter(Boolean).join(", ") + ", ";
		this.setValue(next);
		this.input.dispatchEvent(new Event("input"));
		this.input.focus();
		this.close();
	}
}

/** Lists vault folders whose path contains what was typed (e.g. "설교" → "자료/설교/디도서"). */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, private input: HTMLInputElement) {
		super(app, input);
		this.limit = 50;
	}

	protected getSuggestions(query: string): TFolder[] {
		const folders = new Map<string, TFolder>();
		for (const f of this.app.vault.getAllLoadedFiles()) if (f instanceof TFolder && !f.isRoot()) folders.set(f.path, f);
		return rankFolders([...folders.keys()], query)
			.map((p) => folders.get(p))
			.filter((f): f is TFolder => f instanceof TFolder);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.addClass("articledrop-folder-suggestion");
		el.createDiv({ text: folder.name, cls: "articledrop-folder-name" });
		if (folder.parent && !folder.parent.isRoot()) el.createDiv({ text: folder.parent.path, cls: "articledrop-folder-parent" });
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.input.dispatchEvent(new Event("input"));
		this.close();
	}
}

/** "Folder" field with folder suggestions; empty means the default folder. */
export function addFolderSetting(app: App, container: HTMLElement, defaultFolder: string, onChange: (v: string) => void): Setting {
	return new Setting(container)
		.setName(t("modal.folder"))
		.setDesc(t("modal.folderDesc"))
		.addText((tx) => {
			tx.setPlaceholder(defaultFolder).setValue(defaultFolder).onChange((v) => onChange(v.trim()));
			tx.inputEl.addClass("articledrop-folder-input");
			new FolderSuggest(app, tx.inputEl);
		});
}

/** "Rating" dropdown: — / ★ … ★★★★★ */
export function addRatingSetting(container: HTMLElement, value: number, onChange: (n: number) => void): Setting {
	return new Setting(container).setName(t("modal.rating")).addDropdown((dd) => {
		dd.addOption("0", "—");
		for (let i = 1; i <= 5; i++) dd.addOption(String(i), stars(i));
		dd.setValue(String(value)).onChange((v) => onChange(+v));
	});
}

export interface SaveModalContext {
	url?: string;
	askContent: boolean;
	defaultContent: boolean;
	defaultTags: string;
	statuses: string[];
	defaultStatus: string;
	defaultFolder: string;
	knownTags: () => string[];
	knownProjects: () => string[];
	onSubmit: (opts: SaveOptions) => Promise<boolean>;
}

export class SaveModal extends Modal {
	private opts: SaveOptions;

	constructor(app: App, private ctx: SaveModalContext) {
		super(app);
		this.opts = {
			url: ctx.url ?? "",
			includeContent: ctx.defaultContent,
			tags: [],
			project: "",
			status: ctx.defaultStatus,
			rating: 0,
			folder: ctx.defaultFolder,
		};
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText(t("modal.title"));
		contentEl.addClass("articledrop-modal");

		let urlInput: TextComponent | undefined;
		new Setting(contentEl).setName(t("modal.url")).addText((tx) => {
			urlInput = tx;
			tx.setPlaceholder(t("modal.urlPlaceholder"))
				.setValue(this.opts.url)
				.onChange((v) => (this.opts.url = v.trim()));
			tx.inputEl.addClass("articledrop-url");
		});

		if (this.ctx.askContent) {
			new Setting(contentEl)
				.setName(t("modal.content"))
				.setDesc(t("modal.contentDesc"))
				.addToggle((tg) => tg.setValue(this.opts.includeContent).onChange((v) => (this.opts.includeContent = v)));
		}

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
				tx.onChange((v) => (this.opts.project = v));
				new ListSuggest(this.app, tx.inputEl, this.ctx.knownProjects);
			});

		new Setting(contentEl).setName(t("modal.status")).addDropdown((dd) => {
			for (const st of this.ctx.statuses) dd.addOption(st, st);
			dd.setValue(this.opts.status).onChange((v) => (this.opts.status = v));
		});

		addRatingSetting(contentEl, this.opts.rating, (n) => (this.opts.rating = n));
		addFolderSetting(this.app, contentEl, this.ctx.defaultFolder, (v) => (this.opts.folder = v));

		let button: ButtonComponent | undefined;
		const submit = async () => {
			if (!isHttpUrl(this.opts.url)) {
				urlInput?.inputEl.addClass("articledrop-invalid");
				urlInput?.inputEl.focus();
				return;
			}
			button?.setDisabled(true).setButtonText(t("modal.saving"));
			this.opts.tags = splitList(tagsValue);
			const ok = await this.ctx.onSubmit({ ...this.opts, url: this.opts.url.trim() });
			if (ok) this.close();
			else button?.setDisabled(false).setButtonText(t("modal.save"));
		};

		new Setting(contentEl).addButton((b) => {
			button = b;
			b.setButtonText(t("modal.save")).setCta().onClick(submit);
		});

		this.scope.register([], "Enter", (evt) => {
			if ((evt.target as HTMLElement)?.tagName === "TEXTAREA") return;
			if (activeDocument.querySelector(".suggestion-container")) return; // let the suggest pick
			evt.preventDefault();
			void submit();
		});

		window.setTimeout(() => (this.opts.url ? null : urlInput?.inputEl.focus()), 10);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------

export interface BatchItem {
	url: string;
	existing: boolean;
	selected: boolean;
}

export interface BatchModalContext {
	items: BatchItem[];
	askContent: boolean;
	defaultContent: boolean;
	defaultTags: string;
	statuses: string[];
	defaultStatus: string;
	defaultFolder: string;
	knownTags: () => string[];
	knownProjects: () => string[];
	onSubmit: (urls: string[], opts: Omit<SaveOptions, "url">) => void;
}

export class BatchModal extends Modal {
	constructor(app: App, private ctx: BatchModalContext) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText(t("batch.title"));
		contentEl.addClass("articledrop-modal");
		const items = this.ctx.items;

		if (!items.length) {
			contentEl.createEl("p", { text: t("batch.none") });
			return;
		}

		contentEl.createEl("p", {
			text: t("batch.found", { n: items.length, d: items.filter((i) => i.existing).length }),
			cls: "setting-item-description",
		});

		const list = contentEl.createDiv({ cls: "articledrop-batch-list" });
		const boxes: HTMLInputElement[] = [];
		const selectAll = contentEl.createEl("label", { cls: "articledrop-batch-all" });
		const allBox = selectAll.createEl("input", { type: "checkbox" });
		selectAll.appendText(" " + t("batch.selectAll"));
		list.before(selectAll);

		for (const item of items) {
			const row = list.createEl("label", { cls: "articledrop-batch-row" });
			const box = row.createEl("input", { type: "checkbox" });
			box.checked = item.selected;
			box.addEventListener("change", () => (item.selected = box.checked));
			boxes.push(box);
			row.createSpan({ text: item.url, cls: "articledrop-batch-url" });
			if (item.existing) row.createSpan({ text: t("batch.already"), cls: "articledrop-badge" });
		}
		allBox.checked = items.every((i) => i.selected);
		allBox.addEventListener("change", () => {
			items.forEach((i, idx) => {
				i.selected = allBox.checked;
				boxes[idx].checked = allBox.checked;
			});
		});

		let includeContent = this.ctx.defaultContent;
		if (this.ctx.askContent) {
			new Setting(contentEl)
				.setName(t("modal.content"))
				.setDesc(t("modal.contentDesc"))
				.addToggle((tg) => tg.setValue(includeContent).onChange((v) => (includeContent = v)));
		}

		let tags = "";
		new Setting(contentEl).setName(t("modal.tags")).addText((tx) => {
			tx.setPlaceholder(this.ctx.defaultTags).onChange((v) => (tags = v));
			new ListSuggest(this.app, tx.inputEl, this.ctx.knownTags);
		});

		let project = "";
		new Setting(contentEl).setName(t("modal.project")).addText((tx) => {
			tx.onChange((v) => (project = v));
			new ListSuggest(this.app, tx.inputEl, this.ctx.knownProjects);
		});

		let folder = this.ctx.defaultFolder;
		addFolderSetting(this.app, contentEl, this.ctx.defaultFolder, (v) => (folder = v));

		let status = this.ctx.defaultStatus;
		new Setting(contentEl).setName(t("modal.status")).addDropdown((dd) => {
			for (const st of this.ctx.statuses) dd.addOption(st, st);
			dd.setValue(status).onChange((v) => (status = v));
		});

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText(t("batch.start"))
				.setCta()
				.onClick(() => {
					const urls = items.filter((i) => i.selected).map((i) => i.url);
					if (!urls.length) return;
					this.close();
					this.ctx.onSubmit(urls, { includeContent, tags: splitList(tags), project, status, rating: 0, folder });
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------

export class StatusModal extends SuggestModal<string> {
	constructor(app: App, private statuses: string[], private current: string, private onChoose: (s: string) => void) {
		super(app);
		this.setPlaceholder(t("modal.status"));
	}

	getSuggestions(query: string): string[] {
		const q = query.toLowerCase();
		return this.statuses.filter((s) => s.toLowerCase().includes(q));
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
		if (value === this.current) el.addClass("articledrop-current");
	}

	onChooseSuggestion(item: string): void {
		this.onChoose(item);
	}
}

