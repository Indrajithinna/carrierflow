import pdf from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import { z } from "zod";
import { blankProfile, profileSchema } from "./schema.js";
import { askAI, objectSchema, strings, fail } from "./ai.js";
import { skills, contains, norm } from "./matching.js";

export function localIntake(text) {
  const profile = structuredClone(blankProfile),
    warnings = [],
    evidence = [];
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  profile.resume_raw_text = text;
  profile.email =
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  profile.phone =
    text.match(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]){1,3}\d{3,6}/)?.[0] ||
    "";
  if (
    lines[0] &&
    /^[\p{L} .'-]{3,70}$/u.test(lines[0]) &&
    !/resume|curriculum|profile|engineer|developer/i.test(lines[0])
  )
    profile.full_name = lines[0];
  for (const name of ["linkedin", "github"])
    profile.links[name] =
      text.match(
        new RegExp("https?://(?:www\\.)?" + name + "\\.com/[^\\s|]+", "i"),
      )?.[0] || "";
  profile.resume_structured.skills = skills.filter((s) => contains(text, s));
  let section = "",
    entry = null;
  for (const line of lines) {
    if (/^(professional )?(summary|profile|objective)\s*:?$/i.test(line)) {
      section = "summary";
      entry = null;
      continue;
    }
    if (/^(work |professional )?experience\s*:?$/i.test(line)) {
      section = "experience";
      entry = null;
      continue;
    }
    if (/^projects?\s*:?$/i.test(line)) {
      section = "projects";
      entry = null;
      continue;
    }
    if (/^education\s*:?$/i.test(line)) {
      section = "education";
      entry = null;
      continue;
    }
    if (/^(technical )?skills\s*:?$/i.test(line)) {
      section = "skills";
      entry = null;
      continue;
    }
    if (section === "summary") {
      profile.resume_structured.summary += " " + line;
      continue;
    }
    if (section === "skills") {
      profile.resume_structured.skills.push(
        ...line
          .split(/[,;|]/)
          .map((s) => s.trim())
          .filter((s) => s && s.length < 70),
      );
      continue;
    }
    const bullet = /^[-•*▪]\s*/.test(line);
    if (section === "experience" && !bullet) {
      const parts = line.split(/\s+\|\s+|\s+at\s+/);
      if (parts.length >= 2) {
        entry = {
          title: parts[0],
          org: parts[1],
          dates: parts[2] || "",
          bullets: [],
        };
        profile.resume_structured.experience.push(entry);
        continue;
      }
    }
    if (section === "projects" && !bullet) {
      entry = { name: line, stack: [], bullets: [] };
      profile.resume_structured.projects.push(entry);
      continue;
    }
    if (bullet && entry) {
      entry.bullets.push(line.replace(/^[-•*▪]\s*/, ""));
      continue;
    }
    if (section === "education") {
      const parts = line.split(/\s+\|\s+/);
      if (parts.length >= 2)
        profile.resume_structured.education.push({
          degree: parts[0],
          institution: parts[1],
          year: parts[2] || "",
          grade: parts[3] || "",
        });
    }
  }
  profile.resume_structured.summary = profile.resume_structured.summary.trim();
  profile.resume_structured.skills = [
    ...new Set(profile.resume_structured.skills),
  ].slice(0, 150);
  for (const key of ["full_name", "email", "phone"])
    if (profile[key])
      evidence.push({
        field: key,
        quote: profile[key],
        confidence: "extracted",
      });
  if (!profile.resume_structured.experience.length)
    warnings.push(
      "Experience layout was not recognized locally. AI extraction can organize this source when Gemini is configured.",
    );
  warnings.push(
    "Preferences, name parts, authorization and years of experience are never inferred. Supply them once in your profile.",
  );
  return { profile, evidence, warnings, method: "local", needsReview: true };
}
const field = z
  .object({ path: z.string(), value: z.string(), quote: z.string() })
  .strict();
export async function extractResume(filename, data, env = {}) {
  const buffer = Buffer.from(data, "base64");
  if (buffer.length > 6 * 1024 * 1024)
    throw fail("Choose a resume under 6 MB.");
  let text = "";
  if (/\.pdf$/i.test(filename)) {
    if (buffer.subarray(0, 4).toString() !== "%PDF")
      throw fail("The file is not a valid PDF.");
    text = (await pdf(buffer)).text;
  } else if (/\.docx$/i.test(filename)) {
    if (buffer.subarray(0, 2).toString() !== "PK")
      throw fail("The file is not a valid DOCX.");
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (/\.txt$/i.test(filename)) text = buffer.toString("utf8");
  else throw fail("Choose a PDF, DOCX or TXT resume.");
  text = text.trim().slice(0, 60000);
  if (text.length < 30)
    throw fail(
      "No readable text found. Scanned/image-only resumes need OCR before import.",
    );
  const result = localIntake(text);
  if (env.GEMINI_API_KEY) {
    const schema = objectSchema({
      fields: {
        type: "array",
        items: objectSchema({
          path: { type: "string" },
          value: { type: "string" },
          quote: { type: "string" },
        }),
      },
    });
    const extracted = await askAI(
      "Extract verbatim resume facts. Return flat fields with paths: full_name,email,phone,location,links.github,links.linkedin,links.portfolio,resume_structured.summary,resume_structured.skills.INDEX,resume_structured.experience.INDEX.title|org|dates|bullets.INDEX,resume_structured.projects.INDEX.name|stack.INDEX|bullets.INDEX,resume_structured.education.INDEX.degree|institution|year|grade. Both value and quote must occur verbatim in the source. Do not infer name parts, preferences, authorization, years or missing facts. Contiguous array indexes start at 0.",
      { text },
      schema,
      z.object({ fields: field.array().max(700) }).strict(),
      env,
    );
    const profile = structuredClone(blankProfile);
    profile.resume_raw_text = text;
    const evidence = [];
    for (const f of extracted.fields) {
      if (!text.includes(f.quote) || !f.quote.includes(f.value) || !f.value)
        continue;
      const direct =
        /^(full_name|email|phone|location|links\.(github|linkedin|portfolio)|resume_structured\.summary)$/;
      const array =
        /^resume_structured\.(skills\.\d{1,2}|experience\.\d{1,2}\.(title|org|dates|bullets\.\d{1,2})|projects\.\d{1,2}\.(name|stack\.\d{1,2}|bullets\.\d{1,2})|education\.\d{1,2}\.(degree|institution|year|grade))$/;
      if (!direct.test(f.path) && !array.test(f.path)) continue;
      const keys = f.path.split(".");
      let cursor = profile;
      keys.slice(0, -1).forEach((key, i) => {
        cursor[key] ??= /^\d+$/.test(keys[i + 1]) ? [] : {};
        cursor = cursor[key];
      });
      cursor[keys.at(-1)] = f.value;
      evidence.push({ ...f, confidence: "source-verified" });
    }
    for (const e of profile.resume_structured.experience.filter(Boolean)) {
      e.title ??= "";
      e.org ??= "";
      e.dates ??= "";
      e.bullets = (e.bullets || []).filter(Boolean);
    }
    for (const e of profile.resume_structured.projects.filter(Boolean)) {
      e.name ??= "";
      e.stack = (e.stack || []).filter(Boolean);
      e.bullets = (e.bullets || []).filter(Boolean);
    }
    for (const e of profile.resume_structured.education.filter(Boolean))
      for (const key of ["degree", "institution", "year", "grade"])
        e[key] ??= "";
    for (const key of ["experience", "projects", "education", "skills"])
      profile.resume_structured[key] =
        profile.resume_structured[key].filter(Boolean);
    const parsed = profileSchema.safeParse(profile);
    if (parsed.success) {
      result.profile = parsed.data;
      result.evidence = evidence;
      result.method = "ai-source-verified";
      result.warnings = result.warnings.slice(-1);
    } else
      result.warnings.push(
        "AI extraction had invalid fields; the local extraction was retained.",
      );
  }
  return { ...result, text };
}
