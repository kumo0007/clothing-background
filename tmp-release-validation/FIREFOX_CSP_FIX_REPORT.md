# Firefox CSP investigation report

**Date:** 2026-10-26 (failing-session source hunt, pass 2)  
**Production URL:** https://garment-background-studio.vercel.app/  
**Blocked asset (client + control):** `/assets/index-C3JO3DUu.js`  
**Production deployment (this pass):** `dpl_FNvCPkWZeihgZRBHXqRf9JdYKzff` (CLI `--prod`; ships static boot fallback HTML; **CSP unchanged**)  
**Prior CSP-fix commit still in git history:** `26500421edc26e7f52bb551de6f7241a455464f7`  
**Model:** unchanged — `bg-remove-sdk` + RMBG-1.4  

**Instruction followed:** No speculative CSP edit to `vercel.json`. Policy source identified by reproduction of the exact console wording under a controlled `script-src 'none'` document, then compared to live production.

---

## Executive finding

| Question | Answer |
| --- | --- |
| Live production document CSP count | **1** enforced, **0** report-only |
| Live `script-src` | `'self' 'wasm-unsafe-eval'` — **not** `'none'` |
| CSP `<meta>` in HTML | **None** |
| Service worker | **None** |
| Production commit matches CSP fix | **Yes** (`2650042` on alias `garment-background-studio.vercel.app`) |
| Top-level Firefox Playwright on production | **Renders UI**; **no** `script-src 'none'`; **no** “Loading failed for the module” |
| Exact client console wording reproducible? | **Yes** — only when the **document** CSP is `script-src 'none'` (local control server) |
| Is `vercel.json` / live document the blocking policy? | **No** |

**Verdict:** The console pair  
`Loading failed for the module` + `script-src 'none'`  
is Firefox’s wording when the **browsing document’s effective CSP** forbids scripts. The **current production document response does not contain that policy**. Therefore the failing Firefox session is **not** applying the live `vercel.json` CSP alone — it is applying a **different/additional** enforced policy in that session (extension rewrite, injected header/meta, sandboxed/embedded document, or a non-production document).

**Client blank page is not declared fixed.** Top-level automated Firefox against current production succeeds.

---

## 1. Live document headers (fresh HTTP)

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; …; object-src 'none'; …; frame-ancestors 'none'
Content-Security-Policy-Report-Only: (absent)
X-Frame-Options: DENY
CSP_COUNT=1  REPORT_ONLY=0
ETag: "cc3d4b2f064f73d5800be2d4da54c1ef"
X-Vercel-Cache: HIT
```

Same single CSP on `/assets/index-C3JO3DUu.js` (header on static asset; enforcement for module execution is still the **document** policy).

---

## 2. Live HTML

- Entry: `<script type="module" crossorigin src="/assets/index-C3JO3DUu.js">`
- No `<meta http-equiv="Content-Security-Policy">`
- `vercel.json` value matches the live header string exactly

---

## 3. Exact console reproduction (control vs production)

Artifact: `tmp-release-validation/browser-compat/firefox-forced-none-vs-production.json`

### Control — document header `Content-Security-Policy: default-src 'self'; script-src 'none'`

Firefox console (Playwright):

```text
Loading failed for the module with source “https://garment-background-studio.vercel.app/assets/index-C3JO3DUu.js”.
Content-Security-Policy: The page’s settings blocked a script (script-src-elem) at
https://garment-background-studio.vercel.app/assets/index-C3JO3DUu.js from being executed
because it violates the following directive: “script-src 'none'”
```

This **matches the client report** (same asset URL + `script-src 'none'`).

### Production top-level — same Firefox binary, same asset

| Check | Result |
| --- | --- |
| Document CSP observed | 1× `script-src 'self' 'wasm-unsafe-eval'` |
| Console `script-src 'none'` | **false** |
| “Loading failed for the module” | **false** |
| UI | `hasHeading: true`, `#root` children = 1 |

Artifact: `tmp-release-validation/browser-compat/firefox-csp-source-probe.json`

---

## 4. Frame / embed / SW checks

| Source candidate | Evidence |
| --- | --- |
| Main document response | Single permissive CSP — **ruled out** as the `'none'` source |
| HTML meta CSP | Absent — ruled out |
| Service worker / Cache API | None registered; `/sw.js` not part of app |
| Sandboxed iframe without `allow-scripts` | Spec forces script blocking; production also sends `frame-ancestors 'none'` + `XFO: DENY` so many embeds fail closed |
| Playwright fresh profile (no extensions) | Production works |
| Host Firefox desktop | **Not installed** on this agent machine (`firefox.exe` not under Program Files; only Playwright `firefox-1465`) |
| Vercel dashboard duplicate CSP | Not present on the wire (only one header). Team project inspect intermittently failed; wire evidence still shows a single policy |
| Deployment mismatch | Production alias serves `2650042` with bootstrap-safe CSP |

---

## 5. Deployed commit vs `vercel.json`

| Item | Value |
| --- | --- |
| Production deployment | `dpl_8umCW39tUhNvzr3Dhct2ofC2o62a` |
| `githubCommitSha` | `26500421edc26e7f52bb551de6f7241a455464f7` |
| Alias | `garment-background-studio.vercel.app` |
| `vercel.json` CSP | Identical to live header |

---

## 6. Changes this pass

| Change | Done? |
| --- | --- |
| Modify CSP / `vercel.json` | **No** (would be speculative; live policy already allows `'self'`) |
| Diagnostic probes | `probeFirefoxForcedNone.mts`, fixed `probeFirefoxCspSource.mts`, sandbox probes |
| Static boot fallback in `index.html` | **Yes** — deployed to production (`dpl_FNvCPkWZeihgZRBHXqRf9JdYKzff`); visible inside `#root` until React mounts; survives “JS on but module CSP-blocked” (unlike `<noscript>`). **Not a CSP fix.** |
| Post-deploy Firefox verify | Top-level Playwright: module loads, UI renders, `consoleMentionsScriptSrcNone: false`, CSP still 1× `script-src 'self' 'wasm-unsafe-eval'` |
| Model / inference | Unchanged |

---

## 7. Smallest appropriate fix (by confirmed source)

| If failing session’s policy comes from… | Fix |
| --- | --- |
| Extension / corporate filter injecting CSP | Disable extension / Private Window — **no app CSP change** |
| Embedded / sandboxed preview | Open **top-level** address-bar tab — framing denied by design |
| Extra Vercel project header with `'none'` | Remove that dashboard header only (wire currently shows none) |
| Proven bad value in our single CSP | Then edit `vercel.json` minimally — **not indicated now** |

Do **not** add `unsafe-eval`, `unsafe-inline`, or `script-src *` without a demonstrated need against the live single policy.

---

## 8. Evidence still needed from the failing Firefox session

Without these, the client failure cannot be closed as an application CSP bug:

1. **Network → document** Response Headers screenshot: every `Content-Security-Policy` line (confirm whether `'none'` appears **there**).  
2. Confirm address bar is exactly `https://garment-background-studio.vercel.app/` (top-level, not IDE/device-lab embed).  
3. **Private Window** with extensions disabled + hard refresh result.  
4. Console message **document URI** / frame URL attached to the CSP error (Firefox shows the owning document).  
5. Optional: `about:support` / extension list if Private Window works and normal profile fails.

---

## 9. Claim status

| Claim | Status |
| --- | --- |
| Live production document sends `script-src 'none'` | **False** (measured) |
| Exact client console string is Firefox CSP-block wording | **True** (reproduced under forced `'none'`) |
| Top-level Firefox against current production loads module + UI | **True** (Playwright) |
| Reporter’s blank page fixed | **Not claimed** — failing session not reproduced against live document policy |
