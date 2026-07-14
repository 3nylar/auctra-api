/**
 * Auctra docs generator.
 *
 * Reads content/*.md and spec/openapi.json, writes a static site to dist/.
 * No framework, no runtime data fetching: every page is a complete HTML
 * document that a CDN, an S3 bucket, or `python -m http.server` can serve.
 *
 *   node scripts/build.mjs
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONTENT = join(ROOT, "content");
const DIST = join(ROOT, "dist");
const SPEC = JSON.parse(
  readFileSync(join(ROOT, "..", "spec", "openapi.json"), "utf8"),
);

const SITE = {
  name: "Auctra",
  tagline: "On-chain English auctions, over HTTP.",
  sandbox: "https://auctra-api-production.up.railway.app",
};

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

/** Collects headings as it renders, so the right rail never drifts from the page. */
function makeRenderer(toc) {
  const marked = new Marked({ gfm: true });

  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugify(text);
        if (depth === 2 || depth === 3) toc.push({ id, text, depth });
        const anchor = `<a class="anchor" href="#${id}" aria-hidden="true">#</a>`;
        return `<h${depth} id="${id}">${anchor}${text}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const label = lang || "text";
        return codeBlock(text, label);
      },
    },
  });

  return marked;
}

const escapeHtml = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function codeBlock(source, lang = "text") {
  const cls = lang === "text" ? "" : ` class="language-${lang}"`;
  return `<div class="code">
  <div class="bar"><span>${lang}</span><button class="copy" type="button">Copy</button></div>
  <pre><code${cls}>${escapeHtml(source)}</code></pre>
</div>`;
}

/** Frontmatter: `---\nkey: value\n---` */
function parseFrontmatter(raw) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    meta[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  return { meta, body: raw.slice(match[0].length) };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function sidebar(pages, current) {
  const sections = [];
  for (const p of pages) {
    let s = sections.find((x) => x.name === p.meta.section);
    if (!s) sections.push((s = { name: p.meta.section, items: [] }));
    s.items.push(p);
  }
  return sections
    .map(
      (s) =>
        `<h4>${s.name}</h4>${s.items
          .map(
            (p) =>
              `<a href="${p.meta.slug}.html"${
                p.meta.slug === current ? ' aria-current="page"' : ""
              } data-search="${escapeHtml(p.meta.title + " " + (p.meta.description ?? ""))}">${
                p.meta.title
              }</a>`,
          )
          .join("")}`,
    )
    .join("");
}

function rail(toc) {
  if (!toc.length) return "";
  return `<h5>On this page</h5>${toc
    .map(
      (h) =>
        `<a class="${h.depth === 3 ? "h3" : "h2"}" href="#${h.id}">${h.text}</a>`,
    )
    .join("")}`;
}

function pager(pages, index) {
  const prev = pages[index - 1];
  const next = pages[index + 1];
  if (!prev && !next) return "";
  return `<nav class="pager">
    ${prev ? `<a class="prev" href="${prev.meta.slug}.html"><span>Previous</span><b>${prev.meta.title}</b></a>` : "<div></div>"}
    ${next ? `<a class="next" href="${next.meta.slug}.html"><span>Next</span><b>${next.meta.title}</b></a>` : "<div></div>"}
  </nav>`;
}

function layout({ title, description, section, body, sidebarHtml, railHtml }) {
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${SITE.name} API</title>
<meta name="description" content="${escapeHtml(description ?? SITE.tagline)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">
<script>
  // Applied before first paint so a dark-mode reader never sees a white flash.
  try {
    const t = localStorage.getItem("auctra-theme");
    if (t) document.documentElement.dataset.theme = t;
    else if (matchMedia("(prefers-color-scheme: dark)").matches)
      document.documentElement.dataset.theme = "dark";
  } catch {}
</script>
</head>
<body>

<header class="masthead">
  <button class="icon-btn" id="menu-toggle" aria-label="Toggle navigation" aria-expanded="false">☰</button>
  <a class="wordmark" href="introduction.html"><b>Auctra</b><span>Docs</span></a>
  <nav>
    <a class="hide-sm" href="api-reference.html">API reference</a>
    <a class="hide-sm" href="changelog.html">Changelog</a>
    <a class="hide-sm" href="https://github.com/3nylar/auctra-api">GitHub</a>
    <button class="icon-btn" id="theme-toggle" aria-label="Toggle colour theme">◐</button>
  </nav>
</header>

<div class="shell">
  <aside class="sidebar" id="sidebar">
    <div class="search-wrap">
      <input id="search" type="search" placeholder="Search the docs" autocomplete="off">
    </div>
    ${sidebarHtml}
  </aside>

  <main class="content">
    <p class="eyebrow">${section ?? "Reference"}</p>
    ${body}
  </main>

  <aside class="rail">${railHtml}</aside>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>
  hljs.highlightAll();

  // Copy buttons
  document.querySelectorAll(".copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.closest(".code").querySelector("code").innerText;
      await navigator.clipboard.writeText(code);
      const was = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = was), 1400);
    });
  });

  // Theme
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("auctra-theme", next); } catch {}
  });

  // Mobile nav
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("menu-toggle");
  toggle.addEventListener("click", () => {
    const open = sidebar.dataset.open === "true";
    sidebar.dataset.open = String(!open);
    toggle.setAttribute("aria-expanded", String(!open));
  });

  // Filter the nav, rather than shipping a search index for fifteen pages.
  const search = document.getElementById("search");
  search.addEventListener("input", () => {
    const q = search.value.toLowerCase().trim();
    document.querySelectorAll(".sidebar a").forEach((a) => {
      const hit = !q || (a.dataset.search ?? "").toLowerCase().includes(q);
      a.style.display = hit ? "" : "none";
    });
    document.querySelectorAll(".sidebar h4").forEach((h) => {
      let n = h.nextElementSibling, any = false;
      while (n && n.tagName === "A") { if (n.style.display !== "none") any = true; n = n.nextElementSibling; }
      h.style.display = any ? "" : "none";
    });
  });

  // Highlight the rail entry for whatever section is on screen.
  const links = [...document.querySelectorAll(".rail a")];
  if (links.length) {
    const seen = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
      links.forEach((l) => l.classList.toggle("active", seen.has(l.hash.slice(1))));
    }, { rootMargin: "-80px 0px -70% 0px" });
    document.querySelectorAll("h2[id], h3[id]").forEach((h) => io.observe(h));
  }
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// The intro page gets a lot ticket instead of a wall of text.
// ---------------------------------------------------------------------------

const HERO = `<div class="ticket">
  <p class="stub">Lot 117 · Live</p>
  <div class="row"><dt>Reserve</dt><dd>1.0000 ETH</dd></div>
  <div class="row"><dt>Standing bid</dt><dd>1.0500 ETH</dd></div>
  <div class="row"><dt>Minimum next</dt><dd>1.1025 ETH</dd></div>
  <div class="clock" aria-hidden="true">
    <div class="track"><div class="fill"></div></div>
    <div class="legend"><span>Clock</span><span><b>Late bid</b> · extended ×1</span></div>
  </div>
</div>`;

// ---------------------------------------------------------------------------
// API reference, generated from the spec
// ---------------------------------------------------------------------------

const deref = (node) => {
  if (!node || typeof node !== "object") return node;
  if (node.$ref) {
    const path = node.$ref.replace(/^#\//, "").split("/");
    return path.reduce((acc, k) => acc[k], SPEC);
  }
  return node;
};

const typeOf = (schema) => {
  const s = deref(schema);
  if (!s) return "any";
  if (s.$ref) return s.$ref.split("/").pop();
  if (s.const) return `"${s.const}"`;
  if (s.enum) return s.enum.map((e) => `"${e}"`).join(" | ");
  if (Array.isArray(s.type)) return s.type.join(" | ");
  if (s.type === "array") return `${typeOf(s.items)}[]`;
  return s.type ?? "object";
};

function paramList(rawParams = []) {
  // Parameters are usually $refs into components/parameters. Resolve first,
  // or every row renders as `undefined: any`.
  const params = rawParams.map(deref);
  if (!params.length) return "";
  const rows = params
    .map((p) => {
      const s = deref(p.schema) ?? {};
      const def =
        s.default !== undefined
          ? ` <span class="type">default ${s.default}</span>`
          : "";
      return `<div class="param">
        <div class="param-head">
          <span class="name">${p.name}</span>
          <span class="type">${typeOf(p.schema)}</span>
          <span class="type">${p.in}</span>${def}
          ${p.required ? '<span class="req">Required</span>' : ""}
        </div>
        <div class="param-body">${md.parse(p.description ?? "")}</div>
      </div>`;
    })
    .join("");
  return `<h4 style="font-family:var(--ui);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--slate-2);margin:26px 0 4px">Parameters</h4><div class="params">${rows}</div>`;
}

function bodyFields(op) {
  const content = op.requestBody?.content?.["application/json"];
  if (!content) return "";
  const schema = deref(content.schema) ?? {};
  const props = schema.properties ?? {};
  if (!Object.keys(props).length) return "";
  const required = new Set(schema.required ?? []);
  const rows = Object.entries(props)
    .map(([name, raw]) => {
      const s = deref(raw) ?? {};
      return `<div class="param">
        <div class="param-head">
          <span class="name">${name}</span>
          <span class="type">${typeOf(raw)}</span>
          ${required.has(name) ? '<span class="req">Required</span>' : ""}
        </div>
        <div class="param-body">${md.parse(s.description ?? "")}</div>
      </div>`;
    })
    .join("");
  return `<h4 style="font-family:var(--ui);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--slate-2);margin:26px 0 4px">Body</h4><div class="params">${rows}</div>`;
}

function responses(op) {
  const rows = Object.entries(op.responses ?? {})
    .map(([status, r]) => {
      const ok = status.startsWith("2");
      const desc = (r.description ?? "").split("\n")[0];
      return `<div class="resp ${ok ? "ok" : "err"}"><span class="status">${status}</span><span class="desc">${escapeHtml(desc)}</span></div>`;
    })
    .join("");
  return `<div class="responses"><h4 style="font-family:var(--ui);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--slate-2);margin:0 0 8px">Responses</h4>${rows}</div>`;
}

/** A curl invocation that would actually run, given a key and a URL. */
function curlSample(method, path, op) {
  const example = op.requestBody?.content?.["application/json"]?.example;
  const lines = [`curl -X ${method.toUpperCase()} "$AUCTRA_URL${path}" \\`];
  lines.push(`  -H "Authorization: Bearer $AUCTRA_KEY"`);
  if (example) {
    lines[lines.length - 1] += " \\";
    lines.push(`  -H "Content-Type: application/json" \\`);
    if (method === "post") lines[lines.length - 1] += "";
    lines.push(`  -H "Idempotency-Key: $(uuidgen)" \\`);
    lines.push(
      `  -d '${JSON.stringify(example, null, 2).split("\n").join("\n  ")}'`,
    );
  }
  return lines.join("\n");
}

function responseSample(op) {
  for (const r of Object.values(op.responses ?? {})) {
    const c = r.content?.["application/json"];
    if (!c) continue;
    if (c.example) return JSON.stringify(c.example, null, 2);
    const s = deref(c.schema);
    const ex = s?.examples?.[0] ?? s?.example;
    if (ex) return JSON.stringify(ex, null, 2);
    // allOf composites: a list envelope wrapping `data: Thing[]`. Build the
    // envelope around the item's own example so list endpoints get a sample too.
    for (const part of s?.allOf ?? []) {
      const d = deref(part);
      if (d?.examples?.[0]) return JSON.stringify(d.examples[0], null, 2);
      const items = deref(d?.properties?.data?.items);
      const ex = items?.examples?.[0];
      if (ex) {
        return JSON.stringify(
          { object: "list", data: [ex], has_more: false, next_cursor: null },
          null,
          2,
        );
      }
    }
  }
  return null;
}

function apiReference(toc) {
  const byTag = new Map();
  for (const [path, item] of Object.entries(SPEC.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const tag = op.tags?.[0] ?? "Other";
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push({ path, method, op });
    }
  }

  const tagOrder = SPEC.tags.map((t) => t.name);
  const sections = [];

  for (const tag of tagOrder) {
    const ops = byTag.get(tag);
    if (!ops) continue;
    const tagMeta = SPEC.tags.find((t) => t.name === tag);
    const id = slugify(tag);
    toc.push({ id, text: tag, depth: 2 });

    const opsHtml = ops
      .map(({ path, method, op }) => {
        const opId = slugify(`${method} ${path}`);
        toc.push({ id: opId, text: op.summary, depth: 3 });
        const sample = responseSample(op);
        return `<section class="op" id="${opId}">
  <div class="op-main">
    <h3><a class="anchor" href="#${opId}" aria-hidden="true">#</a>${escapeHtml(op.summary)}</h3>
    <div class="route"><span class="verb ${method}">${method.toUpperCase()}</span><span>${path}</span></div>
    ${md.parse(op.description ?? "")}
    ${paramList(op.parameters)}
    ${bodyFields(op)}
    ${responses(op)}
  </div>
  <div class="op-side">
    ${codeBlock(curlSample(method, path, op), "bash")}
    ${sample ? codeBlock(sample, "json") : ""}
  </div>
</section>`;
      })
      .join("");

    sections.push(
      `<h2 id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${tag}</h2>
       <div style="max-width:var(--measure)">${md.parse(tagMeta?.description ?? "")}</div>
       ${opsHtml}`,
    );
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

let md = new Marked({ gfm: true });

const files = readdirSync(CONTENT)
  .filter((f) => f.endsWith(".md"))
  .sort();
const pages = files.map((f) => {
  const { meta, body } = parseFrontmatter(
    readFileSync(join(CONTENT, f), "utf8"),
  );
  return { file: f, meta, body };
});

// The generated reference sits with the other Reference pages, before the changelog.
const refPage = {
  meta: {
    title: "API reference",
    description: "Every endpoint, parameter and response.",
    section: "Reference",
    slug: "api-reference",
  },
  generated: true,
};
const changelogAt = pages.findIndex((p) => p.meta.slug === "changelog");
pages.splice(changelogAt, 0, refPage);

mkdirSync(DIST, { recursive: true });

pages.forEach((page, i) => {
  const toc = [];
  md = makeRenderer(toc);

  let body;
  if (page.generated) {
    body = `<h1>API reference</h1>
      <div class="lede">All requests are JSON over HTTPS.</div>

      <h2 id="base-url">
        <a class="anchor" href="#base-url" aria-hidden="true">#</a>Base URL
      </h2>
      <div style="max-width: var(--measure)">
        <p>
          Every request is made to
          <a href="${SITE.sandbox}" target="_blank" rel="noopener noreferrer"><code>${SITE.sandbox}</code></a>
          and must include an <code>Authorization: Bearer sk_test_…</code> header.
          Amounts are always decimal strings of wei.
        </p>
      </div>

      ${apiReference(toc)}`;
  } else {
    const isIntro = page.meta.slug === "introduction";
    body = `<h1>${escapeHtml(page.meta.title)}</h1>
      <p class="lede">${escapeHtml(page.meta.description ?? "")}</p>
      ${isIntro ? HERO : ""}
      <div class="prose">${md.parse(page.body)}</div>
      ${pager(pages, i)}`;
  }

  writeFileSync(
    join(DIST, `${page.meta.slug}.html`),
    layout({
      title: page.meta.title,
      description: page.meta.description,
      section: page.meta.section,
      body,
      sidebarHtml: sidebar(pages, page.meta.slug),
      railHtml: rail(toc),
    }),
  );
});

// index.html mirrors the introduction so a bare domain lands somewhere useful.
copyFileSync(join(DIST, "introduction.html"), join(DIST, "index.html"));
copyFileSync(join(ROOT, "theme", "styles.css"), join(DIST, "styles.css"));
copyFileSync(
  join(ROOT, "..", "spec", "openapi.yaml"),
  join(DIST, "openapi.yaml"),
);
copyFileSync(
  join(ROOT, "..", "spec", "openapi.json"),
  join(DIST, "openapi.json"),
);

console.log(`built ${pages.length} pages → docs/dist`);
for (const p of pages) console.log(`  ${p.meta.slug}.html`);
