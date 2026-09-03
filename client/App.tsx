import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canSeeDashboard,
  canSeeMyTasks,
  getTab,
  hasFormAccess,
  visibleTabs,
  type FormSettings,
  type Notification,
  type Ticket,
} from '../shared/spec';
import { api, type AppUser } from './api';
import { AccountPanel } from './components/AccountPanel';
import { AdminPanel } from './components/AdminPanel';
import { AuthScreen } from './components/AuthScreen';
import { CalendarView } from './components/CalendarView';
import { Dashboard } from './components/Dashboard';
import { NAV_ICONS, IconBars, IconLogout, IconPlus } from './components/Icons';
import { MyTasks } from './components/MyTasks';
import { NotificationCenter } from './components/NotificationCenter';
import { Notifications } from './components/Notifications';
import { RequestDetail } from './components/RequestDetail';
import { RequestForm } from './components/RequestForm';
import { TabView } from './components/TabView';
import { ThemeToggle } from './components/ThemeToggle';
import { THEME_STORAGE_KEY } from './lib/theme';

const TICKET_POLL_MS = 60_000;
const NOTIFICATION_POLL_MS = 8_000;
const TOAST_TTL_MS = 5_000;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [formSettings, setFormSettings] = useState<FormSettings>({});
  const [view, setView] = useState('dashboard');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formRequest, setFormRequest] = useState<{ area: string; date?: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [toasts, setToasts] = useState<Notification[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Cursor for the toast poll only — the Notification Center itself always
  // loads the full persisted history, so nothing is lost across a reload.
  const toastCursor = useRef(0);

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

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    setNotifLoading(true);
    try {
      const res = await api.notifications();
      setNotifications(res.notifications);
      setUnreadCount(res.unread);
    } catch {
      /* keep whatever was already loaded */
    } finally {
      setNotifLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    toastCursor.current = Date.now();
    void refresh();
    void loadNotifications();
    api
      .formSettings()
      .then((res) => setFormSettings(res.settings))
      .catch(() => setFormSettings({}));
  }, [user, refresh, loadNotifications]);

  /* ------------------------- polling (spec §3.1) ------------------------ */

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => void refresh(), TICKET_POLL_MS);
    return () => clearInterval(timer);
  }, [user, refresh]);

  // Drives both the transient toasts and the Notification Center's live
  // badge/list — a fresh notification lands in both at once.
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(async () => {
      try {
        const res = await api.notificationsSince(toastCursor.current);
        if (res.notifications.length) {
          toastCursor.current = res.notifications[res.notifications.length - 1].createdAt;
          setToasts((prev) => [...prev, ...res.notifications]);
          setNotifications((prev) => [...[...res.notifications].reverse(), ...prev]);
          setUnreadCount((prev) => prev + res.notifications.length);
        }
      } catch {
        /* ignore transient polling errors */
      }
    }, NOTIFICATION_POLL_MS);
    return () => clearInterval(timer);
  }, [user]);

  // Toasts close automatically after 5 seconds (spec §18.3).
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts((prev) => prev.slice(1)), TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  async function markNotificationRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await api.markNotificationRead(id);
    } catch {
      /* the next full load reconciles */
    }
  }

  async function markAllNotificationsRead() {
    const now = Date.now();
    setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnreadCount(0);
    try {
      await api.markAllNotificationsRead();
    } catch {
      /* the next full load reconciles */
    }
  }

  /* ------------------------------ derived ------------------------------ */

  const tabs = useMemo(() => (user ? visibleTabs(user) : []), [user]);
  const selected = useMemo(
    () => tickets.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId],
  );
  const editingTicket = useMemo(
    () => tickets.find((t) => t.id === editingId) ?? null,
    [tickets, editingId],
  );

  useEffect(() => {
    if (!user) return;
    const allowed = [
      ...(canSeeDashboard(user) ? ['dashboard', 'calendar'] : []),
      ...(canSeeMyTasks(user) ? ['my-tasks'] : []),
      ...tabs.map((t) => t.id),
      ...(user.isAdmin ? ['admin'] : []),
    ];
    if (!allowed.includes(view)) setView(allowed[0] ?? 'dashboard');
  }, [user, tabs, view]);

  /* ------------------------------- logout ------------------------------ */

  async function logout() {
    setSigningOut(true);
    try {
      await api.logout();
    } catch {
      /* the cookie is cleared regardless */
    }
    // The response's Clear-Site-Data: "storage" already drops cookies,
    // IndexedDB and Cache Storage; these two are synchronous belt-and-braces.
    // The theme choice is UI preference, not user data — carry it across.
    try {
      const theme = window.localStorage.getItem(THEME_STORAGE_KEY);
      window.localStorage.clear();
      window.sessionStorage.clear();
      if (theme) window.localStorage.setItem(THEME_STORAGE_KEY, theme);
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
  const viewLabel =
    activeTab?.name ??
    (view === 'dashboard'
      ? 'Dashboard'
      : view === 'calendar'
        ? 'Calendar'
        : view === 'my-tasks'
          ? 'My Tasks'
          : 'Admin panel');

  const navItem = (id: string, label: string) => (
    <NavItem
      key={id}
      id={id}
      label={label}
      view={view}
      onSelect={setView}
      onClose={() => setMenuOpen(false)}
    />
  );

  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">GD</span>
          <div className="brand-text">
            <strong>Growth Department</strong>
            <span>Campaign Requests</span>
          </div>
        </div>

        <nav>
          {canSeeDashboard(user) && navItem('dashboard', 'Dashboard')}
          {canSeeDashboard(user) && navItem('calendar', 'Calendar')}
          {canSeeMyTasks(user) && navItem('my-tasks', 'My Tasks')}

          {tabs.length > 0 && <div className="nav-heading">Requests</div>}
          {tabs.map((tab) => navItem(tab.id, tab.name))}

          {user.isAdmin && (
            <>
              <div className="nav-heading">Administration</div>
              {navItem('admin', 'Admin panel')}
            </>
          )}
        </nav>

        <div className="sidebar-foot">
          <button className="user-card" onClick={() => setShowAccount(true)}>
            <span className="avatar">{initials(user.name)}</span>
            <span className="user-card-text">
              <strong>{user.name}</strong>
              <span>{user.isAdmin ? 'Administrator' : (user.roleName ?? 'No role')}</span>
            </span>
          </button>
          <button className="btn btn-ghost full" onClick={logout} disabled={signingOut}>
            <IconLogout size={17} />
            {signingOut ? 'Signing out…' : 'Log out'}
          </button>
        </div>
      </aside>

      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <IconBars />
          </button>
          <span className="topbar-crumb">Growth Department</span>
          <span className="topbar-crumb" aria-hidden="true">
            /
          </span>
          <span className="topbar-title">{viewLabel}</span>
          <span className="topbar-spacer" />
          <NotificationCenter
            notifications={notifications}
            unread={unreadCount}
            tickets={tickets}
            loading={notifLoading}
            onOpen={() => void loadNotifications()}
            onMarkRead={(id) => void markNotificationRead(id)}
            onMarkAllRead={() => void markAllNotificationsRead()}
            onOpenTicket={(ticketId) => setSelectedId(ticketId)}
          />
          <ThemeToggle />
        </header>

        <Notifications
          events={toasts}
          onDismiss={(id) => setToasts((prev) => prev.filter((e) => e.id !== id))}
        />

        {view === 'dashboard' && canSeeDashboard(user) && (
          <Dashboard user={user} tickets={tickets} />
        )}

        {view === 'calendar' && canSeeDashboard(user) && (
          <CalendarView user={user} tickets={tickets} onOpen={(t) => setSelectedId(t.id)} />
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
            onNew={(date) => setFormRequest({ area: activeTab.id, date })}
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
      </div>

      {canCreateHere && (
        <button
          className="fab"
          onClick={() => setFormRequest({ area: activeTab!.id })}
          aria-label="New request"
        >
          <IconPlus size={24} />
        </button>
      )}

      {formRequest && getTab(formRequest.area) && (
        <RequestForm
          user={user}
          tab={getTab(formRequest.area)!}
          formSettings={formSettings}
          initialDate={formRequest.date}
          onClose={() => setFormRequest(null)}
          onSaved={() => {
            setFormRequest(null);
            void refresh();
          }}
        />
      )}

      {editingTicket && getTab(editingTicket.area) && (
        <RequestForm
          user={user}
          tab={getTab(editingTicket.area)!}
          formSettings={formSettings}
          ticket={editingTicket}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
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
          onEdit={() => {
            setEditingId(selected.id);
            setSelectedId(null);
          }}
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
  const Icon = NAV_ICONS[id];
  return (
    <button
      className={`nav-item ${view === id ? 'active' : ''}`}
      onClick={() => {
        onSelect(id);
        onClose();
      }}
    >
      {Icon && <Icon size={19} />}
      {label}
    </button>
  );
}
