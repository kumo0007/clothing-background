# Browser compatibility report — blank page investigation

**Date:** 2026-10-26  
**Production URL:** https://garment-background-studio.vercel.app/  
**Production model:** unchanged — `bg-remove-sdk` + BRIA RMBG-1.4  

---

## 1. Verdict

| Question | Answer |
| --- | --- |
| Blank page reproduced in Firefox (automated)? | **No** |
| Root cause of the client blank-page report | **Undetermined** — not observed on Firefox 131 against current production or local production preview |
| Firefox main UI renders? | **Yes** (Playwright Firefox 131) |
| Claim “Firefox blank page is fixed”? | **No** — issue was not reproduced; defensive boot UI was added |

---

## 2. Evidence

### Automated Firefox probe (Playwright Firefox 131.0)

| Target | `hasAppHeading` | `#root` children | Console errors | Page errors | Failed network |
| --- | --- | --- | --- | --- | --- |
| Production `garment-background-studio.vercel.app` | **true** | 1 | none | none | none |
| Local `vite preview` (`127.0.0.1:4179`) | **true** | 1 | none | none | none |

Artifacts:

- `tmp-release-validation/browser-compat/firefox-prod.png` — full UI visible  
- `tmp-release-validation/browser-compat/probe-results.json`  

### Chromium (Cursor embedded browser)

Production URL rendered the full studio UI (heading, upload, canvas). UA was Chromium/Electron — not Firefox.

### Network / assets (production)

| Check | Result |
| --- | --- |
| HTML `200`, `Content-Type: text/html` | OK |
| Entry JS `/assets/index-*.js` `application/javascript` | OK |
| CSS `text/css` | OK |
| CSP header | None set (no CSP violation evidence) |
| COOP/COEP | Not set (by design — HF model CDN) |
| Failure stage | **Startup render succeeded** — not an ONNX/WebGPU init failure |

`Running model…` / auto-mask was **not** required for the main UI to appear. Startup ≠ inference.

### Host Firefox desktop app

System `firefox.exe` was not found via PATH/registry in this agent environment. Interactive Computer Use was aborted by the user. Probes used Playwright’s bundled Firefox instead.

---

## 3. What was ruled out (for the probed builds)

- Missing entry script / wrong MIME (assets load as JS/CSS).  
- Immediate React mount failure on Firefox 131 (heading present, no `pageerror`).  
- SharedArrayBuffer / COOP requirement for first paint (app boots without COOP).  
- Silent model substitution (still `bg-remove-sdk` / RMBG-1.4 copy and chunk).  

Possible *unverified* client-side explanations for a historical blank page (not evidenced here): browser extensions (e.g. SES/lockdown), stale cached HTML pointing at a rotated chunk during deploy, older Firefox than 105, or a prior broken deploy.

---

## 4. Hardening changes (blank-page resilience)

Even without a reproduced Firefox crash, the app previously had **no** ErrorBoundary: any render exception left `#root` empty.

| File | Change |
| --- | --- |
| `src/components/AppErrorBoundary.tsx` | Visible recovery UI on render errors |
| `src/main.tsx` | try/catch boot; DOM-safe failure panel |
| `src/lib/browser/bootCompat.ts` | Worker/OffscreenCanvas warnings without blocking UI |
| `index.html` | `<noscript>` fallback |
| `src/index.css` | Styles for boot/error panels |
| `vite.config.ts` | Explicit build targets including `firefox105` |
| `scripts/probeFirefoxBlank.mts` | Repro probe for Firefox/Chromium |

Model path, thresholds, and batch/edit/export behavior were **not** changed for substitution.

---

## 5. Tests / commands

| Command | Exit | Detail |
| --- | ---: | --- |
| `npm run typecheck` | **0** | |
| Focused ErrorBoundary + bootCompat tests | **0** | 5 tests |
| `npm test` | **0** | **323** tests / **51** files |
| `npm run build` | **0** | |
| Playwright Firefox → production | **0** | UI present, no errors |
| Playwright Firefox → local preview | **0** | UI present, no errors |
| Physical Safari / older Firefox | **NOT RUN** | |

---

## 6. Manual verification (if blank page returns)

1. Open https://garment-background-studio.vercel.app/ in Firefox **Private Window** (extensions off).  
2. Confirm heading “Garment Background Studio” and Upload card appear.  
3. If blank: F12 → Console + Network; note red errors and any `404` on `/assets/*.js`.  
4. Hard refresh (Ctrl+F5). Compare with Chrome on the same machine.  
5. Optional: `npx playwright-core install firefox` then  
   `npx tsx scripts/probeFirefoxBlank.mts https://garment-background-studio.vercel.app/`  

Auto-mask may still fail on browsers lacking Worker/OffscreenCanvas; that must show an actionable Batch error, **not** a blank shell.

---

## 7. Unresolved limitations

- Client-reported blank page **not reproduced** on Firefox 131.  
- Deployed production at probe time still served an older entry hash than the latest local build until the next deploy.  
- WebKit/Safari desktop not automated in this pass.  
- Auto-mask backend (WASM/WebGPU) compatibility is separate from first-paint UI.
