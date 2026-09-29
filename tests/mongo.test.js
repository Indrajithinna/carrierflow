import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createApp, errorHandler } from "../server/app.js";
import { createStore } from "../server/db.js";
import { COOKIE_NAME } from "../server/auth.js";

function createMockMongoAuthStore() {
  const users = new Map();
  const sessions = new Map();

  const createUser = async ({
    id,
    email,
    name,
    passwordHash,
    role = "user",
  }) => {
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
    users.set(user.id, user);
    return user;
  };

  const getUserByEmail = async (email) => {
    if (!email) return null;
    const target = email.toLowerCase().trim();
    for (const u of users.values()) {
      if (u.email.toLowerCase() === target) return u;
    }
    return null;
  };

  const getUserById = async (id) => users.get(id) || null;

  const countUsers = async () => users.size;

  const createSession = async ({ id, userId, tokenHash, expiresAt }) => {
    const current = new Date();
    const expiryDate =
      expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    const session = {
      id: id || randomUUID(),
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiryDate.toISOString(),
      created_at: current.toISOString(),
      last_active_at: current.toISOString(),
    };
    sessions.set(session.id, session);
    return session;
  };

  const getSessionByTokenHash = async (tokenHash) => {
    if (!tokenHash) return null;
    for (const s of sessions.values()) {
      if (s.token_hash === tokenHash) {
        if (new Date(s.expires_at).getTime() <= Date.now()) {
          sessions.delete(s.id);
          return null;
        }
        const user = users.get(s.user_id);
        if (!user) return null;
        return {
          ...s,
          user_email: user.email,
          user_name: user.name,
          user_role: user.role,
          user_created_at: user.created_at,
        };
      }
    }
    return null;
  };

  const touchSession = async (sessionId) => {
    const s = sessions.get(sessionId);
    if (s) {
      s.last_active_at = new Date().toISOString();
    }
  };

  const deleteSession = async (sessionId) => {
    sessions.delete(sessionId);
  };

  const deleteSessionByTokenHash = async (tokenHash) => {
    for (const [id, s] of sessions.entries()) {
      if (s.token_hash === tokenHash) sessions.delete(id);
    }
  };

  const deleteUserSessions = async (userId) => {
    for (const [id, s] of sessions.entries()) {
      if (s.user_id === userId) sessions.delete(id);
    }
  };

  const cleanExpiredSessions = async () => {
    const now = Date.now();
    for (const [id, s] of sessions.entries()) {
      if (new Date(s.expires_at).getTime() <= now) sessions.delete(id);
    }
  };

  const close = async () => {};

  return {
    isMongo: true,
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
    close,
  };
}

test("MongoDB Atlas user and session storage integration", async (t) => {
  await t.test(
    "mock MongoDB Atlas store fulfills all auth store operations",
    async () => {
      const mongo = createMockMongoAuthStore();

      assert.equal(await mongo.countUsers(), 0);

      const user = await mongo.createUser({
        email: "alex@mongo.example",
        name: "Alex Mongo",
        passwordHash: "$2a$10$mockhashval1234567890",
        role: "admin",
      });

      assert.equal(user.email, "alex@mongo.example");
      assert.equal(await mongo.countUsers(), 1);

      const found = await mongo.getUserByEmail("ALEX@MONGO.EXAMPLE");
      assert.ok(found);
      assert.equal(found.id, user.id);

      const token = "mongo_token_abc_123";
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 86400000).toISOString();

      const session = await mongo.createSession({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      assert.ok(session);
      assert.equal(session.user_id, user.id);

      const resolved = await mongo.getSessionByTokenHash(tokenHash);
      assert.ok(resolved);
      assert.equal(resolved.user_email, "alex@mongo.example");
      assert.equal(resolved.user_name, "Alex Mongo");

      await mongo.touchSession(session.id);
      await mongo.deleteSession(session.id);
      assert.equal(await mongo.getSessionByTokenHash(tokenHash), null);
    },
  );

  await t.test(
    "Careerflow Express app operates seamlessly with MongoDB Atlas auth store",
    async () => {
      const store = createStore(":memory:");
      const mongoAuthStore = createMockMongoAuthStore();
      const env = { REQUIRE_AUTH: "true" };

      const app = createApp(store, env, { authStore: mongoAuthStore });
      app.use(errorHandler);

      const server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base = "http://127.0.0.1:" + server.address().port;

      let cookie = "";

      try {
        // 1. Storage status shows MongoDB configured
        const statusRes = await fetch(base + "/api/storage/status").then((r) =>
          r.json(),
        );
        assert.equal(statusRes.mongodb.configured, true);

        // 2. Initial state: setupRequired = true
        const meInitial = await fetch(base + "/api/auth/me").then((r) =>
          r.json(),
        );
        assert.equal(meInitial.user, null);
        assert.equal(meInitial.setupRequired, true);

        // 3. Register user with Mongo store
        const regRes = await fetch(base + "/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Mongo Candidate",
            email: "candidate@atlas.example",
            password: "AtlasPassword123",
            confirmPassword: "AtlasPassword123",
          }),
        });

        assert.equal(regRes.status, 201);
        const regData = await regRes.json();
        assert.equal(regData.user.email, "candidate@atlas.example");
        assert.equal(regData.user.role, "admin");

        cookie = regRes.headers.get("set-cookie").split(";")[0];
        assert.ok(cookie.startsWith(COOKIE_NAME + "="));

        // 4. Authenticated /api/auth/me from Mongo session
        const meAuth = await fetch(base + "/api/auth/me", {
          headers: { cookie },
        }).then((r) => r.json());
        assert.ok(meAuth.user);
        assert.equal(meAuth.user.email, "candidate@atlas.example");
        assert.equal(meAuth.setupRequired, false);

        // 5. Access protected route with Mongo session
        const bootRes = await fetch(base + "/api/bootstrap", {
          headers: { cookie },
        });
        assert.equal(bootRes.status, 200);

        // 6. Logout invalidates Mongo session
        const logoutRes = await fetch(base + "/api/auth/logout", {
          method: "POST",
          headers: { cookie },
        });
        assert.equal(logoutRes.status, 200);

        // 7. Subsequent request fails with 401
        const postLogout = await fetch(base + "/api/bootstrap", {
          headers: { cookie },
        });
        assert.equal(postLogout.status, 401);
      } finally {
        await app.locals.queue.stop();
        server.close();
        store.db.close();
      }
    },
  );
});
