import { useState, useEffect, useRef } from "react";
import {
  Upload,
  Plus,
  Trash2,
  Check,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api";
import {
  type Profile as ProfileData,
  type Resume,
  type Execute,
} from "./types";
import { Button, Field, Heading, TextList, Modal } from "./ui";
const cacheKey = "careerflow-profile-draft-v2";
type Extraction = {
  profile: ProfileData;
  text: string;
  method: string;
  warnings: string[];
  evidence: {
    field?: string;
    path?: string;
    quote: string;
    confidence: string;
  }[];
};
export function Profile({
  value,
  execute,
  refresh,
}: {
  value: ProfileData;
  execute: Execute;
  refresh: () => Promise<void>;
}) {
  const [p, setP] = useState<ProfileData>(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (
        cached?.profile?.resume_structured &&
        cached.base === JSON.stringify(value)
      )
        return cached.profile;
    } catch {}
    return structuredClone(value);
  });
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false),
    [extraction, setExtraction] = useState<Extraction | null>(null),
    [showRaw, setShowRaw] = useState(false),
    [recovered, setRecovered] = useState(false);
  const saved = useRef(JSON.stringify(value)),
    serverBase = useRef(JSON.stringify(value)),
    latest = useRef(p),
    chain = useRef<Promise<unknown>>(Promise.resolve()),
    mounted = useRef(true);
  latest.current = p;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const raw = JSON.stringify(p);
    if (raw === saved.current) return;
    try {
      localStorage.setItem(
        cacheKey,
        JSON.stringify({ profile: p, base: serverBase.current }),
      );
    } catch {
      setError(
        "Local draft storage is full. Keep this page open until server save completes.",
      );
    }
    const timer = setTimeout(() => {
      setSaving(true);
      chain.current = chain.current
        .catch(() => {})
        .then(async () => {
          try {
            const result = await api<ProfileData>("/profile", "PUT", p);
            saved.current = raw;
            serverBase.current = JSON.stringify(result);
            if (JSON.stringify(latest.current) === raw)
              localStorage.removeItem(cacheKey);
            else
              localStorage.setItem(
                cacheKey,
                JSON.stringify({
                  profile: latest.current,
                  base: serverBase.current,
                }),
              );
            if (mounted.current) {
              setError("");
              await refresh();
            }
          } catch (e) {
            if (mounted.current)
              setError(
                e instanceof Error ? e.message : "Profile could not be saved.",
              );
          } finally {
            if (mounted.current) setSaving(false);
          }
        });
    }, 1100);
    return () => clearTimeout(timer);
  }, [p]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current) !== saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function field<K extends keyof ProfileData>(key: K, v: ProfileData[K]) {
    setP((prev) => ({ ...prev, [key]: v }));
  }
  function resume(v: Resume) {
    field("resume_structured", v);
  }
  async function upload(file: File) {
    if (file.size > 6 * 1024 * 1024) {
      setError("Choose a resume under 6 MB.");
      return;
    }
    setUploading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const result = await api<Extraction>("/profile/extract", "POST", {
        filename: file.name,
        data: btoa(binary),
      });
      setExtraction(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setUploading(false);
    }
  }
  const r = p.resume_structured;
  return (
    <>
      <Heading
        eyebrow="THE SOURCE OF TRUTH"
        title="Your experience, in your words."
        description="Set your facts and preferences once. Automation never guesses missing personal information."
      >
        <span className="save-state" role="status">
          {saving ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Check size={16} />
          )}{" "}
          {saving
            ? "Saving…"
            : error
              ? "Save needs attention"
              : JSON.stringify(p) !== saved.current
                ? "Changes saved locally"
                : "Saved"}
        </span>
      </Heading>
      {error && (
        <div role="alert" className="callout warning">
          {error}
          <Button variant="ghost" onClick={() => setP({ ...p })}>
            Retry save
          </Button>
        </div>
      )}
      <div className="profile-import">
        <span className="import-symbol">
          <Upload size={24} />
        </span>
        <div>
          <h2>Start with your resume</h2>
          <p>PDF, DOCX or TXT · up to 6 MB · source-backed extraction</p>
        </div>
        <label className="button secondary upload-button">
          {uploading ? "Extracting…" : "Upload resume"}
          <input
            aria-label="Upload resume"
            type="file"
            accept=".pdf,.docx,.txt"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <div className="profile-layout">
        <div>
          <section className="panel profile-section">
            <h2>Contact and identity</h2>
            <div className="form-grid">
              {(
                [
                  { key: "full_name", label: "Full name" },
                  { key: "first_name", label: "First / given name" },
                  { key: "last_name", label: "Last / family name" },
                  { key: "email", label: "Email" },
                  { key: "phone", label: "Phone" },
                  { key: "location", label: "City and country" },
                ] as const
              ).map((f) => (
                <Field key={f.key} label={f.label}>
                  <input
                    type={f.key === "email" ? "email" : "text"}
                    value={p[f.key] || ""}
                    onChange={(e) => field(f.key, e.target.value)}
                  />
                </Field>
              ))}
            </div>
            <div className="form-grid">
              {(["linkedin", "github", "portfolio"] as const).map((key) => (
                <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>
                  <input
                    type="url"
                    value={p.links[key]}
                    onChange={(e) =>
                      field("links", { ...p.links, [key]: e.target.value })
                    }
                  />
                </Field>
              ))}
            </div>
          </section>
          <section className="panel profile-section">
            <h2>Search and eligibility</h2>
            <div className="form-grid">
              <Field label="Target roles" hint="Separate with commas.">
                <input
                  value={(p.target_roles || []).join(", ")}
                  onChange={(e) =>
                    field(
                      "target_roles",
                      e.target.value.split(",").map((s) => s.trim()),
                    )
                  }
                />
              </Field>
              <Field
                label="Years of relevant experience"
                hint="Supply this explicitly; overlapping roles are not added together."
              >
                <input
                  type="number"
                  min={0}
                  max={70}
                  step={0.5}
                  value={p.experience_years ?? ""}
                  onChange={(e) =>
                    field(
                      "experience_years",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </Field>
              <Field
                label="Expected salary"
                hint="Example: INR 18–24 LPA or USD 100000 per year."
              >
                <input
                  value={p.expected_salary || ""}
                  onChange={(e) =>
                    field("expected_salary", e.target.value || null)
                  }
                />
              </Field>
              <Field label="Notice period / availability">
                <input
                  value={p.notice_period || ""}
                  onChange={(e) =>
                    field("notice_period", e.target.value || null)
                  }
                />
              </Field>
              <Field label="Work authorization">
                <input
                  value={p.work_authorization}
                  placeholder="Your exact authorization statement"
                  onChange={(e) => field("work_authorization", e.target.value)}
                />
              </Field>
              <Field
                label="Authorized work countries"
                hint="Separate with commas. Do not include countries where you require unapproved authorization."
              >
                <input
                  value={(p.authorized_countries || []).join(", ")}
                  onChange={(e) =>
                    field(
                      "authorized_countries",
                      e.target.value.split(",").map((s) => s.trim()),
                    )
                  }
                />
              </Field>
              <Field label="Do you require employer sponsorship?">
                <select
                  value={
                    p.requires_sponsorship == null
                      ? ""
                      : String(p.requires_sponsorship)
                  }
                  onChange={(e) =>
                    field(
                      "requires_sponsorship",
                      e.target.value === "" ? null : e.target.value === "true",
                    )
                  }
                >
                  <option value="">Not supplied</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </Field>
              <Field label="Willing to relocate">
                <select
                  value={String(p.willing_to_relocate)}
                  onChange={(e) =>
                    field("willing_to_relocate", e.target.value === "true")
                  }
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </Field>
            </div>
          </section>
          <section className="panel profile-section">
            <h2>Summary and skills</h2>
            <Field label="Professional summary">
              <textarea
                rows={4}
                value={r.summary}
                onChange={(e) => resume({ ...r, summary: e.target.value })}
              />
            </Field>
            <Field
              label="Skills"
              hint="Comma-separated, documented skills only."
            >
              <textarea
                rows={2}
                value={r.skills.join(", ")}
                onChange={(e) =>
                  resume({
                    ...r,
                    skills: e.target.value.split(",").map((s) => s.trim()),
                  })
                }
              />
            </Field>
          </section>
          <section className="panel profile-section">
            <div className="panel-heading compact-heading">
              <h2>Experience</h2>
              <Button
                variant="secondary compact"
                onClick={() =>
                  resume({
                    ...r,
                    experience: [
                      ...r.experience,
                      { title: "", org: "", dates: "", bullets: [] },
                    ],
                  })
                }
              >
                <Plus size={15} />
                Add role
              </Button>
            </div>
            {r.experience.map((entry, i) => (
              <div className="resume-entry" key={i}>
                <div className="form-grid">
                  {(["title", "org", "dates"] as const).map((k) => (
                    <Field
                      label={
                        {
                          title: "Job title",
                          org: "Organization",
                          dates: "Dates",
                        }[k]
                      }
                      key={k}
                    >
                      <input
                        value={entry[k]}
                        onChange={(e) =>
                          resume({
                            ...r,
                            experience: r.experience.map((x, n) =>
                              n === i ? { ...x, [k]: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
                <Field
                  label="Documented achievements"
                  hint="One bullet per line. Keep metrics and ownership accurate."
                >
                  <textarea
                    rows={5}
                    value={entry.bullets.join("\n")}
                    onChange={(e) =>
                      resume({
                        ...r,
                        experience: r.experience.map((x, n) =>
                          n === i
                            ? { ...x, bullets: e.target.value.split("\n") }
                            : x,
                        ),
                      })
                    }
                  />
                </Field>
                <Button
                  variant="ghost compact"
                  onClick={() =>
                    resume({
                      ...r,
                      experience: r.experience.filter((_, n) => n !== i),
                    })
                  }
                >
                  <Trash2 size={14} />
                  Remove role
                </Button>
              </div>
            ))}
          </section>
          <section className="panel profile-section">
            <div className="panel-heading compact-heading">
              <h2>Projects</h2>
              <Button
                variant="secondary compact"
                onClick={() =>
                  resume({
                    ...r,
                    projects: [
                      ...r.projects,
                      { name: "", stack: [], bullets: [] },
                    ],
                  })
                }
              >
                <Plus size={15} />
                Add project
              </Button>
            </div>
            {r.projects.map((entry, i) => (
              <div className="resume-entry" key={i}>
                <div className="form-grid">
                  <Field label="Project name">
                    <input
                      value={entry.name}
                      onChange={(e) =>
                        resume({
                          ...r,
                          projects: r.projects.map((x, n) =>
                            n === i ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label="Technologies">
                    <input
                      value={entry.stack.join(", ")}
                      onChange={(e) =>
                        resume({
                          ...r,
                          projects: r.projects.map((x, n) =>
                            n === i
                              ? {
                                  ...x,
                                  stack: e.target.value
                                    .split(",")
                                    .map((s) => s.trim()),
                                }
                              : x,
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
                <Field label="Project achievements">
                  <textarea
                    rows={4}
                    value={entry.bullets.join("\n")}
                    onChange={(e) =>
                      resume({
                        ...r,
                        projects: r.projects.map((x, n) =>
                          n === i
                            ? { ...x, bullets: e.target.value.split("\n") }
                            : x,
                        ),
                      })
                    }
                  />
                </Field>
                <Button
                  variant="ghost compact"
                  onClick={() =>
                    resume({
                      ...r,
                      projects: r.projects.filter((_, n) => n !== i),
                    })
                  }
                >
                  <Trash2 size={14} />
                  Remove project
                </Button>
              </div>
            ))}
          </section>
          <section className="panel profile-section">
            <div className="panel-heading compact-heading">
              <h2>Education</h2>
              <Button
                variant="secondary compact"
                onClick={() =>
                  resume({
                    ...r,
                    education: [
                      ...r.education,
                      { degree: "", institution: "", year: "", grade: "" },
                    ],
                  })
                }
              >
                <Plus size={15} />
                Add education
              </Button>
            </div>
            {r.education.map((entry, i) => (
              <div className="resume-entry" key={i}>
                <div className="form-grid">
                  {(["degree", "institution", "year", "grade"] as const).map(
                    (k) => (
                      <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                        <input
                          value={entry[k]}
                          onChange={(e) =>
                            resume({
                              ...r,
                              education: r.education.map((x, n) =>
                                n === i ? { ...x, [k]: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </Field>
                    ),
                  )}
                </div>
                <Button
                  variant="ghost compact"
                  onClick={() =>
                    resume({
                      ...r,
                      education: r.education.filter((_, n) => n !== i),
                    })
                  }
                >
                  Remove education
                </Button>
              </div>
            ))}
          </section>
          <section className="panel profile-section">
            <div className="panel-heading compact-heading">
              <h2>Reusable application answers</h2>
              <Button
                variant="secondary compact"
                onClick={() =>
                  field("answers", [
                    ...(p.answers || []),
                    { question: "", answer: "", domain: "" },
                  ])
                }
              >
                <Plus size={15} />
                Add answer
              </Button>
            </div>
            <p className="muted">
              Exact question matches only. Sensitive questions and consent
              remain excluded from automation.
            </p>
            {(p.answers || []).map((a, i) => (
              <div className="resume-entry" key={i}>
                {(["question", "answer", "domain"] as const).map((k) => (
                  <Field
                    key={k}
                    label={
                      k === "domain"
                        ? "Restrict to employer hostname (optional)"
                        : k === "question"
                          ? "Exact question label"
                          : "Your answer"
                    }
                  >
                    <textarea
                      rows={k === "answer" ? 3 : 1}
                      value={a[k]}
                      onChange={(e) =>
                        field(
                          "answers",
                          p.answers!.map((x, n) =>
                            n === i ? { ...x, [k]: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
                <Button
                  variant="ghost compact"
                  onClick={() =>
                    field(
                      "answers",
                      p.answers!.filter((_, n) => n !== i),
                    )
                  }
                >
                  Remove answer
                </Button>
              </div>
            ))}
          </section>
        </div>
        <aside className="profile-aside">
          <section className="panel padded">
            <ShieldCheck size={24} />
            <h3>A reliable starting point</h3>
            <p>
              Every generated document links back to these facts. Profile
              changes invalidate older approvals.
            </p>
            <p>
              First and last names, experience, authorization and preferences
              are supplied once—not inferred from a name or location.
            </p>
            <Button variant="secondary" onClick={() => setShowRaw(true)}>
              View source text
            </Button>
          </section>
        </aside>
      </div>
      {showRaw && (
        <Modal title="Original resume source" onClose={() => setShowRaw(false)}>
          <div className="modal-body">
            <Field label="Source text">
              <textarea
                rows={18}
                value={p.resume_raw_text}
                onChange={(e) => field("resume_raw_text", e.target.value)}
              />
            </Field>
            <p className="muted">
              Changing raw text does not automatically add facts to your
              structured resume.
            </p>
          </div>
        </Modal>
      )}
      {extraction && (
        <Modal title="Resume extraction" onClose={() => setExtraction(null)}>
          <div className="modal-body">
            <p>
              {extraction.method} · {extraction.evidence.length} source-linked
              fields
            </p>
            <TextList items={extraction.warnings} />
            <h3>{extraction.profile.full_name || "Name not found"}</h3>
            <p>
              {extraction.profile.resume_structured.experience.length} roles ·{" "}
              {extraction.profile.resume_structured.projects.length} projects ·{" "}
              {extraction.profile.resume_structured.skills.length} skills
            </p>
            <details>
              <summary>Inspect source evidence</summary>
              {extraction.evidence.slice(0, 60).map((e, i) => (
                <div className="evidence-row" key={i}>
                  <strong>{e.path || e.field}</strong>
                  <p>{e.quote}</p>
                </div>
              ))}
            </details>
            <Button
              onClick={() => {
                const imported = extraction.profile;
                setP((current) => ({
                  ...current,
                  ...Object.fromEntries(
                    (["full_name", "email", "phone", "location"] as const)
                      .filter((k) => imported[k])
                      .map((k) => [k, imported[k]]),
                  ),
                  links: {
                    ...current.links,
                    ...Object.fromEntries(
                      Object.entries(imported.links).filter(([, v]) => v),
                    ),
                  },
                  resume_structured: imported.resume_structured,
                  resume_raw_text: extraction.text,
                }));
                setExtraction(null);
              }}
            >
              Use extracted resume
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
