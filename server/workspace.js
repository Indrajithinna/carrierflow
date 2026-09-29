import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { profileSchema, jobSchema, outputs, statuses } from "./schema.js";
import { fail } from "./ai.js";
export const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const now = () => new Date().toISOString();
export const visible = (a) => !a.archivedAt && !a.deletedAt;
export function canonicalKey(j) {
  return [j.company, j.title, j.location]
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim(),
    )
    .join("|");
}
export function upsertJobs(store, jobs) {
  const existing = store.all("jobs"),
    result = [];
  for (const raw of jobs) {
    const j = jobSchema.parse(raw);
    const key = canonicalKey(j);
    const previous = existing.find(
      (x) =>
        !x.sample &&
        (x.canonicalKey === key || canonicalKey(x) === key || x.url === j.url),
    );
    const merged = {
      ...previous,
      ...j,
      id: previous?.id || j.id || randomUUID(),
      canonicalKey: key,
      fetchedAt: now(),
      sources: [
        ...new Set(
          [...(previous?.sources || []), previous?.source, j.source].filter(
            Boolean,
          ),
        ),
      ],
    };
    store.put("jobs", merged);
    existing.push(merged);
    result.push(merged);
  }
  return [...new Map(result.map((j) => [j.id, j])).values()];
}
export function saveApplication(store, jobId) {
  const j = store.get("jobs", jobId);
  if (!j) throw fail("Job not found.", 404);
  const existing = store.all("applications").find((a) => a.jobId === jobId);
  if (existing) return existing;
  const a = {
    id: randomUUID(),
    jobId,
    jobSnapshot: structuredClone(j),
    status: "shortlisted",
    notes: "",
    version: 1,
    createdAt: now(),
    updatedAt: now(),
    appliedAt: null,
    interviewAt: null,
    nextAction: "Prepare application",
    nextActionAt: null,
    archivedAt: null,
    deletedAt: null,
  };
  store.put("applications", a);
  store.event(a.id, "Saved to shortlist", j.company);
  return a;
}
export function selectedDocuments(store, a, ids, profileHash) {
  const docs = ids.map((id) => store.get("artifacts", id));
  const modes = new Set();
  for (const d of docs) {
    if (
      !d ||
      d.applicationId !== a.id ||
      !d.approved ||
      d.profileHash !== profileHash ||
      !["resume_tailor", "cover_letter"].includes(d.output.mode)
    )
      throw fail(
        "Choose current approved documents belonging to this application.",
      );
    if (modes.has(d.output.mode))
      throw fail("Choose only one version of each document type.");
    modes.add(d.output.mode);
  }
  return docs;
}
export function backup(store) {
  return {
    version: 2,
    exportedAt: now(),
    sample: !!store.setting("sample"),
    profile: store.setting("profile"),
    jobs: store.all("jobs"),
    applications: store.all("applications"),
    artifacts: store.all("artifacts"),
    events: store.all("events"),
    savedSearches: store.all("savedSearches"),
  };
}
export function restore(store, raw) {
  const record = z.object({ id: z.string().min(1).max(100) }).passthrough();
  const data = z
    .object({
      version: z.union([z.literal(1), z.literal(2)]),
      exportedAt: z.string().optional(),
      sample: z.boolean().default(false),
      profile: profileSchema,
      jobs: jobSchema.array().max(10000),
      applications: record.array().max(10000),
      artifacts: record.array().max(30000),
      events: record.array().max(50000),
      savedSearches: record.array().max(100).default([]),
    })
    .strict()
    .parse(raw);
  const jobs = new Set(data.jobs.map((j) => j.id)),
    apps = new Set(data.applications.map((a) => a.id));
  for (const key of [
    "jobs",
    "applications",
    "artifacts",
    "events",
    "savedSearches",
  ])
    if (new Set(data[key].map((x) => x.id)).size !== data[key].length)
      throw fail("Backup contains duplicate IDs.");
  for (const a of data.applications) {
    if (
      !jobs.has(a.jobId) ||
      !statuses.includes(a.status) ||
      !Number.isInteger(a.version)
    )
      throw fail("Backup contains an invalid application.");
  }
  for (const a of data.artifacts) {
    if (!apps.has(a.applicationId) || !outputs[a.output?.mode])
      throw fail("Backup contains an orphan or unknown document.");
    outputs[a.output.mode].parse(a.output);
    profileSchema.parse(a.profile);
  }
  // Import never restores authorization, active worker jobs, or approved documents.
  store.transaction(() => {
    store.db.exec("DELETE FROM records");
    store.setting("profile", data.profile);
    store.setting("sample", data.sample);
    store.setting("automation", null);
    for (const kind of ["jobs", "applications", "events", "savedSearches"])
      for (const r of data[kind]) store.put(kind, r);
    for (const a of data.artifacts)
      store.put("artifacts", {
        ...a,
        approved: false,
        approvedAt: null,
        delivery: ["sent", "sending", "unknown"].includes(a.delivery)
          ? "unknown"
          : "draft",
      });
    store.event(
      null,
      "Workspace restored",
      "Automation paused and document approvals cleared.",
    );
  });
  return {
    success: true,
    counts: {
      jobs: data.jobs.length,
      applications: data.applications.length,
      artifacts: data.artifacts.length,
    },
  };
}
export function calendar(store) {
  const escape = (s) =>
    String(s || "")
      .replaceAll("\\", "\\\\")
      .replaceAll("\n", "\\n")
      .replaceAll(",", "\\,")
      .replaceAll(";", "\\;")
      .replace(/\r/g, "");
  const stamp = (d) =>
    new Date(d)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Careerflow//Local Workspace//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const a of store.all("applications").filter(visible)) {
    const j = a.jobSnapshot || store.get("jobs", a.jobId);
    for (const [kind, time, title] of [
      ["interview", a.interviewAt, "Interview: " + j.company],
      ["action", a.nextActionAt, a.nextAction || "Follow up: " + j.company],
    ]) {
      if (!time || !Number.isFinite(Date.parse(time))) continue;
      lines.push(
        "BEGIN:VEVENT",
        "UID:" + a.id + "-" + kind + "@careerflow.local",
        "DTSTAMP:" + stamp(now()),
        "DTSTART:" + stamp(time),
        "DTEND:" + stamp(Date.parse(time) + 3600000),
        "SUMMARY:" + escape(title),
        "DESCRIPTION:" + escape(j.title + "\n" + j.url),
        "BEGIN:VALARM",
        "TRIGGER:-PT30M",
        "ACTION:DISPLAY",
        "DESCRIPTION:Careerflow reminder",
        "END:VALARM",
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return (
    lines
      .map((line) => {
        let result = "",
          count = 0;
        for (const c of line) {
          const n = Buffer.byteLength(c);
          if (count + n > 73) {
            result += "\r\n ";
            count = 1;
          }
          result += c;
          count += n;
        }
        return result;
      })
      .join("\r\n") + "\r\n"
  );
}
