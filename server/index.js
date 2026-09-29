import "dotenv/config";
import express from "express";
import { resolve } from "node:path";
import { createStore } from "./db.js";
import { createApp, errorHandler } from "./app.js";
import { createS3Service } from "./s3.js";

const store = createStore(process.env.DATABASE_PATH || "./data/careerflow.db");
let authStore = store;

if (process.env.MONGODB_URI) {
  try {
    const { createMongoAuthStore } = await import("./mongo.js");
    authStore = await createMongoAuthStore(process.env.MONGODB_URI);
    console.log("Connected to MongoDB Atlas for user & session storage.");
  } catch (err) {
    console.warn(
      "MongoDB Atlas connection failed, falling back to local session store:",
      err.message,
    );
  }
}

const s3 = createS3Service(process.env);
if (s3.isConfigured()) {
  console.log(`Amazon S3 configured for bucket: ${s3.bucket} (${s3.region})`);
}

const app = createApp(store, process.env, { authStore, s3Service: s3 });
if (process.argv.includes("--production")) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server: undefined } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(errorHandler);
const server = app.listen(Number(process.env.PORT || 4310), "127.0.0.1", () =>
  console.log(
    "Careerflow is ready at " +
      (process.env.APP_ORIGIN || "http://localhost:4310"),
  ),
);
app.locals.queue.start();
const shutdown = async () => {
  await app.locals.queue.stop();
  if (authStore?.close) {
    try {
      await authStore.close();
    } catch {
      // ignore
    }
  }
  server.close(() => {
    store.db.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
