# Firefox CSP fix report

**Date:** 2026-10-26  
**Production URL:** https://garment-background-studio.vercel.app/  
**Entry module (pre-redeploy):** `/assets/index-DnmKjkLx.js`  
**Model:** unchanged — `bg-remove-sdk` + RMBG-1.4  

---

## 1. Client-reported failure

Firefox Console: the Vite entry script is refused because it violates **`script-src 'none'`**, leaving a blank page (no app UI).

Exact filename on the live HTML at investigation time: `assets/index-DnmKjkLx.js` (not `DnmKlkX` — likely a transcription typo).

---

## 2. What was on the wire before the fix

| Probe | Content-Security-Policy | Notes |
| --- | --- | --- |
| `curl -sI` production HTML | **Absent** | HSTS present; no CSP / CSP-Report-Only |
| `curl` with Firefox UA | **Absent** | Same |
| Playwright Firefox 131 response headers | **Absent** | App **did** render in that probe |
| HTML `<meta http-equiv="Content-Security-Policy">` | **Absent** | No CSP meta in deployed or source `index.html` |
| Repo (`vercel.json`, headers files) | **None** before this change | GitHub search: 0 CSP matches |

**Conclusion on policy source:** There was **no CSP in the repository** and **no CSP header** on the production responses we measured from this environment. A `script-src 'none'` / `default-src 'none'` policy that blocks the entry module therefore must come from one of:

1. A **Vercel project / dashboard security-header** setting not present in git (requires team auth to inspect — consent link requested), and/or  
2. A **second, client-local** policy (extension, corporate proxy, cached document), and/or  
3. A **prior deploy** the client still has cached.

Multiple CSP headers **intersect** (all must pass). If a dashboard policy is `default-src 'none'` with no `script-src`, scripts stay blocked even after adding a good `vercel.json` CSP — the dashboard policy must be removed or updated.

---

## 3. Fix applied in-repo

### `vercel.json` (new)

Sets a single bootstrap-safe CSP for `/(.*)` plus standard hardening headers (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`).

Effective CSP value:

```text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self';
img-src 'self' blob: data:;
font-src 'self';
connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net;
worker-src 'self' blob:;
child-src 'self' blob:;
media-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none'
```

| Choice | Reason |
| --- | --- |
| `script-src 'self'` | Allows Vite `/assets/*.js` entry + chunks |
| `'wasm-unsafe-eval'` | Required for ONNX/transformers WASM under CSP (not `'unsafe-eval'`) |
| `worker-src` / `child-src` `blob:` | bg-remove-sdk inline worker |
| `connect-src` HF + jsDelivr | Model weight / runtime asset fetches |
| No `script-src *` | Avoided |
| No `'unsafe-inline'` / `'unsafe-eval'` | Avoided |

Shared source of truth: `src/lib/security/contentSecurityPolicy.ts` (regenerate via `npx tsx scripts/generateVercelJson.mts`).

### Tests

`src/lib/security/contentSecurityPolicy.test.ts` asserts:

- Policy is not script-blocking (`'none'`).  
- `vercel.json` CSP matches the module.  
- `index.html` has no conflicting CSP meta.

---

## 4. Verification commands (local)

| Command | Exit |
| --- | ---: |
| `npm run typecheck` | **0** |
| CSP unit tests | **0** (4) |
| `npm test` | **0** (**327** / **52**) |
| `npm run build` | **0** |

### Browser probes (this agent)

| Check | Result |
| --- | --- |
| Playwright Firefox → production (before redeploy) | UI rendered; **no** CSP header; **no** CSP console violation |
| Playwright Firefox → local preview | UI rendered |
| Deploy + re-check production CSP header | **Pending redeploy** (see §5) |
| Host Firefox desktop DevTools with user console | **Not available** here |

---

## 5. Deploy status (verified)

| Step | Result |
| --- | --- |
| Git push `1a45ba7` → `main` | Done |
| Production HTML entry | `/assets/index-C3JO3DUu.js` |
| Production `Content-Security-Policy` | Present — `script-src 'self' 'wasm-unsafe-eval'` (not `'none'`) |
| Playwright Firefox 131 post-deploy | **UI renders** (`hasHeading: true`); **0** console errors; **0** page errors; CSP header observed on document + assets |

Effective deployed document CSP (abbreviated):

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; …; object-src 'none'; frame-ancestors 'none'
```

### If a blank page still appears for a specific client

1. Hard-refresh (Ctrl+F5) or Firefox Private Window (extensions off) — stale caches may still hold an old policy.  
2. In Vercel → Project → **Settings → Security / Headers**, remove any **additional** CSP with `default-src 'none'` / `script-src 'none'` (multiple CSPs intersect).  
3. Confirm Network → document shows the policy above and that `/assets/index-*.js` is status 200.

---

## 6. Remaining issues

- Pre-fix production responses measured here had **no CSP**; the client’s `script-src 'none'` was not present on the wire from this agent before deploy (possible dashboard/extension/cache source).  
- Dashboard header inventory still needs team consent for full audit.  
- Host Firefox desktop DevTools (non-Playwright) not used in this pass.  
- Model / commercial readiness unchanged (**NOT READY FOR COMMERCIAL PRODUCTION**).
