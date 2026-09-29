import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/db.js";
import { createApp, errorHandler } from "../server/app.js";
import { COOKIE_NAME } from "../server/auth.js";

test("complete production-ready authentication system", async (t) => {
  const store = createStore(":memory:");
  const env = { REQUIRE_AUTH: "true", SESSION_TTL_DAYS: "7" };
  const app = createApp(store, env);
  app.use(errorHandler);

  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;

  let sessionCookie = "";

  const call = async (path, method = "GET", body, extraHeaders = {}) => {
    const headers = { "Content-Type": "application/json", ...extraHeaders };
    if (sessionCookie && !headers.cookie && !headers.Cookie) {
      headers.cookie = sessionCookie;
    }

    const r = await fetch(base + "/api" + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const setCookie = r.headers.get("set-cookie");
    if (setCookie && setCookie.includes(COOKIE_NAME + "=")) {
      const match = setCookie.match(new RegExp(COOKIE_NAME + "=([^;]+)"));
      if (match) {
        sessionCookie = COOKIE_NAME + "=" + match[1];
      }
    }

    let data;
    try {
      data = await r.json();
    } catch {
      data = null;
    }

    return { status: r.status, data, headers: r.headers };
  };

  try {
    // 1. Initial State: Current User is null, Setup is required
    await t.test(
      "unauthenticated /api/auth/me returns user: null and setupRequired: true",
      async () => {
        const res = await call("/auth/me");
        assert.equal(res.status, 200);
        assert.equal(res.data.user, null);
        assert.equal(res.data.setupRequired, true);
      },
    );

    // 2. Protected routes block unauthenticated access
    await t.test(
      "unauthenticated requests to protected endpoints return 401",
      async () => {
        for (const endpoint of ["/bootstrap", "/profile", "/applications"]) {
          const res = await call(endpoint);
          assert.equal(res.status, 401, `Expected 401 for ${endpoint}`);
          assert.match(res.data.error, /Authentication required/i);
        }
      },
    );

    // 3. User Registration validation
    await t.test(
      "registration validates required fields and password rules",
      async () => {
        // Missing / short name
        const r1 = await call("/auth/register", "POST", {
          name: "A",
          email: "alex@example.com",
          password: "Password123",
          confirmPassword: "Password123",
        });
        assert.equal(r1.status, 422);

        // Invalid email
        const r2 = await call("/auth/register", "POST", {
          name: "Alex Morgan",
          email: "not-an-email",
          password: "Password123",
          confirmPassword: "Password123",
        });
        assert.equal(r2.status, 422);

        // Weak password (< 8 chars)
        const r3 = await call("/auth/register", "POST", {
          name: "Alex Morgan",
          email: "alex@example.com",
          password: "Pass1",
          confirmPassword: "Pass1",
        });
        assert.equal(r3.status, 422);

        // Password without digits
        const r4 = await call("/auth/register", "POST", {
          name: "Alex Morgan",
          email: "alex@example.com",
          password: "PasswordOnly",
          confirmPassword: "PasswordOnly",
        });
        assert.equal(r4.status, 422);

        // Mismatched confirmPassword
        const r5 = await call("/auth/register", "POST", {
          name: "Alex Morgan",
          email: "alex@example.com",
          password: "Password123",
          confirmPassword: "DifferentPassword123",
        });
        assert.equal(r5.status, 422);
      },
    );

    // 4. Successful Registration
    let registeredUser;
    let registeredToken;
    await t.test(
      "successful registration creates user, session, sets httpOnly cookie, and returns safe user data",
      async () => {
        const res = await call("/auth/register", "POST", {
          name: "Alex Morgan",
          email: "alex@example.com",
          password: "SecurePassword123",
          confirmPassword: "SecurePassword123",
        });

        assert.equal(res.status, 201);
        assert.ok(res.data.user);
        assert.equal(res.data.user.email, "alex@example.com");
        assert.equal(res.data.user.name, "Alex Morgan");
        assert.equal(res.data.user.role, "admin"); // First user gets admin
        assert.equal(typeof res.data.user.password_hash, "undefined"); // Never expose hash
        assert.ok(res.data.token);

        registeredUser = res.data.user;
        registeredToken = res.data.token;

        // Verify cookie attributes
        const setCookie = res.headers.get("set-cookie");
        assert.ok(setCookie);
        assert.match(setCookie, new RegExp(COOKIE_NAME + "="));
        assert.match(setCookie, /HttpOnly/i);
        assert.match(setCookie, /SameSite=Lax/i);

        // Verify SQLite password hash security
        const dbUser = store.getUserByEmail("alex@example.com");
        assert.ok(dbUser);
        assert.match(dbUser.password_hash, /^\$2[ab]\$/); // bcrypt hash prefix
        assert.notEqual(dbUser.password_hash, "SecurePassword123");
      },
    );

    // 5. Prevent Duplicate Accounts
    await t.test(
      "duplicate email registration returns 409 Conflict",
      async () => {
        const res = await call("/auth/register", "POST", {
          name: "Alex Imposter",
          email: "ALEX@example.com", // Case-insensitive duplicate check
          password: "AnotherPassword123",
          confirmPassword: "AnotherPassword123",
        });

        assert.equal(res.status, 409);
        assert.match(res.data.error, /already exists/i);
      },
    );

    // 6. Current User with Session Cookie
    await t.test(
      "GET /api/auth/me returns current user when session cookie is provided",
      async () => {
        const res = await call("/auth/me");
        assert.equal(res.status, 200);
        assert.ok(res.data.user);
        assert.equal(res.data.user.id, registeredUser.id);
        assert.equal(res.data.user.email, "alex@example.com");
        assert.equal(res.data.setupRequired, false);
        assert.equal(typeof res.data.user.password_hash, "undefined");
      },
    );

    // 7. Protected routes succeed when authenticated
    await t.test(
      "protected routes return 200 when authenticated via cookie",
      async () => {
        const res = await call("/bootstrap");
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.jobs));
        assert.ok(Array.isArray(res.data.applications));
      },
    );

    // 8. Protected routes succeed when authenticated via Bearer token
    await t.test(
      "protected routes return 200 when authenticated via Authorization header",
      async () => {
        const res = await call("/bootstrap", "GET", undefined, {
          Authorization: "Bearer " + registeredToken,
          cookie: "", // Ignore session cookie for this call
        });
        assert.equal(res.status, 200);
      },
    );

    // 9. Logout
    await t.test("logout invalidates session and clears cookie", async () => {
      const res = await call("/auth/logout", "POST");
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);

      // Session should be removed from database
      const oldHash = store.getSessionByTokenHash(registeredToken);
      assert.equal(oldHash, null);

      // Subsequent call to protected route with the old cookie must fail (401)
      const protectedRes = await call("/bootstrap", "GET", undefined, {
        cookie: sessionCookie,
      });
      assert.equal(protectedRes.status, 401);

      // Reset test session cookie
      sessionCookie = "";
    });

    // 10. Login with Invalid Credentials
    await t.test(
      "login fails with safe error for non-existent email or wrong password",
      async () => {
        // Non-existent email
        const r1 = await call("/auth/login", "POST", {
          email: "nonexistent@example.com",
          password: "SomePassword123",
        });
        assert.equal(r1.status, 401);
        assert.match(r1.data.error, /Invalid email or password/i);

        // Wrong password
        const r2 = await call("/auth/login", "POST", {
          email: "alex@example.com",
          password: "WrongPassword999",
        });
        assert.equal(r2.status, 401);
        assert.match(r2.data.error, /Invalid email or password/i);
      },
    );

    // 11. Login with Valid Credentials
    await t.test(
      "login succeeds with correct credentials and issues new session",
      async () => {
        const res = await call("/auth/login", "POST", {
          email: "alex@example.com",
          password: "SecurePassword123",
        });

        assert.equal(res.status, 200);
        assert.ok(res.data.user);
        assert.equal(res.data.user.email, "alex@example.com");
        assert.ok(res.data.token);
        assert.ok(sessionCookie.length > 10);

        // Check current user is authenticated again
        const me = await call("/auth/me");
        assert.equal(me.status, 200);
        assert.equal(me.data.user.id, registeredUser.id);
      },
    );

    // 12. Session Expiration Handling
    await t.test(
      "expired session token returns 401 and is cleaned up",
      async () => {
        // Manually create an expired session
        const expiredToken = "expired_token_1234567890abcdef1234567890abcdef";
        const { createHash } = await import("node:crypto");
        const expiredHash = createHash("sha256")
          .update(expiredToken)
          .digest("hex");

        store.createSession({
          userId: registeredUser.id,
          tokenHash: expiredHash,
          expiresAt: new Date(Date.now() - 1000).toISOString(), // In the past
        });

        const res = await call("/bootstrap", "GET", undefined, {
          Authorization: "Bearer " + expiredToken,
          cookie: "",
        });
        assert.equal(res.status, 401);

        // Verify the expired session was removed from the database
        const found = store.getSessionByTokenHash(expiredHash);
        assert.equal(found, null);
      },
    );

    // 13. Rate Limiting on Login
    await t.test(
      "repeated failed login attempts trigger rate limiting (429)",
      async () => {
        let hitRateLimit = false;
        for (let i = 0; i < 15; i++) {
          const res = await call("/auth/login", "POST", {
            email: "alex@example.com",
            password: "RepeatedWrongPassword" + i,
          });
          if (res.status === 429) {
            hitRateLimit = true;
            assert.match(res.data.error, /Too many failed login attempts/i);
            break;
          }
        }
        assert.equal(
          hitRateLimit,
          true,
          "Rate limit should be triggered after repeated failures",
        );
      },
    );
  } finally {
    await app.locals.queue.stop();
    server.close();
    store.db.close();
  }
});
