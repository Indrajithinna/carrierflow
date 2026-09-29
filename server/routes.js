import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  profileSchema,
  jobSchema,
  statuses,
  fieldSchema,
  sourceSchema,
  outputs,
} from "./schema.js";
import { runMode } from "./modes.js";
import { match, analyzeMatch } from "./matching.js";
import { searchJobs } from "./providers.js";
import { exportArtifact } from "./export.js";
import { extractResume } from "./intake.js";
import {
  hash,
  now,
  upsertJobs,
  saveApplication,
  selectedDocuments,
  backup,
  restore,
  calendar,
} from "./workspace.js";
import { fail } from "./ai.js";
import { changesBetween } from "./documents.js";
import { automationSchema } from "./queue.js";

export function mountRoutes(app, store, service, env, s3 = null) {
  const { queue, generate, jobFor, config } = service;
  const decorated = (j) => ({
    ...j,
    match: match(store.setting("profile"), j),
    analysis: analyzeMatch(store.setting("profile"), j),
  });
  const artifactView = (a) => ({
    ...a,
    stale: a.profileHash !== hash(store.setting("profile")),
    approved: a.approved && a.profileHash === hash(store.setting("profile")),
  });
  app.get("/api/bootstrap", (req, res) =>
    res.json({
      profile: store.setting("profile"),
      sample: !!store.setting("sample"),
      jobs: store.all("jobs").map(decorated),
      applications: store.all("applications"),
      artifacts: store.all("artifacts").map((a) => {
        const { profile, jobSnapshot, ...summary } = artifactView(a);
        return summary;
      }),
      events: store.all("events").slice(0, 100),
      runs: store.all("runs").slice(0, 100),
      config: config(),
      automation: queue.settings(),
      tasks: store.all("tasks").slice(0, 100),
      savedSearches: store.all("savedSearches"),
      notifications: store.all("notifications").slice(0, 100),
      usage: store.all("usage").slice(0, 30),
      s3: { configured: s3?.isConfigured() || false },
    }),
  );
  app.put("/api/profile", (req, res) => {
    const p = profileSchema.parse(req.body);
    p.resume_structured.skills = p.resume_structured.skills.filter(Boolean);
    for (const e of p.resume_structured.projects)
      e.stack = e.stack.filter(Boolean);
    for (const e of [
      ...p.resume_structured.experience,
      ...p.resume_structured.projects,
    ])
      e.bullets = e.bullets.filter((b) => b.trim());
    store.setting("profile", p);
    res.json(p);
  });
  app.post("/api/profile/extract", async (req, res) => {
    const { data, filename } = z
      .object({ data: z.string().max(10000000), filename: z.string().max(250) })
      .strict()
      .parse(req.body);
    const result = await extractResume(filename, data, service.aiEnv());
    if (s3 && s3.isConfigured()) {
      try {
        const buffer = Buffer.from(data, "base64");
        const key = `resumes/${req.user?.id || "local"}/${Date.now()}-${filename}`;
        const contentType = filename.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const uploaded = await s3.uploadFile({
          key,
          buffer,
          contentType,
          metadata: { userId: req.user?.id || "", filename },
        });
        result.s3 = uploaded;
      } catch (err) {
        console.warn("Notice: S3 resume archive:", err.message);
      }
    }
    res.json(result);
  });
  app.get("/api/workspace/export", (req, res) =>
    res.attachment("careerflow-backup.json").json(backup(store)),
  );
  app.post("/api/workspace/restore", (req, res) => {
    if (req.body.confirm !== true) throw fail("Confirm backup restore.");
    if (queue.isRunning())
      throw fail(
        "Pause automation and wait for active work to finish before restoring.",
        409,
      );
    res.json(restore(store, req.body.backup));
  });
  app.post("/api/workspace/reset", (req, res) => {
    if (req.body.confirm !== true) throw fail("Confirmation required.");
    if (queue.isRunning())
      throw fail(
        "Pause automation and wait for active work to finish before resetting.",
        409,
      );
    queue.pause();
    store.clear();
    res.json({ success: true });
  });
  app.get("/api/calendar", (req, res) =>
    res
      .type("text/calendar")
      .attachment("careerflow.ics")
      .send(calendar(store)),
  );
  app.post("/api/search", async (req, res) => {
    const input = z
      .object({
        query: z.string().min(1).max(150),
        location: z.string().max(150).default(""),
      })
      .strict()
      .parse(req.body);
    const result = await searchJobs(input.query, input.location, env);
    res.json({
      ...result,
      jobs: upsertJobs(store, result.jobs).map(decorated),
    });
  });
  app.post("/api/saved-searches", (req, res) => {
    const s = z
      .object({
        query: z.string().min(1).max(150),
        location: z.string().max(150).default(""),
        enabled: z.boolean().default(true),
      })
      .strict()
      .parse(req.body);
    const existing = store
      .all("savedSearches")
      .find(
        (x) =>
          x.query.toLowerCase() === s.query.toLowerCase() &&
          x.location.toLowerCase() === s.location.toLowerCase(),
      );
    const saved = {
      ...existing,
      ...s,
      id: existing?.id || randomUUID(),
      createdAt: existing?.createdAt || now(),
    };
    store.put("savedSearches", saved);
    res.json(saved);
  });
  app.patch("/api/saved-searches/:id", (req, res) => {
    const s = store.get("savedSearches", req.params.id);
    if (!s) throw fail("Saved search not found.", 404);
    const patch = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    res.json(store.put("savedSearches", { ...s, ...patch }));
  });
  app.post("/api/jobs", (req, res) => {
    const j = {
      ...jobSchema.parse(req.body),
      id: randomUUID(),
      source: "Manual",
      sample: false,
      postedAt: now(),
      fetchedAt: now(),
    };
    res.status(201).json(upsertJobs(store, [j])[0]);
  });
  app.post("/api/applications", (req, res) => {
    const { jobId } = z.object({ jobId: z.string() }).strict().parse(req.body);
    const existing = store.all("applications").find((a) => a.jobId === jobId);
    res.status(existing ? 200 : 201).json(saveApplication(store, jobId));
  });
  app.patch("/api/applications/:id", (req, res) => {
    const { a, j } = jobFor(req.params.id);
    const patch = z
      .object({
        status: z.enum(statuses).optional(),
        notes: z.string().max(10000).optional(),
        version: z.number().int(),
        interviewAt: z.string().datetime().nullable().optional(),
        confirmSubmission: z.boolean().optional(),
        submittedArtifactIds: z.string().array().max(2).optional(),
        selectedArtifactIds: z.string().array().max(2).optional(),
        nextAction: z.string().max(500).optional(),
        nextActionAt: z.string().datetime().nullable().optional(),
        archived: z.boolean().optional(),
        deleted: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    if (patch.version !== a.version)
      throw fail("This application changed. Refresh and try again.", 409);
    if (
      ["interview_scheduled", "interviewing", "offer"].includes(patch.status) &&
      !a.appliedAt
    )
      throw fail("Record submission before interview or offer stages.");
    if (
      a.appliedAt &&
      ["shortlisted", "preparing", "ready_to_apply"].includes(patch.status)
    )
      throw fail(
        "A submitted application cannot move back to a pre-submission stage.",
      );
    const submitting = patch.status === "applied" && !a.appliedAt;
    if (submitting && !patch.confirmSubmission)
      throw fail("Confirm that you submitted this application.");
    const ids = submitting
      ? patch.submittedArtifactIds || []
      : a.submittedArtifactIds;
    if (submitting)
      selectedDocuments(store, a, ids, hash(store.setting("profile")));
    if (patch.selectedArtifactIds)
      selectedDocuments(
        store,
        a,
        patch.selectedArtifactIds,
        hash(store.setting("profile")),
      );
    const {
      confirmSubmission,
      submittedArtifactIds,
      archived,
      deleted,
      ...changes
    } = patch;
    const next = {
      ...a,
      ...changes,
      jobSnapshot: a.jobSnapshot || structuredClone(j),
      archivedAt:
        archived === undefined ? a.archivedAt : archived ? now() : null,
      deletedAt: deleted === undefined ? a.deletedAt : deleted ? now() : null,
      submittedArtifactIds: ids,
      version: a.version + 1,
      updatedAt: now(),
      appliedAt: submitting ? now() : a.appliedAt,
      ...(submitting
        ? {
            nextAction: "Follow up on application",
            nextActionAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          }
        : {}),
    };
    store.transaction(() => {
      store.put("applications", next);
      store.event(
        a.id,
        deleted
          ? "Application moved to trash"
          : archived
            ? "Application archived"
            : patch.status && patch.status !== a.status
              ? "Status changed to " + patch.status.replaceAll("_", " ")
              : "Application details updated",
        j.company,
      );
    });
    if (
      patch.status === "interview_scheduled" &&
      (a.status !== "interview_scheduled" ||
        patch.interviewAt !== a.interviewAt)
    )
      queue.enqueue(
        "research",
        { applicationId: a.id },
        "research:" + a.id + ":" + next.interviewAt,
      );
    if (submitting && queue.settings().enabled && queue.settings().autoEmail)
      queue.enqueue(
        "email",
        { applicationId: a.id, eventType: "applied" },
        "email:applied:" + a.id,
      );
    res.json(next);
  });
  const genSchema = z
    .object({
      mode: z.enum([
        "resume_tailor",
        "cover_letter",
        "round_prep",
        "email_draft",
        "form_fill",
      ]),
      event_type: z.enum(["applied", "prep_ready"]).optional(),
      form_snapshot: fieldSchema.array().max(100).optional(),
      search_results: sourceSchema.array().max(15).optional(),
      use_ai: z.boolean().optional(),
      tone: z.enum(["professional", "concise", "warm"]).optional(),
    })
    .strict();
  app.post("/api/applications/:id/generate", async (req, res) => {
    const { mode, ...extra } = genSchema.parse(req.body);
    res.json(await generate(req.params.id, mode, extra));
  });
  app.post("/api/modes/:mode", async (req, res) =>
    res.json(
      await runMode(
        req.params.mode,
        {
          ...req.body,
          candidate_profile: profileSchema.parse(req.body.candidate_profile),
          job_listing: jobSchema.parse(req.body.job_listing),
        },
        env,
      ),
    ),
  );
  app.get("/api/artifacts/:id", (req, res) => {
    const a = store.get("artifacts", req.params.id);
    if (!a) throw fail("Document not found.", 404);
    res.json(artifactView(a));
  });
  app.patch("/api/artifacts/:id", (req, res) => {
    const { approved } = z
      .object({ approved: z.boolean() })
      .strict()
      .parse(req.body);
    res.json(service.approve(req.params.id, approved));
  });
  app.post("/api/artifacts/:id/versions", (req, res) => {
    const a = store.get("artifacts", req.params.id);
    if (!a) throw fail("Document not found.", 404);
    if (a.profileHash !== hash(store.setting("profile")))
      throw fail(
        "Generate a fresh document from your current profile before editing.",
        409,
      );
    const { output } = z
      .object({ output: z.unknown() })
      .strict()
      .parse(req.body);
    const parsed = outputs[a.output.mode].parse(output);
    if (parsed.job_url !== a.output.job_url)
      throw fail("Document job URL cannot change.");
    const doc = store.transaction(() =>
      store.put("artifacts", {
        ...a,
        id: randomUUID(),
        output: parsed,
        parentId: a.id,
        version:
          Math.max(
            ...store
              .all("artifacts")
              .filter(
                (x) =>
                  x.applicationId === a.applicationId &&
                  x.output.mode === a.output.mode,
              )
              .map((x) => x.version),
          ) + 1,
        approved: false,
        approvedAt: null,
        approvedBy: null,
        grounding: "user-edited",
        delivery: "draft",
        createdAt: now(),
        changes: changesBetween(a.output, parsed),
      }),
    );
    store.event(
      a.applicationId,
      "Document revision saved",
      "Version " + doc.version,
    );
    res.status(201).json(doc);
  });
  app.get("/api/artifacts/:id/download", async (req, res) => {
    const a = store.get("artifacts", req.params.id);
    if (!a) throw fail("Document not found.", 404);
    const format = String(req.query.format || "pdf"),
      file = await exportArtifact(a, format);

    if (req.query.archive === "1" && s3 && s3.isConfigured()) {
      const key = `artifacts/${req.user?.id || "local"}/careerflow-${a.output.mode}-v${a.version}.${format}`;
      const upload = await s3.uploadFile({
        key,
        buffer: file.buffer,
        contentType: file.mime,
        metadata: { artifactId: a.id, mode: a.output.mode },
      });
      const downloadUrl = await s3.getPresignedDownloadUrl({ key });
      return res.json({ s3: true, downloadUrl, ...upload });
    }

    res.setHeader("Content-Type", file.mime);
    if (req.query.preview === "1")
      res.setHeader("Content-Disposition", "inline");
    else
      res.attachment(
        "careerflow-" + a.output.mode + "-v" + a.version + "." + format,
      );
    res.send(file.buffer);
  });
  app.post("/api/artifacts/:id/send", async (req, res) => {
    if (req.body.confirm !== true) throw fail("Confirm sending this email.");
    res.json(await service.send(req.params.id));
  });
  app.post("/api/settings/verify/:provider", async (req, res) => {
    const provider = z
      .enum(["gemini", "research", "adzuna", "email"])
      .parse(req.params.provider);
    let status = "verified",
      message = "Connection verified.";
    try {
      if (!config()[provider]) throw fail("No credentials configured.");
      if (provider === "email") await service.transport().verify();
      else {
        const url =
          provider === "gemini"
            ? "https://generativelanguage.googleapis.com/v1beta/models/" +
              encodeURIComponent(env.GEMINI_MODEL || "gemini-2.5-flash")
            : provider === "research"
              ? "https://api.tavily.com/usage"
              : "https://api.adzuna.com/v1/api/jobs/" +
                (env.ADZUNA_COUNTRY || "in") +
                "/categories?" +
                new URLSearchParams({
                  app_id: env.ADZUNA_APP_ID,
                  app_key: env.ADZUNA_APP_KEY,
                });
        const response = await fetch(url, {
          headers:
            provider === "gemini"
              ? { "x-goog-api-key": env.GEMINI_API_KEY }
              : provider === "research"
                ? { Authorization: "Bearer " + env.TAVILY_API_KEY }
                : {},
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok)
          throw fail(
            "Provider rejected the check (HTTP " + response.status + ").",
          );
      }
    } catch (e) {
      status = "failed";
      message = e.status
        ? e.message
        : "Connection could not be verified. Check provider settings and network access.";
    }
    const result = { status, message, checkedAt: now() };
    store.setting("connectionChecks", {
      ...(store.setting("connectionChecks") || {}),
      [provider]: result,
    });
    res.json(result);
  });
  app.put("/api/automation", (req, res) => {
    const settings = automationSchema.parse(req.body);
    if (settings.enabled && !store.setting("sample")) {
      const p = store.setting("profile");
      if (!p.full_name || !p.email || !p.resume_structured.skills.length)
        throw fail(
          "Add your real name, email and resume before enabling automation.",
        );
      if (settings.autoSubmit && !settings.allowedDomains.length)
        throw fail("Add at least one allowed employer domain.");
    }
    store.setting("automation", settings);
    if (!settings.enabled) queue.pause();
    res.json(settings);
  });
  app.post("/api/automation/pause", (req, res) => {
    queue.pause();
    res.json(queue.settings());
  });
  app.post("/api/tasks", (req, res) => {
    const { kind, applicationId, searchId } = z
      .object({
        kind: z.enum(["prepare", "research", "discover", "reminders"]),
        applicationId: z.string().optional(),
        searchId: z.string().optional(),
      })
      .strict()
      .parse(req.body);
    if (["prepare", "research"].includes(kind) && !applicationId)
      throw fail("Choose an application.");
    if (kind === "discover" && !searchId) throw fail("Choose a saved search.");
    res.status(202).json(
      queue.enqueue(kind, {
        applicationId,
        searchId,
        profileHash: hash(store.setting("profile")),
      }),
    );
  });
  app.post("/api/tasks/:id/:action", (req, res) => {
    if (req.params.action === "cancel") res.json(queue.cancel(req.params.id));
    else if (req.params.action === "retry")
      res.json(queue.retry(req.params.id));
    else throw fail("Unknown task action.", 404);
  });

  // Amazon S3 & Cloud Storage endpoints
  app.get("/api/storage/status", (req, res) => {
    res.json({
      s3: {
        configured: s3?.isConfigured() || false,
        bucket: s3?.bucket || null,
        region: s3?.region || null,
      },
      mongodb: {
        configured: !!app.locals.authStore?.isMongo,
      },
    });
  });

  app.post("/api/storage/upload", async (req, res, next) => {
    try {
      const { filename, data, contentType } = z
        .object({
          filename: z.string().max(255),
          data: z.string().max(35000000), // base64 payload
          contentType: z.string().max(100).default("application/octet-stream"),
        })
        .parse(req.body);
      const buffer = Buffer.from(data, "base64");
      const key = `uploads/${req.user?.id || "local"}/${Date.now()}-${filename}`;

      if (s3 && s3.isConfigured()) {
        const upload = await s3.uploadFile({
          key,
          buffer,
          contentType,
          metadata: { userId: req.user?.id || "", filename },
        });
        const downloadUrl = await s3.getPresignedDownloadUrl({ key });
        return res.status(201).json({ ...upload, downloadUrl });
      }

      const record = {
        id: key,
        filename,
        size: buffer.length,
        contentType,
        createdAt: new Date().toISOString(),
      };
      store.put("storage", record);
      res.status(201).json({
        s3: false,
        ...record,
        message:
          "Stored in local storage. Configure Amazon S3 in .env for cloud object storage.",
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/storage/files/{*key}", async (req, res, next) => {
    try {
      const rawKey = req.params.key;
      const key = Array.isArray(rawKey)
        ? rawKey.join("/")
        : String(rawKey || "");
      if (s3 && s3.isConfigured()) {
        const presigned = await s3.getPresignedDownloadUrl({ key });
        if (presigned) {
          return res.redirect(302, presigned);
        }
        const file = await s3.getFile({ key });
        res.setHeader("Content-Type", file.contentType);
        return res.send(file.buffer);
      }

      const record = store.get("storage", key);
      if (!record) throw fail("File not found in storage.", 404);
      res.json(record);
    } catch (err) {
      next(err);
    }
  });
}
