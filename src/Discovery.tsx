import { useState } from "react";
import {
  Search,
  Plus,
  Bookmark,
  MapPin,
  ArrowUpRight,
  Sparkles,
  Filter,
} from "lucide-react";
import { api } from "./api";
import {
  type State,
  type Job,
  type Application,
  type Execute,
  active,
} from "./types";
import {
  Button,
  Field,
  Heading,
  Empty,
  Logo,
  Modal,
  date,
  TextList,
} from "./ui";
export function Discovery({
  state,
  execute,
  open,
}: {
  state: State;
  execute: Execute;
  open: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [location, setLocation] = useState(""),
    [remote, setRemote] = useState(false),
    [source, setSource] = useState("all"),
    [sort, setSort] = useState("match"),
    [liveIds, setLiveIds] = useState<string[] | null>(null),
    [filter, setFilter] = useState(""),
    [inspect, setInspect] = useState<Job | null>(null),
    [add, setAdd] = useState(false),
    [warnings, setWarnings] = useState<string[]>([]),
    [limit, setLimit] = useState(24);
  const [draft, setDraft] = useState({
    title: "",
    company: "",
    location: "",
    description: "",
    salary: "",
    url: "",
    remote: false,
  });
  const tokens = filter.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const jobs = state.jobs.filter(
    (j) =>
      (!liveIds || liveIds.includes(j.id)) &&
      tokens.every((t) =>
        (
          j.title +
          " " +
          j.company +
          " " +
          j.description +
          " " +
          j.tags.join(" ")
        )
          .toLowerCase()
          .includes(t),
      ) &&
      (!remote || j.remote) &&
      (source === "all" || j.source === source),
  );
  const amount = (s: string) => {
    const raw = s.toLowerCase().replaceAll(",", "");
    const values = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(lakh|lpa|k\b|m\b)?/g)];
    return values.length
      ? Math.max(
          ...values.map(
            (v) =>
              +v[1] *
              (v[2]?.startsWith("l")
                ? 100000
                : v[2] === "k"
                  ? 1000
                  : v[2] === "m"
                    ? 1000000
                    : 1),
          ),
        )
      : 0;
  };
  jobs.sort((a, b) =>
    sort === "newest"
      ? (Date.parse(b.postedAt || "") || 0) -
        (Date.parse(a.postedAt || "") || 0)
      : sort === "salary"
        ? amount(b.salary) - amount(a.salary)
        : b.match.match_score - a.match.match_score,
  );
  const save = async (j: Job) => {
    const existing = state.applications.find((a) => a.jobId === j.id);
    if (existing) {
      open(existing.id);
      return;
    }
    const a = await execute(
      () => api<Application>("/applications", "POST", { jobId: j.id }),
      "Job saved",
    );
    if (a) open(a.id);
  };
  const search = async () => {
    const result = await execute(() =>
      api<{ jobs: Job[]; warnings: string[] }>("/search", "POST", {
        query: query || state.profile.target_roles?.[0] || "Software Engineer",
        location,
      }),
    );
    if (result) {
      setLiveIds(result.jobs.map((j) => j.id));
      setWarnings(result.warnings);
      setFilter("");
      setLimit(24);
    }
  };
  return (
    <>
      <Heading
        eyebrow="FIND YOUR NEXT CHAPTER"
        title="Good opportunities. Better context."
        description="Understand the requirements before you invest in an application."
      >
        <Button variant="secondary" onClick={() => setAdd(true)}>
          <Plus size={17} />
          Add a job
        </Button>
      </Heading>
      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label>
          <Search size={19} />
          <input
            aria-label="Live search query"
            placeholder="Role, skill, or company"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <MapPin size={18} />
          <input
            aria-label="Search location"
            placeholder="City or country"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <Button type="submit">Search live jobs</Button>
      </form>
      <div className="button-row discovery-actions">
        <Button
          variant="secondary compact"
          disabled={!query.trim()}
          onClick={() =>
            void execute(
              () =>
                api("/saved-searches", "POST", {
                  query,
                  location,
                  enabled: true,
                }),
              "Saved search added to Autopilot",
            )
          }
        >
          <Bookmark size={15} />
          Save search
        </Button>
        {liveIds && (
          <Button variant="ghost" onClick={() => setLiveIds(null)}>
            Show all workspace jobs
          </Button>
        )}
        <span className="muted">
          {liveIds ? "Latest search batch" : "Workspace"} · {jobs.length}{" "}
          opportunities
        </span>
      </div>
      {warnings.length > 0 && (
        <div className="callout warning">
          <TextList items={warnings} />
        </div>
      )}
      <div className="filter-bar">
        <Field label="Filter results">
          <input
            placeholder="Search within these results"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setLimit(24);
            }}
          />
        </Field>
        <Field label="Source">
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">All sources</option>
            {[...new Set(state.jobs.map((j) => j.source))].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Sort">
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="match">Best requirement fit</option>
            <option value="newest">Newest first</option>
            <option value="salary">Listed salary amount</option>
          </select>
        </Field>
        <label className="check-filter">
          <input
            type="checkbox"
            checked={remote}
            onChange={(e) => setRemote(e.target.checked)}
          />
          Remote only
        </label>
      </div>
      {sort === "salary" && (
        <p className="muted">
          Salary sorting uses listed amounts only; different currencies and
          periods are not ranked as equivalent compensation.
        </p>
      )}
      <div className="jobs-grid">
        {jobs.slice(0, limit).map((j) => (
          <article className="job-card" key={j.id}>
            <div className="job-card-top">
              <Logo job={j} />
              <button
                className="match-chip"
                onClick={() => setInspect(j)}
                aria-label={
                  "Explain " +
                  j.match.match_score +
                  " percent fit for " +
                  j.title
                }
              >
                <Sparkles size={13} />
                {j.match.match_score}% fit
              </button>
            </div>
            <p className="company-name">
              {j.company}
              {j.sample && <span className="sample-label">Sample</span>}
            </p>
            <h2>
              <button className="text-button" onClick={() => setInspect(j)}>
                {j.title}
              </button>
            </h2>
            <div className="job-meta">
              <MapPin size={15} />
              {j.location}
            </div>
            <p className="job-description">{j.description}</p>
            <div className="tags">
              {j.tags.slice(0, 3).map((t) => (
                <span key={t}>{t}</span>
              ))}
              {j.remote && <span>Remote</span>}
              {j.analysis?.stale && (
                <span className="warning-text">Verify still open</span>
              )}
            </div>
            <div className="job-card-bottom">
              <div>
                <strong>{j.salary || "Salary not listed"}</strong>
                <small>
                  {(j.sources || [j.source]).join(" + ")} · {date(j.postedAt)}
                </small>
              </div>
              <Button variant="secondary compact" onClick={() => void save(j)}>
                {state.applications.some((a) => a.jobId === j.id)
                  ? "Open"
                  : "Save"}
                <ArrowUpRight size={15} />
              </Button>
            </div>
          </article>
        ))}
      </div>
      {!jobs.length && (
        <Empty title="No matches in this view">
          Try another search, clear the filters, or add a complete job
          description.
        </Empty>
      )}
      {jobs.length > limit && (
        <Button variant="secondary" onClick={() => setLimit(limit + 24)}>
          Load 24 more
        </Button>
      )}
      {inspect && (
        <Modal
          title={inspect.title + " · " + inspect.company}
          onClose={() => setInspect(null)}
        >
          <div className="modal-body">
            <MatchBreakdown job={inspect} />
            <h3>Job description</h3>
            <p className="preserve-text">{inspect.description}</p>
            <div className="button-row">
              <a
                className="button secondary"
                href={inspect.url}
                target="_blank"
                rel="noreferrer"
              >
                Employer listing
                <ArrowUpRight size={16} />
              </a>
              <Button
                onClick={() => {
                  void save(inspect);
                  setInspect(null);
                }}
              >
                Save / open application
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {add && (
        <Modal title="Add an opportunity" onClose={() => setAdd(false)}>
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              const j = await execute(
                () => api<Job>("/jobs", "POST", draft),
                "Job added",
              );
              if (j) setAdd(false);
            }}
          >
            <div className="form-grid">
              {(["title", "company", "location", "salary", "url"] as const).map(
                (k) => (
                  <Field
                    key={k}
                    label={
                      {
                        title: "Job title",
                        company: "Company",
                        location: "Location",
                        salary: "Salary with currency and period",
                        url: "Employer application URL",
                      }[k]
                    }
                  >
                    <input
                      required={["title", "company", "url"].includes(k)}
                      type={k === "url" ? "url" : "text"}
                      value={draft[k]}
                      onChange={(e) =>
                        setDraft({ ...draft, [k]: e.target.value })
                      }
                    />
                  </Field>
                ),
              )}
            </div>
            <Field label="Complete job description">
              <textarea
                required
                minLength={10}
                rows={9}
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </Field>
            <label className="check-filter">
              <input
                type="checkbox"
                checked={draft.remote}
                onChange={(e) =>
                  setDraft({ ...draft, remote: e.target.checked })
                }
              />
              Remote role
            </label>
            <Button type="submit">Add job</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function MatchBreakdown({ job }: { job: Job }) {
  const a = job.analysis;
  return (
    <section className="match-breakdown">
      <div className="fit-summary">
        <strong>{job.match.match_score}%</strong>
        <div>
          <h3>Requirement alignment</h3>
          <p>{job.match.reason}</p>
        </div>
      </div>
      {a && (
        <>
          <p className="muted">
            {a.disclaimer} Confidence: {a.confidence}.
          </p>
          <div className="requirement-grid">
            {a.requirements.map((r) => (
              <div
                key={r.skill}
                className={r.matched ? "requirement met" : "requirement gap"}
              >
                <strong>
                  {r.matched ? "✓" : "—"} {r.skill}
                </strong>
                <small>{r.kind}</small>
                <p>{r.evidence}</p>
              </div>
            ))}
          </div>
          {a.blockers.length > 0 && (
            <div className="callout warning">
              <div>
                <strong>Automation eligibility gaps</strong>
                <TextList items={a.blockers} />
              </div>
            </div>
          )}
          {a.uncertainties.length > 0 && (
            <div className="callout">
              <div>
                <strong>Information to establish</strong>
                <TextList items={a.uncertainties} />
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
