import { App, ButtonComponent, FuzzyMatch, FuzzySuggestModal, Modal, Setting, SuggestModal, TFile, TextAreaComponent } from "obsidian";
import { t } from "./i18n";
import { stars } from "./render";

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

export class RatingModal extends SuggestModal<number> {
	constructor(app: App, private current: number, private onChoose: (n: number) => void) {
		super(app);
		this.setPlaceholder(t("modal.rating"));
	}

	getSuggestions(query: string): number[] {
		const all = [5, 4, 3, 2, 1, 0];
		const n = parseInt(query, 10);
		return !isNaN(n) && n >= 0 && n <= 5 ? [n] : all;
	}

	renderSuggestion(n: number, el: HTMLElement): void {
		el.setText(n ? `${stars(n)}  ${n}` : t("rating.clear"));
		if (n === this.current) el.addClass("articledrop-current");
	}

	onChooseSuggestion(n: number): void {
		this.onChoose(n);
	}
}

// ---------------------------------------------------------------------------
// Memo / quote log window
// ---------------------------------------------------------------------------

export type EntryKind = "memo" | "quote";

export interface EntryResult {
	kind: EntryKind;
	text: string;
	locator: string;
}

export class EntryModal extends Modal {
	private kind: EntryKind;
	private text: string;
	private locator = "";

	constructor(
		app: App,
		private sourceTitle: string,
		init: { kind: EntryKind; text?: string },
		private onSubmit: (r: EntryResult) => Promise<void>
	) {
		super(app);
		this.kind = init.kind;
		this.text = init.text ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText(t("entry.title"));
		contentEl.addClass("articledrop-modal");
		contentEl.createDiv({ text: this.sourceTitle, cls: "articledrop-entry-source" });

		const tabs = contentEl.createDiv({ cls: "articledrop-entry-tabs" });
		const memoBtn = new ButtonComponent(tabs).setButtonText(t("entry.memo"));
		const quoteBtn = new ButtonComponent(tabs).setButtonText(t("entry.quote"));

		let area: TextAreaComponent | undefined;
		const areaSetting = new Setting(contentEl).setClass("articledrop-entry-text");
		areaSetting.addTextArea((ta) => {
			area = ta;
			ta.inputEl.rows = 6;
			ta.setValue(this.text).onChange((v) => (this.text = v));
		});

		const locSetting = new Setting(contentEl)
			.setName(t("entry.locator"))
			.setDesc(t("entry.locatorDesc"))
			.addText((tx) => tx.setPlaceholder("23").onChange((v) => (this.locator = v)));

		const sync = () => {
			memoBtn.buttonEl.toggleClass("mod-cta", this.kind === "memo");
			quoteBtn.buttonEl.toggleClass("mod-cta", this.kind === "quote");
			locSetting.settingEl.toggle(this.kind === "quote");
			area?.setPlaceholder(this.kind === "memo" ? t("entry.memoPlaceholder") : t("entry.quotePlaceholder"));
		};
		memoBtn.onClick(() => {
			this.kind = "memo";
			sync();
		});
		quoteBtn.onClick(() => {
			this.kind = "quote";
			sync();
		});
		sync();

		const submit = async () => {
			if (!this.text.trim()) return area?.inputEl.focus();
			await this.onSubmit({ kind: this.kind, text: this.text, locator: this.locator });
			this.close();
		};
		new Setting(contentEl).setDesc(t("entry.shortcut")).addButton((b) => b.setButtonText(t("entry.add")).setCta().onClick(submit));
		this.scope.register(["Mod"], "Enter", (evt) => {
			evt.preventDefault();
			void submit();
		});

		window.setTimeout(() => area?.inputEl.focus(), 10);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------
// Source picker (articles + papers)
// ---------------------------------------------------------------------------

export interface SourceItem {
	file: TFile;
	title: string;
	kind: "article" | "paper";
	byline: string; // authors / site · year
	status: string;
	rating: number;
}

export class SourcePickerModal extends FuzzySuggestModal<SourceItem> {
	constructor(app: App, private items: SourceItem[], placeholder: string, private onChoose: (s: SourceItem) => void) {
		super(app);
		this.setPlaceholder(placeholder);
		this.limit = 50;
	}

	getItems(): SourceItem[] {
		return this.items;
	}

	getItemText(item: SourceItem): string {
		return `${item.title} ${item.byline}`;
	}

	renderSuggestion(match: FuzzyMatch<SourceItem>, el: HTMLElement): void {
		const s = match.item;
		el.addClass("articledrop-source-item");
		const top = el.createDiv({ cls: "articledrop-source-title" });
		top.createSpan({ text: s.kind === "paper" ? t("kind.paper") : t("kind.article"), cls: "articledrop-badge" });
		top.appendText(" " + s.title);
		const sub = [s.byline, s.status, s.rating ? stars(s.rating) : ""].filter(Boolean).join(" · ");
		if (sub) el.createDiv({ text: sub, cls: "articledrop-result-meta" });
	}

	onChooseItem(item: SourceItem): void {
		this.onChoose(item);
	}
}
