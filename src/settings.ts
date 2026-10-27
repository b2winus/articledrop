import { App, PluginSettingTab, Setting, SettingDefinitionItem, SettingGroupItem, normalizePath } from "obsidian";
import type ArticledropPlugin from "./main";
import { lang, t } from "./i18n";
import { FolderSuggest } from "./modals";
import { splitList } from "./render";
import type { ArticledropSettings } from "./types";

export function defaultBodyTemplate(): string {
	return [
		`> [!abstract] {{site}}{{#author}} · {{author}}{{/author}}{{#published}} · {{published}}{{/published}}{{#rating}} · {{rating}}{{/rating}}`,
		`{{#description}}> {{description}}`,
		`>`,
		`{{/description}}> [${t("note.original")}]({{url}})`,
		``,
		`## ${t("note.citation")}`,
		`{{citation}}`,
		``,
		`## ${t("note.notes")}`,
		`- `,
		``,
		`## ${t("note.quotes")}`,
		`> `,
		``,
		`{{#content}}## ${t("note.content")}`,
		``,
		`{{content}}`,
		`{{/content}}`,
	].join("\n");
}

export function defaultPaperTemplate(): string {
	return [
		`> [!abstract] {{journal}}{{#volume}} {{volume}}{{/volume}}{{#issue}}({{issue}}){{/issue}}{{#year}} · {{year}}{{/year}}{{#citedBy}} · ${t("paper.citedByLabel")} {{citedBy}}{{/citedBy}}{{#rating}} · {{rating}}{{/rating}}`,
		`> {{authors}}`,
		`>`,
		`> [${t("note.link")}]({{url}}){{#pdf}} · {{pdf}}{{/pdf}}`,
		``,
		`{{#abstract}}## ${t("note.abstract")}`,
		`{{abstract}}`,
		``,
		`{{/abstract}}## ${t("note.citation")}`,
		`{{citation}}`,
		``,
		`## ${t("note.notes")}`,
		`- `,
		``,
		`## ${t("note.quotes")}`,
		`> `,
	].join("\n");
}

export function defaultSettings(): ArticledropSettings {
	const ko = lang() === "ko";
	return {
		folder: ko ? "자료" : "Sources",
		fileNameTemplate: "{{title}}",
		contentMode: "ask",
		citationStyle: ko ? "korean" : "chicago",
		statuses: ko ? ["읽을 것", "읽는 중", "읽음", "활용함"] : ["to-read", "reading", "read", "used"],
		defaultStatus: ko ? "읽을 것" : "to-read",
		defaultTags: "article",
		bodyTemplate: defaultBodyTemplate(),
		openAfterSave: true,
		batchLinkBack: false,
		convertSharedNotes: false,
		indexFileName: ko ? "자료 목록" : "Research index",
		language: "auto",
		insertMode: "footnote",
		clipperMode: "ask",
		clipperFolder: "Clippings",
		bibliographyHeading: t("note.bibliography"),

		paperFileNameTemplate: "{{firstAuthor}} ({{year}}) {{title}}",
		paperTemplate: defaultPaperTemplate(),
		paperSource: "openalex",
		contactEmail: "",
		openAlexKey: "",
		kciKey: "",
		downloadPdf: true,
		pdfFolder: ko ? "자료/PDF" : "Sources/PDF",
		defaultPaperTags: "paper",
	};
}

type Key = Extract<keyof ArticledropSettings, string>;

/** One description of every setting, rendered declaratively (Obsidian 1.13+) or imperatively (older). */
type Spec =
	| { kind: "heading"; name: string }
	| { kind: "info"; name: string; desc?: string }
	| { kind: "text"; key: Key; name: string; desc?: string; secret?: boolean }
	| { kind: "folder"; key: "folder" | "pdfFolder" | "clipperFolder"; name: string; desc?: string }
	| { kind: "toggle"; key: Key; name: string; desc?: string }
	| { kind: "dropdown"; key: Key; name: string; desc?: string; options: Record<string, string> }
	| { kind: "template"; key: "bodyTemplate" | "paperTemplate"; name: string; desc: string; rows: number; reset: () => string };

export class ArticledropSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ArticledropPlugin) {
		super(app, plugin);
	}

	private specs(): Spec[] {
		return [
			{ kind: "folder", key: "folder", name: t("set.folder"), desc: t("set.folderDesc") },
			{ kind: "text", key: "fileNameTemplate", name: t("set.fileName"), desc: t("set.fileNameDesc") },
			{
				kind: "dropdown",
				key: "contentMode",
				name: t("set.contentMode"),
				desc: t("set.contentModeDesc"),
				options: { ask: t("set.contentAsk"), full: t("set.contentFull"), metadata: t("set.contentMeta") },
			},
			{ kind: "toggle", key: "openAfterSave", name: t("set.openAfter") },
			{
				kind: "dropdown",
				key: "language",
				name: t("set.language"),
				desc: t("set.languageDesc"),
				options: { auto: t("set.langAuto"), ko: "한국어", en: "English" },
			},

			{ kind: "heading", name: t("set.organize") },
			{ kind: "text", key: "defaultTags", name: t("set.defaultTags"), desc: t("set.defaultTagsDesc") },
			{ kind: "text", key: "statuses", name: t("set.statuses"), desc: t("set.statusesDesc") },
			{ kind: "text", key: "defaultStatus", name: t("set.defaultStatus") },

			{ kind: "heading", name: t("set.citation") },
			{
				kind: "dropdown",
				key: "citationStyle",
				name: t("set.citationStyle"),
				options: { korean: t("set.citationKorean"), chicago: "Chicago", sbl: "SBL (2nd ed.)", apa: "APA 7", mla: "MLA 9" },
			},

			{ kind: "heading", name: t("set.template") },
			{ kind: "template", key: "bodyTemplate", name: t("set.bodyTemplate"), desc: t("set.bodyTemplateDesc"), rows: 16, reset: defaultBodyTemplate },

			{ kind: "heading", name: t("set.collect") },
			{ kind: "toggle", key: "batchLinkBack", name: t("set.batchLinkBack"), desc: t("set.batchLinkBackDesc") },
			{ kind: "toggle", key: "convertSharedNotes", name: t("set.convertShared"), desc: t("set.convertSharedDesc") },
			{ kind: "info", name: t("set.mobile"), desc: t("set.mobileDesc") },

			{ kind: "heading", name: t("set.clipper") },
			{ kind: "info", name: t("set.clipperIntro") },
			{
				kind: "dropdown",
				key: "clipperMode",
				name: t("set.clipperMode"),
				desc: t("set.clipperModeDesc"),
				options: { ask: t("set.clipperAsk"), auto: t("set.clipperAuto"), off: t("set.clipperOff") },
			},
			{ kind: "folder", key: "clipperFolder", name: t("set.clipperFolder"), desc: t("set.clipperFolderDesc") },

			{ kind: "heading", name: t("set.papers") },
			{ kind: "info", name: t("paper.hint") },
			{ kind: "text", key: "paperFileNameTemplate", name: t("set.paperFileName"), desc: t("set.paperFileNameDesc") },
			{ kind: "text", key: "defaultPaperTags", name: t("set.defaultPaperTags") },
			{
				kind: "dropdown",
				key: "paperSource",
				name: t("set.paperSource"),
				options: { openalex: "OpenAlex", crossref: "Crossref", arxiv: "arXiv", kci: "KCI" },
			},
			{ kind: "toggle", key: "downloadPdf", name: t("set.downloadPdf") },
			{ kind: "folder", key: "pdfFolder", name: t("set.pdfFolder") },
			{ kind: "text", key: "contactEmail", name: t("set.email"), desc: t("set.emailDesc") },
			{ kind: "text", key: "openAlexKey", name: t("set.openAlexKey"), desc: t("set.openAlexKeyDesc"), secret: true },
			{ kind: "text", key: "kciKey", name: t("set.kciKey"), desc: t("set.kciKeyDesc"), secret: true },
			{ kind: "template", key: "paperTemplate", name: t("set.paperTemplate"), desc: t("set.paperTemplateDesc"), rows: 14, reset: defaultPaperTemplate },

			{ kind: "heading", name: t("set.writing") },
			{
				kind: "dropdown",
				key: "insertMode",
				name: t("set.insertMode"),
				desc: t("set.insertModeDesc"),
				options: {
					footnote: t("set.insertFootnote"),
					citation: t("set.insertCitation"),
					link: t("set.insertLink"),
					"citation-link": t("set.insertCitationLink"),
				},
			},
			{ kind: "text", key: "bibliographyHeading", name: t("set.bibHeading") },

			{ kind: "heading", name: t("set.index") },
			{ kind: "text", key: "indexFileName", name: t("set.indexName"), desc: t("set.indexNameDesc") },
		];
	}

	// --- values -----------------------------------------------------------------

	getControlValue(key: string): unknown {
		const s = this.plugin.settings;
		if (key === "statuses") return s.statuses.join(", ");
		return (s as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings;
		const text = typeof value === "string" ? value.trim() : "";
		const defaults = defaultSettings();
		switch (key) {
			case "folder":
			case "pdfFolder":
			case "clipperFolder":
				s[key] = normalizePath(text || defaults[key]);
				break;
			case "statuses": {
				const items = splitList(text);
				if (items.length) s.statuses = items;
				if (!s.statuses.includes(s.defaultStatus)) s.defaultStatus = s.statuses[0];
				break;
			}
			case "fileNameTemplate":
			case "paperFileNameTemplate":
			case "indexFileName":
			case "bibliographyHeading":
				s[key] = text || defaults[key];
				break;
			case "bodyTemplate":
			case "paperTemplate":
				s[key] = typeof value === "string" ? value : defaults[key];
				break;
			default: {
				const record = s as unknown as Record<string, unknown>;
				const current = record[key];
				if (typeof current === "boolean") record[key] = value === true;
				else if (typeof current === "string") record[key] = typeof value === "string" ? value.trim() : current;
			}
		}
		await this.plugin.saveSettings();
	}

	private textValue(key: string): string {
		const v = this.getControlValue(key);
		return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
	}

	// --- shared imperative pieces -------------------------------------------------

	private renderTemplate(setting: Setting, spec: Extract<Spec, { kind: "template" }>) {
		setting.setName(spec.name).setDesc(spec.desc);
		setting.settingEl.addClass("articledrop-template-setting");
		setting.addTextArea((ta) => {
			ta.inputEl.rows = spec.rows;
			ta.inputEl.addClass("articledrop-template");
			ta.setValue(this.plugin.settings[spec.key]).onChange((v) => void this.setControlValue(spec.key, v));
			setting.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip(t("set.resetTemplate"))
					.onClick(() => {
						const fresh = spec.reset();
						ta.setValue(fresh);
						void this.setControlValue(spec.key, fresh);
					})
			);
		});
	}

	private renderSecret(setting: Setting, spec: Extract<Spec, { kind: "text" }>) {
		setting.setName(spec.name);
		if (spec.desc) setting.setDesc(spec.desc);
		setting.addText((tx) => {
			tx.inputEl.type = "password";
			tx.setValue(this.textValue(spec.key)).onChange((v) => void this.setControlValue(spec.key, v));
		});
	}

	// --- Obsidian 1.13+: declarative settings (searchable) ------------------------

	getSettingDefinitions(): SettingDefinitionItem[] {
		const groups: SettingDefinitionItem[] = [];
		let items: SettingGroupItem[] = [];
		let heading = "";
		const flush = () => {
			if (items.length) groups.push({ type: "group", heading: heading || undefined, items });
			items = [];
		};

		for (const spec of this.specs()) {
			switch (spec.kind) {
				case "heading":
					flush();
					heading = spec.name;
					break;
				case "info":
					items.push({ name: spec.name, desc: spec.desc, searchable: false });
					break;
				case "toggle":
					items.push({ name: spec.name, desc: spec.desc, control: { type: "toggle", key: spec.key } });
					break;
				case "dropdown":
					items.push({ name: spec.name, desc: spec.desc, control: { type: "dropdown", key: spec.key, options: spec.options } });
					break;
				case "text":
					if (spec.secret) items.push({ name: spec.name, desc: spec.desc, render: (setting) => this.renderSecret(setting, spec) });
					else items.push({ name: spec.name, desc: spec.desc, control: { type: "text", key: spec.key } });
					break;
				case "folder":
					items.push({ name: spec.name, desc: spec.desc, control: { type: "folder", key: spec.key } });
					break;
				case "template":
					items.push({ name: spec.name, desc: spec.desc, render: (setting) => this.renderTemplate(setting, spec) });
					break;
			}
		}
		flush();
		return groups;
	}

	// --- Older Obsidian: imperative fallback -------------------------------------

	/** Fallback for Obsidian < 1.13, which has no getSettingDefinitions(). */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const spec of this.specs()) {
			const setting = new Setting(containerEl);
			switch (spec.kind) {
				case "heading":
					setting.setName(spec.name).setHeading();
					break;
				case "info":
					setting.setName(spec.name);
					if (spec.desc) setting.setDesc(spec.desc);
					break;
				case "toggle":
					setting.setName(spec.name);
					if (spec.desc) setting.setDesc(spec.desc);
					setting.addToggle((tg) => tg.setValue(this.getControlValue(spec.key) === true).onChange((v) => void this.setControlValue(spec.key, v)));
					break;
				case "dropdown":
					setting.setName(spec.name);
					if (spec.desc) setting.setDesc(spec.desc);
					setting.addDropdown((dd) =>
						dd
							.addOptions(spec.options)
							.setValue(this.textValue(spec.key))
							.onChange((v) => void this.setControlValue(spec.key, v))
					);
					break;
				case "text":
					if (spec.secret) {
						this.renderSecret(setting, spec);
						break;
					}
					setting.setName(spec.name);
					if (spec.desc) setting.setDesc(spec.desc);
					setting.addText((tx) => tx.setValue(this.textValue(spec.key)).onChange((v) => void this.setControlValue(spec.key, v)));
					break;
				case "folder":
					setting.setName(spec.name);
					if (spec.desc) setting.setDesc(spec.desc);
					setting.addText((tx) => {
						tx.setValue(this.textValue(spec.key)).onChange((v) => void this.setControlValue(spec.key, v));
						new FolderSuggest(this.app, tx.inputEl);
					});
					break;
				case "template":
					this.renderTemplate(setting, spec);
					break;
			}
		}
	}
}
