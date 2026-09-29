import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/db.js";
import { createApp, errorHandler } from "../server/app.js";
import { sampleProfile, sampleJobs } from "../server/seed.js";
test("persistent application workflow, exports, concurrency, origins, and sample email controls", async () => {
  const store = createStore(":memory:");
  const app = createApp(store, {});
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const call = async (path, method = "GET", body, headers = {}) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    let s = (await call("/bootstrap")).data;
    assert.equal(s.jobs.length, 8);
    const j = sampleJobs[6];
    const added = await call("/applications", "POST", { jobId: j.id });
    assert.equal(added.status, 201);
    const a = added.data;
    assert.equal(
      (await call("/applications", "POST", { jobId: j.id })).data.id,
      a.id,
    );
    assert.equal(
      (
        await call("/applications/" + a.id, "PATCH", {
          status: "applied",
          version: 1,
        })
      ).status,
      422,
    );
    const applied = await call("/applications/" + a.id, "PATCH", {
      status: "applied",
      version: 1,
      confirmSubmission: true,
    });
    assert.equal(applied.status, 200);
    assert.ok(applied.data.appliedAt);
    assert.equal(
      (
        await call("/applications/" + a.id, "PATCH", {
          notes: "stale",
          version: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("/profile", "PUT", sampleProfile, {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    const doc = await call("/applications/" + a.id + "/generate", "POST", {
      mode: "resume_tailor",
    });
    assert.equal(doc.status, 200);
    for (const format of ["pdf", "docx", "txt", "json"]) {
      const response = await fetch(
        base + "/api/artifacts/" + doc.data.id + "/download?format=" + format,
      );
      assert.equal(response.status, 200);
      const buffer = Buffer.from(await response.arrayBuffer());
      assert.ok(buffer.length > 100);
      if (format === "pdf")
        assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
      if (format === "docx")
        assert.equal(buffer.subarray(0, 2).toString(), "PK");
    }
    assert.equal(
      (await call("/artifacts/" + doc.data.id, "PATCH", { approved: true }))
        .status,
      200,
    );
    await call("/profile", "PUT", {
      ...sampleProfile,
      full_name: "Changed Name",
    });
    assert.equal(
      (await call("/artifacts/" + doc.data.id, "PATCH", { approved: true }))
        .status,
      409,
    );
    const draft = await call("/applications/" + a.id + "/generate", "POST", {
      mode: "email_draft",
      event_type: "applied",
    });
    assert.equal(draft.status, 200);
    await call("/artifacts/" + draft.data.id, "PATCH", { approved: true });
    assert.equal(
      (
        await call("/artifacts/" + draft.data.id + "/send", "POST", {
          confirm: true,
        })
      ).status,
      422,
    );
    assert.equal((await call("/companion/applications")).status, 401);
    const settings = (await call("/settings")).data;
    assert.ok(settings.extensionToken);
    assert.equal("GEMINI_API_KEY" in settings, false);
    assert.equal(
      (
        await call(
          "/companion/map",
          "POST",
          {
            applicationId: a.id,
            pageUrl: "https://other.example/jobs",
            form_snapshot: [],
          },
          { Authorization: "Bearer " + settings.extensionToken },
        )
      ).status,
      422,
    );
    assert.equal(
      (await call("/workspace/reset", "POST", { confirm: true })).status,
      200,
    );
    s = (await call("/bootstrap")).data;
    assert.equal(s.applications.length, 0);
    assert.equal(s.profile.full_name, "");
    assert.equal(s.sample, false);
  } finally {
    server.close();
    store.db.close();
  }
});
