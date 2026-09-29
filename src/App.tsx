import { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard,
  Compass,
  BriefcaseBusiness,
  Files,
  CalendarDays,
  Zap,
  UserRound,
  Settings as SettingsIcon,
  Search,
  Menu,
  X,
  Bell,
  ChevronRight,
  LoaderCircle,
  AlertCircle,
  CheckCircle2,
  LogOut,
} from "lucide-react";
import { api } from "./api";
import {
  type State,
  type Artifact,
  type Execute,
  type User,
  active,
} from "./types";
import { Button, IconButton, Modal, Brand, initials, dateTime } from "./ui";
import { Overview, Prep, Settings } from "./Workspace";
import { Discovery } from "./Discovery";
import { Applications, ApplicationDetail } from "./Applications";
import { Documents, ArtifactDialog } from "./Documents";
import { Profile } from "./Profile";
import { Autopilot } from "./Autopilot";
import { Auth } from "./Auth";
type Page =
  | "overview"
  | "discover"
  | "applications"
  | "documents"
  | "prep"
  | "profile"
  | "settings"
  | "autopilot";
const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "discover", label: "Discover jobs", icon: Compass },
  { id: "applications", label: "My applications", icon: BriefcaseBusiness },
  { id: "documents", label: "Documents", icon: Files },
  { id: "prep", label: "Interview prep", icon: CalendarDays },
  { id: "autopilot", label: "Autopilot", icon: Zap },
  { id: "profile", label: "My profile", icon: UserRound },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;
function currentRoute() {
  const p = new URLSearchParams(location.search);
  const page = p.get("page");
  return {
    page: navigation.some((n) => n.id === page)
      ? (page as Page)
      : ("overview" as Page),
    application: p.get("application"),
  };
}
export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null),
    [authChecked, setAuthChecked] = useState(false),
    [setupRequired, setSetupRequired] = useState(false),
    [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [route, setRoute] = useState(currentRoute),
    [mobile, setMobile] = useState(false),
    [quickSearch, setQuickSearch] = useState(false),
    [search, setSearch] = useState(""),
    [activity, setActivity] = useState(false),
    [artifact, setArtifact] = useState<Artifact | null>(null),
    [working, setWorking] = useState(0),
    [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
      null,
    );

  const checkAuth = useCallback(async () => {
    try {
      const res = await api<{ user: User | null; setupRequired?: boolean }>(
        "/auth/me",
      );
      setCurrentUser(res.user);
      setSetupRequired(!!res.setupRequired);
      return res.user;
    } catch {
      setCurrentUser(null);
      return null;
    } finally {
      setAuthChecked(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api<State>("/bootstrap");
      setState(data);
      setError("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "The request failed.";
      if (msg.includes("Authentication required")) {
        setCurrentUser(null);
      }
      setError(msg);
    }
  }, []);

  const handleLogout = async () => {
    try {
      await api("/auth/logout", "POST");
    } catch {
      // ignore
    }
    setCurrentUser(null);
    setState(null);
  };

  useEffect(() => {
    void checkAuth().then((u) => {
      if (u) void refresh();
    });
  }, [checkAuth, refresh]);

  useEffect(() => {
    if (!currentUser) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, 6000);
    return () => clearInterval(timer);
  }, [currentUser, refresh]);
  useEffect(() => {
    const pop = () => {
      setRoute(currentRoute());
      setMobile(false);
    };
    const keys = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !target.closest("input,textarea,select,[contenteditable=true]") &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        setQuickSearch(true);
      }
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("keydown", keys);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);
  const execute: Execute = async (work, message) => {
    setWorking((n) => n + 1);
    try {
      const result = await work();
      await refresh();
      if (message) setToast({ text: message });
      return result;
    } catch (e) {
      setToast({
        text: e instanceof Error ? e.message : "The operation failed.",
        error: true,
      });
      return undefined;
    } finally {
      setWorking((n) => n - 1);
    }
  };
  const navigate = (page: Page, application: string | null = null) => {
    const params = new URLSearchParams();
    if (page !== "overview") params.set("page", page);
    if (application) params.set("application", application);
    history.pushState({}, "", params.size ? "/?" + params : "/");
    setRoute({ page, application });
    setMobile(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const open = (id: string) => navigate("applications", id);
  const nav = (
    <nav aria-label="Workspace">
      {navigation.map((n) => (
        <button
          key={n.id}
          className={route.page === n.id ? "active" : ""}
          aria-current={route.page === n.id ? "page" : undefined}
          onClick={() => navigate(n.id)}
        >
          <n.icon size={19} />
          <span>{n.label}</span>
          {n.id === "applications" && state && (
            <span className="nav-count">
              {state.applications.filter(active).length}
            </span>
          )}
          {n.id === "autopilot" && state?.automation.enabled && (
            <span className="live-dot" />
          )}
        </button>
      ))}
    </nav>
  );
  if (!authChecked)
    return (
      <div className="boot">
        <Brand />
        <LoaderCircle className="spin" />
        <p>Connecting to Careerflow…</p>
      </div>
    );

  if (!currentUser)
    return (
      <Auth
        onAuthenticated={(user) => {
          setCurrentUser(user);
          void refresh();
        }}
        initialSetup={setupRequired}
      />
    );

  if (!state)
    return (
      <div className="boot">
        <Brand />
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button
              onClick={() => void refresh().catch((e) => setError(e.message))}
            >
              Retry
            </Button>
            <Button
              variant="ghost"
              onClick={handleLogout}
              style={{ marginTop: "0.5rem" }}
            >
              Sign out
            </Button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>Opening your workspace…</p>
          </>
        )}
      </div>
    );
  return (
    <div className="app-shell v2">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <aside className="sidebar">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <Brand />
        </a>
        <div className="workspace-switch">
          <span className="workspace-initial">P</span>
          <span>
            Personal workspace<small>INDEPENDENT. LOCAL. YOURS.</small>
          </span>
        </div>
        {nav}
        <div className="sidebar-bottom">
          <div className="momentum-card">
            <span className="momentum-icon">
              <Zap size={18} />
            </span>
            <strong>A little progress, on autopilot.</strong>
            <p>
              Thoughtful applications. Clear limits. A record of every step.
            </p>
            <button onClick={() => navigate("autopilot")}>
              Open Autopilot
              <ChevronRight size={15} />
            </button>
          </div>
          <button
            className="profile-switch"
            onClick={() => navigate("profile")}
          >
            <span className="avatar">
              {initials(currentUser.name || state.profile.full_name)}
            </span>
            <span>
              <strong>
                {currentUser.name || state.profile.full_name || "Your profile"}
              </strong>
              <small>{currentUser.email}</small>
            </span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="mobile-menu">
              <IconButton
                label="Open navigation"
                onClick={() => setMobile(true)}
              >
                <Menu size={22} />
              </IconButton>
            </span>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {navigation.find((n) => n.id === route.page)?.label}
            </strong>
          </div>
          <div className="topbar-actions">
            <button
              className="quick-search"
              onClick={() => setQuickSearch(true)}
              aria-label="Quick search"
            >
              <Search size={17} />
              <span>Quick search</span>
              <kbd>/</kbd>
            </button>
            <IconButton
              label="Activity and notifications"
              onClick={() => setActivity(true)}
            >
              <Bell size={19} />
            </IconButton>
            <button
              className="avatar small"
              aria-label="Open profile"
              title={`${currentUser.name} (${currentUser.email})`}
              onClick={() => navigate("profile")}
            >
              {initials(currentUser.name || state.profile.full_name)}
            </button>
            <IconButton
              label={`Sign out (${currentUser.email})`}
              onClick={handleLogout}
            >
              <LogOut size={18} />
            </IconButton>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {state.sample && (
            <div className="sample-banner">
              <span>
                <span className="tiny-pill">SAMPLE</span>Fictional workspace. No
                applications or emails are sent from sample data.
              </span>
              <button onClick={() => navigate("settings")}>
                Make it yours
                <ChevronRight size={14} />
              </button>
            </div>
          )}
          {route.page === "overview" && (
            <Overview
              state={state}
              open={open}
              discover={() => navigate("discover")}
              autopilot={() => navigate("autopilot")}
            />
          )}
          {route.page === "discover" && (
            <Discovery state={state} execute={execute} open={open} />
          )}
          {route.page === "applications" && (
            <Applications
              state={state}
              execute={execute}
              open={open}
              discover={() => navigate("discover")}
            />
          )}
          {route.page === "documents" && (
            <Documents state={state} open={setArtifact} />
          )}
          {route.page === "prep" && (
            <Prep
              state={state}
              execute={execute}
              open={open}
              openArtifact={setArtifact}
            />
          )}
          {route.page === "autopilot" && (
            <Autopilot state={state} execute={execute} open={open} />
          )}
          {route.page === "profile" && (
            <Profile
              value={state.profile}
              execute={execute}
              refresh={refresh}
            />
          )}
          {route.page === "settings" && (
            <Settings state={state} execute={execute} />
          )}
          <footer className="page-footer">
            <span>Careerflow · Your next chapter, organized.</span>
            <span>Local workspace · v2</span>
          </footer>
        </main>
      </div>
      {mobile && (
        <Modal title="Navigation" onClose={() => setMobile(false)}>
          <div className="mobile-navigation">{nav}</div>
        </Modal>
      )}
      {route.application && (
        <ApplicationDetail
          key={route.application}
          state={state}
          id={route.application}
          execute={execute}
          onClose={() => navigate(route.page)}
          openArtifact={setArtifact}
        />
      )}
      {artifact && (
        <ArtifactDialog
          initial={artifact}
          state={state}
          execute={execute}
          onClose={() => setArtifact(null)}
          onChange={setArtifact}
        />
      )}
      {quickSearch && (
        <Modal
          title="Search your workspace"
          onClose={() => {
            setQuickSearch(false);
            setSearch("");
          }}
        >
          <div className="modal-body">
            <input
              autoFocus
              className="wide-input"
              aria-label="Search workspace"
              placeholder="Find a role or company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {state.jobs
              .filter((j) =>
                search
                  .toLowerCase()
                  .split(/\s+/)
                  .every((t) =>
                    (j.title + " " + j.company).toLowerCase().includes(t),
                  ),
              )
              .slice(0, 10)
              .map((j) => (
                <button
                  key={j.id}
                  className="artifact-row"
                  onClick={async () => {
                    let a = state.applications.find((a) => a.jobId === j.id);
                    if (!a)
                      a = await execute(() =>
                        api("/applications", "POST", { jobId: j.id }),
                      );
                    if (a) {
                      setQuickSearch(false);
                      setSearch("");
                      open(a.id);
                    }
                  }}
                >
                  <span>
                    <strong>{j.title}</strong>
                    <small>{j.company}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
          </div>
        </Modal>
      )}
      {activity && (
        <Modal
          title="Activity and notifications"
          onClose={() => setActivity(false)}
        >
          <div className="modal-body">
            {state.notifications.map((n) => (
              <button
                key={n.id}
                className="artifact-row"
                onClick={() => {
                  setActivity(false);
                  open(n.applicationId);
                }}
              >
                <span>
                  <strong>{n.title}</strong>
                  <small>{dateTime(n.dueAt)}</small>
                </span>
              </button>
            ))}
            {state.events.map((e) => (
              <div className="activity-row" key={e.id}>
                <div>
                  <strong>{e.title}</strong>
                  <p>{e.detail}</p>
                  <small>{dateTime(e.createdAt)}</small>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={"toast " + (toast.error ? "error" : "")}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
          <p>{toast.text}</p>
          <IconButton label="Dismiss message" onClick={() => setToast(null)}>
            <X size={17} />
          </IconButton>
        </div>
      )}
      {working > 0 && (
        <div className="working-indicator" role="status">
          <LoaderCircle className="spin" size={16} />
          Working…
        </div>
      )}
    </div>
  );
}
