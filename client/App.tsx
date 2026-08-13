import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canSeeDashboard,
  canSeeMyTasks,
  getTab,
  hasFormAccess,
  visibleTabs,
  type ActivityEvent,
  type FormSettings,
  type Ticket,
} from '../shared/spec';
import { api, type AppUser } from './api';
import { AccountPanel } from './components/AccountPanel';
import { AdminPanel } from './components/AdminPanel';
import { AuthScreen } from './components/AuthScreen';
import { Dashboard } from './components/Dashboard';
import { MyTasks } from './components/MyTasks';
import { Notifications } from './components/Notifications';
import { RequestDetail } from './components/RequestDetail';
import { RequestForm } from './components/RequestForm';
import { TabView } from './components/TabView';

const TICKET_POLL_MS = 60_000;
const EVENT_POLL_MS = 8_000;
const TOAST_TTL_MS = 5_000;

export function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [formSettings, setFormSettings] = useState<FormSettings>({});
  const [view, setView] = useState('dashboard');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formArea, setFormArea] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [toasts, setToasts] = useState<ActivityEvent[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const lastEventTs = useRef(0);

  /* ------------------------------- boot -------------------------------- */

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.tickets();
      setTickets(res.tickets);
    } catch {
      /* the next poll retries */
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    lastEventTs.current = Date.now();
    void refresh();
    api
      .formSettings()
      .then((res) => setFormSettings(res.settings))
      .catch(() => setFormSettings({}));
  }, [user, refresh]);

  /* ------------------------- polling (spec §3.1) ------------------------ */

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => void refresh(), TICKET_POLL_MS);
    return () => clearInterval(timer);
  }, [user, refresh]);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(async () => {
      try {
        const res = await api.events(lastEventTs.current);
        if (res.events.length) {
          lastEventTs.current = res.events[res.events.length - 1].createdAt;
          setToasts((prev) => [...prev, ...res.events]);
        }
      } catch {
        /* ignore transient polling errors */
      }
    }, EVENT_POLL_MS);
    return () => clearInterval(timer);
  }, [user]);

  // Toasts close automatically after 5 seconds (spec §18.3).
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts((prev) => prev.slice(1)), TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  /* ------------------------------ derived ------------------------------ */

  const tabs = useMemo(() => (user ? visibleTabs(user) : []), [user]);
  const selected = useMemo(
    () => tickets.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId],
  );

  useEffect(() => {
    if (!user) return;
    const allowed = [
      ...(canSeeDashboard(user) ? ['dashboard'] : []),
      ...(canSeeMyTasks(user) ? ['my-tasks'] : []),
      ...tabs.map((t) => t.id),
      ...(user.isAdmin ? ['admin'] : []),
    ];
    if (!allowed.includes(view)) setView(allowed[0] ?? 'dashboard');
  }, [user, tabs, view]);

  /* ------------------------------- logout ------------------------------ */

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* the cookie is cleared regardless */
    }
    try {
      if (window.caches) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      }
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* storage may be unavailable in private mode */
    }
    window.location.reload();
  }

  if (booting) {
    return <div className="boot">Loading…</div>;
  }

  if (!user) {
    return <AuthScreen onSignedIn={setUser} />;
  }

  const activeTab = getTab(view);
  const canCreateHere = Boolean(activeTab) && hasFormAccess(user);

  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <strong>Growth Department</strong>
          <span className="muted small">Campaign Requests</span>
        </div>

        <nav>
          {canSeeDashboard(user) && (
            <NavItem id="dashboard" label="Dashboard" view={view} onSelect={setView} onClose={() => setMenuOpen(false)} />
          )}
          {canSeeMyTasks(user) && (
            <NavItem id="my-tasks" label="My Tasks" view={view} onSelect={setView} onClose={() => setMenuOpen(false)} />
          )}
          {tabs.length > 0 && <div className="nav-heading">Requests</div>}
          {tabs.map((tab) => (
            <NavItem
              key={tab.id}
              id={tab.id}
              label={tab.name}
              view={view}
              onSelect={setView}
              onClose={() => setMenuOpen(false)}
            />
          ))}
          {user.isAdmin && (
            <>
              <div className="nav-heading">Administration</div>
              <NavItem id="admin" label="Admin panel" view={view} onSelect={setView} onClose={() => setMenuOpen(false)} />
            </>
          )}
        </nav>

        <div className="sidebar-foot">
          <button className="linklike" onClick={() => setShowAccount(true)}>
            {user.name}
          </button>
          <span className="muted small">{user.email}</span>
          <span className="muted small">{user.isAdmin ? 'Administrator' : (user.roleName ?? 'No role')}</span>
          <button className="btn btn-ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="main">
        <button className="menu-toggle" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
          ☰
        </button>

        <Notifications
          events={toasts}
          onDismiss={(id) => setToasts((prev) => prev.filter((e) => e.id !== id))}
        />

        {view === 'dashboard' && canSeeDashboard(user) && (
          <Dashboard user={user} tickets={tickets} />
        )}

        {view === 'my-tasks' && canSeeMyTasks(user) && (
          <MyTasks user={user} tickets={tickets} onOpen={(t) => setSelectedId(t.id)} />
        )}

        {activeTab && (
          <TabView
            user={user}
            tab={activeTab}
            tickets={tickets}
            onOpen={(t) => setSelectedId(t.id)}
            onNew={() => setFormArea(activeTab.id)}
          />
        )}

        {view === 'admin' && user.isAdmin && (
          <AdminPanel
            user={user}
            tickets={tickets}
            formSettings={formSettings}
            onOpen={(t) => setSelectedId(t.id)}
            onRefresh={() => void refresh()}
            onFormSettings={setFormSettings}
          />
        )}
      </main>

      {canCreateHere && (
        <button
          className="fab"
          onClick={() => setFormArea(activeTab!.id)}
          aria-label="New request"
        >
          +
        </button>
      )}

      {formArea && getTab(formArea) && (
        <RequestForm
          user={user}
          tab={getTab(formArea)!}
          formSettings={formSettings}
          onClose={() => setFormArea(null)}
          onCreated={() => {
            setFormArea(null);
            void refresh();
          }}
        />
      )}

      {selected && (
        <RequestDetail
          user={user}
          ticket={selected}
          onClose={() => setSelectedId(null)}
          onChanged={() => void refresh()}
        />
      )}

      {showAccount && (
        <AccountPanel user={user} onClose={() => setShowAccount(false)} onUpdated={setUser} />
      )}
    </div>
  );
}

function NavItem({
  id,
  label,
  view,
  onSelect,
  onClose,
}: {
  id: string;
  label: string;
  view: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <button
      className={`nav-item ${view === id ? 'active' : ''}`}
      onClick={() => {
        onSelect(id);
        onClose();
      }}
    >
      {label}
    </button>
  );
}
