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

## 5. Deploy status

- Fix is committed to git as `vercel.json` + CSP module (requires push / Vercel production deploy).  
- Until production serves the new headers, `curl -sI` will still show **no** CSP.  
- After deploy, expect:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; …
```

and Firefox Network → document → Response Headers should match. Console must **not** report `script-src 'none'` for `/assets/index-*.js`.

### If blank page persists after redeploy

1. In Vercel → Project → **Settings → Security / Headers**, remove any extra CSP with `default-src 'none'` or `script-src 'none'` (intersecting policies).  
2. Hard-refresh Firefox (Ctrl+F5) or try a Private Window (extensions off).  
3. Approve team access if agents need to inspect dashboard headers: use the Vercel consent link from the agent session.

---

## 6. Remaining issues

- Pre-fix production responses we measured had **no CSP** — client `script-src 'none'` was **not** observed on the wire from this environment.  
- Dashboard header inspection blocked (`403` team scope) until consent.  
- Post-deploy Firefox confirmation of “no CSP violation + UI renders” must be recorded after the new deployment is live.  
- Model / commercial blockers unchanged.
