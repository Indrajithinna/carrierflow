# Careerflow 2 — implementation scope

Independent local application. No ProInterview integration or public deployment.

## Deliverables

- Correct interview filters, tokenized search, exact submitted document selection, stale companion mapping invalidation.
- PDF/DOCX/TXT intake with structured extraction, evidence, uncertainty and local draft recovery.
- Requirement-aware matching, normalized salary ranges, eligibility gates and transparent explanations.
- Evidence-backed writing, editable immutable document versions, differences and export previews.
- Research stages with specific excerpts and sources; separate general practice exercises.
- Due actions, calendar export, saved searches, deduplication, stale-listing labels, archive/trash/undo.
- Durable discovery/preparation/submission/email/reminder queue, retry/cancellation, restart recovery, budgets and audit trail.
- Browser runner for eligible standard HTML application forms, including attachments and receipt checks. Restricted to explicitly configured HTTPS employer domains. Unknown required answers, consent decisions, login and CAPTCHA stop the task. No CAPTCHA bypass or guessed facts. Uncertain submissions are never retried automatically.
- Responsive accessible UI, routes, smaller typed components, autosave, connection verification and transactional backup restore.
- Automated regression, HTTP, worker, browser-fixture and document tests.

## Automation contract

One-time setup is unavoidable: a real profile, credentials where needed, browser installation and application rules. Automation may then run while the local server is running without per-job approval for source-preserving documents and supported forms. AI rewrites whose factual grounding cannot be established are not auto-submitted. Sensitive or unknown answers become blocked tasks, not invented answers. No live applications or emails are sent from sample/test data.

Production multi-user authentication is outside this local-only release. The loopback binding remains mandatory. Credential-dependent providers and employer-specific websites cannot be certified without real credentials and authorized fixtures; verification distinguishes tested behavior from unsupported or unverified integrations.
