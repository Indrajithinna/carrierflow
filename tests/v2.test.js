import test from "node:test";
import assert from "node:assert/strict";
import { Document, Packer, Paragraph } from "docx";
import { createStore } from "../server/db.js";
import { createApp, errorHandler } from "../server/app.js";
import { createServices } from "../server/services.js";
import { createQueue, automationSchema } from "../server/queue.js";
import { sampleProfile, sampleJobs } from "../server/seed.js";
import {
  parseSalary,
  salaryFit,
  analyzeMatch,
  overlap,
} from "../server/matching.js";
import { localIntake, extractResume } from "../server/intake.js";
import {
  backup,
  restore,
  upsertJobs,
  saveApplication,
  selectedDocuments,
  hash,
  calendar,
  now,
} from "../server/workspace.js";
import {
  verifyEvidence,
  changesBetween,
  buildResearch,
  createDocument,
} from "../server/documents.js";
import {
  allowedApplicationUrl,
  publicAddress,
} from "../server/browser-runner.js";
import { askAI, objectSchema } from "../server/ai.js";
import { z } from "zod";

test("salary ranges share suffixes and annualize monthly compensation", () => {
  assert.deepEqual(parseSalary("INR 18–24 LPA"), {
    currency: "INR",
    period: "year",
    min: 1800000,
    max: 2400000,
  });
  assert.equal(
    salaryFit("INR 150000 per month", "INR 18–24 LPA"),
    "within_range",
  );
  assert.equal(salaryFit("USD 20 per hour", "USD 42000 per year"), "unknown");
  assert.equal(parseSalary("18 LPA"), null);
});
test("matching distinguishes preferred gaps from requirements and does not duplicate casing", () => {
  const p = {
    ...sampleProfile,
    resume_structured: {
      ...sampleProfile.resume_structured,
      skills: ["React", "react"],
    },
  };
  const j = {
    ...sampleJobs[0],
    description: "React is required. Kubernetes is preferred.",
    tags: [],
  };
  const a = analyzeMatch(p, j);
  assert.equal(
    a.requirements.filter((r) => r.skill.toLowerCase() === "react").length,
    1,
  );
  assert.equal(
    a.requirements.find((r) => r.skill === "Kubernetes").kind,
    "preferred",
  );
  assert.equal(
    a.blockers.some((s) => s.includes("Kubernetes")),
    false,
  );
});
test("eligibility blocks missing experience, sponsorship restrictions, and stale listings", () => {
  const a = analyzeMatch(
    { ...sampleProfile, experience_years: 1, requires_sponsorship: true },
    {
      ...sampleJobs[0],
      description:
        "React is required. 5+ years of experience. No visa sponsorship.",
      postedAt: "2020-01-01",
    },
  );
  assert.equal(a.eligible, false);
  assert.equal(a.experience.fit, "gap");
  assert.ok(a.blockers.some((s) => s.includes("sponsorship")));
  assert.ok(a.stale);
});
test("authorization does not imply residence in a remote job country", () => {
  const a = analyzeMatch(
    { ...sampleProfile, authorized_countries: ["United States"] },
    { ...sampleJobs[0], remote: true, location: "United States" },
  );
  assert.equal(a.location_fit, "mismatch");
});
test("raw text alone does not create approved structured candidate facts", () => {
  const p = {
    ...sampleProfile,
    resume_raw_text: "Expert in Rust and Kubernetes",
  };
  assert.equal(
    overlap(p, { description: "Rust and Kubernetes", tags: [] }).matched.length,
    0,
  );
});
test("local intake organizes readable sections while retaining exact bullet facts", () => {
  const text =
    "Alex Morgan\nalex@example.com\nSummary\nFrontend engineer building React interfaces.\nExperience\nEngineer | Studio One | 2022–2025\n- Built accessible React dashboards.\nSkills\nReact, TypeScript\nEducation\nBSc | Example University | 2022";
  const r = localIntake(text);
  assert.equal(r.profile.full_name, "Alex Morgan");
  assert.equal(r.profile.email, "alex@example.com");
  assert.equal(
    r.profile.resume_structured.experience[0].bullets[0],
    "Built accessible React dashboards.",
  );
  assert.equal(r.profile.experience_years, undefined);
});
test("DOCX intake extracts source text without loading external content", async () => {
  const buffer = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph("Alex Morgan"),
            new Paragraph("alex@example.com"),
            new Paragraph("Summary"),
            new Paragraph(
              "Frontend engineer building accessible React interfaces.",
            ),
          ],
        },
      ],
    }),
  );
  const r = await extractResume("resume.docx", buffer.toString("base64"));
  assert.ok(r.text.includes("accessible React"));
  assert.equal(r.profile.email, "alex@example.com");
});
test("invalid document types and unreadable content are rejected", async () => {
  await assert.rejects(
    extractResume(
      "resume.exe",
      Buffer.from("not a document").toString("base64"),
    ),
  );
  await assert.rejects(
    extractResume("resume.pdf", Buffer.from("bad pdf").toString("base64")),
  );
  await assert.rejects(
    extractResume("empty.txt", Buffer.from(" ").toString("base64")),
  );
});
test("source evidence cannot introduce numbers or uncited technologies", () => {
  const facts = [
    { id: "one", text: "Built React dashboards used by 40 teams." },
  ];
  assert.throws(() =>
    verifyEvidence("Built React dashboards for 400 teams.", ["one"], facts),
  );
  assert.throws(() => verifyEvidence("Used Kubernetes.", ["one"], facts));
  assert.throws(() => verifyEvidence("Used React.", ["missing"], facts));
  assert.ok(verifyEvidence("Built React dashboards.", ["one"], facts));
});
test("resume generation preserves employment chronology and records differences", async () => {
  const p = structuredClone(sampleProfile);
  p.resume_structured.experience.push({
    title: "Old role",
    org: "Earlier company",
    dates: "2019–2020",
    bullets: ["Built React and TypeScript services."],
  });
  const result = await createDocument("resume_tailor", p, sampleJobs[0]);
  assert.deepEqual(
    result.output.resume_tailored.experience.map((e) => e.org),
    p.resume_structured.experience.map((e) => e.org),
  );
  assert.equal(result.grounding, "source-preserved");
  assert.deepEqual(changesBetween({ text: "before" }, { text: "after" }), [
    { path: "text", before: "before", after: "after" },
  ]);
});
test("research combines stage evidence and labels general practice separately", () => {
  const source = [
    {
      id: "s1",
      url: "https://example.com/hiring",
      title: "Process",
      content:
        "We start with a recruiter screen. The technical interview covers system design.",
    },
    {
      id: "s2",
      url: "https://example.com/interview",
      title: "Interview",
      content: "The technical interview uses pair programming.",
    },
  ];
  const result = buildResearch(sampleProfile, sampleJobs[0], source);
  assert.equal(
    result.output.rounds.filter((r) => r.round_name === "Technical interview")
      .length,
    1,
  );
  assert.equal(
    result.citations.find((c) => c.stage === "Technical interview").evidence
      .length,
    2,
  );
  assert.ok(result.practice.every((p) => p.source.includes("not a reported")));
  assert.equal(
    buildResearch(sampleProfile, sampleJobs[0], []).output.rounds.length,
    0,
  );
});
test("job deduplication retains stable IDs and application snapshots", () => {
  const store = createStore(":memory:", false);
  try {
    const a = upsertJobs(store, [
      { ...sampleJobs[0], id: "a", sample: false },
    ])[0];
    const application = saveApplication(store, a.id);
    const changed = {
      ...a,
      id: "b",
      source: "Another source",
      description: "New changed description mentioning React.",
    };
    const b = upsertJobs(store, [changed])[0];
    assert.equal(a.id, b.id);
    assert.equal(store.all("jobs").length, 1);
    assert.equal(application.jobSnapshot.description, a.description);
    assert.ok(b.sources.includes("Another source"));
  } finally {
    store.db.close();
  }
});
test("only the explicitly selected current version is recorded", () => {
  const store = createStore(":memory:");
  try {
    const a = store.all("applications")[0],
      p = store.setting("profile");
    for (const [id, version] of [
      ["one", 1],
      ["two", 2],
    ])
      store.put("artifacts", {
        id,
        applicationId: a.id,
        approved: true,
        profileHash: hash(p),
        version,
        output: { mode: "resume_tailor" },
      });
    assert.deepEqual(
      selectedDocuments(store, a, ["two"], hash(p)).map((d) => d.id),
      ["two"],
    );
    assert.throws(() => selectedDocuments(store, a, ["one", "two"], hash(p)));
    assert.throws(() => selectedDocuments(store, a, ["one"], "stale"));
  } finally {
    store.db.close();
  }
});
test("backup restore is validated, transactional, and does not restore permissions", () => {
  const store = createStore(":memory:");
  try {
    const b = backup(store);
    assert.equal("extensionToken" in b, false);
    const invalid = structuredClone(b);
    invalid.applications[0].jobId = "missing";
    assert.throws(() => restore(store, invalid));
    assert.equal(store.all("jobs").length, 8);
    store.setting("automation", { enabled: true });
    restore(store, b);
    assert.equal(store.setting("automation"), null);
    assert.equal(store.all("jobs").length, 8);
  } finally {
    store.db.close();
  }
});
test("calendar escapes user text and carries reminder alarms", () => {
  const store = createStore(":memory:");
  try {
    const a = store.all("applications")[0];
    store.put("applications", {
      ...a,
      nextAction: "Follow up, tomorrow; please\nNew line",
      nextActionAt: now(),
    });
    const ics = calendar(store);
    assert.ok(ics.includes("BEGIN:VALARM"));
    assert.ok(ics.includes("Follow up\\, tomorrow\\; please\\nNew line"));
    assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  } finally {
    store.db.close();
  }
});
test("queue deduplicates work, retries only safe transient failures, and quarantines crashes", async () => {
  const store = createStore(":memory:");
  try {
    store.put("tasks", {
      id: "crash-submit",
      kind: "submit",
      status: "running",
      payload: {},
      key: "crash",
      createdAt: now(),
    });
    let attempts = 0;
    const queue = createQueue(store, {
      prepare: async () => {
        attempts++;
        if (attempts === 1)
          throw Object.assign(new Error("temporary"), { status: 503 });
        return { done: true };
      },
    });
    assert.equal(store.get("tasks", "crash-submit").status, "uncertain");
    const t = queue.enqueue("prepare", {}, "same");
    assert.equal(queue.enqueue("prepare", {}, "same").id, t.id);
    await queue.tick();
    assert.equal(store.get("tasks", t.id).status, "queued");
    store.put("tasks", { ...store.get("tasks", t.id), nextAt: now() });
    await queue.tick();
    assert.equal(store.get("tasks", t.id).status, "succeeded");
    assert.throws(() => queue.retry("crash-submit"));
  } finally {
    store.db.close();
  }
});
test("queue refuses automatic retries after an irreversible step", async () => {
  const store = createStore(":memory:");
  try {
    const queue = createQueue(store, {
      submit: async (_, ctx) => {
        store.put("tasks", {
          ...store.get("tasks", ctx.taskId),
          irreversibleAt: now(),
        });
        throw Object.assign(new Error("No receipt"), { status: 503 });
      },
    });
    const t = queue.enqueue("submit");
    await queue.tick();
    assert.equal(store.get("tasks", t.id).status, "uncertain");
    assert.throws(() => queue.retry(t.id));
  } finally {
    store.db.close();
  }
});
test("sample package preparation creates approved documents but never submits", async () => {
  const store = createStore(":memory:");
  const service = createServices(store, {});
  try {
    const a = store.all("applications").find((a) => a.status === "shortlisted");
    const t = service.queue.enqueue("prepare", {
      applicationId: a.id,
      profileHash: hash(store.setting("profile")),
    });
    await service.queue.tick();
    assert.equal(store.get("tasks", t.id).status, "succeeded");
    assert.equal(store.get("applications", a.id).status, "ready_to_apply");
    assert.equal(store.all("artifacts").filter((d) => d.approved).length, 2);
    assert.equal(
      store.all("tasks").some((t) => t.kind === "submit"),
      false,
    );
  } finally {
    store.db.close();
  }
});
test("concurrent generation allocates unique document versions", async () => {
  const store = createStore(":memory:");
  const service = createServices(store, {});
  try {
    const a = store.all("applications")[0];
    const docs = await Promise.all([
      service.generate(a.id, "resume_tailor"),
      service.generate(a.id, "resume_tailor"),
    ]);
    assert.deepEqual(docs.map((d) => d.version).sort(), [1, 2]);
  } finally {
    store.db.close();
  }
});
test("automatic application URLs must match exact public HTTPS hostnames", () => {
  assert.equal(
    allowedApplicationUrl("https://jobs.example.com/apply", [
      "jobs.example.com",
    ]),
    true,
  );
  for (const url of [
    "http://jobs.example.com",
    "https://jobs.example.com.evil.test",
    "https://jobs.example.com:8443",
    "https://user:pass@jobs.example.com",
    "https://127.0.0.1/",
  ])
    assert.equal(allowedApplicationUrl(url, ["jobs.example.com"]), false);
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.0.5",
    "169.254.169.254",
    "::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.throws(() =>
    automationSchema.parse({ allowedDomains: ["localhost"] }),
  );
});
test("AI adapter sends an explicit schema and validates the response", async () => {
  const previous = global.fetch;
  let request;
  global.fetch = async (url, opts) => {
    request = JSON.parse(opts.body);
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"value":"ok"}' }] } }],
        usageMetadata: { totalTokenCount: 4 },
      }),
      { status: 200 },
    );
  };
  try {
    const r = await askAI(
      "Return a value",
      {},
      objectSchema({ value: { type: "string" } }),
      z.object({ value: z.string() }).strict(),
      { GEMINI_API_KEY: "fixture" },
    );
    assert.equal(r.value, "ok");
    assert.ok(request.generationConfig.responseJsonSchema);
    assert.ok(request.systemInstruction.parts[0].text.includes("untrusted"));
  } finally {
    global.fetch = previous;
  }
});
test("new HTTP workflows preserve versions, enforce submission stages, and support undo", async () => {
  const store = createStore(":memory:");
  const app = createApp(store, {});
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + server.address().port + "/api";
  const call = async (path, method = "GET", body) => {
    const r = await fetch(url + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    const a = store.all("applications").find((a) => a.status === "shortlisted");
    assert.equal(
      (
        await call("/applications/" + a.id, "PATCH", {
          status: "offer",
          version: a.version,
        })
      ).status,
      422,
    );
    const archived = await call("/applications/" + a.id, "PATCH", {
      archived: true,
      version: a.version,
    });
    assert.ok(archived.data.archivedAt);
    const restored = await call("/applications/" + a.id, "PATCH", {
      archived: false,
      version: archived.data.version,
    });
    assert.equal(restored.data.archivedAt, null);
    const doc = (
      await call("/applications/" + a.id + "/generate", "POST", {
        mode: "resume_tailor",
      })
    ).data;
    await call("/artifacts/" + doc.id, "PATCH", { approved: true });
    const output = structuredClone(doc.output);
    output.resume_tailored.summary = "Edited summary supplied by the user.";
    const revision = await call("/artifacts/" + doc.id + "/versions", "POST", {
      output,
    });
    assert.equal(revision.status, 201);
    assert.equal(revision.data.version, 2);
    assert.equal(revision.data.approved, false);
    assert.notEqual(
      store.get("artifacts", doc.id).output.resume_tailored.summary,
      output.resume_tailored.summary,
    );
    const check = await call("/settings/verify/gemini", "POST", {});
    assert.equal(check.data.status, "failed");
    const boot = (await call("/bootstrap")).data;
    assert.ok(boot.artifacts.every((d) => !d.profile));
    assert.equal("GEMINI_API_KEY" in boot.config, false);
    assert.equal(
      (
        await call("/automation", "PUT", {
          ...automationSchema.parse({}),
          maxApplicationsPerDay: 999,
        })
      ).status,
      422,
    );
    const task = await call("/tasks", "POST", {
      kind: "prepare",
      applicationId: a.id,
    });
    assert.equal(task.status, 202);
    assert.equal(
      (await call("/tasks/" + task.data.id + "/cancel", "POST", {})).status,
      200,
    );
  } finally {
    await app.locals.queue.stop();
    await new Promise((r) => server.close(r));
    store.db.close();
  }
});
