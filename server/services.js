import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { runMode } from "./modes.js";
import { sourceSchema } from "./schema.js";
import { createDocument, buildResearch } from "./documents.js";
import { searchJobs, researchJob } from "./providers.js";
import {
  hash,
  now,
  upsertJobs,
  saveApplication,
  visible,
  selectedDocuments,
} from "./workspace.js";
import { fail } from "./ai.js";
import { analyzeMatch } from "./matching.js";
import { createQueue } from "./queue.js";
import { submitApplication } from "./browser-runner.js";

export function createServices(store, env = {}) {
  for (const run of store.all("runs"))
    if (run.status === "running")
      store.put("runs", {
        ...run,
        status: "failed",
        error: "Generation interrupted by server restart.",
        finishedAt: now(),
      });
  for (const artifact of store.all("artifacts"))
    if (artifact.delivery === "sending")
      store.put("artifacts", { ...artifact, delivery: "unknown" });
  const jobFor = (id) => {
    const a = store.get("applications", id);
    if (!a) throw fail("Application not found.", 404);
    const j = a.jobSnapshot || store.get("jobs", a.jobId);
    if (!j) throw fail("Job not found.", 404);
    return { a, j };
  };
  const config = () => ({
    gemini: !!env.GEMINI_API_KEY,
    research: !!env.TAVILY_API_KEY,
    adzuna: !!(env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY),
    email: !!(env.SMTP_USER && env.SMTP_PASSWORD),
    model: env.GEMINI_MODEL || "gemini-2.5-flash",
    mailTo: store.setting("profile").email,
    checks: store.setting("connectionChecks") || {},
  });
  const transport = () =>
    nodemailer.createTransport({
      host: env.SMTP_HOST || "smtp.gmail.com",
      port: Number(env.SMTP_PORT || 465),
      secure: env.SMTP_SECURE !== "false",
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      connectionTimeout: 15000,
      socketTimeout: 20000,
    });
  const aiEnv = () => ({
    ...env,
    _beforeAI() {
      const day = now().slice(0, 10),
        u = store.get("usage", day) || {
          id: day,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        };
      if (u.calls >= queue.settings().maxAICallsPerDay)
        throw fail("Daily AI call budget reached.", 422);
      store.put("usage", { ...u, calls: u.calls + 1 });
    },
    _onUsage(usage) {
      const day = now().slice(0, 10),
        u = store.get("usage", day);
      store.put("usage", {
        ...u,
        model: usage.model,
        inputTokens: u.inputTokens + usage.inputTokens,
        outputTokens: u.outputTokens + usage.outputTokens,
        totalTokens: u.totalTokens + usage.totalTokens,
      });
    },
  });
  async function generate(id, mode, extra = {}) {
    const { a, j } = jobFor(id);
    if (!visible(a))
      throw fail("Restore this application before generating documents.");
    const p = structuredClone(store.setting("profile")),
      run = {
        id: randomUUID(),
        applicationId: id,
        mode,
        promptVersion: "2.0.0",
        status: "running",
        startedAt: now(),
        profileHash: hash(p),
        jobHash: hash(j),
      };
    store.put("runs", run);
    try {
      const sources =
        mode === "round_prep"
          ? extra.search_results?.length
            ? sourceSchema.array().max(15).parse(extra.search_results)
            : j.sample
              ? []
              : await researchJob(j, env)
          : [];
      const artifacts = store
        .all("artifacts")
        .filter((x) => x.applicationId === id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const event_payload = {
        appliedAt: a.appliedAt,
        artifacts: artifacts
          .filter((x) => (a.submittedArtifactIds || []).includes(x.id))
          .map(
            (x) =>
              x.title +
              " v" +
              x.version +
              " — " +
              (env.APP_ORIGIN || "http://localhost:4310") +
              "/api/artifacts/" +
              x.id +
              "/download?format=pdf",
          ),
        trackerUrl:
          (env.APP_ORIGIN || "http://localhost:4310") +
          "/?page=applications&application=" +
          id,
        prep: artifacts.find((x) => x.output.mode === "round_prep")?.output,
      };
      const actualEnv = j.sample ? {} : aiEnv();
      const result = ["resume_tailor", "cover_letter"].includes(mode)
        ? await createDocument(mode, p, j, extra, actualEnv)
        : mode === "round_prep"
          ? buildResearch(p, j, sources)
          : {
              output: await runMode(
                mode,
                {
                  candidate_profile: p,
                  job_listing: j,
                  event_payload,
                  ...extra,
                },
                actualEnv,
              ),
              grounding: "source-preserved",
              changes: [],
              evidence: [],
            };
      const title =
        {
          resume_tailor: "Tailored resume",
          cover_letter: "Cover letter",
          round_prep: "Interview brief",
          email_draft: "Tracking email",
          form_fill: "Form mapping",
        }[mode] +
        " · " +
        j.company;
      const artifact = store.transaction(() => {
        const version =
          store
            .all("artifacts")
            .filter((x) => x.applicationId === id && x.output.mode === mode)
            .reduce((n, x) => Math.max(n, x.version), 0) + 1;
        return store.put("artifacts", {
          id: randomUUID(),
          applicationId: id,
          runId: run.id,
          title,
          ...result,
          profile: p,
          profileHash: hash(p),
          jobSnapshot: structuredClone(j),
          jobHash: hash(j),
          sources,
          version,
          approved: false,
          createdAt: now(),
          delivery: "draft",
        });
      });
      store.put("runs", { ...run, status: "succeeded", finishedAt: now() });
      store.event(id, title + " created", "Version " + artifact.version);
      return artifact;
    } catch (e) {
      store.put("runs", {
        ...run,
        status: "failed",
        error: e.status ? e.message : "Generation failed",
        finishedAt: now(),
      });
      throw e;
    }
  }
  function approve(id, approved = true, by = "user") {
    const a = store.get("artifacts", id);
    if (!a) throw fail("Document not found.", 404);
    if (approved && a.profileHash !== hash(store.setting("profile")))
      throw fail(
        "Your profile changed. Generate a fresh document before approval.",
        409,
      );
    const doc = {
      ...a,
      approved,
      approvedAt: approved ? now() : null,
      approvedBy: by,
    };
    store.put("artifacts", doc);
    return doc;
  }
  async function send(
    id,
    { checkpoint = () => {}, beforeSend = () => {} } = {},
  ) {
    const a = store.get("artifacts", id);
    if (!a || a.output.mode !== "email_draft")
      throw fail("Email draft not found.", 404);
    if (a.profileHash !== hash(store.setting("profile")))
      throw fail("Your profile changed. Generate a new email.", 409);
    if (!a.approved) throw fail("Email is not approved.");
    if (["sent", "sending", "unknown"].includes(a.delivery))
      throw fail(
        "This email was sent or delivery is uncertain. It will not be sent again.",
        409,
      );
    if (jobFor(a.applicationId).j.sample || store.setting("sample"))
      throw fail("Sending is disabled in the sample workspace.");
    if (!config().email)
      throw fail("Configure SMTP credentials in .env and restart.", 503);
    const to = store.setting("profile").email;
    if (!to) throw fail("Add your tracking email in Profile.");
    checkpoint();
    await beforeSend();
    store.put("artifacts", { ...a, delivery: "sending" });
    try {
      const info = await transport().sendMail({
        from: env.MAIL_FROM || env.SMTP_USER,
        to,
        subject: a.output.subject,
        text: a.output.body,
      });
      store.put("artifacts", {
        ...a,
        delivery: "sent",
        sentAt: now(),
        messageId: info.messageId,
      });
      store.event(a.applicationId, "Tracking email sent", to);
      return { success: true };
    } catch {
      store.put("artifacts", { ...a, delivery: "unknown" });
      throw fail(
        "Email delivery is uncertain. Check your mailbox; automatic retry is disabled.",
        409,
      );
    }
  }
  function markIrreversible(ctx) {
    ctx.checkpoint();
    const t = store.get("tasks", ctx.taskId);
    store.put("tasks", { ...t, irreversibleAt: now() });
  }
  function assertEnabled(ctx) {
    ctx.checkpoint();
    if (!queue.settings().enabled) throw fail("Automation is paused.");
    if (store.setting("sample"))
      throw fail("External automation is disabled in the sample workspace.");
  }
  const handlers = {
    async discover({ searchId }, ctx) {
      assertEnabled(ctx);
      const search = store.get("savedSearches", searchId);
      if (!search || search.enabled === false)
        throw fail("Saved search is disabled.");
      const result = await searchJobs(search.query, search.location, env);
      ctx.checkpoint();
      const jobs = upsertJobs(store, result.jobs);
      store.put("savedSearches", {
        ...search,
        lastRunAt: now(),
        lastCount: jobs.length,
        warnings: result.warnings,
      });
      let queued = 0;
      const cfg = queue.settings(),
        p = store.setting("profile");
      for (const j of jobs) {
        const fit = analyzeMatch(p, j);
        if (
          fit.score < cfg.minMatch ||
          !fit.eligible ||
          cfg.excludedCompanies.some(
            (c) => c.toLowerCase() === j.company.toLowerCase(),
          )
        )
          continue;
        const a = saveApplication(store, j.id);
        if (!visible(a) || a.appliedAt) continue;
        ctx.enqueue(
          "prepare",
          { applicationId: a.id, profileHash: hash(p) },
          "prepare:" + a.id + ":" + hash(p),
        );
        queued++;
        if (queued >= cfg.maxApplicationsPerDay) break;
      }
      store.event(
        null,
        "Saved search completed",
        jobs.length + " openings; " + queued + " preparation tasks",
      );
      return { found: jobs.length, queued, warnings: result.warnings };
    },
    async prepare({ applicationId, profileHash }, ctx) {
      const { a } = jobFor(applicationId);
      if (!visible(a) || a.appliedAt)
        throw fail("Application is already submitted or inactive.");
      if (profileHash && profileHash !== hash(store.setting("profile")))
        throw fail("Profile changed since this task was queued.", 409);
      const cfg = queue.settings();
      const docs = [];
      for (const mode of ["resume_tailor", "cover_letter"]) {
        ctx.checkpoint();
        const existing = store
          .all("artifacts")
          .filter(
            (x) =>
              x.applicationId === a.id &&
              x.output.mode === mode &&
              x.profileHash === hash(store.setting("profile")) &&
              x.approved,
          )
          .sort((a, b) => b.version - a.version)[0];
        const doc =
          existing || (await generate(a.id, mode, { use_ai: cfg.useAI }));
        ctx.checkpoint();
        if (doc.profileHash !== hash(store.setting("profile")))
          throw fail("Profile changed during generation.", 409);
        docs.push(approve(doc.id, true, "automation"));
      }
      const current = store.get("applications", a.id);
      if (!visible(current) || current.appliedAt)
        throw fail("Application changed during generation.", 409);
      store.put("applications", {
        ...current,
        status: "ready_to_apply",
        selectedArtifactIds: docs.map((d) => d.id),
        nextAction: cfg.autoSubmit
          ? "Waiting for automation eligibility check"
          : "Ready to apply",
        version: current.version + 1,
        updatedAt: now(),
      });
      if (cfg.enabled && cfg.autoSubmit && !store.setting("sample"))
        ctx.enqueue(
          "submit",
          {
            applicationId: a.id,
            profileHash: hash(store.setting("profile")),
            artifactIds: docs.map((d) => d.id),
          },
          "submit:" + a.id,
        );
      return { artifactIds: docs.map((d) => d.id) };
    },
    async submit(payload, ctx) {
      assertEnabled(ctx);
      const cfg = queue.settings();
      if (!cfg.autoSubmit) throw fail("Automatic submission is disabled.");
      const { a, j } = jobFor(payload.applicationId),
        p = store.setting("profile");
      if (!visible(a) || a.appliedAt || j.sample)
        throw fail("Application is not eligible for submission.");
      if (payload.profileHash !== hash(p))
        throw fail("Profile changed since preparation.", 409);
      const analysis = analyzeMatch(p, j);
      if (!analysis.eligible || analysis.score < cfg.minMatch)
        throw fail(
          [...analysis.blockers, ...analysis.uncertainties].join("; ") ||
            "Match score is below your threshold.",
        );
      if (
        cfg.excludedCompanies.some(
          (c) => c.toLowerCase() === j.company.toLowerCase(),
        )
      )
        throw fail("Company is excluded by your automation rules.");
      const today = now().slice(0, 10);
      const attempts = store
        .all("tasks")
        .filter(
          (t) => t.kind === "submit" && t.irreversibleAt?.startsWith(today),
        );
      if (attempts.length >= cfg.maxApplicationsPerDay)
        throw fail("Daily application limit reached.");
      if (
        store
          .all("tasks")
          .some(
            (t) =>
              t.id !== ctx.taskId &&
              t.kind === "submit" &&
              t.payload.applicationId === a.id &&
              (t.irreversibleAt || t.status === "uncertain"),
          )
      )
        throw fail(
          "A previous submission attempt requires receipt verification.",
          409,
        );
      const docs = selectedDocuments(store, a, payload.artifactIds, hash(p));
      if (!docs.some((d) => d.output.mode === "resume_tailor"))
        throw fail("A current approved resume is required.");
      const receipt = await submitApplication({
        profile: p,
        job: j,
        documents: docs,
        config: cfg,
        env,
        checkpoint: ctx.checkpoint,
        beforeSubmit(destination) {
          assertEnabled(ctx);
          const latestRules = queue.settings();
          const latestApplication = store.get("applications", a.id);
          if (!latestRules.autoSubmit)
            throw fail("Automatic submission was disabled.");
          if (
            hash(store.setting("profile")) !== payload.profileHash ||
            !visible(latestApplication) ||
            latestApplication.appliedAt
          )
            throw fail(
              "Profile or application changed before submission.",
              409,
            );
          if (
            ![destination.pageUrl, destination.action].every((url) =>
              latestRules.allowedDomains.includes(new URL(url).hostname),
            ) ||
            analysis.score < latestRules.minMatch ||
            latestRules.excludedCompanies.some(
              (c) => c.toLowerCase() === j.company.toLowerCase(),
            )
          )
            throw fail("Application rules changed before submission.", 409);
          selectedDocuments(
            store,
            latestApplication,
            payload.artifactIds,
            hash(store.setting("profile")),
          );
          markIrreversible(ctx);
        },
      });
      const current = store.get("applications", a.id);
      store.put("applications", {
        ...current,
        status: "applied",
        appliedAt: receipt.receivedAt,
        submissionReceipt: receipt,
        submittedArtifactIds: docs.map((d) => d.id),
        nextAction: "Follow up on application",
        nextActionAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        version: current.version + 1,
        updatedAt: now(),
      });
      store.event(a.id, "Application receipt verified", receipt.receipt);
      if (cfg.autoEmail)
        ctx.enqueue(
          "email",
          { applicationId: a.id, eventType: "applied" },
          "email:applied:" + a.id,
        );
      return receipt;
    },
    async research({ applicationId }, ctx) {
      ctx.checkpoint();
      const result = await generate(applicationId, "round_prep");
      if (
        queue.settings().enabled &&
        queue.settings().autoEmail &&
        !store.setting("sample")
      )
        ctx.enqueue(
          "email",
          { applicationId, eventType: "prep_ready" },
          "email:prep:" + result.id,
        );
      return { artifactId: result.id };
    },
    async email({ applicationId, eventType }, ctx) {
      assertEnabled(ctx);
      if (!queue.settings().autoEmail)
        throw fail("Automatic tracking email is disabled.");
      const doc = await generate(applicationId, "email_draft", {
        event_type: eventType,
      });
      approve(doc.id, true, "automation");
      return send(doc.id, {
        checkpoint: ctx.checkpoint,
        beforeSend() {
          assertEnabled(ctx);
          if (!queue.settings().autoEmail)
            throw fail("Automatic email was disabled.");
          markIrreversible(ctx);
        },
      });
    },
    async reminders(_, ctx) {
      assertEnabled(ctx);
      let count = 0;
      for (const a of store.all("applications").filter(visible)) {
        for (const [kind, time] of [
          ["next action", a.nextActionAt],
          ["interview", a.interviewAt],
        ]) {
          if (!time || Date.parse(time) > Date.now() + 24 * 3600000) continue;
          const id = a.id + ":" + kind + ":" + time;
          if (store.get("notifications", id)) continue;
          store.put("notifications", {
            id,
            applicationId: a.id,
            title:
              kind === "interview"
                ? "Interview approaching"
                : a.nextAction || "Follow-up due",
            dueAt: time,
            createdAt: now(),
            read: false,
          });
          count++;
        }
      }
      return { notifications: count };
    },
  };
  const queue = createQueue(store, handlers);
  return { generate, approve, send, jobFor, config, transport, queue, aiEnv };
}
