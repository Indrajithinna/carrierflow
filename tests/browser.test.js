import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import {
  captureStandardForm,
  fillStandardForm,
} from "../server/browser-runner.js";
import { sampleProfile, sampleJobs } from "../server/seed.js";
import { runMode } from "../server/modes.js";
const available = existsSync(chromium.executablePath());
test(
  "isolated browser adapter fills, uploads, validates and exposes a receipt on a local fixture",
  { skip: !available },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<h1>Fictional role</h1><form><label>Full name<input name="name" required></label><label>Email<input type="email" required></label><label>Resume<input type="file" required></label><label>Unknown optional<textarea></textarea></label><button type="submit">Submit application</button></form><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.body.innerHTML="<h1>Thank you for applying</h1>"}</script>',
      );
      const output = await runMode("resume_tailor", {
        candidate_profile: sampleProfile,
        job_listing: sampleJobs[0],
      });
      const result = await fillStandardForm(
        page,
        sampleProfile,
        sampleJobs[0],
        [{ id: "doc", title: "Fixture", profile: sampleProfile, output }],
      );
      assert.equal(
        await page
          .getByRole("textbox", { name: "Full name", exact: true })
          .inputValue(),
        sampleProfile.full_name,
      );
      assert.equal(
        await page
          .locator("input[type=file]")
          .evaluate((el) => el.files[0].name),
        "careerflow-resume_tailor.pdf",
      );
      assert.equal(result.filled.length, 3);
      await page.getByRole("button", { name: "Submit application" }).click();
      assert.equal(
        await page.locator("h1").innerText(),
        "Thank you for applying",
      );
    } finally {
      await browser.close();
    }
  },
);
test(
  "browser adapter stops at missing required answers, consent and login",
  { skip: !available },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      for (const field of [
        "<label>Unknown required<input required></label>",
        '<label>I agree to terms<input type="checkbox" required></label>',
        '<label>Password<input type="password"></label>',
      ]) {
        await page.setContent(
          '<form><label>Email<input type="email" required></label>' +
            field +
            "<button>Submit application</button></form>",
        );
        await assert.rejects(
          fillStandardForm(page, sampleProfile, sampleJobs[0], []),
        );
      }
      await page.setContent(
        '<form><label>Email<input type="email"></label><div class="g-recaptcha">captcha</div></form>',
      );
      assert.ok((await page.evaluate(captureStandardForm)).blocker);
    } finally {
      await browser.close();
    }
  },
);
test(
  "browser adapter never silently replaces conflicting prefilled answers",
  { skip: !available },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<form><label>Email<input type="email" value="someone-else@example.com" required></label></form>',
      );
      await assert.rejects(
        fillStandardForm(page, sampleProfile, sampleJobs[0], []),
        /different value/,
      );
      assert.equal(
        await page.locator("input").inputValue(),
        "someone-else@example.com",
      );
    } finally {
      await browser.close();
    }
  },
);
