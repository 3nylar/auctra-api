/**
 * Every dashboard page loads this before its own inline script.
 *
 * `AUCTRA_API` is the one thing you edit after deploying — see the comment
 * below. Everything else is `credentials: "include"` on every request, which
 * is what makes the login cookie actually travel: without it, a cross-site
 * fetch never attaches cookies at all, logged in or not.
 */

// EDIT THIS after you deploy the API — point it at your real Railway URL.
const AUCTRA_API = "https://auctra-api-production.up.railway.app";

async function api(method, path, body) {
  const res = await fetch(`${AUCTRA_API}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const message = json?.error?.message ?? `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return json;
}

function showError(el, err) {
  el.textContent = err.message || String(err);
  el.classList.add("show");
}

function hideError(el) {
  el.classList.remove("show");
}
