# Careerflow 2

An independent, local job-search workspace with discovery, explainable matching, resume import, evidence-backed documents, interview preparation, application tracking and a persistent automation worker. **No ProInterview integration.**

## Start

Requires Node.js 24+.

```powershell
cd D:\Careerflow
npm install
npm run browser:install
npm run build
npm start
```

Open http://localhost:4310. For development, use `npm run dev` instead of build/start. The app binds only to 127.0.0.1. Do not expose it as a public multi-user server.

The included `.env` is ready for your credentials; `.env.example` documents every setting. Keep `.env` private and restart after changing it. Blank keys do not prevent local/sample use.

## What's included

- Responsive desktop/mobile workspace with keyboard navigation, URL history and quick search (`/`).
- PDF/DOCX/TXT resume intake, source-linked structured extraction when Gemini is configured, local fallback extraction, autosave and recoverable local drafts.
- Requirement-weighted job matching, mandatory/preferred gaps, experience and sponsorship checks, explicit remote eligibility, salary normalization, uncertainty and stale-listing indicators. Scores are not hiring probabilities.
- Live Remotive/Adzuna search, provider deduplication, saved queries, source filters and sorting.
- Immutable application snapshots, notes, next-action dates, calendar export, list/drag-and-drop/keyboard board views, archive/trash/restore.
- Evidence-backed resume/letter generation, edits as new versions, differences, source evidence, PDF preview and real PDF/DOCX/TXT/JSON downloads.
- Evidence-based interview stages with separate general-practice exercises. Missing evidence remains unknown.
- Persistent Autopilot queue for discovery, preparation, eligible standard-form submission, receipt verification, research and tracking emails to your own profile address.
- Daily limits, pause/cancel, safe retries, restart recovery, usage tracking and no blind retries after uncertain submissions or email delivery.
- Connection checks, private JSON export and transactional restore.

## Automation setup

See **[docs/AUTOPILOT.md](docs/AUTOPILOT.md)** for the complete setup and operating contract.

Enter a real profile, configure optional providers, save search queries, then set Autopilot rules. Enabling automatic submission grants ongoing permission to fill and submit eligible applications on your explicitly allowed employer hostnames. Nothing is sent from sample data.

The browser worker supports a unique top-level standard HTML application form, regular inputs/selects/textareas, PDF attachments, a supported submit button and a recognizable receipt. It stops for login/CAPTCHA, unknown required answers, required consent, sensitive questions and unsupported forms. Cross-origin frames, custom ATS widgets and arbitrary multi-step flows are not universally supported. Absolute zero-intervention operation across all employer websites is not promised.

The worker runs while the local server is running; it is not an installed Windows service. To run it later, start Careerflow again. No third-party accounts, real applications, emails or public hosting are created during installation/testing.

## Configuration

| Variables | Purpose |
| --- | --- |
| `PORT`, `APP_ORIGIN`, `DATABASE_PATH` | Local server and SQLite path |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Source-backed extraction, writing and evidence checks |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `ADZUNA_COUNTRY` | Regional job discovery |
| `TAVILY_API_KEY` | Company/interview evidence |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Tracking email transport |
| `EXTENSION_TOKEN` | Optional companion token; generated locally when blank |
| `BROWSER_CHANNEL` | Optional installed `chrome` / `msedge`; blank uses Playwright Chromium |
| `RESUME_FONT_PATH`, `RESUME_BOLD_FONT_PATH` | Optional multilingual TTF/OTF fonts; Windows Arial is preferred when available |

Settings distinguishes configured credentials from verified connections. SMTP verification does not prove the provider will accept a particular sender or deliver a message. Gemini checks validate model/key access, not future generation quality. Scanned resumes need OCR before import. AI checks reduce—but cannot eliminate—factual risk; turn off AI writing for source-preserving generation.

## Browser companion

Load `D:\Careerflow\extension` as an unpacked Chrome/Edge extension, copy the pairing token from Settings, and connect. Capture/review a form before filling. Changing the application/token invalidates the old mapping. Existing values are not overwritten. The companion is a manual diagnostic/filling tool; Autopilot's separate worker handles eligible automatic submissions. Companion file upload and final submission remain manual.

## Data and recovery

Data lives in `data/careerflow.db` and its SQLite sidecars. Use Settings → Export workspace for a private JSON backup. Restore replaces the current workspace, validates references, pauses automation and removes document approvals. Credentials and pairing tokens are excluded. For file-level backups, stop the server before copying the whole `data/` directory. Archive and trash are recoverable from My applications.

## Verification

```powershell
npm test
npm run build
npm audit
```

Browser tests use isolated local HTML fixtures; run `npm run browser:install` first. If Chromium is absent, those tests report skipped rather than pretending to pass. Provider tests use fixtures and never submit real applications or send real emails. See [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Structure

`src/` contains typed feature modules and shared UI. `server/` contains routes, services, schema contracts, matching, document processing, provider adapters, SQLite, queue and browser runner. `extension/` contains the companion. `tests/` contains unit, HTTP, worker and isolated browser fixtures. `docs/` contains architecture, Autopilot setup and verification details.

The original six-mode JSON contracts remain available at `/api/modes/:mode`. Persistent UI generation uses `/api/applications/:id/generate`; background work uses `/api/tasks` and Autopilot settings.
