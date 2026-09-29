import { chromium } from "playwright";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fail } from "./ai.js";
import { mapFields } from "./modes.js";
import { norm } from "./matching.js";
import { exportArtifact } from "./export.js";

export function allowedApplicationUrl(value, domains) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      domains.includes(u.hostname) &&
      !isIP(u.hostname)
    );
  } catch {
    return false;
  }
}
export function publicAddress(address) {
  if (address.includes(":"))
    return !/^(::|fc|fd|fe80|ff)/i.test(address) && !address.includes("ffff:");
  return !/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.(18|19)\.|22[4-9]\.|23\d\.)/.test(
    address,
  );
}
export async function assertPublicHost(hostname) {
  if (isIP(hostname) || hostname === "localhost" || hostname.endsWith(".local"))
    throw fail("Private network destinations are not allowed.");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw fail("Destination resolves to a private or unsupported address.");
}
// Runs in an isolated page context. Never returns existing answers, cookies or hidden fields.
export function captureStandardForm() {
  const visible = (el) => !!el.getClientRects().length;
  if (
    [
      ...document.querySelectorAll(
        'input[type=password],iframe[src*="recaptcha"],iframe[src*="hcaptcha"],.g-recaptcha,.h-captcha,[data-sitekey]',
      ),
    ].some(visible)
  )
    return {
      blocker: "Login or CAPTCHA must be completed outside automation.",
      fields: [],
    };
  const forms = [...document.forms].filter(
    (f) =>
      visible(f) &&
      f.querySelector("input[type=email],input[type=file],textarea"),
  );
  if (forms.length !== 1)
    return {
      blocker: "A unique supported application form could not be identified.",
      fields: [],
    };
  const form = forms[0];
  form.setAttribute("data-careerflow-form", "active");
  const fields = [...form.querySelectorAll("input,select,textarea")]
    .filter(
      (el) =>
        !el.disabled &&
        el.type !== "hidden" &&
        !["button", "submit", "reset"].includes(el.type) &&
        (visible(el) || el.type === "file"),
    )
    .map((el, i) => {
      const id = "cf-run-" + i;
      el.setAttribute("data-careerflow-field", id);
      const labelled = (el.getAttribute("aria-labelledby") || "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      const label =
        [...(el.labels || [])].map((l) => l.textContent.trim()).join(" ") ||
        el.getAttribute("aria-label") ||
        labelled ||
        el.placeholder ||
        el.name ||
        "Unlabeled field";
      return {
        selector: id,
        label: label.slice(0, 500),
        type: el.tagName === "SELECT" ? "select" : el.type || "text",
        required: !!el.required || el.getAttribute("aria-required") === "true",
        ...(el.tagName === "SELECT"
          ? {
              options: [...el.options]
                .map((o) => o.textContent.trim())
                .slice(0, 100),
            }
          : {}),
      };
    });
  return {
    fields,
    blocker:
      fields.length > 100 ? "Too many fields for the standard adapter." : null,
  };
}
export async function fillStandardForm(
  page,
  profile,
  job,
  documents,
  checkpoint = () => {},
) {
  const snapshot = await page.evaluate(captureStandardForm);
  if (snapshot.blocker) throw fail(snapshot.blocker);
  const mapping = mapFields(profile, job, snapshot.fields);
  if (mapping.blocking_issue) throw fail(mapping.blocking_issue);
  const filled = [];
  for (const f of snapshot.fields) {
    checkpoint();
    const answer = mapping.fields.find((x) => x.selector === f.selector);
    const el = page.locator('[data-careerflow-field="' + f.selector + '"]');
    if (["checkbox", "radio"].includes(f.type)) {
      if (f.required)
        throw fail("Required selection/consent is not supported: " + f.label);
      continue;
    }
    if (!answer || answer.action === "FLAG") {
      if (f.required) throw fail("Missing confident answer: " + f.label);
      continue;
    }
    if (f.type === "file") {
      const kind =
          answer.value === "UPLOAD:resume_tailored"
            ? "resume_tailor"
            : answer.value?.replace("UPLOAD:", ""),
        doc = documents.find((d) => d.output.mode === kind);
      if (!doc) {
        if (f.required) throw fail("No approved attachment: " + f.label);
        continue;
      }
      const file = await exportArtifact(doc, "pdf");
      await el.setInputFiles({
        name: "careerflow-" + kind + ".pdf",
        mimeType: file.mime,
        buffer: file.buffer,
      });
      filled.push(f.label);
      continue;
    }
    const existing = await el.inputValue();
    if (existing && existing !== answer.value)
      throw fail("A field already contains a different value: " + f.label);
    if (answer.value?.startsWith("UPLOAD:"))
      throw fail("Attachment token cannot be inserted as text.");
    if (f.type === "select") await el.selectOption({ label: answer.value });
    else await el.fill(answer.value || "");
    const accepted =
      f.type === "select"
        ? await el.locator("option:checked").innerText()
        : await el.inputValue();
    if (accepted !== answer.value)
      throw fail("The form did not retain the intended value: " + f.label);
    filled.push(f.label);
  }
  if (
    !(await page
      .locator("[data-careerflow-form=active]")
      .evaluate((form) => form.checkValidity()))
  )
    throw fail("The completed form still has validation errors.");
  return { snapshot, mapping, filled };
}
export async function submitApplication({
  profile,
  job,
  documents,
  config,
  env = {},
  checkpoint = () => {},
  beforeSubmit = () => {},
}) {
  if (!allowedApplicationUrl(job.url, config.allowedDomains))
    throw fail(
      "Application URL is not an explicitly allowed HTTPS employer domain.",
    );
  await assertPublicHost(new URL(job.url).hostname);
  checkpoint();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(env.BROWSER_CHANNEL ? { channel: env.BROWSER_CHANNEL } : {}),
    });
  } catch {
    throw fail(
      "Browser runtime unavailable. Run npm run browser:install, or set BROWSER_CHANNEL=chrome/msedge.",
      503,
    );
  }
  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    // Guard every request against private-network access and unexpected write destinations.
    const checked = new Set();
    await context.route("**/*", async (route) => {
      try {
        const request = route.request(),
          url = new URL(request.url());
        if (!["https:"].includes(url.protocol)) return route.abort();
        if (!checked.has(url.hostname)) {
          await assertPublicHost(url.hostname);
          checked.add(url.hostname);
        }
        if (
          !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
          !config.allowedDomains.includes(url.hostname)
        )
          return route.abort();
        await route.continue();
      } catch {
        await route.abort();
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 35000 });
    checkpoint();
    if (!allowedApplicationUrl(page.url(), config.allowedDomains))
      throw fail(
        "The application redirected outside the allowed employer domains.",
      );
    const body = norm(await page.locator("body").innerText());
    if (!body.includes(norm(job.title)) || !body.includes(norm(job.company)))
      throw fail("The page does not identify the expected company and role.");
    const result = await fillStandardForm(
      page,
      profile,
      job,
      documents,
      checkpoint,
    );
    const form = page.locator("[data-careerflow-form=active]");
    const action = await form.evaluate((f) => f.action || location.href);
    if (!allowedApplicationUrl(action, config.allowedDomains))
      throw fail("Form submission target is not an allowed employer domain.");
    const submit = form.getByRole("button", {
      name: /^(submit application|send application|apply now|submit)$/i,
    });
    if ((await submit.count()) !== 1)
      throw fail("A unique supported final submit button was not found.");
    const receipt =
      /application (?:has been |was )?(?:received|submitted)|thank you for applying|application successfully submitted/i;
    if (receipt.test(await page.locator("body").innerText()))
      throw fail(
        "A receipt already exists on this page. Verify it before another attempt.",
      );
    const fresh = await page.evaluate(captureStandardForm);
    if (
      fresh.blocker ||
      JSON.stringify(fresh.fields) !== JSON.stringify(result.snapshot.fields)
    )
      throw fail("The application form changed during filling.");
    checkpoint();
    await beforeSubmit({ pageUrl: page.url(), action });
    await submit.click();
    await page.waitForFunction(
      () =>
        /application (?:has been |was )?(?:received|submitted)|thank you for applying|application successfully submitted/i.test(
          document.body.innerText,
        ),
      {},
      { timeout: 15000 },
    );
    const text = await page.locator("body").innerText();
    return {
      url: page.url(),
      receivedAt: new Date().toISOString(),
      receipt:
        text.match(
          /.{0,60}(?:application (?:has been |was )?(?:received|submitted)|thank you for applying|application successfully submitted).{0,150}/i,
        )?.[0] || "Submission receipt displayed",
      filled: result.filled,
    };
  } finally {
    await browser.close();
  }
}
