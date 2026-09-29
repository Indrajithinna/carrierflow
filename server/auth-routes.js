import { registerSchema, loginSchema } from "./schema.js";
import {
  hashPassword,
  comparePassword,
  generateSessionToken,
  hashSessionToken,
  getSessionCookieOptions,
  toPublicUser,
  checkAuthRateLimit,
  recordFailedAuthAttempt,
  clearAuthRateLimit,
  COOKIE_NAME,
} from "./auth.js";

export function mountAuthRoutes(app, store, env = process.env) {
  // GET /api/auth/me - Retrieve current authenticated user
  app.get("/api/auth/me", async (req, res, next) => {
    try {
      const userCount = await store.countUsers();
      res.json({
        user: toPublicUser(req.user),
        setupRequired: userCount === 0,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/register - User Registration
  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const ip = req.ip || "local";
      if (!checkAuthRateLimit("reg:" + ip, 15, 15 * 60 * 1000)) {
        return res
          .status(429)
          .json({
            error: "Too many registration attempts. Please try again later.",
          });
      }

      const { name, email, password } = registerSchema.parse(req.body);
      const normalizedEmail = email.toLowerCase().trim();

      const existing = await store.getUserByEmail(normalizedEmail);
      if (existing) {
        return res
          .status(409)
          .json({
            error: "An account with this email address already exists.",
          });
      }

      const passwordHash = await hashPassword(password);
      const count = await store.countUsers();
      const isFirstUser = count === 0;
      const user = await store.createUser({
        name,
        email: normalizedEmail,
        passwordHash,
        role: isFirstUser ? "admin" : "user",
      });

      // Automatically create a session upon successful registration
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const days = Number(env.SESSION_TTL_DAYS) || 7;
      const expiresAt = new Date(
        Date.now() + days * 24 * 60 * 60 * 1000,
      ).toISOString();

      await store.createSession({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      res.cookie(COOKIE_NAME, token, getSessionCookieOptions(env));
      clearAuthRateLimit("reg:" + ip);

      return res.status(201).json({
        user: toPublicUser(user),
        token,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/login - User Login
  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const ip = req.ip || "local";
      const key = "login:" + ip;

      if (!checkAuthRateLimit(key, 10, 15 * 60 * 1000)) {
        return res
          .status(429)
          .json({
            error: "Too many failed login attempts. Please wait 15 minutes.",
          });
      }

      const { email, password } = loginSchema.parse(req.body);
      const normalizedEmail = email.toLowerCase().trim();

      const user = await store.getUserByEmail(normalizedEmail);
      if (!user) {
        recordFailedAuthAttempt(key);
        return res.status(401).json({ error: "Invalid email or password." });
      }

      const valid = await comparePassword(password, user.password_hash);
      if (!valid) {
        recordFailedAuthAttempt(key);
        return res.status(401).json({ error: "Invalid email or password." });
      }

      clearAuthRateLimit(key);

      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const days = Number(env.SESSION_TTL_DAYS) || 7;
      const expiresAt = new Date(
        Date.now() + days * 24 * 60 * 60 * 1000,
      ).toISOString();

      await store.createSession({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      res.cookie(COOKIE_NAME, token, getSessionCookieOptions(env));

      return res.json({
        user: toPublicUser(user),
        token,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/logout - Invalidate Session
  app.post("/api/auth/logout", async (req, res, next) => {
    try {
      if (req.session) {
        await store.deleteSession(req.session.id);
      }
      res.clearCookie(COOKIE_NAME, getSessionCookieOptions(env));
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });
}
