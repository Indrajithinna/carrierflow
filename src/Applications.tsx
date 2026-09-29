import { useState } from "react";
import {
  Plus,
  List,
  Columns3,
  Archive,
  Trash2,
  RotateCcw,
  ExternalLink,
  Zap,
  CheckCheck,
  Sparkles,
  CalendarDays,
} from "lucide-react";
import { api } from "./api";
import {
  type State,
  type Application,
  type Artifact,
  type Execute,
  type Status,
  statusLabels,
  applicationJob,
  active,
} from "./types";
import {
  Button,
  Field,
  Heading,
  Empty,
  Badge,
  Logo,
  Modal,
  date,
  localInput,
} from "./ui";
import { MatchBreakdown } from "./Discovery";
export function Applications({
  state,
  execute,
  open,
  discover,
}: {
  state: State;
  execute: Execute;
  open: (id: string) => void;
  discover: () => void;
}) {
  const [board, setBoard] = useState(false),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [scope, setScope] = useState("active"),
    [drag, setDrag] = useState<string | null>(null);
  const apps = state.applications
    .filter((a) =>
      scope === "trash"
        ? !!a.deletedAt
        : scope === "archived"
          ? !!a.archivedAt && !a.deletedAt
          : active(a),
    )
    .filter(
      (a) =>
        filter === "all" ||
        (filter === "interviews" &&
          ["interview_scheduled", "interviewing"].includes(a.status)) ||
        a.status === filter,
    )
    .filter((a) =>
      search
        .toLowerCase()
        .split(/\s+/)
        .every((t) => {
          const j = applicationJob(state, a);
          return ((j?.title || "") + " " + (j?.company || ""))
            .toLowerCase()
            .includes(t);
        }),
    );
  const columns: Status[] = [
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
  const move = (a: Application, status: Status) => {
    if (status === "applied" && !a.appliedAt) {
      open(a.id);
      return;
    }
    void execute(
      () =>
        api("/applications/" + a.id, "PATCH", { status, version: a.version }),
      "Stage updated",
    );
  };
  return (
    <>
      <Heading
        eyebrow="EVERY OPPORTUNITY, IN ONE PLACE"
        title="A little clarity. A lot of momentum."
        description="Track the exact documents, next actions and outcomes for every application."
      >
        <Button onClick={discover}>
          <Plus size={17} />
          Find opportunities
        </Button>
      </Heading>
      <div className="filter-bar">
        <Field label="Search applications">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Role or company"
          />
        </Field>
        <Field label="Stage">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All stages</option>
            <option value="interviews">All interviews</option>
            {Object.entries(statusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Workspace view">
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="trash">Trash — recoverable</option>
          </select>
        </Field>
        <div className="view-toggle">
          <Button
            variant={!board ? "secondary" : "ghost"}
            onClick={() => setBoard(false)}
            aria-pressed={!board}
          >
            <List size={17} />
            List
          </Button>
          <Button
            variant={board ? "secondary" : "ghost"}
            onClick={() => setBoard(true)}
            aria-pressed={board}
          >
            <Columns3 size={17} />
            Board
          </Button>
        </div>
      </div>
      {board && scope === "active" ? (
        <>
          <p className="muted">
            Drag a card to move it, or use its stage selector with the keyboard.
            Submission must have a verified receipt or an explicit record.
          </p>
          <div className="kanban">
            {columns.map((s) => (
              <section
                key={s}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const a = apps.find((a) => a.id === drag);
                  if (a) move(a, s);
                  setDrag(null);
                }}
              >
                <h3>
                  {statusLabels[s]}
                  <small>{apps.filter((a) => a.status === s).length}</small>
                </h3>
                {apps
                  .filter((a) => a.status === s)
                  .map((a) => {
                    const j = applicationJob(state, a);
                    return (
                      j && (
                        <article
                          className="kanban-card"
                          key={a.id}
                          draggable
                          onDragStart={() => setDrag(a.id)}
                          onDragEnd={() => setDrag(null)}
                        >
                          <button
                            className="text-button"
                            onClick={() => open(a.id)}
                          >
                            <Logo small job={j} />
                            <strong>{j.title}</strong>
                            <span>{j.company}</span>
                          </button>
                          <select
                            aria-label={"Move " + j.title + " at " + j.company}
                            value={a.status}
                            onChange={(e) => move(a, e.target.value as Status)}
                          >
                            {columns.map((c) => (
                              <option key={c} value={c}>
                                {statusLabels[c]}
                              </option>
                            ))}
                          </select>
                        </article>
                      )
                    );
                  })}
              </section>
            ))}
          </div>
        </>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Stage</th>
                <th>Next action</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => {
                const j = applicationJob(state, a);
                return (
                  j && (
                    <tr key={a.id}>
                      <td>
                        <button
                          className="text-button table-job"
                          onClick={() => open(a.id)}
                        >
                          <Logo small job={j} />
                          <span>
                            <strong>{j.title}</strong>
                            <small>{j.company}</small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <Badge status={a.status} />
                      </td>
                      <td>
                        <span>{a.nextAction || "Set a next action"}</span>
                        <small className="block muted">
                          {date(a.nextActionAt)}
                        </small>
                      </td>
                      <td>{date(a.updatedAt)}</td>
                      <td>
                        {scope !== "active" ? (
                          <Button
                            variant="ghost compact"
                            onClick={() =>
                              void execute(
                                () =>
                                  api("/applications/" + a.id, "PATCH", {
                                    version: a.version,
                                    archived: false,
                                    deleted: false,
                                  }),
                                "Application restored",
                              )
                            }
                          >
                            <RotateCcw size={14} />
                            Restore
                          </Button>
                        ) : (
                          <button
                            className="text-link"
                            onClick={() => open(a.id)}
                          >
                            Open
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                );
              })}
            </tbody>
          </table>
          {!apps.length && (
            <Empty title="Nothing in this view">
              Try another stage or save an opportunity from Discover jobs.
            </Empty>
          )}
        </div>
      )}
    </>
  );
}
export function ApplicationDetail({
  state,
  id,
  execute,
  onClose,
  openArtifact,
}: {
  state: State;
  id: string;
  execute: Execute;
  onClose: () => void;
  openArtifact: (a: Artifact) => void;
}) {
  const a = state.applications.find((a) => a.id === id),
    j = a ? applicationJob(state, a) : null;
  const [tab, setTab] = useState("overview"),
    [confirm, setConfirm] = useState(false),
    [resumeId, setResumeId] = useState(""),
    [coverId, setCoverId] = useState(""),
    [notes, setNotes] = useState(a?.notes || ""),
    [nextAction, setNextAction] = useState(a?.nextAction || ""),
    [nextAt, setNextAt] = useState(localInput(a?.nextActionAt)),
    [interviewAt, setInterviewAt] = useState(localInput(a?.interviewAt)),
    [source, setSource] = useState(""),
    [form, setForm] = useState(""),
    [tone, setTone] = useState("professional"),
    [useAI, setUseAI] = useState(state.config.gemini);
  if (!a || !j) return null;
  const related = state.artifacts
    .filter((d) => d.applicationId === a.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const docs = (mode: string) =>
    related.filter((d) => d.output.mode === mode && d.approved && !d.stale);
  const update = (patch: Record<string, unknown>) =>
    execute(
      () =>
        api<Application>("/applications/" + a.id, "PATCH", {
          ...patch,
          version: a.version,
        }),
      "Application updated",
    );
  const generate = async (
    mode: string,
    extra: Record<string, unknown> = {},
  ) => {
    const result = await execute(
      () =>
        api<Artifact>("/applications/" + a.id + "/generate", "POST", {
          mode,
          use_ai: useAI,
          tone,
          ...extra,
        }),
      "Document created",
    );
    if (result) openArtifact(result);
  };
  const changeStatus = (status: Status) => {
    if (status === "applied" && !a.appliedAt) setConfirm(true);
    else void update({ status });
  };
  return (
    <Modal title="Application workspace" sheet onClose={onClose}>
      <div className="detail-heading">
        <Logo job={j} />
        <div>
          <small>
            {j.company}
            {j.sample ? " · Sample" : ""}
          </small>
          <h2>{j.title}</h2>
          <span>{j.location}</span>
        </div>
      </div>
      <div className="detail-status">
        <select
          aria-label="Application status"
          value={a.status}
          onChange={(e) => changeStatus(e.target.value as Status)}
        >
          {Object.entries(statusLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <a
          className="button secondary compact"
          href={j.url}
          target="_blank"
          rel="noreferrer"
        >
          Employer page
          <ExternalLink size={14} />
        </a>
      </div>
      <div className="detail-tabs" role="tablist">
        {["overview", "documents", "apply", "prep", "activity"].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="detail-content">
        {!active(a) && (
          <div className="callout warning">
            This application is {a.deletedAt ? "in the trash" : "archived"}.
            <Button
              variant="secondary compact"
              onClick={() => void update({ deleted: false, archived: false })}
            >
              Restore
            </Button>
          </div>
        )}
        {tab === "overview" && (
          <>
            <MatchBreakdown job={j} />
            <section>
              <h3>Your next step</h3>
              <Field label="Next action">
                <input
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                />
              </Field>
              <div className="form-grid">
                <Field label="Action due">
                  <input
                    type="datetime-local"
                    value={nextAt}
                    onChange={(e) => setNextAt(e.target.value)}
                  />
                </Field>
                <Field label="Interview date and time">
                  <input
                    type="datetime-local"
                    value={interviewAt}
                    onChange={(e) => setInterviewAt(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  rows={5}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                onClick={() =>
                  void update({
                    notes,
                    nextAction,
                    nextActionAt: nextAt
                      ? new Date(nextAt).toISOString()
                      : null,
                    interviewAt: interviewAt
                      ? new Date(interviewAt).toISOString()
                      : null,
                  })
                }
              >
                Save notes and dates
              </Button>
            </section>
            <details>
              <summary>Saved job description</summary>
              <p className="preserve-text">
                {(a.jobSnapshot || j).description}
              </p>
            </details>
            <div className="button-row archive-actions">
              <Button
                variant="ghost"
                onClick={() => void update({ archived: !a.archivedAt })}
              >
                <Archive size={15} />
                {a.archivedAt ? "Unarchive" : "Archive"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void update({ deleted: !a.deletedAt })}
              >
                {a.deletedAt ? <RotateCcw size={15} /> : <Trash2 size={15} />}{" "}
                {a.deletedAt ? "Undo trash" : "Move to trash"}
              </Button>
            </div>
          </>
        )}
        {tab === "documents" && (
          <>
            <div className="callout">
              <Zap size={21} />
              <div>
                <strong>Prepare this application automatically</strong>
                <p>
                  The worker creates and approves an evidence-checked resume and
                  cover letter. If enabled, Autopilot then checks submission
                  eligibility.
                </p>
              </div>
            </div>
            <Button
              disabled={!active(a) || !!a.appliedAt}
              onClick={() =>
                void execute(
                  () =>
                    api("/tasks", "POST", {
                      kind: "prepare",
                      applicationId: a.id,
                    }),
                  "Application package queued",
                )
              }
            >
              <Zap size={16} />
              Prepare package
            </Button>
            <div className="form-grid document-generation">
              <Field label="Writing tone">
                <select value={tone} onChange={(e) => setTone(e.target.value)}>
                  <option value="professional">Professional</option>
                  <option value="warm">Warm</option>
                  <option value="concise">Concise</option>
                </select>
              </Field>
              <label className="check-filter">
                <input
                  type="checkbox"
                  checked={useAI}
                  onChange={(e) => setUseAI(e.target.checked)}
                />
                Use AI when configured
              </label>
            </div>
            <div className="button-row">
              <Button
                variant="secondary"
                onClick={() => void generate("resume_tailor")}
              >
                Create resume
              </Button>
              <Button
                variant="secondary"
                onClick={() => void generate("cover_letter")}
              >
                Create cover letter
              </Button>
            </div>
            {related
              .filter((d) =>
                ["resume_tailor", "cover_letter"].includes(d.output.mode),
              )
              .map((d) => (
                <button
                  key={d.id}
                  className="artifact-row"
                  onClick={() => openArtifact(d)}
                >
                  <Sparkles size={18} />
                  <span>
                    <strong>{d.title}</strong>
                    <small>
                      v{d.version} ·{" "}
                      {d.stale ? "Stale" : d.approved ? "Approved" : "Draft"}
                      {(a.submittedArtifactIds || []).includes(d.id)
                        ? " · Submitted version"
                        : ""}
                    </small>
                  </span>
                </button>
              ))}
          </>
        )}
        {tab === "apply" && (
          <>
            <section>
              <h3>Automation readiness</h3>
              <p>
                {state.automation.enabled && state.automation.autoSubmit
                  ? "Automatic submission is enabled for eligible jobs on your allowed domains."
                  : "Enable Autopilot and automatic submission in Operating rules to run supported forms without per-job approval."}
              </p>
              <p>
                The runner handles standard HTML forms. CAPTCHA, account login,
                unsupported widgets and unanswered mandatory questions stop the
                task.
              </p>
              {a.submissionReceipt && (
                <div className="callout">
                  <div>
                    <strong>Receipt recorded</strong>
                    <p>{a.submissionReceipt.receipt}</p>
                    <small>{a.submissionReceipt.receivedAt}</small>
                  </div>
                </div>
              )}
              <Button disabled={!!a.appliedAt} onClick={() => setConfirm(true)}>
                <CheckCheck size={16} />
                {a.appliedAt
                  ? "Submission recorded"
                  : "Record an application submitted elsewhere"}
              </Button>
            </section>
            <details>
              <summary>Browser companion / form diagnostics</summary>
              <Field label="Form snapshot JSON">
                <textarea
                  rows={7}
                  value={form}
                  onChange={(e) => setForm(e.target.value)}
                  placeholder={
                    '[{"label":"Full name","type":"text","selector":"name","required":true}]'
                  }
                />
              </Field>
              <Button
                variant="secondary"
                onClick={() =>
                  void execute(async () => {
                    const fields = JSON.parse(form);
                    const result = await api<Artifact>(
                      "/applications/" + a.id + "/generate",
                      "POST",
                      { mode: "form_fill", form_snapshot: fields },
                    );
                    openArtifact(result);
                    return result;
                  })
                }
              >
                Map fields
              </Button>
            </details>
            <section>
              <h3>Tracking email</h3>
              <div className="button-row">
                <Button
                  variant="secondary"
                  disabled={!a.appliedAt}
                  onClick={() =>
                    void generate("email_draft", { event_type: "applied" })
                  }
                >
                  Draft applied email
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    !related.some((d) => d.output.mode === "round_prep")
                  }
                  onClick={() =>
                    void generate("email_draft", { event_type: "prep_ready" })
                  }
                >
                  Draft prep-ready email
                </Button>
              </div>
            </section>
          </>
        )}
        {tab === "prep" && (
          <>
            <div className="callout">
              <CalendarDays size={20} />
              <p>
                Research is separated from general practice. Missing or
                conflicting evidence is not turned into a confirmed interview
                process.
              </p>
            </div>
            <Button
              onClick={() =>
                void execute(
                  () =>
                    api("/tasks", "POST", {
                      kind: "research",
                      applicationId: a.id,
                    }),
                  "Research queued",
                )
              }
            >
              <Sparkles size={16} />
              Research company and interviews
            </Button>
            <details>
              <summary>Add your own source excerpts</summary>
              <Field
                label="Sources JSON"
                hint="Each item needs id, title, url and content."
              >
                <textarea
                  rows={8}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                onClick={() =>
                  void execute(async () => {
                    const result = await api<Artifact>(
                      "/applications/" + a.id + "/generate",
                      "POST",
                      {
                        mode: "round_prep",
                        search_results: JSON.parse(source),
                      },
                    );
                    openArtifact(result);
                    return result;
                  })
                }
              >
                Build brief from sources
              </Button>
            </details>
            {related
              .filter((d) => d.output.mode === "round_prep")
              .map((d) => (
                <button
                  className="artifact-row"
                  key={d.id}
                  onClick={() => openArtifact(d)}
                >
                  <span>
                    <strong>{d.title}</strong>
                    <small>
                      Version {d.version} · {d.sources.length} sources
                    </small>
                  </span>
                </button>
              ))}
          </>
        )}
        {tab === "activity" && (
          <>
            {state.events
              .filter((e) => e.applicationId === a.id)
              .map((e) => (
                <div className="activity-row" key={e.id}>
                  <div>
                    <strong>{e.title}</strong>
                    <p>{e.detail}</p>
                  </div>
                  <small>{date(e.createdAt)}</small>
                </div>
              ))}
            {state.tasks
              .filter((t) => t.payload.applicationId === a.id)
              .map((t) => (
                <div className="task-row" key={t.id}>
                  <div>
                    <strong>{t.kind}</strong>
                    <p>{t.error}</p>
                  </div>
                  <Badge status={t.status} />
                </div>
              ))}
          </>
        )}
        {confirm && (
          <section className="inline-confirm">
            <h3>Record exactly what you submitted</h3>
            <p>
              This records a past submission; it does not send a new
              application.
            </p>
            <Field label="Resume version submitted">
              <select
                value={resumeId}
                onChange={(e) => setResumeId(e.target.value)}
              >
                <option value="">No Careerflow resume used</option>
                {docs("resume_tailor").map((d) => (
                  <option key={d.id} value={d.id}>
                    Resume v{d.version}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cover letter version submitted">
              <select
                value={coverId}
                onChange={(e) => setCoverId(e.target.value)}
              >
                <option value="">No Careerflow letter used</option>
                {docs("cover_letter").map((d) => (
                  <option key={d.id} value={d.id}>
                    Cover letter v{d.version}
                  </option>
                ))}
              </select>
            </Field>
            <div className="button-row">
              <Button
                onClick={async () => {
                  const result = await update({
                    status: "applied",
                    confirmSubmission: true,
                    submittedArtifactIds: [resumeId, coverId].filter(Boolean),
                  });
                  if (result) setConfirm(false);
                }}
              >
                Confirm submission record
              </Button>
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
