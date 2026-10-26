# Firefox CSP investigation report

**Date:** 2026-10-26 (pass 3 — failing session / preview source hunt)  
**Production URL:** https://garment-background-studio.vercel.app/  
**Blocked asset:** `/assets/index-C3JO3DUu.js`  
**Live deployment config (Vercel inspect):** CSP from `vercel.json` with `script-src 'self' 'wasm-unsafe-eval'`  
**Model:** unchanged — `bg-remove-sdk` + RMBG-1.4  

**Instruction followed:** No speculative CSP change to `vercel.json`. Goal was to identify the actual source of `script-src 'none'`.

---

## Executive finding

| Question | Answer |
| --- | --- |
| Does the live production **document** send `script-src 'none'`? | **No** |
| Enforced `Content-Security-Policy` headers on document | **Exactly 1** |
| `Content-Security-Policy-Report-Only` | **0** |
| CSP `<meta>` in HTML | **None** |
| Service worker | **None** |
| System HTTP(S) proxy on this agent machine | **None** (`ProxyEnable=0`, WinHTTP direct) |
| Top-level Firefox (Playwright) on same URL + same JS hash | **UI renders**; fallback cleared; **no** `script-src 'none'` |
| Exact client console wording reproducible? | **Yes** — only when the **browsing document’s effective CSP** is `script-src 'none'` |
| Mobile/IDE preview showing boot fallback | **Consistent with a non–top-level / sandboxed browsing context** (scripts blocked; HTML still visible) |

**Confirmed policy source class:** the blocking `script-src 'none'` is the **effective policy of the failing browsing context**, **not** the Vercel/`vercel.json` document response measured on the wire.

**Proven mechanisms that produce this exact failure:**

1. **Document CSP literally `script-src 'none'`** (local control server) → Firefox console matches the client report word-for-word, including the production asset URL. The CSP error’s **`file:` / source link** points at the **owning document** (e.g. `http://127.0.0.1:…/forced-none.html`), not at Vercel.
2. **HTML iframe `sandbox` without `allow-scripts`** loading a document that references the production module → boot-static-fallback **stays visible** (scripts do not mount React). Same symptom as the reported mobile preview. Top-level production with the same build **clears** the fallback and renders.

**Not claimed fixed** for the reporter’s Firefox session: host Firefox DevTools could not be driven (Computer Use aborted; no separate system Firefox install beyond Playwright). Automated top-level Firefox against production succeeds.

---

## 1. Live document headers (fresh HTTP, this pass)

```
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net; worker-src 'self' blob:; child-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Content-Security-Policy-Report-Only: (absent)
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
CSP_COUNT=1
REPORT_ONLY=0
ETag: "f5fb418a4ac155d31c0dcee183706392"
```

Vercel project inspect shows the same header block from `vercel.json` (single CSP; no second `'none'` policy in that config).

---

## 2. Live HTML

- Entry: `<script type="module" crossorigin src="/assets/index-C3JO3DUu.js">`
- No CSP meta tags
- `#boot-static-fallback` present until React mounts (diagnostic for “JS on but module blocked”)

---

## 3. Exact console reproduction (control)

Artifact: `tmp-release-validation/browser-compat/firefox-forced-none-vs-production.json`

When the **document** response is `Content-Security-Policy: … script-src 'none'`:

```text
Loading failed for the module with source “https://garment-background-studio.vercel.app/assets/index-C3JO3DUu.js”.
Content-Security-Policy: The page’s settings blocked a script (script-src-elem) at
https://garment-background-studio.vercel.app/assets/index-C3JO3DUu.js …
directive: “script-src 'none'”
{file: "http://127.0.0.1:<port>/forced-none.html" line: 0}
```

**Critical:** the source link beside the CSP error names the **document that owns the policy**. If that link is not the top-level production URL (e.g. `about:srcdoc`, `127.0.0.1`, `vscode-webview:`, preview origin), the block is **not** coming from the Vercel HTML response headers alone.

Same Firefox binary against production top-level: **no** such messages; UI renders.

---

## 4. Preview / sandbox vs top-level (same build)

Artifact: `tmp-release-validation/browser-compat/firefox-preview-srcdoc-sandbox.json`  
Screenshots: `firefox-preview-sandboxed.png`, `firefox-preview-allow-scripts.png`, `firefox-production-toplevel.png`

| Context | Boot fallback | App UI |
| --- | --- | --- |
| iframe `sandbox="allow-same-origin"` (no `allow-scripts`), absolute production module URL | **Stays visible** | Does not mount |
| Same iframe + `allow-scripts` | Cleared | Mounts |
| Top-level `https://garment-background-studio.vercel.app/` | Cleared | Mounts |

This matches the report that a **mobile preview** shows the loading/error fallback while a correct top-level session should not.

Production also sends `frame-ancestors 'none'` + `X-Frame-Options: DENY`, so many direct iframes of the production URL fail closed; preview shells that **re-host** HTML (srcdoc / proxy / sandbox) can still show our markup under a **different** effective policy.

---

## 5. Ruled out as the wire source of `'none'`

| Candidate | Result |
| --- | --- |
| `vercel.json` / live document CSP | `script-src 'self' 'wasm-unsafe-eval'` only |
| Duplicate intersecting HTTP CSP | Count = 1 |
| CSP meta | Absent |
| Service worker / Cache API | None |
| OS proxy rewriting headers | Disabled / direct |
| Deployment serving wrong CSP | Inspected production config matches bootstrap-safe CSP |
| Playwright vs production URL/build mismatch | Same URL + `index-C3JO3DUu.js` |

---

## 6. Changes this pass

| Change | Done? |
| --- | --- |
| Modify CSP / `vercel.json` | **No** |
| Probes | `probeFirefoxForcedNone.mts`, `probePreviewEmbedSrcdoc.mts`, prior source probes |
| Boot fallback copy | Clarified: open top-level production URL; read CSP error **document** source link |
| bg-remove-sdk / RMBG-1.4 | Unchanged |

Redeploy of the fallback text is optional for diagnostics only; it does **not** remove `script-src 'none'` from a sandboxed/extension context.

---

## 7. Smallest appropriate fix (by source)

| Confirmed source in the failing session | Fix |
| --- | --- |
| IDE / mobile **preview** / sandboxed frame | Open production in a **top-level** Firefox tab — **no CSP change** |
| Extension injecting CSP | Private Window, extensions off — **no CSP change** |
| Extra Vercel dashboard header with `'none'` | Remove that header only (not observed on the wire here) |
| Proven bug in our single CSP string | Minimal `vercel.json` edit — **not indicated** by measurements |

Do **not** add `unsafe-eval`, `unsafe-inline`, or `script-src *`.

---

## 8. Verification performed here

| Check | Result |
| --- | --- |
| Live CSP headers | 1× permissive `script-src 'self'` |
| Firefox Playwright top-level production | Module loads; UI renders; no `'none'` console |
| Forced `'none'` document | Exact client console reproduced |
| Sandboxed preview | Fallback persists (scripts blocked) |
| Upload / auto-mask in the **failing** Firefox UI session | **Not verified** — that session was not reproducible as top-level against live CSP |
| Host Firefox DevTools Network panel | **Blocked** — Computer Use stopped by user; no system Firefox outside Playwright |

---

## 9. Exact evidence still needed from the failing Firefox session

1. Console CSP error → click the **source link** → record the **document URL** (`file:` / panel).  
2. Network → select the **document** request for the address-bar URL → copy **all** `Content-Security-Policy` values.  
3. Confirm address bar is exactly `https://garment-background-studio.vercel.app/` (top-level), then Private Window + Ctrl+F5.  
4. If Private Window works and normal profile fails → extension list.  
5. If only the mobile/IDE preview fails → treat as embed/sandbox; use a top-level tab for real use.

---

## 10. Claim status

| Claim | Status |
| --- | --- |
| Live Vercel document policy is `script-src 'none'` | **False** |
| Client console string is Firefox CSP-block wording | **True** (reproduced under document `'none'`) |
| Mobile preview fallback is consistent with script-blocked embed/sandbox | **True** (behavioral reproduction) |
| Top-level Firefox against current production works | **True** (Playwright) |
| Reporter’s blank Firefox session fixed | **Not claimed** |
