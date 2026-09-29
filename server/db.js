import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { blankProfile } from "./schema.js";
import { sampleJobs, sampleProfile } from "./seed.js";
export function createStore(path, seed = true) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_active_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);",
  );
  const get = (kind, id) => {
    const row = db
      .prepare("SELECT data FROM records WHERE kind=? AND id=?")
      .get(kind, id);
    return row ? JSON.parse(row.data) : null;
  };
  const all = (kind) =>
    db
      .prepare("SELECT data FROM records WHERE kind=? ORDER BY rowid DESC")
      .all(kind)
      .map((r) => JSON.parse(r.data));
  const remove = (kind, id) =>
    db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  const put = (kind, item) => {
    db.prepare(
      "INSERT INTO records(kind,id,data) VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
    ).run(kind, item.id, JSON.stringify(item));
    return item;
  };
  const setting = (key, value) => {
    if (value !== undefined)
      db.prepare(
        "INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(key, JSON.stringify(value));
    const row = db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : null;
  };
  const event = (applicationId, title, detail = "") =>
    put("events", {
      id: randomUUID(),
      applicationId,
      title,
      detail,
      createdAt: new Date().toISOString(),
    });
  const createUser = ({ id, email, name, passwordHash, role = "user" }) => {
    const current = new Date().toISOString();
    const user = {
      id: id || randomUUID(),
      email: email.toLowerCase().trim(),
      name: name.trim(),
      password_hash: passwordHash,
      role,
      created_at: current,
      updated_at: current,
    };
    db.prepare(
      "INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      user.id,
      user.email,
      user.name,
      user.password_hash,
      user.role,
      user.created_at,
      user.updated_at,
    );
    return user;
  };
  const getUserByEmail = (email) => {
    if (!email) return null;
    return (
      db
        .prepare("SELECT * FROM users WHERE lower(email) = lower(?)")
        .get(email.trim()) || null
    );
  };
  const getUserById = (id) => {
    if (!id) return null;
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
  };
  const countUsers = () => {
    const row = db.prepare("SELECT count(*) as count FROM users").get();
    return row ? Number(row.count) : 0;
  };
  const createSession = ({ id, userId, tokenHash, expiresAt }) => {
    const current = new Date().toISOString();
    const session = {
      id: id || randomUUID(),
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_at: current,
      last_active_at: current,
    };
    db.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      session.id,
      session.user_id,
      session.token_hash,
      session.expires_at,
      session.created_at,
      session.last_active_at,
    );
    return session;
  };
  const getSessionByTokenHash = (tokenHash) => {
    if (!tokenHash) return null;
    return (
      db
        .prepare(
          "SELECT s.*, u.email as user_email, u.name as user_name, u.role as user_role, u.created_at as user_created_at FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = ?",
        )
        .get(tokenHash) || null
    );
  };
  const touchSession = (sessionId) => {
    const current = new Date().toISOString();
    db.prepare("UPDATE sessions SET last_active_at = ? WHERE id = ?").run(
      current,
      sessionId,
    );
  };
  const deleteSession = (sessionId) => {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  };
  const deleteSessionByTokenHash = (tokenHash) => {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  };
  const deleteUserSessions = (userId) => {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  };
  const cleanExpiredSessions = () => {
    const current = new Date().toISOString();
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(current);
  };
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const clear = () =>
    transaction(() => {
      db.exec("DELETE FROM records; DELETE FROM sessions;");
      setting("profile", blankProfile);
      setting("sample", false);
      setting("automation", null);
    });
  if (!setting("initialized")) {
    setting("initialized", true);
    setting("profile", seed ? sampleProfile : blankProfile);
    setting("sample", seed);
    if (seed) {
      sampleJobs.forEach((j) => put("jobs", j));
      [
        "applied",
        "interview_scheduled",
        "shortlisted",
        "interviewing",
        "shortlisted",
        "preparing",
      ].forEach((status, i) => {
        const createdAt = new Date(
          Date.now() - (6 - i) * 86400000,
        ).toISOString();
        const app = put("applications", {
          id: randomUUID(),
          jobId: sampleJobs[i].id,
          status,
          notes: "",
          version: 1,
          createdAt,
          updatedAt: createdAt,
          appliedAt: [
            "applied",
            "interviewing",
            "interview_scheduled",
          ].includes(status)
            ? createdAt
            : null,
          interviewAt:
            status === "interview_scheduled"
              ? new Date(Date.now() + 2 * 86400000).toISOString()
              : null,
        });
        put("events", {
          id: randomUUID(),
          applicationId: app.id,
          title:
            status === "shortlisted"
              ? "Saved to shortlist"
              : status === "interview_scheduled"
                ? "Interview scheduled"
                : "Application updated",
          detail: sampleJobs[i].company,
          createdAt,
        });
      });
    }
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS records_kind ON records(kind); CREATE INDEX IF NOT EXISTS idx_users_email ON users(email); CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash); CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id); PRAGMA user_version=3;",
  );
  return {
    db,
    get,
    all,
    put,
    setting,
    event,
    transaction,
    clear,
    remove,
    createUser,
    getUserByEmail,
    getUserById,
    countUsers,
    createSession,
    getSessionByTokenHash,
    touchSession,
    deleteSession,
    deleteSessionByTokenHash,
    deleteUserSessions,
    cleanExpiredSessions,
  };
}
