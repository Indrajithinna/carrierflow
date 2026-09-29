import { useState, type FormEvent } from "react";
import {
  Sparkles,
  Lock,
  Mail,
  User as UserIcon,
  Eye,
  EyeOff,
  AlertCircle,
  LoaderCircle,
  ArrowRight,
  ShieldCheck,
  Check,
} from "lucide-react";
import { api } from "./api";
import { type User, type AuthState } from "./types";
import { Brand, Button } from "./ui";

type Mode = "login" | "register";

export function Auth({
  onAuthenticated,
  initialSetup = false,
}: {
  onAuthenticated: (user: User) => void;
  initialSetup?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(initialSetup ? "register" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      errs.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errs.email = "Please enter a valid email address.";
    }

    if (!password) {
      errs.password = "Password is required.";
    } else if (mode === "register") {
      if (password.length < 8) {
        errs.password = "Password must be at least 8 characters long.";
      } else if (!/[a-zA-Z]/.test(password)) {
        errs.password = "Password must include at least one letter.";
      } else if (!/[0-9]/.test(password)) {
        errs.password = "Password must include at least one number.";
      }
    }

    if (mode === "register") {
      if (!name.trim()) {
        errs.name = "Name is required.";
      } else if (name.trim().length < 2) {
        errs.name = "Name must be at least 2 characters.";
      }

      if (!confirmPassword) {
        errs.confirmPassword = "Confirm your password.";
      } else if (password !== confirmPassword) {
        errs.confirmPassword = "Passwords do not match.";
      }
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validate()) return;

    setLoading(true);
    try {
      if (mode === "register") {
        const res = await api<{ user: User }>("/auth/register", "POST", {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          confirmPassword,
        });
        onAuthenticated(res.user);
      } else {
        const res = await api<{ user: User }>("/auth/login", "POST", {
          email: email.trim().toLowerCase(),
          password,
        });
        onAuthenticated(res.user);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-brand-wrapper">
            <Brand />
          </div>
          <p className="auth-subtitle">
            {mode === "login"
              ? "Welcome back. Sign in to your career workspace."
              : "Create an account to start tracking, tailoring, and advancing your career."}
          </p>

          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={"auth-tab " + (mode === "login" ? "active" : "")}
              onClick={() => {
                setMode("login");
                setError("");
                setFieldErrors({});
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              className={"auth-tab " + (mode === "register" ? "active" : "")}
              onClick={() => {
                setMode("register");
                setError("");
                setFieldErrors({});
              }}
            >
              Create Account
            </button>
          </div>
        </div>

        {error && (
          <div className="auth-alert" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {mode === "register" && (
            <div className="auth-field-group">
              <label htmlFor="auth-name">Full Name</label>
              <div className="auth-input-wrapper">
                <UserIcon className="auth-input-icon" size={17} />
                <input
                  id="auth-name"
                  type="text"
                  placeholder="e.g. Alex Morgan"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (fieldErrors.name)
                      setFieldErrors((prev) => ({ ...prev, name: "" }));
                  }}
                  disabled={loading}
                  autoComplete="name"
                  required
                />
              </div>
              {fieldErrors.name && (
                <small className="auth-field-error">{fieldErrors.name}</small>
              )}
            </div>
          )}

          <div className="auth-field-group">
            <label htmlFor="auth-email">Email Address</label>
            <div className="auth-input-wrapper">
              <Mail className="auth-input-icon" size={17} />
              <input
                id="auth-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email)
                    setFieldErrors((prev) => ({ ...prev, email: "" }));
                }}
                disabled={loading}
                autoComplete="email"
                required
              />
            </div>
            {fieldErrors.email && (
              <small className="auth-field-error">{fieldErrors.email}</small>
            )}
          </div>

          <div className="auth-field-group">
            <label htmlFor="auth-password">Password</label>
            <div className="auth-input-wrapper">
              <Lock className="auth-input-icon" size={17} />
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                placeholder={
                  mode === "register"
                    ? "Minimum 8 characters (letters & numbers)"
                    : "Enter your password"
                }
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password)
                    setFieldErrors((prev) => ({ ...prev, password: "" }));
                }}
                disabled={loading}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                tabIndex={-1}
                title={showPassword ? "Hide password" : "Show password"}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {fieldErrors.password && (
              <small className="auth-field-error">{fieldErrors.password}</small>
            )}
          </div>

          {mode === "register" && (
            <div className="auth-field-group">
              <label htmlFor="auth-confirm-password">Confirm Password</label>
              <div className="auth-input-wrapper">
                <Lock className="auth-input-icon" size={17} />
                <input
                  id="auth-confirm-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (fieldErrors.confirmPassword)
                      setFieldErrors((prev) => ({
                        ...prev,
                        confirmPassword: "",
                      }));
                  }}
                  disabled={loading}
                  autoComplete="new-password"
                  required
                />
              </div>
              {fieldErrors.confirmPassword && (
                <small className="auth-field-error">
                  {fieldErrors.confirmPassword}
                </small>
              )}
            </div>
          )}

          <div className="auth-actions">
            <button
              type="submit"
              className="button primary auth-submit-btn"
              disabled={loading}
            >
              {loading ? (
                <>
                  <LoaderCircle className="spin" size={18} />
                  <span>
                    {mode === "register"
                      ? "Creating Account..."
                      : "Signing In..."}
                  </span>
                </>
              ) : (
                <>
                  <span>
                    {mode === "register" ? "Create Account" : "Sign In"}
                  </span>
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </div>
        </form>

        <div className="auth-footer">
          <div className="auth-security-badge">
            <ShieldCheck size={16} className="auth-security-icon" />
            <span>Secure password hashing & local encrypted session</span>
          </div>
        </div>
      </div>
    </div>
  );
}
