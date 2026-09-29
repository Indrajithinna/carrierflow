import { useState, useEffect } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  BriefcaseBusiness,
  Files,
  CalendarDays,
  Zap,
  ShieldCheck,
  Download,
  Upload,
  CheckCircle2,
  RefreshCw,
  Copy,
} from "lucide-react";
import { api } from "./api";
import {
  type State,
  type Execute,
  type Artifact,
  active,
  applicationJob,
} from "./types";
import {
  Button,
  Heading,
  Empty,
  Logo,
  Badge,
  Field,
  Modal,
  date,
  dateTime,
} from "./ui";
export function Overview({
  state,
  open,
  discover,
  autopilot,
}: {
  state: State;
  open: (id: string) => void;
  discover: () => void;
  autopilot: () => void;
}) {
  const apps = state.applications.filter(active),
    interviews = apps.filter((a) =>
      ["interviewing", "interview_scheduled"].includes(a.status),
    );
  const due = apps
    .filter(
      (a) =>
        (a.nextActionAt &&
          Date.parse(a.nextActionAt) < Date.now() + 86400000) ||
        (a.interviewAt && Date.parse(a.interviewAt) < Date.now() + 86400000),
    )
    .sort(
      (a, b) =>
        Date.parse(a.nextActionAt || a.interviewAt || "") -
        Date.parse(b.nextActionAt || b.interviewAt || ""),
    );
  const attention = state.tasks.filter((t) =>
    ["blocked", "failed", "uncertain"].includes(t.status),
  );
  const recommended = state.jobs
    .filter((j) => j.match.match_score > 0)
    .sort((a, b) => b.match.match_score - a.match.match_score)
    .slice(0, 3);
  const name = state.profile.full_name.split(" ")[0] || "there";
  return (
    <>
      <Heading
        eyebrow="A LITTLE PROGRESS, EVERY DAY"
        title={"Your next chapter, " + name + "."}
        description="A clear view of your search—and a worker to keep it moving."
      >
        <Button onClick={discover}>
          Find opportunities
          <ArrowUpRight size={17} />
        </Button>
      </Heading>
      <div className="stats-grid">
        {[
          {
            label: "Active applications",
            value: apps.filter(
              (a) => !["rejected", "withdrawn", "offer"].includes(a.status),
            ).length,
            icon: BriefcaseBusiness,
            note: "Your ongoing opportunities",
          },
          {
            label: "Interview conversations",
            value: interviews.length,
            icon: CalendarDays,
            note: "Scheduled and in progress",
          },
          {
            label: "Documents approved",
            value: state.artifacts.filter(
              (d) =>
                d.approved &&
                ["resume_tailor", "cover_letter"].includes(d.output.mode),
            ).length,
            icon: Files,
            note: "Current profile versions",
          },
          {
            label: "Worker tasks completed",
            value: state.tasks.filter((t) => t.status === "succeeded").length,
            icon: Zap,
            note: "Within the latest 100 tasks",
          },
        ].map((s) => (
          <div className="stat-card" key={s.label}>
            <div>
              <span>{s.label}</span>
              <span className="stat-icon green">
                <s.icon size={18} />
              </span>
            </div>
            <strong>{String(s.value).padStart(2, "0")}</strong>
            <small>{s.note}</small>
          </div>
        ))}
      </div>
      <button className="autopilot-summary" onClick={autopilot}>
        <span className="momentum-icon">
          <Zap size={19} />
        </span>
        <span>
          <strong>
            {state.automation.enabled
              ? "Autopilot is enabled"
              : "Your search can run on Autopilot"}
          </strong>
          <small>
            {attention.length
              ? attention.length + " tasks need attention"
              : "Set your search, limits and allowed employer domains once."}
          </small>
        </span>
        <ArrowRight size={20} />
      </button>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Your next actions</h2>
              <p>Due today, overdue, or approaching soon.</p>
            </div>
            <a className="text-link" href="/api/calendar">
              Export calendar
            </a>
          </div>
          {due.length ? (
            due.slice(0, 6).map((a) => {
              const j = applicationJob(state, a);
              return (
                j && (
                  <button
                    key={a.id}
                    className="action-row"
                    onClick={() => open(a.id)}
                  >
                    <span className="date-block">
                      <small>
                        {a.interviewAt &&
                        Date.parse(a.interviewAt) < Date.now() + 86400000
                          ? "INTERVIEW"
                          : "ACTION"}
                      </small>
                      <CalendarDays size={22} />
                    </span>
                    <span>
                      <strong>{j.company}</strong>
                      <small>
                        {a.nextAction || "Prepare for your interview"}
                      </small>
                      <small>
                        {dateTime(a.nextActionAt || a.interviewAt!)}
                      </small>
                    </span>
                    <ArrowUpRight size={17} />
                  </button>
                )
              );
            })
          ) : (
            <Empty title="Nothing due today">
              Set a next-action date on an application. Follow-up dates are
              added after submission.
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Worth a closer look</h2>
            <button className="text-link" onClick={discover}>
              View jobs
            </button>
          </div>
          {recommended.length ? (
            recommended.map((j) => (
              <div key={j.id} className="job-row">
                <Logo job={j} />
                <div className="job-main">
                  <strong>{j.title}</strong>
                  <span>{j.company}</span>
                </div>
                <span className="match-chip">{j.match.match_score}% fit</span>
              </div>
            ))
          ) : (
            <Empty title="A fresh start">
              Add a resume and discover roles aligned with your experience.
            </Empty>
          )}
          <div className="panel-footer">
            <ShieldCheck size={15} />
            Fit reflects requirements, not hiring probability.
          </div>
        </section>
      </div>
      <div className="overview-bottom">
        <section className="panel">
          <div className="panel-heading">
            <h2>Your application pipeline</h2>
          </div>
          <div className="pipeline">
            {[
              { key: "shortlisted", label: "Shortlist" },
              { key: "preparing", label: "Preparing" },
              { key: "applied", label: "Applied" },
              { key: "interviews", label: "Interviews" },
              { key: "offer", label: "Offers" },
            ].map((s, i) => {
              const n =
                s.key === "interviews"
                  ? interviews.length
                  : apps.filter((a) =>
                      s.key === "preparing"
                        ? ["preparing", "ready_to_apply"].includes(a.status)
                        : a.status === s.key,
                    ).length;
              return (
                <div key={s.key}>
                  <div className="pipeline-bar-track">
                    <div
                      style={{
                        height:
                          Math.max(8, (n / Math.max(1, apps.length)) * 160) +
                          "px",
                        background: [
                          "#bedacc",
                          "#8fbaa5",
                          "#4a8a6b",
                          "#1f644d",
                          "#c29b58",
                        ][i],
                      }}
                    >
                      <strong>{n}</strong>
                    </div>
                  </div>
                  <span>{s.label}</span>
                </div>
              );
            })}
          </div>
          <p className="pipeline-note">
            Counts show current stages, not conversion rates.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Recent activity</h2>
          </div>
          <div className="activity-list">
            {state.events.slice(0, 5).map((e) => (
              <div className="activity-row" key={e.id}>
                <span className="activity-icon">
                  <CheckCircle2 size={16} />
                </span>
                <div>
                  <strong>{e.title}</strong>
                  <p>{e.detail || "Workspace updated"}</p>
                </div>
                <small>{date(e.createdAt)}</small>
              </div>
            ))}
            {!state.events.length && (
              <Empty title="Your story starts here">
                Progress will appear as you use your workspace.
              </Empty>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
export function Prep({
  state,
  execute,
  open,
  openArtifact,
}: {
  state: State;
  execute: Execute;
  open: (id: string) => void;
  openArtifact: (a: Artifact) => void;
}) {
  const apps = state.applications.filter(
    (a) =>
      active(a) && ["interviewing", "interview_scheduled"].includes(a.status),
  );
  return (
    <>
      <Heading
        eyebrow="A CONFIDENT NEXT CONVERSATION"
        title="Prepare with evidence, not guesses."
        description="Company research, documented interview stages, and practice grounded in your own experience."
      >
        <a className="button secondary" href="/api/calendar">
          <CalendarDays size={17} />
          Export calendar
        </a>
      </Heading>
      <div className="prep-grid">
        {apps.map((a) => {
          const j = applicationJob(state, a),
            brief = state.artifacts
              .filter(
                (d) =>
                  d.applicationId === a.id && d.output.mode === "round_prep",
              )
              .sort((a, b) => b.version - a.version)[0];
          return (
            j && (
              <article className="prep-card panel" key={a.id}>
                <Logo job={j} />
                <h2>{j.company}</h2>
                <p>{j.title}</p>
                <p className="prep-date">
                  {a.interviewAt
                    ? dateTime(a.interviewAt)
                    : "Interview date not set"}
                </p>
                <div className="button-row">
                  <Button variant="secondary" onClick={() => open(a.id)}>
                    Application
                  </Button>
                  <Button
                    onClick={() =>
                      brief
                        ? openArtifact(brief)
                        : void execute(
                            () =>
                              api("/tasks", "POST", {
                                kind: "research",
                                applicationId: a.id,
                              }),
                            "Research queued",
                          )
                    }
                  >
                    {brief ? "Open prep brief" : "Build prep brief"}
                  </Button>
                </div>
              </article>
            )
          );
        })}
      </div>
      {!apps.length && (
        <Empty title="Your next conversation is ahead">
          After recording an application, set its stage to Interview scheduled
          and add a date.
        </Empty>
      )}
    </>
  );
}
export function Settings({
  state,
  execute,
}: {
  state: State;
  execute: Execute;
}) {
  const [token, setToken] = useState(""),
    [confirm, setConfirm] = useState(""),
    [restoreData, setRestoreData] = useState<unknown>(null),
    [restoreName, setRestoreName] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    api<{ extensionToken: string }>("/settings")
      .then((r) => setToken(r.extensionToken))
      .catch((e) => setMessage(e.message));
  }, []);
  return (
    <>
      <Heading
        eyebrow="YOUR WORKSPACE, YOUR CONTROL"
        title="Connections and peace of mind."
        description="Credentials stay on your computer. No ProInterview integration or shared account."
      />
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Provider connections</h2>
            <p>
              Enter credentials in D:\Careerflow\.env, then restart. A
              configured key is not automatically a verified connection.
            </p>
          </div>
        </div>
        {(
          [
            {
              key: "gemini",
              name: "Gemini",
              description:
                "Structured resume extraction and evidence-checked writing",
              env: "GEMINI_API_KEY",
            },
            {
              key: "research",
              name: "Tavily",
              description: "Company and interview research",
              env: "TAVILY_API_KEY",
            },
            {
              key: "adzuna",
              name: "Adzuna",
              description: "Location-based job discovery",
              env: "ADZUNA_APP_ID + ADZUNA_APP_KEY",
            },
            {
              key: "email",
              name: "Tracking email",
              description: "SMTP delivery to your own profile email",
              env: "SMTP_USER + SMTP_PASSWORD",
            },
          ] as const
        ).map((p) => (
          <div className="connection-row" key={p.key}>
            <span className="connection-icon">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h3>{p.name}</h3>
              <p>{p.description}</p>
              <code>{p.env}</code>
              {state.config.checks?.[p.key] && (
                <small className="block">
                  {state.config.checks[p.key].message} ·{" "}
                  {dateTime(state.config.checks[p.key].checkedAt)}
                </small>
              )}
            </div>
            <Badge
              status={
                !state.config[p.key]
                  ? "not configured"
                  : state.config.checks?.[p.key]?.status || "key entered"
              }
            />
            <Button
              variant="secondary compact"
              disabled={!state.config[p.key]}
              onClick={() =>
                void execute(() => api("/settings/verify/" + p.key, "POST", {}))
              }
            >
              <RefreshCw size={14} />
              Test connection
            </Button>
          </div>
        ))}
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h2>Browser companion</h2>
        </div>
        <div className="settings-content">
          <p>
            Load <code>D:\Careerflow\extension</code> as an unpacked Chrome/Edge
            extension. Pair it to inspect and fill the current form. The
            standalone Autopilot worker has its own browser runtime.
          </p>
          <Field label="Pairing token">
            <input readOnly value={token} type="password" />
          </Field>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(token);
                setMessage("Pairing token copied.");
              } catch {
                setMessage(
                  "Clipboard unavailable. Select and copy the token manually.",
                );
              }
            }}
          >
            <Copy size={15} />
            Copy pairing token
          </Button>
          <p>
            Install the worker browser with <code>npm run browser:install</code>
            . It uses a separate session and does not borrow your existing
            browser login.
          </p>
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h2>Backup and recovery</h2>
        </div>
        <div className="settings-content">
          <p>
            Exports include your profile, job history, documents and saved
            searches. Treat backups as private. Credentials and pairing tokens
            are excluded.
          </p>
          <div className="button-row">
            <a className="button secondary" href="/api/workspace/export">
              <Download size={16} />
              Export workspace
            </a>
            <label className="button secondary upload-button">
              <Upload size={16} />
              Restore backup
              <input
                aria-label="Restore workspace backup"
                type="file"
                accept=".json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    if (f.size > 24 * 1024 * 1024)
                      throw new Error("Backup must be under 24 MB.");
                    setRestoreData(JSON.parse(await f.text()));
                    setRestoreName(f.name);
                    setConfirm("restore");
                  } catch (e) {
                    setMessage(
                      e instanceof Error ? e.message : "Invalid backup file.",
                    );
                  }
                  e.target.value = "";
                }}
              />
            </label>
            <a className="button secondary" href="/api/calendar">
              <CalendarDays size={16} />
              Export calendar
            </a>
          </div>
          <p>
            Restoring replaces this workspace, pauses automation, and clears
            document approvals. Export your current workspace first.
          </p>
          <Button variant="ghost" onClick={() => setConfirm("reset")}>
            Clear workspace / remove sample data
          </Button>
        </div>
      </section>
      <p role="status" className="muted">
        {message}
      </p>
      {confirm && (
        <Modal
          title={
            confirm === "restore"
              ? "Restore workspace backup"
              : "Clear workspace"
          }
          onClose={() => setConfirm("")}
        >
          <div className="modal-body">
            <p>
              {confirm === "restore"
                ? "Replace the current workspace with " + restoreName + "?"
                : "Clear profiles, jobs, documents and activity? This cannot be undone without a backup."}
            </p>
            <a href="/api/workspace/export" className="text-link">
              Export current workspace first
            </a>
            <div className="button-row">
              <Button
                onClick={async () => {
                  const result = await execute(
                    () =>
                      api(
                        "/workspace/" +
                          (confirm === "restore" ? "restore" : "reset"),
                        "POST",
                        confirm === "restore"
                          ? { confirm: true, backup: restoreData }
                          : { confirm: true },
                      ),
                    "Workspace updated",
                  );
                  if (result) {
                    localStorage.removeItem("careerflow-profile-draft-v2");
                    setConfirm("");
                  }
                }}
              >
                {confirm === "restore" ? "Restore backup" : "Clear workspace"}
              </Button>
              <Button variant="secondary" onClick={() => setConfirm("")}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
