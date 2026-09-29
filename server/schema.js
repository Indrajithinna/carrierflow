import { z } from "zod";
const text = z.string().max(60000);
const short = z.string().max(500);
export const resumeSchema = z
  .object({
    summary: text,
    education: z
      .array(
        z
          .object({
            degree: short,
            institution: short,
            year: short,
            grade: short,
          })
          .strict(),
      )
      .max(30),
    experience: z
      .array(
        z
          .object({
            title: short,
            org: short,
            dates: short,
            bullets: z.array(text).max(40),
          })
          .strict(),
      )
      .max(30),
    projects: z
      .array(
        z
          .object({
            name: short,
            stack: z.array(short).max(60),
            bullets: z.array(text).max(40),
          })
          .strict(),
      )
      .max(30),
    skills: z.array(short).max(150),
  })
  .strict();
export const profileSchema = z
  .object({
    full_name: short,
    email: z.union([z.literal(""), z.string().email()]),
    phone: short,
    location: short,
    willing_to_relocate: z.union([z.boolean(), short]),
    expected_salary: short.nullable(),
    notice_period: short.nullable(),
    work_authorization: short,
    links: z
      .object({ github: short, linkedin: short, portfolio: short })
      .strict(),
    resume_structured: resumeSchema,
    resume_raw_text: text,
    first_name: short.optional(),
    last_name: short.optional(),
    experience_years: z.number().min(0).max(70).nullable().optional(),
    target_roles: z.array(short).max(20).optional(),
    authorized_countries: z.array(short).max(30).optional(),
    requires_sponsorship: z.boolean().nullable().optional(),
    answers: z
      .array(
        z
          .object({ question: short, answer: text, domain: short.default("") })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();
export const jobSchema = z
  .object({
    id: short.optional(),
    title: short.min(1),
    company: short.min(1),
    location: short,
    description: text.min(10),
    salary: short.default(""),
    url: z
      .string()
      .url()
      .refine((v) => /^https?:\/\//.test(v), "Use an HTTP(S) URL"),
    remote: z.boolean().default(false),
    tags: z.array(short).max(30).default([]),
    source: short.default("Manual"),
    postedAt: short.optional(),
    sample: z.boolean().default(false),
    color: short.optional(),
    fetchedAt: short.optional(),
    canonicalKey: short.optional(),
    sources: z.array(short).optional(),
    expired: z.boolean().optional(),
  })
  .strict();
export const fieldSchema = z
  .object({
    label: short,
    type: short,
    selector: short,
    required: z.boolean(),
    options: z.array(short).max(100).optional(),
  })
  .strict();
export const sourceSchema = z
  .object({
    id: short,
    url: z.string().url(),
    title: short,
    content: text,
    publishedAt: short.optional(),
  })
  .strict();
export const outputs = {
  search_match: z
    .object({
      mode: z.literal("search_match"),
      job_url: z.string(),
      match_score: z.number().int().min(0).max(100),
      location_fit: z.enum([
        "match",
        "remote_ok",
        "relocation_required",
        "mismatch",
      ]),
      salary_fit: z.enum([
        "within_range",
        "below_range",
        "above_range",
        "unknown",
      ]),
      reason: short,
    })
    .strict(),
  resume_tailor: z
    .object({
      mode: z.literal("resume_tailor"),
      job_url: z.string(),
      resume_tailored: resumeSchema,
      keywords_matched: z.array(short),
      keywords_missing_from_candidate: z.array(short),
    })
    .strict(),
  cover_letter: z
    .object({
      mode: z.literal("cover_letter"),
      job_url: z.string(),
      cover_letter: text,
    })
    .strict(),
  form_fill: z
    .object({
      mode: z.literal("form_fill"),
      job_url: z.string(),
      blocking_issue: short.nullable(),
      fields: z.array(
        z
          .object({
            selector: short,
            label: short,
            action: z.enum(["FILL", "GENERATE", "FLAG"]),
            value: text.nullable(),
            reason_if_flagged: short.nullable(),
          })
          .strict(),
      ),
    })
    .strict(),
  round_prep: z
    .object({
      mode: z.literal("round_prep"),
      job_url: z.string(),
      company: short,
      process_overview: text,
      rounds: z.array(
        z
          .object({
            round_name: short,
            what_to_expect: text,
            practice_questions: z.array(text),
            confidence: z.enum(["high", "medium", "low"]),
          })
          .strict(),
      ),
      company_context: text,
      candidate_emphasis_notes: text,
    })
    .strict(),
  email_draft: z
    .object({
      mode: z.literal("email_draft"),
      job_url: z.string(),
      subject: short,
      body: text,
    })
    .strict(),
};
export const statuses = [
  "shortlisted",
  "preparing",
  "ready_to_apply",
  "applied",
  "interview_scheduled",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
];
export const blankProfile = {
  full_name: "",
  email: "",
  phone: "",
  location: "",
  willing_to_relocate: false,
  expected_salary: null,
  notice_period: null,
  work_authorization: "",
  links: { github: "", linkedin: "", portfolio: "" },
  resume_structured: {
    summary: "",
    education: [],
    experience: [],
    projects: [],
    skills: [],
  },
  resume_raw_text: "",
};

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100),
    email: z
      .string()
      .trim()
      .email("Please enter a valid email address")
      .max(255),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password must be at most 128 characters")
      .regex(/[a-zA-Z]/, "Password must contain at least one letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string(),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email("Please enter a valid email address")
      .max(255),
    password: z.string().min(1, "Password is required").max(128),
  })
  .strict();

export const userPublicSchema = z
  .object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
    role: z.string(),
    createdAt: z.string(),
  })
  .strict();
