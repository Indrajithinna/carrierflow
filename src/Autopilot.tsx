import { useState, useEffect } from "react";
import {
  Zap,
  Pause,
  Play,
  ShieldCheck,
  RotateCcw,
  X,
  Clock3,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { api } from "./api";
import { type State, type Execute, type Automation } from "./types";
import { Button, Field, Heading, Badge, Empty, dateTime, TextList } from "./ui";
export function Autopilot({
  state,
  execute,
  open,
}: {
  state: State;
  execute: Execute;
  open: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Automation>(state.automation),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(state.automation);
  }, [state.automation, dirty]);
  function set<K extends keyof Automation>(key: K, value: Automation[K]) {
    setDirty(true);
    setDraft((d) => ({ ...d, [key]: value }));
  }
  const blocked = state.tasks.filter((t) =>
    ["blocked", "failed", "uncertain"].includes(t.status),
  );
  const busy = state.tasks.filter((t) =>
    ["queued", "running"].includes(t.status),
  );
  return (
    <>
      <Heading
        eyebrow="YOUR SEARCH, IN MOTION"
        title="Autopilot, with clear boundaries."
        description="Configure once. Eligible work runs in the background while Careerflow is open."
      >
        <Button
          variant="secondary"
          onClick={async () => {
            const s = await execute(
              () => api<Automation>("/automation/pause", "POST", {}),
              "Automation paused",
            );
            if (s) {
              setDraft(s);
              setDirty(false);
            }
          }}
        >
          <Pause size={16} />
          Pause all
        </Button>
      </Heading>
      <div className="automation-hero">
        <span className="autopilot-orb">
          <Zap size={30} />
        </span>
        <div>
          <span className="eyebrow">
            {state.sample
              ? "SAFE SAMPLE WORKSPACE"
              : state.automation.enabled
                ? "WORKER ENABLED"
                : "WORKER PAUSED"}
          </span>
          <h2>
            {state.sample
              ? "Explore the workflow. No external submissions."
              : state.automation.enabled
                ? "Your next step is already in motion."
                : "Ready when your profile and rules are."}
          </h2>
          <p>
            {busy.length} queued or running · {blocked.length} need attention ·{" "}
            {state.tasks.filter((t) => t.status === "succeeded").length}{" "}
            completed
          </p>
        </div>
      </div>
      <div className="workflow-strip">
        {[
          "Discover",
          "Check eligibility",
          "Prepare documents",
          "Fill & submit",
          "Verify receipt",
        ].map((s, i) => (
          <div key={s}>
            <span>{i + 1}</span>
            {s}
          </div>
        ))}
      </div>
      <div className="automation-layout">
        <section className="panel padded">
          <h2>Operating rules</h2>
          <p className="muted">
            These are ongoing permissions, not per-application approval
            requests.
          </p>
          <div className="toggle-list">
            {(
              [
                {
                  key: "enabled",
                  title: "Enable scheduled discovery",
                  detail: "Run enabled saved searches on the interval below.",
                },
                {
                  key: "useAI",
                  title: "Use evidence-checked AI writing",
                  detail:
                    "Uses your Gemini key and daily call budget. Without a key, documents preserve source wording.",
                },
                {
                  key: "autoSubmit",
                  title: "Submit eligible supported forms",
                  detail:
                    "Includes attachments and final submission on allowed domains. Unknown required answers, consent, CAPTCHA and login stop the task.",
                },
                {
                  key: "autoEmail",
                  title: "Send tracking emails automatically",
                  detail:
                    "Applied and prep-ready messages go only to your profile email.",
                },
              ] as const
            ).map((o) => (
              <label className="toggle-row" key={o.key}>
                <span>
                  <strong>{o.title}</strong>
                  <small>{o.detail}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft[o.key]}
                  onChange={(e) => set(o.key, e.target.checked)}
                />
              </label>
            ))}
          </div>
          <div className="form-grid">
            {(
              [
                {
                  key: "minMatch",
                  label: "Minimum fit score",
                  min: 0,
                  max: 100,
                },
                {
                  key: "maxApplicationsPerDay",
                  label: "Applications per day",
                  min: 1,
                  max: 20,
                },
                {
                  key: "maxAICallsPerDay",
                  label: "AI calls per day",
                  min: 1,
                  max: 500,
                },
                {
                  key: "intervalHours",
                  label: "Search interval (hours)",
                  min: 1,
                  max: 168,
                },
              ] as const
            ).map((f) => (
              <Field key={f.key} label={f.label}>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  value={draft[f.key]}
                  onChange={(e) => set(f.key, Number(e.target.value))}
                />
              </Field>
            ))}
          </div>
          <Field
            label="Allowed employer domains"
            hint="Exact hostnames, one per line. HTTPS only. Add both the form host and its submission host if different."
          >
            <textarea
              rows={3}
              placeholder={"jobs.example.com\ncareers.example.com"}
              value={draft.allowedDomains.join("\n")}
              onChange={(e) =>
                set("allowedDomains", e.target.value.toLowerCase().split("\n"))
              }
            />
          </Field>
          <Field label="Excluded companies" hint="One company name per line.">
            <textarea
              rows={2}
              value={draft.excludedCompanies.join("\n")}
              onChange={(e) =>
                set("excludedCompanies", e.target.value.split("\n"))
              }
            />
          </Field>
          <Button
            onClick={async () => {
              const s = await execute(
                () =>
                  api<Automation>("/automation", "PUT", {
                    ...draft,
                    allowedDomains: draft.allowedDomains
                      .map((s) => s.trim())
                      .filter(Boolean),
                    excludedCompanies: draft.excludedCompanies
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }),
                "Automation rules saved",
              );
              if (s) {
                setDraft(s);
                setDirty(false);
              }
            }}
          >
            <ShieldCheck size={17} />
            Save operating rules
          </Button>
          {dirty && <small className="muted"> Unsaved rule changes</small>}
        </section>
        <aside>
          <section className="panel padded">
            <h2>Saved searches</h2>
            {state.savedSearches.length ? (
              state.savedSearches.map((s) => (
                <div className="saved-search" key={s.id}>
                  <strong>{s.query}</strong>
                  <p>
                    {s.location || "Any location"} ·{" "}
                    {s.enabled ? "Scheduled" : "Paused"}
                  </p>
                  {s.lastRunAt && (
                    <small>
                      {s.lastCount || 0} results · {dateTime(s.lastRunAt)}
                    </small>
                  )}
                  <div className="button-row">
                    <Button
                      variant="secondary compact"
                      onClick={() =>
                        void execute(
                          () =>
                            api("/tasks", "POST", {
                              kind: "discover",
                              searchId: s.id,
                            }),
                          "Search queued",
                        )
                      }
                    >
                      <Play size={14} />
                      Run
                    </Button>
                    <Button
                      variant="ghost compact"
                      onClick={() =>
                        void execute(() =>
                          api("/saved-searches/" + s.id, "PATCH", {
                            enabled: !s.enabled,
                          }),
                        )
                      }
                    >
                      {s.enabled ? "Pause" : "Enable"}
                    </Button>
                  </div>
                  {s.warnings && <TextList items={s.warnings} />}
                </div>
              ))
            ) : (
              <Empty title="Your search, on repeat">
                Save a query from Discover jobs to schedule it here.
              </Empty>
            )}
          </section>
          <section className="panel padded">
            <h2>Usage today (UTC)</h2>
            <strong className="usage-number">
              {state.usage.find(
                (u) => u.id === new Date().toISOString().slice(0, 10),
              )?.calls || 0}
              <small> / {state.automation.maxAICallsPerDay} AI calls</small>
            </strong>
            <p className="muted">
              {(
                state.usage.find(
                  (u) => u.id === new Date().toISOString().slice(0, 10),
                )?.totalTokens || 0
              ).toLocaleString()}{" "}
              provider-reported tokens. Currency cost is not estimated.
            </p>
          </section>
          <div className="callout">
            <ShieldCheck size={20} />
            <p>
              Uncertain submissions and emails are never retried automatically.
              An uncertain task may have reached the recipient; check its
              receipt first.
            </p>
          </div>
        </aside>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Worker activity</h2>
          <span className="muted">Most recent 100 tasks</span>
        </div>
        {state.tasks.length ? (
          <div className="task-list">
            {state.tasks.map((t) => (
              <article key={t.id} className="task-row">
                <div>
                  <div className="button-row">
                    <strong>{t.kind[0].toUpperCase() + t.kind.slice(1)}</strong>
                    <Badge status={t.status} />
                  </div>
                  <p>
                    {t.error ||
                      "Attempt " + t.attempts + " · " + dateTime(t.updatedAt)}
                  </p>
                  {t.payload.applicationId && (
                    <button
                      className="text-link"
                      onClick={() => open(t.payload.applicationId!)}
                    >
                      Open application
                    </button>
                  )}
                </div>
                <div className="button-row">
                  {["queued", "running"].includes(t.status) &&
                    !t.irreversibleAt && (
                      <Button
                        variant="ghost compact"
                        onClick={() =>
                          void execute(() =>
                            api("/tasks/" + t.id + "/cancel", "POST", {}),
                          )
                        }
                      >
                        <X size={14} />
                        Cancel
                      </Button>
                    )}
                  {["blocked", "failed", "cancelled"].includes(t.status) &&
                    !t.irreversibleAt && (
                      <Button
                        variant="secondary compact"
                        onClick={() =>
                          void execute(
                            () => api("/tasks/" + t.id + "/retry", "POST", {}),
                            "Task requeued",
                          )
                        }
                      >
                        <RotateCcw size={14} />
                        Retry
                      </Button>
                    )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No work queued yet">
            Save a search or queue an application package to get started.
          </Empty>
        )}
      </section>
    </>
  );
}
