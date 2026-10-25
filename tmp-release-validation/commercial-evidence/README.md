# Commercial evidence directory

Place **offline** BRIA commercial-agreement artifacts here when the project owner obtains them (PDF/DocuSign export, etc.).

## Rules

- This folder is the **only** path the automated gate accepts for `**Evidence artifact:**`.
- Checklist values should be filenames relative to this directory (e.g. `bria-rmbg-1.4-agreement.pdf`).
- Do **not** commit real agreements unless the owner explicitly intends them in git; prefer private storage + a local copy for gate checks.
- A nonempty file here is **bookkeeping only** — it is **not** proof that BRIA granted commercial rights.
- Do not add sample/fake “agreement” PDFs that could be mistaken for authorization.

## Reviewer attestation

Follow **`../HUMAN_REVIEW_EVIDENCE_PROCEDURE.md`**. After an authorized reviewer reviews the real agreement, fill in the checklist with a real name/date/scope (example shape only):

```markdown
**Owner attestation:** <Reviewer Name>, <YYYY-MM-DD> — reviewed BRIA commercial grant for RMBG-1.4 browser use
```

Then `npm run verify:commercial-release` may exit 0 with outcome `evidence_present_pending_review` (still not “legally approved”).
