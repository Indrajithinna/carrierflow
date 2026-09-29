export const skills = [
  "React",
  "TypeScript",
  "JavaScript",
  "Node.js",
  "Python",
  "Java",
  "SQL",
  "PostgreSQL",
  "MongoDB",
  "AWS",
  "Azure",
  "GCP",
  "Docker",
  "Kubernetes",
  "Terraform",
  "CSS",
  "HTML",
  "Figma",
  "Git",
  "Accessibility",
  "REST API",
  "GraphQL",
  "Go",
  "Rust",
  "Next.js",
  "C++",
  "C#",
  "Excel",
  "Power BI",
  "Tableau",
  "Salesforce",
  "SAP",
  "SEO",
  "Accounting",
  "Customer support",
  "Project management",
  "Product management",
  "Data analysis",
  "Machine learning",
  "Communication",
  "Leadership",
];
export const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\bnodejs\b|\bnode js\b/g, "node.js")
    .replace(/\bnextjs\b/g, "next.js")
    .replace(/\bpostgres\b/g, "postgresql")
    .replace(/\ba11y\b/g, "accessibility")
    .replace(/\bbengaluru\b/g, "bangalore")
    .trim();
export const contains = (hay, needle) =>
  !!needle &&
  new RegExp(
    "(^|[^a-z0-9])" +
      norm(needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "(?=$|[^a-z0-9])",
    "i",
  ).test(norm(hay));
export function resumeFacts(p) {
  const r = p.resume_structured;
  return [
    r.summary,
    ...r.skills,
    ...r.experience.flatMap((e) => [e.title, e.org, ...e.bullets]),
    ...r.projects.flatMap((e) => [e.name, ...e.stack, ...e.bullets]),
    ...r.education.flatMap((e) => [e.degree, e.institution, e.year, e.grade]),
  ].filter(Boolean);
}
export function overlap(p, j) {
  const seen = new Set();
  const candidates = [
    ...p.resume_structured.skills,
    ...p.resume_structured.projects.flatMap((x) => x.stack),
    ...skills,
  ].filter((s) => {
    const n = norm(s);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  const required = candidates.filter((s) =>
    contains(j.description + " " + (j.tags || []).join(" "), s),
  );
  const facts = resumeFacts(p).join("\n");
  return {
    matched: required.filter((s) => contains(facts, s)),
    missing: required.filter((s) => !contains(facts, s)),
    required,
  };
}
export function parseSalary(raw) {
  const s = String(raw || "")
    .toLowerCase()
    .replaceAll(",", "");
  const currency = /inr|₹/.test(s)
    ? "INR"
    : /usd|\$/.test(s)
      ? "USD"
      : /eur|€/.test(s)
        ? "EUR"
        : /gbp|£/.test(s)
          ? "GBP"
          : null;
  const period = /year|annual|annum|lpa/.test(s)
    ? "year"
    : /month/.test(s)
      ? "month"
      : /hour/.test(s)
        ? "hour"
        : null;
  const parts = [
    ...s.matchAll(/(\d+(?:\.\d+)?)\s*(lakh|lac|lpa|l\b|k\b|m\b)?/g),
  ];
  if (!currency || !period || !parts.length || parts.length > 2) return null;
  const scale = (u) =>
    /^l/.test(u || "") ? 100000 : u === "k" ? 1000 : u === "m" ? 1000000 : 1;
  const shared = parts.at(-1)[2];
  const values = parts.map((m) => Number(m[1]) * scale(m[2] || shared));
  return {
    currency,
    period,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
export function salaryFit(expected, listed) {
  const a = parseSalary(expected),
    b = parseSalary(listed);
  if (!a || !b || a.currency !== b.currency) return "unknown";
  // Monthly/annual are comparable; hourly would need a supplied working-hours assumption.
  if ((a.period === "hour") !== (b.period === "hour")) return "unknown";
  const unit = (x) => (x.period === "month" ? 12 : 1);
  return a.min * unit(a) > b.max * unit(b)
    ? "below_range"
    : a.max * unit(a) < b.min * unit(b)
      ? "above_range"
      : "within_range";
}
export function analyzeMatch(p, j) {
  const o = overlap(p, j),
    sentences = j.description.split(/\n|(?<=[.;])\s+/);
  const requirements = o.required.map((skill) => {
    const evidence = sentences.find((s) => contains(s, skill)) || "";
    const preferred = /preferred|nice.to.have|bonus|desirable|optional/i.test(
      evidence,
    );
    return {
      skill,
      kind: preferred ? "preferred" : "required",
      matched: o.matched.includes(skill),
      evidence: evidence.slice(0, 500),
    };
  });
  const weights = requirements.reduce(
    (n, r) => n + (r.kind === "required" ? 2 : 1),
    0,
  );
  const skillScore = weights
    ? requirements.reduce(
        (n, r) => n + (r.matched ? (r.kind === "required" ? 2 : 1) : 0),
        0,
      ) / weights
    : 0;
  const home = norm(p.location).split(",")[0];
  let location_fit = "mismatch";
  const global = /worldwide|anywhere|global remote/i.test(j.location);
  const countries = p.authorized_countries || [];
  if (
    j.remote &&
    (global ||
      countries.some(
        (c) => contains(j.location, c) && contains(p.location, c),
      ) ||
      (/india/i.test(j.location) && /india/i.test(p.location)))
  )
    location_fit = "remote_ok";
  else if (home && contains(j.location, home)) location_fit = "match";
  else if (
    p.willing_to_relocate === true ||
    /^yes$/i.test(p.willing_to_relocate)
  )
    location_fit = "relocation_required";
  const salary_fit = salaryFit(p.expected_salary, j.salary);
  const years = [
    ...j.description.matchAll(
      /(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s*\+?\s*years?(?:\s+of)?\s+(?:relevant\s+|professional\s+)?experience/gi,
    ),
  ].map((m) => +m[1]);
  const minYears = years.length ? Math.max(...years) : null;
  const experienceFit =
    minYears === null
      ? "not_specified"
      : p.experience_years == null
        ? "unknown"
        : p.experience_years >= minYears
          ? "match"
          : "gap";
  const sponsorshipBlocked =
    p.requires_sponsorship === true &&
    /no (?:visa )?sponsorship|cannot sponsor|unable to sponsor|sponsorship.*not (?:available|provided)/i.test(
      j.description,
    );
  const seniority =
    /\b(principal|staff|senior|lead|head|director)\b/i.exec(j.title)?.[1] ||
    null;
  const seniorityUnknown = !!seniority && p.experience_years == null;
  const expired = !!j.expired;
  const stale =
    !!j.postedAt &&
    Number.isFinite(Date.parse(j.postedAt)) &&
    Date.now() - Date.parse(j.postedAt) > 30 * 86400000;
  const blockers = [];
  const uncertainties = [];
  if (!o.matched.length) blockers.push("No relevant documented skill overlap");
  if (requirements.some((r) => r.kind === "required" && !r.matched))
    blockers.push(
      "Missing explicit requirements: " +
        requirements
          .filter((r) => r.kind === "required" && !r.matched)
          .map((r) => r.skill)
          .join(", "),
    );
  if (location_fit === "mismatch")
    blockers.push("Location / remote eligibility is not established");
  if (experienceFit === "gap")
    blockers.push("Requested experience exceeds supplied experience");
  if (sponsorshipBlocked)
    blockers.push("Employer excludes sponsorship you require");
  if (salary_fit === "below_range")
    blockers.push("Salary below your stated minimum");
  if (expired || stale)
    blockers.push(
      expired
        ? "Listing is marked expired"
        : "Listing is older than 30 days; verify it is still open",
    );
  if (experienceFit === "unknown" || seniorityUnknown)
    uncertainties.push("Confirm your years of experience");
  if (salary_fit === "unknown")
    uncertainties.push("Salary cannot be compared from supplied information");
  if (!p.work_authorization && !countries.length)
    uncertainties.push("Work authorization is not supplied");
  if (j.description.length < 250)
    uncertainties.push("Short description: full requirements may be missing");
  if (!requirements.length)
    uncertainties.push("No recognizable skill requirements");
  const score = o.matched.length
    ? Math.round(
        55 * skillScore +
          (["match", "remote_ok"].includes(location_fit)
            ? 20
            : location_fit === "relocation_required"
              ? 8
              : 0) +
          (salary_fit === "within_range"
            ? 10
            : salary_fit === "above_range"
              ? 7
              : 0) +
          (experienceFit === "match"
            ? 15
            : experienceFit === "not_specified"
              ? 8
              : 0),
      )
    : 0;
  return {
    score,
    location_fit,
    salary_fit,
    requirements,
    matched: o.matched,
    missing: o.missing,
    experience: {
      requiredYears: minYears,
      suppliedYears: p.experience_years ?? null,
      fit: experienceFit,
    },
    seniority,
    blockers,
    uncertainties,
    confidence:
      uncertainties.length > 1
        ? "low"
        : uncertainties.length
          ? "medium"
          : "high",
    eligible:
      blockers.length === 0 &&
      !uncertainties.some((s) =>
        /experience|authorization|description|recognizable/.test(s),
      ),
    stale,
    disclaimer:
      "Requirement alignment, not an interview or hiring probability.",
  };
}
export function match(p, j) {
  const a = analyzeMatch(p, j);
  return {
    mode: "search_match",
    job_url: j.url,
    match_score: a.score,
    location_fit: a.location_fit,
    salary_fit: a.salary_fit,
    reason: a.matched.length
      ? (
          a.matched.slice(0, 4).join(", ") +
          " align; " +
          (a.blockers[0] ||
            a.uncertainties[0] ||
            "check the requirement breakdown.")
        ).slice(0, 500)
      : "no relevant overlap",
  };
}
