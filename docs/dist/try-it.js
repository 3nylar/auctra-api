/**
 * The try-it console. Loaded only on api-reference.html.
 *
 * One fetch of /openapi.json drives every panel on the page — the same
 * spec that generates the reference text also generates these forms, so
 * the two can never drift apart the way hand-written examples could.
 *
 * The API key never leaves this browser except in the actual request it
 * authorizes: stored in localStorage, read fresh on every send, never
 * logged, never sent anywhere but the base URL the person typed in
 * themselves. There's no server component to this feature at all — it's
 * a JSON fetch and a fetch() call, both running client-side.
 */
(function () {
  const KEY_STORAGE = "auctra-tryit-key";
  const BASE_STORAGE = "auctra-tryit-base";

  const keyInput = document.getElementById("tryit-key");
  const baseInput = document.getElementById("tryit-base");

  if (!keyInput || !baseInput) return; // not on the reference page

  try {
    const savedKey = localStorage.getItem(KEY_STORAGE);
    const savedBase = localStorage.getItem(BASE_STORAGE);
    if (savedKey) keyInput.value = savedKey;
    if (savedBase) baseInput.value = savedBase;
  } catch {}

  keyInput.addEventListener("input", () => {
    try { localStorage.setItem(KEY_STORAGE, keyInput.value); } catch {}
  });
  baseInput.addEventListener("input", () => {
    try { localStorage.setItem(BASE_STORAGE, baseInput.value); } catch {}
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function deref(spec, node) {
    if (!node || typeof node !== "object") return node;
    if (node.$ref) {
      const path = node.$ref.replace(/^#\//, "").split("/");
      return path.reduce((acc, k) => acc?.[k], spec);
    }
    return node;
  }

  function exampleFor(spec, schema) {
    const s = deref(spec, schema);
    if (!s) return undefined;
    if (s.example !== undefined) return s.example;
    const content = s.content?.["application/json"];
    if (content?.example) return content.example;
    if (Array.isArray(s.allOf)) {
      for (const part of s.allOf) {
        const ex = exampleFor(spec, part);
        if (ex !== undefined) return ex;
      }
    }
    return undefined;
  }

  function buildPanel(spec, container) {
    const method = container.dataset.method;
    const path = container.dataset.path;

    const item = spec.paths?.[path];
    const op = item?.[method];
    if (!op) return; // spec and generated HTML disagree — fail quiet, not loud

    const pathParams = (op.parameters ?? [])
      .map((p) => deref(spec, p))
      .filter((p) => p.in === "path");
    const queryParams = (op.parameters ?? [])
      .map((p) => deref(spec, p))
      .filter((p) => p.in === "query");

    const bodySchema = op.requestBody?.content?.["application/json"];
    const bodyExample = bodySchema?.example ?? exampleFor(spec, deref(spec, bodySchema?.schema));
    const needsBody = Boolean(bodySchema);
    const needsIdempotency = method === "post";

    const fieldsHtml = [
      ...pathParams.map(
        (p) => `<div class="tryit-field">
          <label>${escapeHtml(p.name)} <span class="tryit-req">path</span></label>
          <input type="text" data-param="path:${escapeHtml(p.name)}" placeholder="${escapeHtml(p.name)}">
        </div>`,
      ),
      ...queryParams.map(
        (p) => `<div class="tryit-field">
          <label>${escapeHtml(p.name)}</label>
          <input type="text" data-param="query:${escapeHtml(p.name)}" placeholder="optional">
        </div>`,
      ),
    ].join("");

    const bodyHtml = needsBody
      ? `<div class="tryit-field">
          <label>Body (JSON)</label>
          <textarea data-param="body" rows="6" spellcheck="false">${escapeHtml(
            JSON.stringify(bodyExample ?? {}, null, 2),
          )}</textarea>
        </div>`
      : "";

    container.innerHTML = `
      <div class="tryit-panel">
        <div class="tryit-panel-head">Try it</div>
        ${fieldsHtml}
        ${bodyHtml}
        <button class="tryit-send" type="button">Send request</button>
        <div class="tryit-result" hidden></div>
      </div>`;

    const sendBtn = container.querySelector(".tryit-send");
    const resultEl = container.querySelector(".tryit-result");

    sendBtn.addEventListener("click", async () => {
      const base = (baseInput.value || "").replace(/\/$/, "");
      const key = keyInput.value.trim();

      if (!base) {
        showResult(resultEl, { error: "Set a base URL above first." }, null);
        return;
      }

      let resolvedPath = path;
      container.querySelectorAll('[data-param^="path:"]').forEach((input) => {
        const name = input.dataset.param.slice(5);
        if (input.value) resolvedPath = resolvedPath.replace(`{${name}}`, encodeURIComponent(input.value));
      });

      const query = new URLSearchParams();
      container.querySelectorAll('[data-param^="query:"]').forEach((input) => {
        const name = input.dataset.param.slice(6);
        if (input.value) query.set(name, input.value);
      });
      const qs = query.toString();

      const headers = {};
      if (key) headers["Authorization"] = `Bearer ${key}`;
      if (needsBody) headers["Content-Type"] = "application/json";
      if (needsIdempotency) {
        headers["Idempotency-Key"] =
          crypto.randomUUID?.() ?? `tryit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }

      let body;
      if (needsBody) {
        const raw = container.querySelector('[data-param="body"]').value;
        try {
          body = JSON.stringify(JSON.parse(raw));
        } catch {
          showResult(resultEl, { error: "Body is not valid JSON." }, null);
          return;
        }
      }

      sendBtn.disabled = true;
      sendBtn.textContent = "Sending...";

      try {
        const res = await fetch(`${base}${resolvedPath}${qs ? `?${qs}` : ""}`, {
          method: method.toUpperCase(),
          headers,
          body,
        });
        const text = await res.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
        showResult(resultEl, parsed, res.status);
      } catch (err) {
        // A network-level failure this far along is almost always CORS or an
        // unreachable base URL — say so plainly rather than a bare "Failed to fetch".
        showResult(
          resultEl,
          { error: `Could not reach ${base}. Check the base URL, and that the API allows requests from this page's origin.` },
          null,
        );
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send request";
      }
    });
  }

  function showResult(el, body, status) {
    el.hidden = false;
    const statusHtml =
      status === null
        ? ""
        : `<div class="tryit-status ${status < 300 ? "ok" : "err"}">${status}</div>`;
    el.innerHTML = `${statusHtml}<pre>${escapeHtml(JSON.stringify(body, null, 2))}</pre>`;
  }

  fetch("openapi.json")
    .then((r) => r.json())
    .then((spec) => {
      document.querySelectorAll(".tryit[data-method]").forEach((el) => buildPanel(spec, el));
    })
    .catch(() => {
      // The reference text and examples still work without this; a try-it
      // panel that never appears is a much smaller problem than a page
      // that throws and shows nothing.
      console.warn("Auctra try-it console: could not load openapi.json");
    });
})();
