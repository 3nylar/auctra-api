# Docs fixes — summary

## Build-breaking bugs (site could not reliably build)

1. **`docs/package.json` was missing entirely.** A fresh `npm install` had
   nothing to install against, and even a manual `npm install marked` grabs
   whatever the current major is — which, unpinned, breaks the custom
   renderer in `build.mjs` (it uses the token-object `heading({tokens,
   depth})` API, which requires `marked` ≥ 16). Added `docs/package.json`
   pinning `marked: ^18.0.6`, the version actually compatible with this
   script.

2. **`content/07-response-format.md` had broken frontmatter** — no
   `section`, no `slug`, and a `meta-description` key the build script
   doesn't read. This produced a page called `undefined.html`, with no
   sidebar link, and an `<h4>undefined</h4>` group header in the nav on
   every page. Fixed the frontmatter to match every other content file; the
   page now builds as `response-format.html` and appears in the sidebar
   under **Build**.

## Wired up, not new — features that existed in code but were never called

3. **`scopeBadge()`** was fully implemented (with a scope map mirroring
   `authentication.md`) but never invoked. Now called under every
   operation's route line — each endpoint shows `Requires scope
   auctions:write` (or "No authentication required") right where you're
   reading it, instead of only in the auth doc.

4. **`requestSample()`**, a bash/JavaScript/Python tab strip, was fully
   implemented but the reference generator was calling `curlSample()`
   directly instead — so every endpoint showed bash only. Now every
   endpoint shows all three languages via tabs.

   This exposed two missing pieces, also added:
   - CSS for `.scope-badge` and `.lang-tabs`/`.lang-tab`/`.lang-panel`
     (theme/styles.css) — the markup existed with no styling.
   - Tab-click JS, and a copy-button fix so "Copy" copies the *active*
     language panel instead of always the first `<code>` block in a group.

## New

5. **Quick-scan endpoint index** at the top of the API reference page:
   verb + name, grouped by resource, linking straight to each operation's
   anchor — generated from the OpenAPI spec (`quickIndex()` in
   `build.mjs`), so it can't drift out of sync with the actual endpoints.

6. **Markdown mirrors** — every page now gets a `.md` file next to its
   `.html` file (`introduction.md`, `api-reference.md`, etc.), for tools
   and LLMs that want clean markdown instead of parsing HTML. The
   generated reference page gets a new `apiReferenceMarkdown()` renderer;
   hand-written pages just mirror their markdown source.

7. **`llms.txt`** updated to link to the `.md` mirrors instead of `.html`,
   to include the previously-orphaned Response format page, and to match
   the current **Build** / **Reference** section names (the nav had
   already been consolidated from four groups to three in the content
   frontmatter — `Core concepts` and `Guides` both now say `Build` — but
   the shipped `dist/` in the zip predated that change, which is why the
   live site still showed four groups).

## Verified

Ran a full `node scripts/build.mjs` end to end after each change. Final
build: 17 pages, 17 `.md` mirrors, zero `undefined` references anywhere in
`dist/`, scope badges on all 19 authenticated-or-not operations, language
tabs on all 19 request samples, one quick-index block.

## Still open (product decisions, not mechanical fixes)

- A live "try it" request console (Zap's biggest UX advantage) — bigger
  scope, needs a decision on whether it's sandbox-only and how the reader's
  key is handled client-side.
- Response *schema* tables (types/enums per field), not just example JSON
  — straightforward to template from `components.schemas` in the spec,
  but wasn't part of "fix what's broken" so left for a deliberate pass.
