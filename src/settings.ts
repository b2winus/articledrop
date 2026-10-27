import { App, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type ArticledropPlugin from "./main";
import { lang, t } from "./i18n";
import { splitList } from "./render";
import type { ArticledropSettings, CitationStyle, ContentMode, InsertMode, PaperSource } from "./types";

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
		folder: ko ? "아티클" : "Articles",
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
		bibliographyHeading: t("note.bibliography"),

		paperFolder: ko ? "논문" : "Papers",
		paperFileNameTemplate: "{{firstAuthor}} ({{year}}) {{title}}",
		paperTemplate: defaultPaperTemplate(),
		paperSource: "openalex",
		contactEmail: "",
		openAlexKey: "",
		kciKey: "",
		downloadPdf: true,
		pdfFolder: ko ? "논문/PDF" : "Papers/PDF",
		defaultPaperTags: "paper",
	};
}

export class ArticledropSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ArticledropPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		// General ------------------------------------------------------------
		new Setting(containerEl)
			.setName(t("set.folder"))
			.setDesc(t("set.folderDesc"))
			.addText((tx) =>
				tx.setValue(s.folder).onChange(async (v) => {
					s.folder = normalizePath(v.trim() || "/");
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("set.fileName"))
			.setDesc(t("set.fileNameDesc"))
			.addText((tx) =>
				tx.setValue(s.fileNameTemplate).onChange(async (v) => {
					s.fileNameTemplate = v.trim() || "{{title}}";
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("set.contentMode"))
			.setDesc(t("set.contentModeDesc"))
			.addDropdown((dd) =>
				dd
					.addOption("ask", t("set.contentAsk"))
					.addOption("full", t("set.contentFull"))
					.addOption("metadata", t("set.contentMeta"))
					.setValue(s.contentMode)
					.onChange(async (v) => {
						s.contentMode = v as ContentMode;
						await save();
					})
			);

		new Setting(containerEl).setName(t("set.openAfter")).addToggle((tg) =>
			tg.setValue(s.openAfterSave).onChange(async (v) => {
				s.openAfterSave = v;
				await save();
			})
		);

		new Setting(containerEl)
			.setName(t("set.language"))
			.setDesc(t("set.languageDesc"))
			.addDropdown((dd) =>
				dd
					.addOption("auto", t("set.langAuto"))
					.addOption("ko", "한국어")
					.addOption("en", "English")
					.setValue(s.language)
					.onChange(async (v) => {
						s.language = v as ArticledropSettings["language"];
						await save();
					})
			);

		// Organize -----------------------------------------------------------
		new Setting(containerEl).setName(t("set.organize")).setHeading();

		new Setting(containerEl)
			.setName(t("set.defaultTags"))
			.setDesc(t("set.defaultTagsDesc"))
			.addText((tx) =>
				tx.setValue(s.defaultTags).onChange(async (v) => {
					s.defaultTags = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("set.statuses"))
			.setDesc(t("set.statusesDesc"))
			.addText((tx) =>
				tx.setValue(s.statuses.join(", ")).onChange(async (v) => {
					const list = splitList(v);
					if (list.length) s.statuses = list;
					if (!s.statuses.includes(s.defaultStatus)) s.defaultStatus = s.statuses[0];
					await save();
				})
			);

		new Setting(containerEl).setName(t("set.defaultStatus")).addText((tx) =>
			tx.setValue(s.defaultStatus).onChange(async (v) => {
				s.defaultStatus = v.trim();
				await save();
			})
		);

		// Citation -----------------------------------------------------------
		new Setting(containerEl).setName(t("set.citation")).setHeading();

		new Setting(containerEl).setName(t("set.citationStyle")).addDropdown((dd) =>
			dd
				.addOption("korean", t("set.citationKorean"))
				.addOption("chicago", "Chicago")
				.addOption("sbl", "SBL (2nd ed.)")
				.addOption("apa", "APA 7")
				.addOption("mla", "MLA 9")
				.setValue(s.citationStyle)
				.onChange(async (v) => {
					s.citationStyle = v as CitationStyle;
					await save();
				})
		);

		// Template -----------------------------------------------------------
		new Setting(containerEl).setName(t("set.template")).setHeading();

		const tplSetting = new Setting(containerEl)
			.setName(t("set.bodyTemplate"))
			.setDesc(t("set.bodyTemplateDesc"));
		tplSetting.settingEl.addClass("articledrop-template-setting");
		tplSetting.addTextArea((ta) => {
			ta.inputEl.rows = 16;
			ta.inputEl.addClass("articledrop-template");
			ta.setValue(s.bodyTemplate).onChange(async (v) => {
				s.bodyTemplate = v;
				await save();
			});
		});
		tplSetting.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip(t("set.resetTemplate"))
				.onClick(async () => {
					s.bodyTemplate = defaultBodyTemplate();
					await save();
					this.display();
				})
		);

		// Collecting ---------------------------------------------------------
		new Setting(containerEl).setName(t("set.collect")).setHeading();

		new Setting(containerEl)
			.setName(t("set.batchLinkBack"))
			.setDesc(t("set.batchLinkBackDesc"))
			.addToggle((tg) =>
				tg.setValue(s.batchLinkBack).onChange(async (v) => {
					s.batchLinkBack = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("set.convertShared"))
			.setDesc(t("set.convertSharedDesc"))
			.addToggle((tg) =>
				tg.setValue(s.convertSharedNotes).onChange(async (v) => {
					s.convertSharedNotes = v;
					await save();
				})
			);

		new Setting(containerEl).setName(t("set.mobile")).setDesc(t("set.mobileDesc"));

		// Papers -------------------------------------------------------------
		new Setting(containerEl).setName(t("set.papers")).setHeading();
		containerEl.createEl("p", { text: t("paper.hint"), cls: "setting-item-description" });

		const text = (name: string, desc: string | null, get: () => string, set: (v: string) => void, secret = false) => {
			const st = new Setting(containerEl).setName(name);
			if (desc) st.setDesc(desc);
			st.addText((tx) => {
				if (secret) tx.inputEl.type = "password";
				tx.setValue(get()).onChange(async (v) => {
					set(v.trim());
					await save();
				});
			});
		};

		text(t("set.paperFolder"), null, () => s.paperFolder, (v) => (s.paperFolder = normalizePath(v || "/")));
		text(t("set.paperFileName"), t("set.paperFileNameDesc"), () => s.paperFileNameTemplate, (v) => (s.paperFileNameTemplate = v || "{{title}}"));
		text(t("set.defaultPaperTags"), null, () => s.defaultPaperTags, (v) => (s.defaultPaperTags = v));

		new Setting(containerEl).setName(t("set.paperSource")).addDropdown((dd) =>
			dd
				.addOption("openalex", "OpenAlex")
				.addOption("crossref", "Crossref")
				.addOption("arxiv", "arXiv")
				.addOption("kci", "KCI")
				.setValue(s.paperSource)
				.onChange(async (v) => {
					s.paperSource = v as PaperSource;
					await save();
				})
		);

		new Setting(containerEl).setName(t("set.downloadPdf")).addToggle((tg) =>
			tg.setValue(s.downloadPdf).onChange(async (v) => {
				s.downloadPdf = v;
				await save();
			})
		);
		text(t("set.pdfFolder"), null, () => s.pdfFolder, (v) => (s.pdfFolder = normalizePath(v || "/")));
		text(t("set.email"), t("set.emailDesc"), () => s.contactEmail, (v) => (s.contactEmail = v));
		text(t("set.openAlexKey"), t("set.openAlexKeyDesc"), () => s.openAlexKey, (v) => (s.openAlexKey = v), true);
		text(t("set.kciKey"), t("set.kciKeyDesc"), () => s.kciKey, (v) => (s.kciKey = v), true);

		const ptpl = new Setting(containerEl).setName(t("set.paperTemplate")).setDesc(t("set.paperTemplateDesc"));
		ptpl.settingEl.addClass("articledrop-template-setting");
		ptpl.addTextArea((ta) => {
			ta.inputEl.rows = 14;
			ta.inputEl.addClass("articledrop-template");
			ta.setValue(s.paperTemplate).onChange(async (v) => {
				s.paperTemplate = v;
				await save();
			});
		});
		ptpl.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip(t("set.resetTemplate"))
				.onClick(async () => {
					s.paperTemplate = defaultPaperTemplate();
					await save();
					this.display();
				})
		);

		// Writing ------------------------------------------------------------
		new Setting(containerEl).setName(t("set.writing")).setHeading();

		new Setting(containerEl)
			.setName(t("set.insertMode"))
			.setDesc(t("set.insertModeDesc"))
			.addDropdown((dd) =>
				dd
					.addOption("footnote", t("set.insertFootnote"))
					.addOption("citation", t("set.insertCitation"))
					.addOption("link", t("set.insertLink"))
					.addOption("citation-link", t("set.insertCitationLink"))
					.setValue(s.insertMode)
					.onChange(async (v) => {
						s.insertMode = v as InsertMode;
						await save();
					})
			);

		new Setting(containerEl).setName(t("set.bibHeading")).addText((tx) =>
			tx.setValue(s.bibliographyHeading).onChange(async (v) => {
				s.bibliographyHeading = v.trim() || t("note.bibliography");
				await save();
			})
		);

		// Index --------------------------------------------------------------
		new Setting(containerEl).setName(t("set.index")).setHeading();

		new Setting(containerEl)
			.setName(t("set.indexName"))
			.setDesc(t("set.indexNameDesc"))
			.addText((tx) =>
				tx.setValue(s.indexFileName).onChange(async (v) => {
					s.indexFileName = v.trim() || defaultSettings().indexFileName;
					await save();
				})
			);
	}
}
