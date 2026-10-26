# Firefox CSP investigation report

**Date:** 2026-10-26 (pass 4)  
**Production URL:** https://garment-background-studio.vercel.app/  
**Blocked asset (client report):** `/assets/index-C3JO3DUu.js`  
**Model:** unchanged — `bg-remove-sdk` + RMBG-1.4  

**Instruction followed:** No speculative CSP change. Identify the source of `script-src 'none'` before editing policy.

---

## Executive finding

| Question | Answer |
| --- | --- |
| Live production document `Content-Security-Policy` count | **1** |
| Live `script-src` | `'self' 'wasm-unsafe-eval'` — **not** `'none'` |
| `Content-Security-Policy-Report-Only` | **0** |
| CSP `<meta>` | **None** |
| Service worker | **None** |
| OS proxy | **None** (`ProxyEnable=0`) |
| Top-level Firefox (Playwright) Network → document CSP | Same single permissive header |
| Top-level Firefox UI | Renders; boot fallback cleared |
| Top-level Firefox upload smoke | **Pass** (slip-dress fixture appears in UI) |
| Exact client console (`Loading failed` + `script-src 'none'`) | Reproduced **only** when the **owning document** has CSP `script-src 'none'` |
| CSP error **source link** (`file:`) in that control | Points at the **local owning document**, not at Vercel |
| Mobile preview showing boot fallback | Matches a **script-blocked browsing context** (embed/sandbox/extension), not the live Vercel header |

**Confirmed:** The blocking policy is **not** the current Vercel/`vercel.json` document response.

**Confirmed mechanism for the console text:** Firefox emits that pair when the **effective document CSP** (of whatever page owns the `<script type="module">`) includes `script-src 'none'`. The source link beside the error is that document’s URL.

**Not claimed fixed** for the reporter’s blank Firefox/mobile-preview session. Host Firefox DevTools could not be operated (Computer Use stopped; no Mozilla Firefox install under Program Files — only Playwright `firefox-1465`). Automated top-level production Firefox succeeds.

---

## 1. Live document headers + HTML (HTTP)

```
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; …; object-src 'none'; …; frame-ancestors 'none'
Content-Security-Policy-Report-Only: (absent)
X-Frame-Options: DENY
CSP_COUNT=1  REPORT_ONLY=0
ETag: "67d78af67778d488e9ba5b1107ce8a8f"
```

HTML: module entry `/assets/index-C3JO3DUu.js`; no CSP meta; `#boot-static-fallback` until React mounts.

---

## 2. Firefox “Network → document” equivalent (Playwright)

Artifact: `tmp-release-validation/browser-compat/firefox-devtools-evidence.json`

### Production top-level

| Field | Value |
| --- | --- |
| `isTop` | `true` |
| `frameElement` | `null` |
| Document CSP headers | **1×** `script-src 'self' 'wasm-unsafe-eval'` |
| Report-Only | none |
| Meta CSP | none |
| `mentionsScriptSrcNone` | `false` |
| Fallback visible | `false` |
| Heading | `Garment Background Studio` |

### Control document (`script-src 'none'`) loading the **same** production asset URL

| Field | Value |
| --- | --- |
| Document CSP | `script-src 'none'` |
| Console | `Loading failed for the module` + `script-src 'none'` for `…/assets/index-C3JO3DUu.js` |
| CSP error `file:` / source | `http://127.0.0.1:<port>/forced-none.html` |

**Interpretation:** If the reporter’s CSP error source link is **not** `https://garment-background-studio.vercel.app/`, the block is owned by another document/context (preview, srcdoc, extension page, etc.). If it **is** that URL but Network → document shows only `script-src 'self'`, a second intersecting policy is being applied **in-browser** (extension) and will not appear as a second Vercel header on curl.

---

## 3. Source classification

| Candidate | Status |
| --- | --- |
| Vercel response / `vercel.json` | **Ruled out** as `'none'` source (measured) |
| Duplicate HTTP CSP intersection | **Ruled out** (count = 1) |
| CSP meta | **Ruled out** |
| Service worker / Cache API | **Ruled out** |
| OS HTTP proxy | **Ruled out** on this machine |
| iframe `sandbox` without `allow-scripts` | **Can** force script blocking + leave boot fallback visible (preview symptom) |
| Browser extension injecting CSP | **Plausible** if top-level Private Window works and normal profile fails |
| IDE / mobile device preview shell | **Consistent** with client report (fallback visible in preview) |

Production also sends `frame-ancestors 'none'` + `XFO: DENY`, so many direct iframes of the production URL fail closed; preview tools that re-host HTML can still show our markup under a **different** effective policy.

---

## 4. Compare failing report vs successful Playwright (same URL/build)

| Item | Client report | Playwright top-level |
| --- | --- | --- |
| URL | production | same |
| Entry JS | `index-C3JO3DUu.js` | same |
| Document CSP on wire | (claims `'none'`) | `script-src 'self' 'wasm-unsafe-eval'` |
| UI | blank / fallback | full UI |
| Upload | n/a | fixture upload OK |

---

## 5. Fix applied

| Change | Done? |
| --- | --- |
| Change CSP / loosen `script-src` | **No** — would be speculative against measured production policy |
| Change bg-remove-sdk / RMBG-1.4 | **No** |
| Operational fix for confirmed non-document source | Use a **top-level** Firefox tab to the production URL; Private Window; Ctrl+F5; read CSP error **document** source link |
| Diagnostic boot fallback copy | Already ships guidance for top-level vs preview |

There is **no correct app-side CSP edit** that overrides a sandboxed preview without `allow-scripts` or an extension-injected intersecting `'none'` policy (CSP policies intersect; a second restrictive policy still blocks).

---

## 6. Verification (this environment)

| Check | Result |
| --- | --- |
| curl document CSP | 1× `'self'` |
| Firefox top-level render | Pass (`firefox-devtools-evidence.json`) |
| Firefox upload smoke | Pass (`firefox-production-upload-smoke.json`) |
| Auto-mask in Firefox | **Not run this pass** (`--mask` not requested; long model download) — separate from CSP bootstrap |
| Reporter’s failing Firefox/mobile preview | **Not reproduced** as top-level against live CSP |
| Host Firefox DevTools | Unavailable here |

---

## 7. Evidence still needed from the failing session

1. Console → CSP error → **source link document URL** (must paste exact string).  
2. Network → **document** request for the address-bar URL → every `Content-Security-Policy` value.  
3. Screenshot of address bar showing top-level `https://garment-background-studio.vercel.app/` vs preview chrome.  
4. Private Window (extensions off) result on that same URL.  

Until (1)–(2) show `'none'` on the production document response itself, treat further `vercel.json` edits as speculative.

---

## 8. Claim status

| Claim | Status |
| --- | --- |
| Production Vercel policy is `script-src 'none'` | **False** |
| Client console text is real Firefox CSP-block wording | **True** (control) |
| Top-level automated Firefox loads module + UI + upload | **True** |
| Reporter blank page / mobile preview fixed | **Not claimed** |
