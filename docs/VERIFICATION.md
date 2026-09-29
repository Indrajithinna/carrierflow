# Careerflow 2 verification

## Automated checks

39 tests pass, with zero skips in the verified environment. Includes:

- Original six mode contracts, zero-overlap rejection, token boundaries, salary uncertainty, exact source preservation and sensitive field blockers.
- Shared salary suffixes and monthly/annual conversion; preferred/required skills; experience, sponsorship, stale-listing and remote-residency gates.
- Source-backed intake, real DOCX extraction, unsupported formats, evidence-number and technology checks.
- Preserved employment chronology, document differences, combined research-stage excerpts and separately labeled general practice.
- Stable cross-source job IDs, immutable application snapshots, exact selected document versions, concurrency-safe version allocation.
- Transactional validated restore, reversible archive, calendar escaping/alarms, credential-free exports.
- Durable queue deduplication/recovery/retry, irreversible-action quarantine, sample package preparation without submission.
- Public HTTPS/exact-domain application constraints and private-IP rejection.
- Explicit Gemini output-schema use and parsed-response validation against fixture responses.
- HTTP status-transition, document-revision, connection-check and queue-cancellation behavior.
- Isolated Chromium fixtures: fill standard fields, upload a real generated PDF, validate the form and observe a local receipt; stop for missing answers, consent, CAPTCHA, login and conflicting prefilled values.

TypeScript and Vite production build pass. Dependency installation/audit reports zero known vulnerabilities after updating Nodemailer to 10.0.10.

## UI verification

Used a separate sample database on localhost:4311, leaving the main workspace data intact. Verified desktop layout, combined interview filtering (scheduled + interviewing), queued package creation, immutable edited document version and before/after differences. Verified mobile profile and Autopilot/navigation at 390 × 844 with no horizontal document overflow. Profile first/last name autosave reached Saved. Production assets are reloaded after rebuilds. The working app remains on localhost:4310.

## Boundaries of this evidence

No real employer submission, employer account, real email or credential-authenticated AI/job/research request was used. Browser tests exercise local HTML fixtures, not arbitrary Greenhouse/Lever/Workday or other production ATS installations. Provider credentials, sender authorization, quota and actual delivery remain setup-dependent. The companion's mapping invalidation is covered by source/syntax review; unpacked-extension behavior in the user's signed-in browser is not claimed to be end-to-end certified.

The app is local-only. Public multi-user hosting/authentication is not included. Scanned/image-only resume OCR and unsupported ATS flows still need another supported input path. AI evidence checks are probabilistic rather than a guarantee of factual correctness; source-preserving generation remains available.

## Repeat

```powershell
npm run browser:install
npm test
npm run build
npm audit
```
