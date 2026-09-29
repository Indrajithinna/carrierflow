import { randomUUID } from "node:crypto";
import { z } from "zod";
import { now } from "./workspace.js";
import { fail } from "./ai.js";

export const automationSchema = z
  .object({
    enabled: z.boolean().default(false),
    autoSubmit: z.boolean().default(false),
    autoEmail: z.boolean().default(false),
    useAI: z.boolean().default(true),
    minMatch: z.number().int().min(0).max(100).default(75),
    maxApplicationsPerDay: z.number().int().min(1).max(20).default(3),
    maxAICallsPerDay: z.number().int().min(1).max(500).default(40),
    intervalHours: z.number().min(1).max(168).default(12),
    allowedDomains: z
      .array(
        z
          .string()
          .max(200)
          .regex(
            /^(?!localhost$)(?!.*\.local$)(?!\d+(?:\.\d+){3}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i,
          ),
      )
      .max(30)
      .default([]),
    excludedCompanies: z.array(z.string().max(200)).max(100).default([]),
  })
  .strict();
export const automationDefaults = automationSchema.parse({});
export function createQueue(store, handlers) {
  let timer = null,
    running = false,
    active = null,
    controller = null;
  const settings = () =>
    automationSchema.parse(store.setting("automation") || {});
  // Potentially irreversible work is quarantined after a crash, never blindly replayed.
  for (const t of store.all("tasks"))
    if (t.status === "running")
      store.put("tasks", {
        ...t,
        status: ["submit", "email"].includes(t.kind) ? "uncertain" : "queued",
        error:
          "Interrupted by server restart" +
          (["submit", "email"].includes(t.kind)
            ? "; verify external receipt before any new attempt."
            : "; safe to retry."),
        updatedAt: now(),
        nextAt: now(),
      });
  const enqueue = (kind, payload = {}, key = randomUUID()) => {
    if (!handlers[kind]) throw fail("Unknown automation operation.");
    const found = store
      .all("tasks")
      .find(
        (t) =>
          t.key === key &&
          !["cancelled", "failed", "blocked"].includes(t.status),
      );
    if (found) return found;
    return store.put("tasks", {
      id: randomUUID(),
      kind,
      payload,
      key,
      status: "queued",
      attempts: 0,
      createdAt: now(),
      updatedAt: now(),
      nextAt: now(),
      error: null,
    });
  };
  async function tick() {
    if (running) return;
    const t = store
      .all("tasks")
      .filter(
        (t) => t.status === "queued" && Date.parse(t.nextAt) <= Date.now(),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!t) return;
    running = true;
    active = t.id;
    controller = new AbortController();
    store.put("tasks", {
      ...t,
      status: "running",
      attempts: t.attempts + 1,
      updatedAt: now(),
    });
    const checkpoint = () => {
      if (
        controller.signal.aborted ||
        store.get("tasks", t.id)?.status === "cancelled"
      )
        throw fail("Task cancelled.", 499);
    };
    try {
      const result = await handlers[t.kind](t.payload, {
        taskId: t.id,
        signal: controller.signal,
        checkpoint,
        enqueue,
        settings,
      });
      checkpoint();
      store.put("tasks", {
        ...store.get("tasks", t.id),
        status: "succeeded",
        result,
        updatedAt: now(),
        error: null,
      });
    } catch (e) {
      const current = store.get("tasks", t.id);
      if (current) {
        const unsafe =
          ["submit", "email"].includes(t.kind) && current.irreversibleAt;
        const retry =
          !unsafe &&
          !["submit", "email"].includes(t.kind) &&
          [429, 502, 503, 504].includes(e.status) &&
          t.attempts < 2 &&
          !controller.signal.aborted;
        store.put("tasks", {
          ...current,
          status: unsafe
            ? "uncertain"
            : controller.signal.aborted
              ? "cancelled"
              : retry
                ? "queued"
                : [400, 403, 409, 422].includes(e.status)
                  ? "blocked"
                  : "failed",
          error: e.status
            ? e.message
            : "The task failed unexpectedly. Check server diagnostics.",
          nextAt: new Date(
            Date.now() + Math.pow(2, t.attempts) * 30000,
          ).toISOString(),
          updatedAt: now(),
        });
        store.event(
          t.payload.applicationId || null,
          "Automation " +
            (unsafe ? "needs receipt verification" : "needs attention"),
          e.status ? e.message : "Unexpected worker failure",
        );
        if (!e.status)
          console.error("Careerflow task failure", t.kind, e.message);
      }
    } finally {
      running = false;
      active = null;
      controller = null;
    }
  }
  function cancel(id) {
    const t = store.get("tasks", id);
    if (!t) throw fail("Task not found.", 404);
    if (!["queued", "running"].includes(t.status))
      throw fail("Only queued or running tasks can be cancelled.");
    if (t.irreversibleAt)
      throw fail(
        "An external action may already have occurred. Wait for its receipt; do not retry.",
        409,
      );
    store.put("tasks", { ...t, status: "cancelled", updatedAt: now() });
    if (id === active) controller?.abort();
    return { success: true };
  }
  function retry(id) {
    const t = store.get("tasks", id);
    if (
      !t ||
      !["failed", "blocked", "cancelled"].includes(t.status) ||
      t.irreversibleAt
    )
      throw fail("This task cannot safely be retried.", 409);
    return store.put("tasks", {
      ...t,
      status: "queued",
      attempts: 0,
      error: null,
      nextAt: now(),
      updatedAt: now(),
    });
  }
  function pause() {
    store.setting("automation", { ...settings(), enabled: false });
    for (const t of store.all("tasks")) if (t.status === "queued") cancel(t.id);
    if (active && !store.get("tasks", active)?.irreversibleAt) cancel(active);
  }
  function schedule() {
    const config = settings();
    if (!config.enabled || store.setting("sample")) return;
    const bucket = Math.floor(Date.now() / (config.intervalHours * 3600000));
    for (const search of store
      .all("savedSearches")
      .filter((s) => s.enabled !== false))
      enqueue(
        "discover",
        { searchId: search.id },
        "discover:" + search.id + ":" + bucket,
      );
    enqueue("reminders", {}, "reminders:" + Math.floor(Date.now() / 3600000));
  }
  return {
    enqueue,
    tick,
    cancel,
    retry,
    pause,
    settings,
    isRunning: () => running,
    active: () => active,
    start() {
      if (timer) return;
      schedule();
      timer = setInterval(() => {
        try {
          schedule();
          void tick();
        } catch (e) {
          console.error("Careerflow scheduler:", e.message);
        }
      }, 2000);
      timer.unref();
    },
    async stop() {
      clearInterval(timer);
      timer = null;
      controller?.abort();
      while (running) await new Promise((r) => setTimeout(r, 20));
    },
  };
}
