# Autopilot setup and operating contract

Careerflow remains a standalone, single-user local app. It is not connected to ProInterview. The worker runs only while the Careerflow server is running; it is not an installed Windows background service.

## One-time setup

1. Export existing data if needed. Remove the sample workspace in Settings before using real applications.
2. Import a PDF/DOCX/TXT resume in My profile. Apply the structured extraction and complete your contact details, first and last name, location, relevant experience, salary, work authorization and reusable answers. Preferences and sensitive answers are never invented.
3. Fill the existing `.env` placeholders as needed and restart: Gemini for AI extraction/writing, Adzuna for regional discovery, Tavily for research, SMTP for tracking email. Remotive needs no key. No API key is exposed in frontend code.
4. Run `npm run browser:install` to install the isolated Chromium runtime. Alternatively set `BROWSER_CHANNEL=chrome` or `msedge` to use a supported installed browser executable. The worker uses a fresh isolated session, not your personal signed-in browser profile.
5. Save job queries in Discover jobs. Configure Autopilot's minimum score, daily application and AI-call limits, search interval and excluded companies.
6. Add exact employer hostnames to Allowed employer domains. Enable scheduled discovery and, if wanted, automatic submission and tracking email. Save operating rules. These are ongoing permissions for eligible tasks—not per-job approval prompts.

## Automatic workflow

Saved search → provider listings → deduplication → requirement/eligibility gate → document package → supported form filling and approved PDF attachments → final submit → explicit on-page receipt → application tracking → tracking email to your own profile email (if enabled).

The worker stores every task in SQLite. Safe transient discovery/preparation failures receive bounded retries. Work interrupted before an irreversible action can be retried. A submission or email with an uncertain external result is quarantined and is never automatically repeated. Daily application limits count attempted irreversible submissions, not just successful receipts. Budgets use UTC days. Pause all cancels queued work and requests cancellation before irreversible actions; it cannot recall a submitted application or sent email.

## Supported browser forms

The standard adapter supports a unique top-level HTML form with normal inputs, textareas, selects, and file inputs. It checks the expected company/role, public HTTPS destination and explicit allowed hostnames. It verifies that filled values were retained and that form validation passes. A unique supported submit button and a recognizable success receipt are required. Attachments are chosen from the prepared, current approved document versions.

It does **not** promise universal ATS compatibility. Multi-step flows, custom widgets, cross-origin frames, CAPTCHA, account creation, login, sensitive questions, required consent or unknown required answers stop the task. No CAPTCHA solving, login bypass, employer API impersonation or guessed qualifications is implemented. ToS/consent decisions are not accepted automatically. Some forms autosave entered data; the allowed-domain configuration authorizes transmitting the supplied application facts to those employers even before final submission.

Autopilot therefore requires one-time setup and can still produce blocked tasks. Absolute zero-intervention operation across arbitrary employer websites cannot be guaranteed. Nothing is sent from sample/test data, and no real employer submissions were used for verification.

## Writing and source evidence

Local generation preserves original candidate wording. AI writing includes source references, numeric/technology checks and a separate model-based entailment check. Model checks reduce risk but do not constitute a mathematical guarantee of truth. Disable AI writing for source-preserving automation. Edited documents create new unapproved versions; profile changes invalidate old approvals. Careerflow records the exact submitted artifact IDs and an immutable job snapshot.

PDF export uses Windows Arial where available, or configurable `RESUME_FONT_PATH` / `RESUME_BOLD_FONT_PATH`. Supply a font covering your language for scripts not covered by the default font. Scanned/image-only resumes require OCR before import.

## Backups and release boundaries

Export JSON includes private candidate/application data; store it securely. Restore validates references transactionally, pauses automation and clears approvals. API keys, extension tokens and active worker jobs are never restored from a backup. Archive and trash are reversible; reset/restore require confirmation.

The server binds to 127.0.0.1. Do not expose it publicly: multi-user authentication, per-user database isolation and public-hosting hardening are not part of this local release. Full employer-specific browser compatibility and authenticated provider delivery require your own setup and cannot be certified by offline tests.

## Official references

- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Playwright input, selects and file upload](https://playwright.dev/docs/input)
- [Tavily usage verification](https://docs.tavily.com/documentation/api-reference/endpoint/usage)
- [Nodemailer SMTP verification](https://nodemailer.com/smtp)
- [WCAG 2.2 accessibility requirements](https://www.w3.org/TR/WCAG22/)
