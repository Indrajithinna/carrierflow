import express from "express";
import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import nodemailer from "nodemailer";
import { createServices } from "./services.js";
import { mountRoutes } from "./routes.js";
import { authMiddleware, requireAuth } from "./auth.js";
import { mountAuthRoutes } from "./auth-routes.js";
import { createS3Service } from "./s3.js";
import {
  profileSchema,
  jobSchema,
  statuses,
  fieldSchema,
  sourceSchema,
} from "./schema.js";
import { match, runMode } from "./modes.js";
import { searchJobs, researchJob } from "./providers.js";
import { exportArtifact } from "./export.js";
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export function createApp(store, env = process.env, options = {}) {
  const app = express();
  app.disable("x-powered-by");
  const authStore = options.authStore || store;
  const s3 = options.s3Service || createS3Service(env);
  app.locals.authStore = authStore;
  app.locals.s3 = s3;
  const origin = env.APP_ORIGIN || "http://localhost:4310";
  const port = new URL(origin).port || "4310";
  const validOrigins = new Set([origin, "http://127.0.0.1:" + port]);
  const token =
    env.EXTENSION_TOKEN ||
    store.setting("extensionToken") ||
    randomBytes(24).toString("hex");
  store.setting("extensionToken", token);
  const validToken = (req) => {
    const value = String(req.headers.authorization || "").replace(
      /^Bearer /,
      "",
    );
    return (
      Buffer.byteLength(value) === Buffer.byteLength(token) &&
      timingSafeEqual(Buffer.from(value), Buffer.from(token))
    );
  };
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    const host = (req.headers.host || "").split(":")[0];
    if (!["localhost", "127.0.0.1"].includes(host))
      return res.status(403).json({ error: "Local access only." });
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    const o = req.headers.origin;
    if (
      o?.startsWith("chrome-extension://") &&
      req.path.startsWith("/api/companion/")
    ) {
      res.setHeader("Access-Control-Allow-Origin", o);
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") return res.sendStatus(204);
      if (!validToken(req))
        return res
          .status(401)
          .json({ error: "Pair the extension using the token in Settings." });
    } else if (o && !validOrigins.has(o))
      return res.status(403).json({ error: "Origin not allowed." });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.is("application/json") &&
      !req.originalUrl.startsWith("/api/auth/logout")
    )
      return res.status(415).json({ error: "JSON content type required." });
    next();
  });
  app.use(express.json({ limit: "25mb" }));
  app.use(authMiddleware(authStore, env));
  mountAuthRoutes(app, authStore, env);
  const activity = new Map();
  app.use("/api", (req, res, next) => {
    if (req.method === "GET") return next();
    const now = Date.now(),
      key = req.ip || "local";
    const calls = (activity.get(key) || []).filter((t) => now - t < 60000);
    if (calls.length >= 180)
      return res
        .status(429)
        .json({ error: "Too many requests. Please wait a minute." });
    calls.push(now);
    activity.set(key, calls);
    next();
  });
  const jobFor = (id) => {
    const a = store.get("applications", id);
    if (!a) throw fail("Application not found.", 404);
    const j = store.get("jobs", a.jobId);
    if (!j) throw fail("Job not found.", 404);
    return { a, j };
  };
  const config = () => ({
    gemini: !!env.GEMINI_API_KEY,
    research: !!env.TAVILY_API_KEY,
    adzuna: !!(env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY),
    email: !!(env.SMTP_USER && env.SMTP_PASSWORD),
    model: env.GEMINI_MODEL || "gemini-2.5-flash",
    mailTo: store.setting("profile").email,
  });
  const service = createServices(store, env);
  const { queue, generate } = service;
  app.locals.queue = queue;

  // Protect all /api routes except authentication, browser companion, and storage status
  app.use("/api", (req, res, next) => {
    const p = req.originalUrl.split("?")[0];
    if (
      p.startsWith("/api/auth/") ||
      p.startsWith("/api/companion/") ||
      p === "/api/storage/status"
    ) {
      return next();
    }
    return requireAuth(authStore, env)(req, res, next);
  });

  mountRoutes(app, store, service, env, s3);
  app.get("/api/settings", (req, res) =>
    res.json({ ...service.config(), extensionToken: token }),
  );
  app.get("/api/companion/applications", (req, res) => {
    if (!validToken(req)) throw fail("Pairing token required.", 401);
    res.json(
      store
        .all("applications")
        .filter((a) => !a.archivedAt && !a.deletedAt)
        .map((a) => ({
          ...a,
          job: a.jobSnapshot || store.get("jobs", a.jobId),
        })),
    );
  });
  app.post("/api/companion/map", async (req, res) => {
    if (!validToken(req)) throw fail("Pairing token required.", 401);
    const { applicationId, form_snapshot, pageUrl } = z
      .object({
        applicationId: z.string(),
        pageUrl: z.string().url(),
        form_snapshot: fieldSchema.array().max(100),
      })
      .parse(req.body);
    const { j } = service.jobFor(applicationId);
    if (new URL(pageUrl).origin !== new URL(j.url).origin)
      throw fail(
        "The form domain does not match the saved application URL. Update the job URL before continuing.",
        422,
      );
    const a = await generate(applicationId, "form_fill", { form_snapshot });
    res.json(a.output);
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  return app;
}
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (!(err instanceof z.ZodError) && !err.status)
    console.error(
      "Careerflow request failed:",
      req.method,
      req.path,
      err.message,
    );
  res.status(err instanceof z.ZodError ? 422 : err.status || 500).json({
    error:
      err instanceof z.ZodError
        ? "Invalid input: " +
          err.issues
            .map((i) => i.path.join(".") + " " + i.message)
            .slice(0, 3)
            .join("; ")
        : err.status
          ? err.message
          : "The operation failed. Check server diagnostics before retrying.",
  });
}
