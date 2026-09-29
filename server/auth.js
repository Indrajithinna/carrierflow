import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";

export const COOKIE_NAME = "careerflow_session";

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password, hash) {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

export function generateSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(";");
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].trim();
    if (!pair) continue;
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const val = pair.slice(eqIdx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

export function getSessionCookieOptions(env = process.env) {
  const days = Number(env.SESSION_TTL_DAYS) || 7;
  const isProduction = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction,
    maxAge: days * 24 * 60 * 60 * 1000,
  };
}

export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || "user",
    createdAt: user.created_at || user.createdAt,
  };
}

// Rate limiting for auth endpoints (brute force protection)
const failedAttempts = new Map();

export function checkAuthRateLimit(
  key,
  maxAttempts = 10,
  windowMs = 15 * 60 * 1000,
) {
  const now = Date.now();
  const attempts = (failedAttempts.get(key) || []).filter(
    (t) => now - t < windowMs,
  );
  failedAttempts.set(key, attempts);
  return attempts.length < maxAttempts;
}

export function recordFailedAuthAttempt(key) {
  const now = Date.now();
  const attempts = failedAttempts.get(key) || [];
  attempts.push(now);
  failedAttempts.set(key, attempts);
}

export function clearAuthRateLimit(key) {
  failedAttempts.delete(key);
}

export function authMiddleware(store, env = process.env) {
  return async (req, res, next) => {
    req.user = null;
    req.session = null;

    // 1. Check Authorization Bearer header
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const candidate = authHeader.slice(7).trim();
      // Only treat as session token if it is not the companion token
      const extensionToken =
        env.EXTENSION_TOKEN || store.setting("extensionToken");
      if (candidate !== extensionToken) {
        token = candidate;
      }
    }

    // 2. Check HTTP-only cookie
    if (!token && req.headers.cookie) {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies[COOKIE_NAME]) {
        token = cookies[COOKIE_NAME];
      }
    }

    if (!token) {
      return next();
    }

    try {
      const tokenHash = hashSessionToken(token);
      const session = await store.getSessionByTokenHash(tokenHash);

      if (!session) {
        return next();
      }

      // Check expiration
      if (new Date(session.expires_at).getTime() <= Date.now()) {
        await store.deleteSession(session.id);
        res.clearCookie(COOKIE_NAME, getSessionCookieOptions(env));
        return next();
      }

      // Populate user and session
      req.session = session;
      req.user = {
        id: session.user_id,
        email: session.user_email,
        name: session.user_name,
        role: session.user_role || "user",
        createdAt: session.user_created_at,
      };

      // Update last activity periodically
      await store.touchSession(session.id);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAuth(store, env = process.env) {
  return async (req, res, next) => {
    try {
      const userCount = await store.countUsers();
      const isEnforced =
        env.REQUIRE_AUTH === "true" ||
        (env.REQUIRE_AUTH !== "false" && userCount > 0);

      if (!isEnforced) {
        return next();
      }

      if (!req.user) {
        return res
          .status(401)
          .json({ error: "Authentication required. Please sign in." });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res
        .status(403)
        .json({ error: "Forbidden: insufficient permissions." });
    }
    next();
  };
}
