export type Resume = {
  summary: string;
  skills: string[];
  experience: {
    title: string;
    org: string;
    dates: string;
    bullets: string[];
  }[];
  projects: { name: string; stack: string[]; bullets: string[] }[];
  education: {
    degree: string;
    institution: string;
    year: string;
    grade: string;
  }[];
};
export type Profile = {
  full_name: string;
  first_name?: string;
  last_name?: string;
  email: string;
  phone: string;
  location: string;
  willing_to_relocate: boolean | string;
  expected_salary: string | null;
  notice_period: string | null;
  work_authorization: string;
  links: { github: string; linkedin: string; portfolio: string };
  resume_structured: Resume;
  resume_raw_text: string;
  experience_years?: number | null;
  target_roles?: string[];
  authorized_countries?: string[];
  requires_sponsorship?: boolean | null;
  answers?: { question: string; answer: string; domain: string }[];
};
export type Status =
  | "shortlisted"
  | "preparing"
  | "ready_to_apply"
  | "applied"
  | "interview_scheduled"
  | "interviewing"
  | "offer"
  | "rejected"
  | "withdrawn";
export type MatchAnalysis = {
  score: number;
  requirements: {
    skill: string;
    kind: string;
    matched: boolean;
    evidence: string;
  }[];
  matched: string[];
  missing: string[];
  blockers: string[];
  uncertainties: string[];
  confidence: string;
  eligible: boolean;
  stale: boolean;
  disclaimer: string;
  experience: {
    requiredYears: number | null;
    suppliedYears: number | null;
    fit: string;
  };
  seniority: string | null;
};
export type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  salary: string;
  url: string;
  remote: boolean;
  tags: string[];
  source: string;
  sources?: string[];
  sample: boolean;
  color?: string;
  postedAt?: string;
  fetchedAt?: string;
  analysis?: MatchAnalysis;
  match: {
    match_score: number;
    reason: string;
    location_fit: string;
    salary_fit: string;
  };
};
export type Application = {
  id: string;
  jobId: string;
  jobSnapshot?: Job;
  status: Status;
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  interviewAt: string | null;
  nextAction?: string;
  nextActionAt?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  submittedArtifactIds?: string[];
  selectedArtifactIds?: string[];
  submissionReceipt?: { receipt: string; url: string; receivedAt: string };
};
export type Source = {
  id: string;
  title: string;
  url: string;
  content: string;
  publishedAt?: string;
};
export type FieldDecision = {
  selector: string;
  label: string;
  action: "FILL" | "GENERATE" | "FLAG";
  value: string | null;
  reason_if_flagged: string | null;
};
export type Output = (
  | {
      mode: "resume_tailor";
      resume_tailored: Resume;
      keywords_matched: string[];
      keywords_missing_from_candidate: string[];
    }
  | { mode: "cover_letter"; cover_letter: string }
  | { mode: "email_draft"; subject: string; body: string }
  | {
      mode: "round_prep";
      company: string;
      process_overview: string;
      rounds: {
        round_name: string;
        what_to_expect: string;
        practice_questions: string[];
        confidence: string;
      }[];
      company_context: string;
      candidate_emphasis_notes: string;
    }
  | {
      mode: "form_fill";
      blocking_issue: string | null;
      fields: FieldDecision[];
    }
) & { job_url: string };
export type Artifact = {
  id: string;
  applicationId: string;
  title: string;
  output: Output;
  profile?: Profile;
  sources: Source[];
  version: number;
  approved: boolean;
  stale?: boolean;
  delivery: string;
  createdAt: string;
  grounding?: string;
  writingMethod?: string;
  changes?: { path: string; before: unknown; after: unknown }[];
  evidence?: unknown[];
  practice?: { skill: string; question: string; source: string }[];
  parentId?: string;
};
export type Automation = {
  enabled: boolean;
  autoSubmit: boolean;
  autoEmail: boolean;
  useAI: boolean;
  minMatch: number;
  maxApplicationsPerDay: number;
  maxAICallsPerDay: number;
  intervalHours: number;
  allowedDomains: string[];
  excludedCompanies: string[];
};
export type Task = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  error: string | null;
  payload: { applicationId?: string; searchId?: string };
  createdAt: string;
  updatedAt: string;
  irreversibleAt?: string;
};
export type SavedSearch = {
  id: string;
  query: string;
  location: string;
  enabled: boolean;
  lastRunAt?: string;
  lastCount?: number;
  warnings?: string[];
};
export type Config = {
  gemini: boolean;
  research: boolean;
  adzuna: boolean;
  email: boolean;
  model: string;
  mailTo: string;
  checks?: Record<
    string,
    { status: string; message: string; checkedAt: string }
  >;
};
export type State = {
  profile: Profile;
  sample: boolean;
  jobs: Job[];
  applications: Application[];
  artifacts: Artifact[];
  events: {
    id: string;
    applicationId: string | null;
    title: string;
    detail: string;
    createdAt: string;
  }[];
  runs: { id: string; mode: string; status: string; error?: string }[];
  config: Config;
  automation: Automation;
  tasks: Task[];
  savedSearches: SavedSearch[];
  notifications: {
    id: string;
    applicationId: string;
    title: string;
    dueAt: string;
  }[];
  usage: { id: string; calls: number; totalTokens: number; model?: string }[];
};
export type Execute = <T>(
  work: () => Promise<T>,
  message?: string,
) => Promise<T | undefined>;
export const statusLabels: Record<Status, string> = {
  shortlisted: "Shortlisted",
  preparing: "Preparing",
  ready_to_apply: "Ready to apply",
  applied: "Applied",
  interview_scheduled: "Interview scheduled",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};
export const active = (a: Application) => !a.archivedAt && !a.deletedAt;
export const applicationJob = (state: State, a: Application) =>
  state.jobs.find((j) => j.id === a.jobId) || a.jobSnapshot;

export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
};

export type AuthState = {
  user: User | null;
  setupRequired?: boolean;
};
