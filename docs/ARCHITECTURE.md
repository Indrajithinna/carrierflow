# Standalone architecture — v2

Careerflow has no runtime, route, credential, storage or account integration with ProInterview.

## Runtime and modules

React/TypeScript feature modules are bundled by Vite. Express serves the API and production assets on 127.0.0.1:4310. Node 24 SQLite provides parameterized storage, WAL and synchronous transactions. No cloud database is needed.

- `app.js`: loopback/origin checks, JSON-only mutations, request limits and companion pairing.
- `routes.js`: workspace, applications, versions, connection verification, automation and task APIs.
- `services.js`: source snapshots, generation, approval, email and task handlers.
- `matching.js`: requirement weighting, explicit eligibility and salary normalization.
- `intake.js`: PDF/DOCX/TXT extraction with optional source-verified structured AI extraction.
- `ai.js` / `documents.js`: JSON-schema AI calls, usage hooks, source references, metric/technology checks, independent entailment checking, immutable differences and evidence-based preparation.
- `queue.js`: persisted queued/running/succeeded/failed/blocked/cancelled/uncertain work, bounded safe retries, cancellation and restart recovery.
- `browser-runner.js`: isolated Chromium standard-form adapter, destination restrictions, data filling, approved attachments and receipt detection.
- `workspace.js`: deduplication, immutable job snapshots, exact submitted document selection, validated transactional restore and calendar generation.

The UI is split into application, discovery, documents, profile, Autopilot and workspace modules with shared typed data and controls. Profile drafts are debounced to the server and retained locally for recovery. Browser navigation uses URL query state and history. The UI polls while visible; events/runs/tasks are bounded to recent activity and artifact profile snapshots are fetched on demand. The single-user store still loads job/application collections in memory; it is not intended as a large public multi-tenant database.

## Records

SQLite `meta` contains the profile, sample flag, pairing token, automation rules and connection-check state. Generic typed record collections contain jobs, applications, immutable artifacts, events, generation runs, queued tasks, saved searches, notifications and daily AI usage. Schema version is recorded through SQLite user_version. JSON backups exclude secrets and executable work. Restore validates IDs/contracts/references transactionally and clears approval/automation permissions.

## Execution and safety

The queue runs one task at a time in the local process. Scheduled discovery is controlled by saved search queries, interval, exclusions and minimum fit. Eligible applications get prepared documents. Automatic submit requires enabled rules, a current profile, explicit allowed HTTPS hostnames, a current approved resume, eligibility and daily budget. Exact document IDs, immutable listing snapshots and on-page receipts are retained. The browser stops for required unknown answers, login, CAPTCHA, sensitive/consent fields and unsupported forms. It never executes AI-generated scripts or arbitrary selectors.

Before a submit click or mail send, the task records an irreversible boundary. Uncertain delivery is not retried. On restart, interrupted safe tasks return to the queue, while potentially irreversible tasks become uncertain. Generation runs are marked interrupted; sending email artifacts become unknown. Pause cannot recall previously submitted applications or sent mail.

Local writing preserves source facts. AI writing supplies candidate references and undergoes deterministic checks plus a model-based entailment check. This is risk reduction, not proof of truth. Source-preserving mode remains available. Research groups actual source excerpts into stages and labels general practice separately, without claiming an unverified company process sequence.

## Boundaries

The worker is active only while Careerflow runs. No Windows service, cloud scheduler, public deployment, account creation or multi-user authentication is installed. Arbitrary ATS systems, multi-step flows, custom widgets, cross-origin form frames, scanned-resume OCR and all world scripts in a single bundled font are not universally supported. See AUTOPILOT.md and VERIFICATION.md for tested behavior and setup-dependent limitations.
