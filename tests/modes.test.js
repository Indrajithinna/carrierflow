import test from "node:test";
import assert from "node:assert/strict";
import { sampleProfile, sampleJobs } from "../server/seed.js";
import {
  runMode,
  match,
  parseSalary,
  salaryFit,
  mapFields,
  contains,
  coverTemplate,
  validateCover,
} from "../server/modes.js";
import { outputs, blankProfile } from "../server/schema.js";
const p = sampleProfile,
  j = sampleJobs[0];
test("zero relevant overlap always scores zero even with matching salary and location", () => {
  const r = match(p, {
    ...j,
    tags: ["Rust"],
    description: "Build Rust compilers and LLVM systems.",
  });
  assert.equal(r.match_score, 0);
  assert.equal(r.reason, "no relevant overlap");
});
test("skill matching respects token boundaries", () => {
  assert.equal(contains("An ongoing relationship", "Go"), false);
  assert.equal(contains("React and Node.js", "Node.js"), true);
  assert.equal(contains("JavaScript", "Java"), false);
});
test("salary comparison never guesses currency or period", () => {
  assert.equal(
    salaryFit("INR 1800000 per year", "INR 1600000 - 2400000 per year"),
    "within_range",
  );
  assert.equal(
    salaryFit("INR 1800000 per year", "USD 100000 per year"),
    "unknown",
  );
  assert.equal(salaryFit(null, "INR 1800000 per year"), "unknown");
  assert.equal(parseSalary("1800000"), null);
  assert.equal(salaryFit("INR 30 lpa", "INR 20 lpa"), "below_range");
});
test("remote role in another country is not automatically compatible", () => {
  assert.equal(
    match(p, { ...j, remote: true, location: "United States" }).location_fit,
    "mismatch",
  );
});
test("tailored resume preserves every original bullet without invented tools", async () => {
  const r = await runMode("resume_tailor", {
    candidate_profile: p,
    job_listing: {
      ...j,
      description: j.description + " AWS Terraform Kubernetes.",
    },
  });
  const original = p.resume_structured.experience
    .flatMap((e) => e.bullets)
    .concat(p.resume_structured.projects.flatMap((e) => e.bullets))
    .sort();
  assert.deepEqual(
    r.resume_tailored.experience
      .flatMap((e) => e.bullets)
      .concat(r.resume_tailored.projects.flatMap((e) => e.bullets))
      .sort(),
    original,
  );
  assert.deepEqual(
    [...r.resume_tailored.skills].sort(),
    [...p.resume_structured.skills].sort(),
  );
  assert.ok(r.keywords_missing_from_candidate.includes("AWS"));
  assert.equal("provenance" in r, false);
});
test("cover letter meets the requested contract and uses original facts", () => {
  const s = coverTemplate(p, j);
  validateCover(s, p, j);
  assert.ok(s.includes(p.resume_structured.experience[0].bullets[0]));
  assert.ok(s.split(/\s+/).length >= 250);
  assert.ok(s.split(/\s+/).length <= 350);
});
test("sensitive IDs and unknown salary are flagged", () => {
  const r = mapFields({ ...p, expected_salary: null }, j, [
    { label: "Date of birth", selector: "dob", type: "date", required: true },
    {
      label: "Expected salary",
      selector: "salary",
      type: "text",
      required: true,
    },
    { label: "First name", selector: "name", type: "text", required: true },
  ]);
  assert.ok(r.fields.every((f) => f.action === "FLAG" && f.value === null));
});
test("CAPTCHA stops processing later fields", () => {
  const r = mapFields(p, j, [
    { label: "Full name", selector: "name", type: "text", required: true },
    { label: "CAPTCHA", selector: "cap", type: "captcha", required: true },
    { label: "Email", selector: "email", type: "email", required: true },
  ]);
  assert.ok(r.blocking_issue);
  assert.equal(r.fields.length, 1);
});
test("files return fixed tokens and unmatched select options are flagged", () => {
  const r = mapFields(p, j, [
    { label: "Resume", selector: "cv", type: "file", required: true },
    {
      label: "Work authorization",
      selector: "work",
      type: "select",
      required: true,
      options: ["Yes", "No"],
    },
  ]);
  assert.equal(r.fields[0].value, "UPLOAD:resume_tailored");
  assert.equal(r.fields[1].action, "FLAG");
});
test("research with no evidence never invents rounds", async () => {
  const r = await runMode("round_prep", {
    candidate_profile: p,
    job_listing: j,
    search_results: [],
  });
  assert.equal(r.process_overview, "insufficient data");
  assert.deepEqual(r.rounds, []);
});
test("research questions are source quotations only", async () => {
  const content =
    "We have a portfolio interview. How did you approach accessibility?";
  const r = await runMode("round_prep", {
    candidate_profile: p,
    job_listing: j,
    search_results: [
      {
        id: "1",
        title: "Our interview process",
        url: "https://example.com/hiring",
        content,
      },
    ],
  });
  assert.equal(r.rounds[0].what_to_expect, content);
  assert.equal(
    r.rounds[0].practice_questions[0],
    "How did you approach accessibility?",
  );
  assert.equal(r.rounds[0].confidence, "low");
});
test("applied tracking email cannot be drafted without submission evidence", async () => {
  await assert.rejects(
    runMode("email_draft", {
      candidate_profile: p,
      job_listing: j,
      event_type: "applied",
      event_payload: {},
    }),
  );
});
test("unknown modes and unexpected output keys are rejected", async () => {
  await assert.rejects(
    runMode("invent", { candidate_profile: p, job_listing: j }),
  );
  assert.throws(() =>
    outputs.search_match.parse({ ...match(p, j), extra: "forbidden" }),
  );
});
