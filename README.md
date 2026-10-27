# Articledrop

Save web articles and scholarly papers into Obsidian as research notes — metadata, readable full text, a ready-made citation, tags, topics/projects and reading status — and browse them all in one index.

웹 아티클과 학술 논문을 Obsidian 자료 노트로 저장합니다. 논문은 OpenAlex·Crossref·arXiv·KCI에서 검색해 바로 넣을 수 있습니다. 메타데이터, 본문(선택), 인용문, 태그, 주제/프로젝트, 읽기 상태를 함께 기록하고 목록에서 한눈에 볼 수 있습니다.

## Features

- **Four ways to add an article**
  - *Save article from URL* — paste a URL into a modal.
  - *Save article from clipboard URL* — uses the URL already on your clipboard.
  - *Save all links in current note* — collect every link in a note (an "inbox" or reading list) in one go; already-saved links are detected and unchecked.
  - *Mobile / other apps* — open `obsidian://articledrop?url=<encoded URL>` from an iOS Shortcut, Android share action or a desktop bookmarklet. Optionally, a new note that contains only a URL (e.g. created by the mobile share sheet) is turned into an article note.
- **Full text or metadata only** — choose every time, or set a default. Full text is extracted with Mozilla Readability and converted to Markdown. Metadata-only notes can be upgraded later with *Re-fetch content of current article*.
- **Good metadata** — title, author, site, publish date, description, cover image, language and canonical URL from Open Graph, JSON-LD, Highwire `citation_*` tags and more.
- **Korean sites work** — EUC-KR / CP949 pages are decoded correctly, Naver Blog posts are followed through their frame, and Korean date formats are understood.
- **Citations** — Korean footnote style, Chicago, SBL, APA 7 or MLA 9, stored in frontmatter and in the note. *Copy citation of current article* puts it on the clipboard.
- **Organize** — tags, topics/projects (with autocomplete from what you have used before) and a reading status (`읽을 것 → 읽는 중 → 읽음 → 활용함` by default, customizable). *Change reading status of current article* switches it.
- **Index** — *Create or open article index* creates a Bases file (`.base`) with an "All" table, one view per status and a cards view. Requires Obsidian 1.9+ with Bases enabled.
- **Duplicate detection** — saving a URL you already have opens the existing note (tracking parameters like `utm_*` are ignored).
- **Template** — the note body is a template with `{{placeholders}}` and conditional sections.

## Works with Obsidian Web Clipper

Clip a page with the [Obsidian Web Clipper](https://obsidian.md/clipper) browser extension as usual. When the new note appears in the Clipper's folder (`Clippings` by default), Articledrop organizes it:

- the clipped text stays as the article body (the Clipper reads the page in your real browser, so it also works for pages that need a login or render with JavaScript);
- the Clipper's properties (`source`, `author`, `published`, `created`, `description`, `tags`) become Articledrop properties, with missing details (site, image, canonical URL) filled from the page;
- citation, status, rating, My notes and Key quotes are added, and the note moves into your Articledrop folder;
- if the page is a journal article with a DOI, it becomes a paper note with full scholarly metadata, keeping the clipped text.

Settings → *When a clip arrives*: **Ask** (default — a small window for tags, project, status, rating and folder), **Organize automatically**, or **Do nothing**. Only notes created in the last two minutes while Obsidian is in front are picked up, so clips that arrive later by sync are left alone. *Organize Web Clipper notes* tidies every clip already in the folder, and *Organize current note as an article* works on any note with a `source` or `url` property.

## One folder, told apart by tags

Articles and papers are saved in the same folder (`자료` / `Sources` by default). Web articles get the `article` tag and papers the `paper` tag (both configurable), and every note also has `type: article` or `type: paper`, which the index uses for its *Articles* and *Papers* views.

Every save window has a **Folder** field: type a keyword and matching folders in your vault are listed (folder-name matches first). Leave it as is for the default folder, or type a new name to create a folder.

## Scholarly papers

- **Search scholarly papers** (graduation-cap ribbon icon) — search by title or keywords and pick a result to save it. Sources:
  - **OpenAlex** (default) — all disciplines, abstracts, citation counts and open-access PDF links. No key needed for light use (about 100 searches a day); a free key from [openalex.org/settings/api](https://openalex.org/settings/api) raises the limit.
  - **Crossref** — the DOI registry; good for exact titles.
  - **arXiv** — preprints.
  - **KCI** (한국학술지인용색인) — Korean journals. Needs a free API key from [open.kci.go.kr](https://open.kci.go.kr).
  - Typing a DOI or arXiv ID in the search box looks it up directly.
- **Save paper by DOI or arXiv ID** — paste `10.xxxx/…`, a `doi.org` link, `arXiv:2101.00001` or an arxiv.org link.
- **Automatic** — saving a `doi.org` / `arxiv.org` URL, or a journal article page that declares its DOI, creates a paper note instead of a web-article note. *Save all links in current note* also picks up bare DOIs and `arXiv:` ids.
- **Merged metadata** — Crossref supplies authoritative bibliographic data; OpenAlex adds the abstract, keywords, citation count and open-access PDF.
- **Open-access PDFs** — optionally downloaded into your vault (`자료/PDF` by default) and linked from the note's `pdf` property. *Download open-access PDF for current paper* adds one later.
- **Citations and BibTeX** — journal-article citations in Korean, Chicago, APA 7 or MLA 9; a `citekey`; *Copy BibTeX of current paper*.

Paper notes use `type: paper` and properties such as `authors`, `year`, `journal`, `volume`, `issue`, `pages`, `doi`, `arxiv`, `pdf`, `keywords`, `cited_by`, `citekey`. The index has separate *Articles* and *Papers* views.

You can also open the search from outside Obsidian: `obsidian://articledrop?paper=<query>`.

## Reading and writing with your sources

- **Reading status and rating** — every article and paper has a `status` and an optional 1–5 `rating`, set when saving or later with *Change reading status* / *Rate current article or paper*. Both appear as columns in the index.
- **Memo and quote window** — *Add memo to a source* and *Add quote to a source* open a small window and append a dated entry under **My notes** / **Key quotes** of the source note (with page or location for quotes). Select text first — in the saved article body or anywhere else — and *Add quote* is prefilled with it. If you run them outside a source note, you pick the source from a list.
- **Insert citation** — pick a saved source and Articledrop inserts, at the cursor, a footnote `[^1]` whose text is the citation plus a link back to the source note (default), or the citation text, a link, or both.
- **Insert bibliography** — collects every saved source this note links to (including those footnote links) and inserts a sorted **Bibliography** list.
- Citations are rebuilt from the note's properties in the style currently selected, so changing the style updates what you insert next.
- **Citation styles** — Korean footnote style, Chicago, **SBL (2nd ed.)**, APA 7, MLA 9. SBL uses `Journal 125.2 (2006): 287–303` for journal articles.

## Note format

```markdown
---
title: …
author: …
site: …
url: https://…
published: 2026-10-21
saved: 2026-10-22
description: …
image: https://…
type: article
status: 읽을 것
project: [디도서 설교]
tags: [article, 설교-자료]
citation: 김기자, “…”, 예시일보, 2026. 10. 21., https://… (접속일: 2026. 10. 22.).
---

> [!abstract] 예시일보 · 김기자 · 2026-10-21
> …
> [원문 보기](https://…)

## 인용
…
## 내 메모
## 핵심 인용
## 본문
```

### Template placeholders

`{{title}} {{url}} {{site}} {{author}} {{published}} {{saved}} {{description}} {{image}} {{citation}} {{content}} {{tags}} {{project}} {{status}}`

- `{{#key}}…{{/key}}` — shown only when the value exists
- `{{^key}}…{{/key}}` — shown only when the value is empty

The article body is wrapped in `<!-- articledrop:content -->` markers (invisible in reading view) so *Re-fetch content* can replace it without touching your own notes.

## Saving from your phone

**iOS (Shortcuts):** create a shortcut that *Receives URLs from the Share Sheet* → *URL Encode* the input → *Open URL* `obsidian://articledrop?url=` + encoded text. Then share any page to that shortcut.

**Android:** share the page to Obsidian and turn on *Convert shared links* in settings; the new note becomes an article note after you tap Save. Or use an app like HTTP Shortcuts to open the `obsidian://articledrop` link.

**Desktop bookmarklet:**

```js
javascript:location.href='obsidian://articledrop?url='+encodeURIComponent(location.href)
```

## Limitations

- Pages that need a login, are behind a paywall, or render entirely with JavaScript may only yield metadata.
- Images in the article body are linked, not downloaded.
- Paywalled papers get metadata and abstract only; PDFs are downloaded only when a legal open-access copy exists.
- KCI response parsing follows the published API guide; please report records that come through incomplete.

## Network use

Articledrop contacts the web pages whose URLs you give it, and — for papers — the scholarly APIs you search: api.openalex.org, api.crossref.org, export.arxiv.org and open.kci.go.kr (only if you add a KCI key), plus the open-access PDF hosts they point to. Your optional contact email and API keys are sent only to those services. There is no telemetry.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production build
npm test        # extraction / citation / template tests (jsdom)
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/articledrop/`.

## License

MIT
