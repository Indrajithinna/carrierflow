import { useState, useEffect } from "react";
import {
  FileText,
  Download,
  Check,
  Send,
  Clock3,
  ExternalLink,
} from "lucide-react";
import { api } from "./api";
import {
  type State,
  type Artifact,
  type Output,
  type Resume,
  type Execute,
} from "./types";
import {
  Button,
  Field,
  Heading,
  Empty,
  Modal,
  Badge,
  date,
  TextList,
} from "./ui";
export function Documents({
  state,
  open,
}: {
  state: State;
  open: (a: Artifact) => void;
}) {
  const [all, setAll] = useState(false),
    [kind, setKind] = useState("all");
  const seen = new Set<string>();
  const documents = [...state.artifacts]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((a) => {
      if (
        a.output.mode === "form_fill" ||
        (kind !== "all" && a.output.mode !== kind)
      )
        return false;
      const k = a.applicationId + ":" + a.output.mode;
      if (!all && seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return (
    <>
      <Heading
        eyebrow="A CLEARER STORY"
        title="Your work, ready to share."
        description="Source-linked drafts, editable versions, and the exact files you send."
      />
      <div className="filter-bar">
        <Field label="Document type">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All documents</option>
            <option value="resume_tailor">Resumes</option>
            <option value="cover_letter">Cover letters</option>
            <option value="round_prep">Interview briefs</option>
            <option value="email_draft">Tracking emails</option>
          </select>
        </Field>
        <label className="check-filter">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          Show every version
        </label>
      </div>
      <div className="documents-grid">
        {documents.map((a) => (
          <button className="document-card" key={a.id} onClick={() => open(a)}>
            <div className="document-paper">
              <div>
                <span />
                <span />
                <span />
                <span />
              </div>
              <span>
                <FileText size={24} />
              </span>
            </div>
            <div className="document-card-body">
              <strong>{a.title}</strong>
              <span>
                Version {a.version} · {date(a.createdAt)}
              </span>
              <div className="document-state">
                {a.stale
                  ? "Profile changed"
                  : a.approved
                    ? "Approved"
                    : a.grounding === "user-edited"
                      ? "Edited draft"
                      : "Draft"}
                {a.delivery === "sent" && " · Sent"}
              </div>
            </div>
          </button>
        ))}
      </div>
      {!documents.length && (
        <Empty title="Your next draft starts with an opportunity">
          Open an application and prepare its document package.
        </Empty>
      )}
    </>
  );
}
export function ArtifactDialog({
  initial,
  state,
  execute,
  onClose,
  onChange,
}: {
  initial: Artifact;
  state: State;
  execute: Execute;
  onClose: () => void;
  onChange: (a: Artifact) => void;
}) {
  const [a, setA] = useState<Artifact | null>(null),
    [tab, setTab] = useState("document"),
    [draft, setDraft] = useState<Output | null>(null),
    [edited, setEdited] = useState(false),
    [confirmSend, setConfirmSend] = useState(false),
    [loadError, setLoadError] = useState("");
  useEffect(() => {
    setA(null);
    setEdited(false);
    setLoadError("");
    api<Artifact>("/artifacts/" + initial.id)
      .then((d) => {
        setA(d);
        setDraft(structuredClone(d.output));
      })
      .catch((e) => setLoadError(e.message));
  }, [initial.id]);
  const close = () => {
    if (edited && !window.confirm("Discard unsaved document edits?")) return;
    onClose();
  };
  const change = (output: Output) => {
    setDraft(output);
    setEdited(true);
  };
  const versions = state.artifacts
    .filter(
      (x) =>
        x.applicationId === initial.applicationId &&
        x.output.mode === initial.output.mode,
    )
    .sort((a, b) => b.version - a.version);
  return (
    <Modal title={initial.title} onClose={close}>
      <div className="artifact-toolbar">
        <span>
          Version {a?.version || initial.version} ·{" "}
          {a?.grounding?.replaceAll("-", " ") || "Source document"}
        </span>
        <select
          aria-label="Document version"
          value={initial.id}
          onChange={(e) => {
            if (
              !edited ||
              window.confirm("Discard unsaved edits and change version?")
            ) {
              const next = versions.find((v) => v.id === e.target.value);
              if (next) onChange(next);
            }
          }}
        >
          {versions.map((v) => (
            <option value={v.id} key={v.id}>
              Version {v.version}
              {v.approved ? " · approved" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="detail-tabs" role="tablist">
        {["document", "edit", "changes", "sources", "pdf"].map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t === "pdf" ? "PDF preview" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {!a || !draft ? (
        <div className="modal-body">{loadError || "Loading document…"}</div>
      ) : (
        <>
          <div className="artifact-preview">
            {a.stale && (
              <div className="callout warning">
                Your profile changed. This version cannot be approved or used
                for automatic submission.
              </div>
            )}
            {tab === "document" && <OutputPreview artifact={a} />}
            {tab === "edit" && (
              <>
                <p className="muted">
                  Edits create a new, unapproved version. Previously sent files
                  remain unchanged.
                </p>
                <OutputEditor output={draft} change={change} />
                <Button
                  disabled={!edited || a.stale}
                  onClick={async () => {
                    const next = await execute(
                      () =>
                        api<Artifact>(
                          "/artifacts/" + a.id + "/versions",
                          "POST",
                          { output: draft },
                        ),
                      "New document version saved",
                    );
                    if (next) {
                      setEdited(false);
                      setA(next);
                      onChange(next);
                    }
                  }}
                >
                  Save new version
                </Button>
              </>
            )}
            {tab === "changes" && (
              <>
                {a.changes?.length ? (
                  a.changes.map((c, i) => (
                    <div className="diff-row" key={i}>
                      <strong>{c.path}</strong>
                      <div className="diff-columns">
                        <div>
                          <small>Before</small>
                          <p>
                            {typeof c.before === "string"
                              ? c.before
                              : JSON.stringify(c.before)}
                          </p>
                        </div>
                        <div>
                          <small>After</small>
                          <p>
                            {typeof c.after === "string"
                              ? c.after
                              : JSON.stringify(c.after)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty title="No wording changes">
                    This version preserves your source wording, or has no
                    recorded edits.
                  </Empty>
                )}
              </>
            )}
            {tab === "sources" && (
              <>
                <h3>Original candidate facts</h3>
                {a.profile && (
                  <>
                    <p>{a.profile.resume_structured.summary}</p>
                    {[
                      ...a.profile.resume_structured.experience,
                      ...a.profile.resume_structured.projects,
                    ]
                      .flatMap((x) => x.bullets)
                      .map((text, i) => (
                        <div className="evidence-row" key={i}>
                          <p>{text}</p>
                        </div>
                      ))}
                  </>
                )}
                <h3>Generation evidence</h3>
                <pre className="json-evidence">
                  {JSON.stringify(a.evidence || [], null, 2)}
                </pre>
                <h3>Research links</h3>
                {a.sources?.length ? (
                  a.sources.map((s) => (
                    <a
                      className="source-link"
                      key={s.id}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.title}
                      <ExternalLink size={14} />
                    </a>
                  ))
                ) : (
                  <p>No external research was used.</p>
                )}
              </>
            )}
            {tab === "pdf" && (
              <iframe
                title={"PDF preview: " + a.title}
                className="pdf-preview"
                src={
                  "/api/artifacts/" + a.id + "/download?format=pdf&preview=1"
                }
              />
            )}
          </div>
          <div className="artifact-actions">
            <Button
              disabled={a.stale}
              variant={a.approved ? "secondary" : ""}
              onClick={async () => {
                const result = await execute(
                  () =>
                    api<Artifact>("/artifacts/" + a.id, "PATCH", {
                      approved: !a.approved,
                    }),
                  a.approved ? "Approval removed" : "Document approved",
                );
                if (result) setA({ ...result, stale: false });
              }}
            >
              <Check size={16} />
              {a.approved ? "Remove approval" : "Approve version"}
            </Button>
            <div className="button-row">
              {["pdf", "docx", "txt"].map((f) => (
                <a
                  className="button secondary compact"
                  key={f}
                  href={"/api/artifacts/" + a.id + "/download?format=" + f}
                >
                  <Download size={14} />
                  {f.toUpperCase()}
                </a>
              ))}
            </div>
            {a.output.mode === "email_draft" && (
              <Button
                disabled={
                  !a.approved ||
                  a.stale ||
                  ["sent", "sending", "unknown"].includes(a.delivery) ||
                  state.sample
                }
                onClick={() => setConfirmSend(true)}
              >
                <Send size={15} />
                {a.delivery === "sent"
                  ? "Sent"
                  : a.delivery === "unknown"
                    ? "Delivery uncertain"
                    : "Send tracking email"}
              </Button>
            )}
          </div>
        </>
      )}
      {confirmSend && a && (
        <div className="modal-body inline-confirm">
          <p>Send this tracking email to {state.profile.email}?</p>
          <div className="button-row">
            <Button
              onClick={async () => {
                const result = await execute(
                  () =>
                    api("/artifacts/" + a.id + "/send", "POST", {
                      confirm: true,
                    }),
                  "Tracking email sent",
                );
                if (result) {
                  setConfirmSend(false);
                  setA({ ...a, delivery: "sent" });
                }
              }}
            >
              Send email
            </Button>
            <Button variant="secondary" onClick={() => setConfirmSend(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
export function OutputPreview({ artifact: a }: { artifact: Artifact }) {
  const o = a.output;
  if (o.mode === "resume_tailor")
    return (
      <div className="resume-document">
        <h1>{a.profile?.full_name}</h1>
        <p className="resume-contact">
          {[a.profile?.email, a.profile?.phone, a.profile?.location]
            .filter(Boolean)
            .join(" | ")}
        </p>
        <p className="resume-contact">
          {Object.values(a.profile?.links || {})
            .filter(Boolean)
            .join(" | ")}
        </p>
        <h3>Summary</h3>
        <p>{o.resume_tailored.summary}</p>
        <h3>Experience</h3>
        {o.resume_tailored.experience.map((e, i) => (
          <section key={i}>
            <h4>
              {e.title} · {e.org}
            </h4>
            <small>{e.dates}</small>
            <TextList items={e.bullets} />
          </section>
        ))}
        <h3>Projects</h3>
        {o.resume_tailored.projects.map((e, i) => (
          <section key={i}>
            <h4>{e.name}</h4>
            <small>{e.stack.join(", ")}</small>
            <TextList items={e.bullets} />
          </section>
        ))}
        <h3>Education</h3>
        {o.resume_tailored.education.map((e, i) => (
          <p key={i}>
            {[e.degree, e.institution, e.year, e.grade]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ))}
        <h3>Skills</h3>
        <p>{o.resume_tailored.skills.join(", ")}</p>
      </div>
    );
  if (o.mode === "cover_letter")
    return (
      <div className="letter-document">
        {o.cover_letter.split(/\n\s*\n/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    );
  if (o.mode === "email_draft")
    return (
      <>
        <h3>{o.subject}</h3>
        <p className="preserve-text">{o.body}</p>
      </>
    );
  if (o.mode === "round_prep")
    return (
      <div className="brief-document">
        <h2>{o.company}</h2>
        <h3>Evidence-backed process</h3>
        <p>{o.process_overview}</p>
        {o.rounds.map((r, i) => (
          <section key={i}>
            <h3>{r.round_name}</h3>
            <Badge status={r.confidence + " confidence"} />
            <p className="preserve-text">{r.what_to_expect}</p>
            <TextList items={r.practice_questions} />
          </section>
        ))}
        <h3>General practice — not reported company questions</h3>
        {a.practice?.map((p, i) => (
          <p key={i}>{p.question}</p>
        ))}
        <h3>Company context</h3>
        <p className="preserve-text">{o.company_context}</p>
        <h3>Your strongest examples</h3>
        <p>{o.candidate_emphasis_notes}</p>
      </div>
    );
  return (
    <>
      {o.blocking_issue && (
        <div className="callout warning">{o.blocking_issue}</div>
      )}
      {o.fields.map((f) => (
        <div className="field-decision" key={f.selector}>
          <span className={"decision " + f.action.toLowerCase()}>
            {f.action}
          </span>
          <div>
            <strong>{f.label}</strong>
            <p>{f.value || f.reason_if_flagged}</p>
          </div>
        </div>
      ))}
    </>
  );
}
function OutputEditor({
  output: o,
  change,
}: {
  output: Output;
  change: (output: Output) => void;
}) {
  if (o.mode === "cover_letter")
    return (
      <Field label="Cover letter">
        <textarea
          rows={18}
          value={o.cover_letter}
          onChange={(e) => change({ ...o, cover_letter: e.target.value })}
        />
        <small>{o.cover_letter.trim().split(/\s+/).length} words</small>
      </Field>
    );
  if (o.mode === "email_draft")
    return (
      <>
        <Field label="Subject">
          <input
            value={o.subject}
            onChange={(e) => change({ ...o, subject: e.target.value })}
          />
        </Field>
        <Field label="Message">
          <textarea
            rows={14}
            value={o.body}
            onChange={(e) => change({ ...o, body: e.target.value })}
          />
        </Field>
      </>
    );
  if (o.mode === "resume_tailor") {
    const r = o.resume_tailored;
    return (
      <>
        <Field label="Summary">
          <textarea
            rows={4}
            value={r.summary}
            onChange={(e) =>
              change({
                ...o,
                resume_tailored: { ...r, summary: e.target.value },
              })
            }
          />
        </Field>
        <Field label="Skills">
          <textarea
            rows={2}
            value={r.skills.join(", ")}
            onChange={(e) =>
              change({
                ...o,
                resume_tailored: {
                  ...r,
                  skills: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </Field>
        {(["experience", "projects"] as const).map((kind) =>
          r[kind].map((entry, i) => (
            <Field
              key={kind + i}
              label={
                kind === "experience"
                  ? (entry as Resume["experience"][number]).title
                  : (entry as Resume["projects"][number]).name
              }
            >
              <textarea
                rows={5}
                value={entry.bullets.join("\n")}
                onChange={(e) =>
                  change({
                    ...o,
                    resume_tailored: {
                      ...r,
                      [kind]: r[kind].map((x, n) =>
                        n === i
                          ? {
                              ...x,
                              bullets: e.target.value
                                .split("\n")
                                .filter(Boolean),
                            }
                          : x,
                      ),
                    },
                  })
                }
              />
            </Field>
          )),
        )}
      </>
    );
  }
  return (
    <p>
      This evidence-based output is read-only. Add source excerpts or regenerate
      the brief from the application.
    </p>
  );
}
