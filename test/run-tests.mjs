// Unit tests for the Obsidian-free modules (extract, render, charset), run with jsdom.
import esbuild from "esbuild";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), "articledrop-test-")), "bundle.mjs");
await esbuild.build({
	stdin: {
		contents: `export * from "./src/extract"; export * from "./src/render"; export * from "./src/charset"; export * from "./src/scholar";`,
		resolveDir: join(here, ".."),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	outfile: out,
	logLevel: "silent",
});
const m = await import(pathToFileURL(out).href);

let passed = 0;
const test = (name, fn) => {
	try {
		fn();
		passed++;
		console.log("  ✓", name);
	} catch (e) {
		console.error("  ✗", name, "\n", e.message);
		process.exitCode = 1;
	}
};

const docFrom = (html) => new JSDOM(html).window.document;

// --- charset -----------------------------------------------------------------
console.log("charset");
const eucKr = readFileSync(join(here, "fixtures/news-euckr.html"));
test("detects EUC-KR from <meta> and decodes Korean", () => {
	const text = m.decodeBody(eucKr.buffer.slice(eucKr.byteOffset, eucKr.byteOffset + eucKr.byteLength), undefined);
	assert.match(text, /이주노동자/);
});
test("header charset wins and cp949 maps to euc-kr", () => {
	assert.equal(m.detectCharset(new Uint8Array([60]), "text/html; charset=CP949"), "euc-kr");
});

// --- metadata ------------------------------------------------------------------
console.log("metadata");
const newsHtml = m.decodeBody(eucKr.buffer.slice(eucKr.byteOffset, eucKr.byteOffset + eucKr.byteLength), undefined);
const newsUrl = "https://news.example.co.kr/article/123?utm_source=kakao#top";
const newsDoc = docFrom(newsHtml);
const meta = m.extractMeta(newsDoc, newsUrl);
test("title from og:title without site suffix", () => assert.equal(meta.title, "포천 이주노동자 산재, 무엇이 달라져야 하나"));
test("site from og:site_name", () => assert.equal(meta.site, "예시일보"));
test("author from JSON-LD (object)", () => assert.equal(meta.author, "김기자"));
test("published keeps publisher's local date", () => assert.equal(meta.published, "2026-10-21"));
test("image resolved to absolute URL", () => assert.equal(meta.image, "https://news.example.co.kr/img/cover.jpg"));
test("canonical URL", () => assert.equal(meta.canonicalUrl, "https://news.example.co.kr/article/123"));
test("lang", () => assert.equal(meta.lang, "ko"));

console.log("readable content");
const readable = m.extractReadable(newsDoc, newsUrl);
test("readability finds the body", () => {
	assert.ok(readable);
	assert.match(readable.element.textContent, /산업재해/);
	assert.doesNotMatch(readable.element.textContent, /광고 문의/);
});
test("lazy image promoted and absolutized", () => {
	const img = readable.element.querySelector("img");
	assert.equal(img.getAttribute("src"), "https://news.example.co.kr/photos/site.jpg");
});
test("relative links absolutized", () => {
	const a = readable.element.querySelector("a");
	assert.equal(a.getAttribute("href"), "https://news.example.co.kr/related/77");
});
test("original document untouched", () => assert.ok(newsDoc.querySelector("script")));

console.log("other pages");
test("Naver blog frame is followed", () => {
	const d = docFrom(`<html><head><title>블로그</title></head><body><iframe id="mainFrame" src="/PostView.naver?blogId=abc&logNo=1"></iframe></body></html>`);
	assert.equal(m.findContentFrame(d, "https://blog.naver.com/abc/1"), "https://blog.naver.com/PostView.naver?blogId=abc&logNo=1");
	assert.equal(m.findContentFrame(d, "https://example.com/abc"), null);
});
test("fallbacks: <title>, meta author, time[datetime], host", () => {
	const d = docFrom(`<html><head><title>Why Wisdom Waits – The Example Review</title><meta name="author" content="By Jane Doe"><meta property="og:site_name" content="The Example Review"></head><body><time datetime="2025-03-04T22:00:00-05:00">Mar 4</time></body></html>`);
	const x = m.extractMeta(d, "https://www.example.org/p/wisdom");
	assert.equal(x.title, "Why Wisdom Waits");
	assert.equal(x.author, "Jane Doe");
	assert.equal(x.published, "2025-03-04");
	assert.equal(x.site, "The Example Review");
});
test("scholarly citation_author list", () => {
	const d = docFrom(`<html><head><meta name="citation_title" content="On Grace"><meta name="citation_author" content="Kim, A."><meta name="citation_author" content="Lee, B."><meta name="citation_publication_date" content="2024/05/01"></head><body></body></html>`);
	const x = m.extractMeta(d, "https://journal.example.edu/a/1");
	assert.equal(x.author, "Kim, A., Lee, B.");
	assert.equal(x.published, "2024-05-01");
	assert.equal(x.site, "journal.example.edu");
});
test("Korean date formats", () => {
	assert.equal(m.toIsoDate("2026.10.21. 오후 3:12"), "2026-10-21");
	assert.equal(m.toIsoDate("2026년 1월 5일"), "2026-01-05");
	assert.equal(m.toIsoDate("20240102"), "2024-01-02");
});

// --- urls ----------------------------------------------------------------------
console.log("urls");
test("normalizeUrl strips tracking params, hash and trailing slash", () => {
	assert.equal(m.normalizeUrl("https://Example.com/a/?utm_source=x&id=3&fbclid=9#frag"), "https://example.com/a?id=3");
	assert.equal(m.normalizeUrl("https://example.com/"), "https://example.com/");
});
test("findUrls handles markdown links, bare URLs and punctuation", () => {
	const text = "- [글](https://a.com/x) 그리고 https://b.com/y.\n<https://c.com/z> https://a.com/x";
	assert.deepEqual(m.findUrls(text), ["https://a.com/x", "https://b.com/y", "https://c.com/z"]);
});

// --- render --------------------------------------------------------------------
console.log("render");
const art = { ...meta, url: "https://news.example.co.kr/article/123" };
test("Korean citation", () => {
	assert.equal(
		m.buildCitation(art, "korean", "2026-10-22"),
		"김기자, “포천 이주노동자 산재, 무엇이 달라져야 하나”, 예시일보, 2026. 10. 21., https://news.example.co.kr/article/123 (접속일: 2026. 10. 22.)."
	);
});
test("Chicago citation", () => {
	assert.equal(
		m.buildCitation(art, "chicago", "2026-10-22"),
		"김기자. “포천 이주노동자 산재, 무엇이 달라져야 하나.” 예시일보, October 21, 2026. https://news.example.co.kr/article/123."
	);
});
test("APA citation, no date → n.d. + retrieved", () => {
	const c = m.buildCitation({ ...art, published: "", author: "" }, "apa", "2026-10-22");
	assert.equal(c, "*포천 이주노동자 산재, 무엇이 달라져야 하나.* (n.d.). 예시일보. Retrieved October 22, 2026, from https://news.example.co.kr/article/123");
});
test("MLA citation", () => {
	assert.equal(
		m.buildCitation(art, "mla", "2026-10-22"),
		"김기자. “포천 이주노동자 산재, 무엇이 달라져야 하나.” *예시일보*, 21 Oct. 2026, https://news.example.co.kr/article/123. Accessed 22 Oct. 2026."
	);
});
test("template sections", () => {
	const tpl = "A {{#author}}by {{author}}{{/author}}{{^author}}anon{{/author}}\n\n\n\n{{#content}}## Body\n{{content}}{{/content}}";
	assert.equal(m.renderTemplate(tpl, { author: "Kim", content: "" }), "A by Kim\n");
	assert.equal(m.renderTemplate(tpl, { author: "", content: "text $1 {{x}}" }), "A anon\n\n## Body\ntext $1 {{x}}\n");
});
test("file names and tags", () => {
	assert.equal(m.sanitizeFileName('A/B: "C" #1 [x]?'), "A B C 1 x");
	assert.equal(m.toTag("#설교 자료"), "설교-자료");
	assert.deepEqual(m.splitList("a, b，c\n"), ["a", "b", "c"]);
});


// --- papers --------------------------------------------------------------------
console.log("identifiers");
test("DOI forms", () => {
	assert.deepEqual(m.detectIdentifier("https://doi.org/10.7717/PeerJ.4375"), { kind: "doi", value: "10.7717/peerj.4375" });
	assert.deepEqual(m.detectIdentifier("doi: 10.1000/xyz123."), { kind: "doi", value: "10.1000/xyz123" });
	assert.deepEqual(m.detectIdentifier("10.1000/abc(def)"), { kind: "doi", value: "10.1000/abc(def)" });
	assert.equal(m.normalizeDoi("(see 10.1000/xyz)."), "10.1000/xyz");
});
test("arXiv forms", () => {
	assert.deepEqual(m.detectIdentifier("https://arxiv.org/abs/1706.03762v7"), { kind: "arxiv", value: "1706.03762" });
	assert.deepEqual(m.detectIdentifier("https://arxiv.org/pdf/1706.03762.pdf"), { kind: "arxiv", value: "1706.03762" });
	assert.deepEqual(m.detectIdentifier("arXiv:2101.00001"), { kind: "arxiv", value: "2101.00001" });
	assert.deepEqual(m.detectIdentifier("10.48550/arXiv.2101.00001"), { kind: "arxiv", value: "2101.00001" });
	assert.deepEqual(m.detectIdentifier("math/0211159"), { kind: "arxiv", value: "math/0211159" });
});
test("ordinary input stays a query", () => {
	assert.equal(m.detectIdentifier("theology of hospitality migrants").kind, "query");
	assert.equal(m.detectIdentifier("https://news.example.com/2024/10/10.5/story").kind, "query");
	assert.equal(m.detectIdentifier("https://example.com/2101.00001").kind, "query");
});
test("page DOI meta is picked up", () => {
	const d = docFrom(`<html><head><meta name="citation_title" content="X"><meta name="citation_journal_title" content="J"><meta name="citation_doi" content="doi:10.1234/ABC.5"></head><body></body></html>`);
	const x = m.extractMeta(d, "https://journal.example.org/a/5");
	assert.equal(x.doi, "10.1234/abc.5");
	assert.equal(x.scholarly, true);
	assert.equal(m.extractMeta(newsDoc, newsUrl).scholarly, false);
});

console.log("paper parsers");
const oaw = JSON.parse(readFileSync(join(here, "fixtures/openalex-work.json"), "utf8"));
const oa = m.parseOpenAlexWork(oaw);
test("OpenAlex work", () => {
	assert.equal(oa.title, "The state of OA: a large-scale analysis of the prevalence and impact of Open Access articles");
	assert.deepEqual(oa.authors.map((a) => a.name), ["Heather Piwowar", "Jason Priem", "Stefanie Haustein"]);
	assert.equal(oa.year, "2018");
	assert.equal(oa.journal, "PeerJ");
	assert.equal(oa.pages, "e4375");
	assert.equal(oa.doi, "10.7717/peerj.4375");
	assert.equal(oa.pdfUrl, "https://peerj.com/articles/4375.pdf");
	assert.equal(oa.abstract, "Despite growing interest in Open Access");
	assert.equal(oa.citedBy, 1450);
	assert.deepEqual(oa.keywords, ["Citation", "Open access"]);
});
test("OpenAlex search list", () => assert.equal(m.parseOpenAlexSearch({ results: [oaw, { display_name: "" }] }).length, 1));
const cr = m.parseCrossrefWork(JSON.parse(readFileSync(join(here, "fixtures/crossref-work.json"), "utf8")).message);
test("Crossref work", () => {
	assert.equal(cr.authors.length, 9);
	assert.deepEqual(cr.authors[3], { name: "Juan Pablo Alperin", given: "Juan Pablo", family: "Alperin" });
	assert.equal(cr.published, "2018-02-13");
	assert.equal(cr.doi, "10.7717/peerj.4375");
	assert.equal(cr.url, "https://doi.org/10.7717/peerj.4375");
	assert.match(cr.abstract, /^Despite growing interest in Open Access \(OA\)/);
	assert.doesNotMatch(cr.abstract, /jats/);
});
test("merge: Crossref biblio + OpenAlex extras", () => {
	const merged = m.mergePapers(cr, oa);
	assert.equal(merged.authors.length, 9);
	assert.equal(merged.pdfUrl, "https://peerj.com/articles/4375.pdf");
	assert.equal(merged.citedBy, 1450);
	assert.ok(merged.abstract.length > 60, "keeps the longer abstract");
	assert.deepEqual(merged.keywords, ["General Medicine"]);
});
const ax = m.parseArxivFeed(new JSDOM(readFileSync(join(here, "fixtures/arxiv.xml"), "utf8"), { contentType: "application/xml" }).window.document)[0];
test("arXiv entry", () => {
	assert.equal(ax.title, "Attention Is All You Need");
	assert.equal(ax.arxivId, "1706.03762");
	assert.equal(ax.year, "2017");
	assert.equal(ax.pdfUrl, "https://arxiv.org/pdf/1706.03762v7");
	assert.equal(ax.url, "https://arxiv.org/abs/1706.03762");
	assert.match(ax.abstract, /^The dominant sequence/);
	assert.deepEqual(ax.keywords, ["cs.CL", "cs.LG"]);
});
const kci = m.parseKci(new JSDOM(readFileSync(join(here, "fixtures/kci.xml"), "utf8"), { contentType: "application/xml" }).window.document)[0];
test("KCI record", () => {
	assert.equal(kci.title, "한국 교회의 이주민 선교와 환대의 신학");
	assert.deepEqual(kci.authors.map((a) => a.name), ["홍길동", "김철수"]);
	assert.equal(kci.journal, "선교신학");
	assert.equal(kci.volume, "61");
	assert.equal(kci.issue, "1");
	assert.equal(kci.pages, "101-130");
	assert.equal(kci.published, "2021-03");
	assert.equal(kci.doi, "10.12345/kms.2021.61.101");
	assert.equal(kci.citedBy, 3);
	assert.match(kci.url, /^https:\/\/www\.kci\.go\.kr/);
	assert.match(kci.abstract, /^본 연구는/);
});

console.log("paper citations");
const full = m.mergePapers(cr, oa);
test("APA", () =>
	assert.equal(
		m.buildPaperCitation({ ...full, authors: full.authors.slice(0, 3) }, "apa"),
		"Piwowar, H., Priem, J., & Larivière, V. (2018). The state of OA: a large-scale analysis of the prevalence and impact of Open Access articles. *PeerJ*, *6*, e4375. https://doi.org/10.7717/peerj.4375"
	));
test("Chicago", () =>
	assert.equal(
		m.buildPaperCitation({ ...full, authors: full.authors.slice(0, 2) }, "chicago"),
		"Piwowar, Heather, and Jason Priem. “The state of OA: a large-scale analysis of the prevalence and impact of Open Access articles.” *PeerJ* 6 (2018): e4375. https://doi.org/10.7717/peerj.4375."
	));
test("MLA (3+ authors → et al.)", () =>
	assert.equal(
		m.buildPaperCitation(full, "mla"),
		"Piwowar, Heather, et al. “The state of OA: a large-scale analysis of the prevalence and impact of Open Access articles.” *PeerJ*, vol. 6, 2018, pp. e4375, https://doi.org/10.7717/peerj.4375."
	));
test("Korean, Korean paper", () =>
	assert.equal(
		m.buildPaperCitation(kci, "korean"),
		"홍길동, 김철수, “한국 교회의 이주민 선교와 환대의 신학”, 『선교신학』 61권 1호 (2021): 101-130. https://doi.org/10.12345/kms.2021.61.101"
	));
test("Korean, many authors → 외 n인", () => assert.match(m.buildPaperCitation(full, "korean"), /^Heather Piwowar 외 8인, /));
test("arXiv preprint citation", () =>
	assert.equal(
		m.buildPaperCitation(ax, "apa"),
		"Vaswani, A., & Shazeer, N. (2017). Attention Is All You Need. *arXiv:1706.03762*. https://arxiv.org/abs/1706.03762"
	));
test("citekey and BibTeX", () => {
	assert.equal(m.citeKey(full), "piwowar2018state");
	assert.equal(m.citeKey(kci), "홍길동2021");
	const bib = m.toBibTeX(full);
	assert.match(bib, /^@article\{piwowar2018state,/);
	assert.match(bib, /title = \{\{The state of OA/);
	assert.match(bib, /author = \{Piwowar, Heather and Priem, Jason/);
	assert.match(bib, /journal = \{PeerJ\}/);
	assert.match(bib, /doi = \{10\.7717\/peerj\.4375\}/);
	assert.doesNotMatch(bib, /url =/);
	const axBib = m.toBibTeX(ax);
	assert.match(axBib, /^@misc\{vaswani2017attention,/);
	assert.match(axBib, /eprint = \{1706\.03762\}/);
	assert.match(m.toBibTeX(kci), /author = \{\{홍길동\} and \{김철수\}\}/);
});

console.log("v0.3 research tools");
test("SBL paper: vol.issue, en dash", () =>
	assert.equal(
		m.buildPaperCitation({ ...kci, authors: [{ name: "John Smith" }, { name: "Jane Doe" }], title: "Hospitality in Luke-Acts", journal: "Journal of Biblical Literature", volume: "125", issue: "2", pages: "287-303", year: "2006", doi: "" , url: "" }, "sbl"),
		"Smith, John, and Jane Doe. “Hospitality in Luke-Acts.” *Journal of Biblical Literature* 125.2 (2006): 287–303."
	));
test("SBL paper: three authors", () => assert.match(m.buildPaperCitation(full, "sbl"), /^Piwowar, Heather, Jason Priem, .*, and Stefanie Haustein\. “The state of OA/));
test("SBL web article", () =>
	assert.equal(
		m.buildCitation(art, "sbl", "2026-10-22"),
		"김기자. “포천 이주노동자 산재, 무엇이 달라져야 하나.” *예시일보*, October 21, 2026. https://news.example.co.kr/article/123."
	));
test("Chicago two authors use a comma before and", () => assert.match(m.buildPaperCitation({ ...full, authors: full.authors.slice(0, 2) }, "chicago"), /^Piwowar, Heather, and Jason Priem\. /));
test("stars", () => {
	assert.equal(m.stars(4), "★★★★☆");
	assert.equal(m.stars(0), "");
	assert.equal(m.stars(9), "★★★★★");
});
const NOTE = "---\ntitle: x\n---\n\n## 인용\n텍스트\n\n## 내 메모\n- \n\n## 핵심 인용\n> \n\n## 본문\n\n<!-- articledrop:content -->\n본문\n<!-- /articledrop:content -->\n";
test("memo replaces placeholder and stays in its section", () => {
	const out = m.appendToSection(NOTE, "내 메모", m.memoEntry("설교 서론에 쓸 것\n둘째 줄", "2026-10-27"), { beforeMarker: "<!-- articledrop:content -->" });
	assert.match(out, /## 내 메모\n- 2026-10-27 설교 서론에 쓸 것\n  둘째 줄\n\n## 핵심 인용/);
	const again = m.appendToSection(out, "내 메모", m.memoEntry("두 번째", "2026-10-28"), {});
	assert.match(again, /  둘째 줄\n- 2026-10-28 두 번째\n\n## 핵심 인용/);
});
test("quotes are separate blockquotes with locator", () => {
	let out = m.appendToSection(NOTE, "핵심 인용", m.quoteEntry("첫 문장", "23", "2026-10-27"), { separate: true });
	out = m.appendToSection(out, "핵심 인용", m.quoteEntry("둘째", "3장", "2026-10-27"), { separate: true });
	assert.match(out, /## 핵심 인용\n> 첫 문장\n> — p\. 23 · 2026-10-27\n\n> 둘째\n> — 3장 · 2026-10-27\n\n## 본문/);
});
test("missing section is created before the saved body", () => {
	const plain = "---\na: 1\n---\n\n본문 위\n\n## 본문\n\n<!-- articledrop:content -->\nX\n<!-- /articledrop:content -->\n";
	const out = m.appendToSection(plain, "내 메모", "- 메모", { beforeMarker: "<!-- articledrop:content -->" });
	assert.match(out, /본문 위\n\n## 내 메모\n- 메모\n\n## 본문\n\n<!-- articledrop/);
	assert.match(m.appendToSection("only text", "내 메모", "- 메모"), /^only text\n\n## 내 메모\n- 메모\n$/);
});
test("next footnote number", () => {
	assert.equal(m.nextFootnote("no notes"), 1);
	assert.equal(m.nextFootnote("a[^1] b[^3]\n\n[^1]: x\n[^3]: y\n[^note]: z"), 4);
});
console.log("v0.4 folders");
test("folder suggestions rank by name match", () => {
	const paths = ["자료", "자료/설교", "자료/설교/디도서", "설교 준비", "ISF/보고서", "아카이브/옛 설교"];
	assert.deepEqual(m.rankFolders(paths, "설교"), ["설교 준비", "자료/설교", "아카이브/옛 설교", "자료/설교/디도서"]);
	assert.deepEqual(m.rankFolders(paths, "디도"), ["자료/설교/디도서"]);
	assert.deepEqual(m.rankFolders(paths, "isf"), ["ISF/보고서"]);
	assert.equal(m.rankFolders(paths, "").length, paths.length);
	assert.deepEqual(m.rankFolders(paths, "없는폴더"), []);
});

console.log(`\n${passed} passed${process.exitCode ? ", some failed" : ""}`);
