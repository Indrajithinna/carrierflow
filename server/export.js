import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { Document, Packer, Paragraph, TextRun } from "docx";
export function artifactLines(artifact) {
  const o = artifact.output,
    p = artifact.profile;
  if (o.mode === "resume_tailor") {
    const r = o.resume_tailored;
    return [
      { text: p.full_name, heading: true },
      { text: [p.email, p.phone, p.location].filter(Boolean).join(" | ") },
      { text: Object.values(p.links).filter(Boolean).join(" | ") },
      { text: "Summary", heading: true },
      { text: r.summary },
      { text: "Experience", heading: true },
      ...r.experience.flatMap((e) => [
        { text: e.title + " — " + e.org + " | " + e.dates, heading: true },
        ...e.bullets.map((text) => ({ text })),
      ]),
      { text: "Projects", heading: true },
      ...r.projects.flatMap((e) => [
        { text: e.name + " | " + e.stack.join(", "), heading: true },
        ...e.bullets.map((text) => ({ text })),
      ]),
      { text: "Education", heading: true },
      ...r.education.map((e) => ({
        text: [e.degree, e.institution, e.year, e.grade]
          .filter(Boolean)
          .join(" | "),
      })),
      { text: "Skills", heading: true },
      { text: r.skills.join(", ") },
    ].filter((l) => l.text);
  }
  if (o.mode === "cover_letter")
    return o.cover_letter.split("\n\n").map((text) => ({ text }));
  if (o.mode === "email_draft")
    return [
      { text: o.subject, heading: true },
      ...o.body.split("\n").map((text) => ({ text })),
    ];
  if (o.mode === "round_prep")
    return [
      { text: o.company + " — Interview preparation", heading: true },
      { text: o.process_overview },
      ...o.rounds.flatMap((r) => [
        { text: r.round_name, heading: true },
        { text: r.what_to_expect },
        ...r.practice_questions.map((text) => ({ text })),
      ]),
      { text: o.company_context },
      { text: o.candidate_emphasis_notes },
    ];
  return [{ text: JSON.stringify(o, null, 2) }];
}
export async function exportArtifact(a, format) {
  const lines = artifactLines(a);
  if (format === "txt")
    return {
      mime: "text/plain; charset=utf-8",
      buffer: Buffer.from(lines.map((l) => l.text).join("\n\n")),
    };
  if (format === "json")
    return {
      mime: "application/json",
      buffer: Buffer.from(JSON.stringify(a.output, null, 2)),
    };
  if (format === "docx") {
    const d = new Document({
      sections: [
        {
          properties: {},
          children: lines.map(
            (l) =>
              new Paragraph({
                keepNext: !!l.heading,
                widowControl: true,
                spacing: { after: 160 },
                children: [
                  new TextRun({
                    text: l.text,
                    bold: !!l.heading,
                    size: l.heading ? 26 : 22,
                    font: "Calibri",
                  }),
                ],
              }),
          ),
        },
      ],
    });
    return {
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: await Packer.toBuffer(d),
    };
  }
  if (format !== "pdf")
    throw Object.assign(new Error("Unsupported export format."), {
      status: 400,
    });
  const buffer = await new Promise((resolve, reject) => {
    const chunks = [],
      doc = new PDFDocument({
        margin: 48,
        size: "A4",
        info: { Title: a.title },
      });
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const regular =
      process.env.RESUME_FONT_PATH ||
      (existsSync("C:/Windows/Fonts/arial.ttf")
        ? "C:/Windows/Fonts/arial.ttf"
        : "Helvetica");
    const bold =
      process.env.RESUME_BOLD_FONT_PATH ||
      (existsSync("C:/Windows/Fonts/arialbd.ttf")
        ? "C:/Windows/Fonts/arialbd.ttf"
        : regular === "Helvetica"
          ? "Helvetica-Bold"
          : regular);
    for (const l of lines) {
      if (l.heading && doc.y > doc.page.height - doc.page.margins.bottom - 65)
        doc.addPage();
      doc
        .font(l.heading ? bold : regular)
        .fontSize(l.heading ? 13 : 10.5)
        .text(l.text, { lineGap: 3 })
        .moveDown(0.6);
    }
    doc.end();
  });
  return { mime: "application/pdf", buffer };
}
