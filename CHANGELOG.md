# Changelog

## 0.3.3
- Fixed the review bot's install failure: `package-lock.json` was generated with `--legacy-peer-deps` and lacked peer packages, so a plain `npm ci` refused to install. Regenerated it with a normal `npm install`; `npm ci`, build, tests and lint all pass from a clean copy.
- Packaging now runs that clean `npm ci` check before making the zip.

## 0.3.2
- Uses only public Obsidian APIs: tag suggestions read each note's cache (`getAllTags`) instead of the undocumented `metadataCache.getTags()`; file-name checks use the Vault API instead of the adapter.
- Converting a shared-link note now rewrites it with `vault.process` (atomic) instead of `vault.modify`.
- Settings: removed the top-level "General" heading, per Obsidian's settings guidelines.
- Manifest: added author and funding links.
- Build tooling: esbuild 0.25 (dev-server advisory GHSA-67mh-4wv8-2f99), pinned `obsidian` typings, aligned ESLint packages.

## 0.3.1
- Security: updated `@mozilla/readability` to 0.6.0 (advisory GHSA-3p6v-hrg8-8qj7).
- Settings now use Obsidian's declarative settings API, so they appear in settings search on Obsidian 1.13+; older versions keep the previous settings screen.
- Paper API responses are validated field by field instead of being trusted as `any`.
- Links and images in saved articles are made absolute without inserting a `<base>` element.
- Replaced the `builtin-modules` build dependency with Node's built-in `builtinModules`.
- Code cleanup for the Obsidian review checks (unsafe types, unnecessary assertions, a `TFile` cast, regular-expression warnings, button handlers returning promises).
- Added `npm run lint` using `eslint-plugin-obsidianmd`; packaging runs it first.

## 0.3.0
- Rating (★1–5) for articles and papers: set when saving or with *Rate current article or paper*; shown in the index.
- SBL (2nd ed.) citation style for web articles and journal articles (`Journal 125.2 (2006): 287–303`).
- Chicago: comma before "and" with two authors.
- Memo and quote window: *Add memo to a source* / *Add quote to a source* append dated entries under My notes / Key quotes; selected text prefills the quote.
- *Insert citation*: footnote with link to the source note (default), citation text, link, or both.
- *Insert bibliography*: sorted list of saved sources linked from the current note.
- Citations are rebuilt in the current style when inserted or copied.

## 0.2.0
- Scholarly paper search: OpenAlex, Crossref, arXiv, KCI.
- Save by DOI or arXiv ID; DOI/arXiv links and journal pages with a DOI are saved as papers.
- Merged metadata (Crossref + OpenAlex), open-access PDF download, BibTeX, citekeys.
- Index with separate Articles and Papers views.

## 0.1.0
- Save web articles from a URL, the clipboard, all links in a note, or the mobile share sheet / `obsidian://articledrop`.
- Full text (Readability → Markdown) or metadata only; EUC-KR pages and Naver Blog supported.
- Citations (Korean, Chicago, APA, MLA), tags, topics/projects, reading status, Bases index.
