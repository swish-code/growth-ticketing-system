import { useEffect, useMemo, useState } from 'react';
import {
  ADMIN_ROLE_ID,
  BRANDS,
  TABS,
  emptyPermissions,
  fieldSetting,
  tabName,
  type AreaFormSettings,
  type FormSettings,
  type Role,
  type RolePermissions,
  type StaffMember,
  type TabAccess,
  type Ticket,
} from '../../shared/spec';
import { ApiError, api, type AppUser } from '../api';
import { formatDateTime, statusClass } from '../lib/format';

type Section = 'staff' | 'roles' | 'submissions' | 'forms' | 'workflow';

interface Props {
  user: AppUser;
  tickets: Ticket[];
  formSettings: FormSettings;
  onOpen: (ticket: Ticket) => void;
  onRefresh: () => void;
  onFormSettings: (settings: FormSettings) => void;
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'staff', label: 'Staff access' },
  { id: 'roles', label: 'Roles' },
  { id: 'submissions', label: 'Submissions' },
  { id: 'forms', label: 'Form builder' },
  { id: 'workflow', label: 'Workflow' },
];

export function AdminPanel(props: Props) {
  const [section, setSection] = useState<Section>('staff');

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Admin panel</h1>
          <p className="muted">Staff, roles, submissions, forms and workflow configuration.</p>
        </div>
      </header>

      <nav className="subnav">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            className={`subnav-item ${section === item.id ? 'active' : ''}`}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {section === 'staff' && <StaffSection />}
      {section === 'roles' && <RolesSection />}
      {section === 'submissions' && (
        <SubmissionsSection tickets={props.tickets} onOpen={props.onOpen} />
      )}
      {section === 'forms' && (
        <FormBuilderSection settings={props.formSettings} onSaved={props.onFormSettings} />
      )}
      {section === 'workflow' && <WorkflowSection />}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Staff access (spec §20.1)                                           */
/* ------------------------------------------------------------------ */

function StaffSection() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<(Role & { protected: boolean })[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  async function load() {
    try {
      const [staffRes, rolesRes] = await Promise.all([api.staff(), api.roles()]);
      setStaff(staffRes.staff);
      setRoles(rolesRes.roles);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load staff.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    }
  }

  const roleName = (id: string | null) =>
    id === ADMIN_ROLE_ID ? 'Admin' : (roles.find((r) => r.id === id)?.name ?? '—');

  return (
    <>
      <div className="panel">
        <h2>Add staff</h2>
        <div className="inline-form">
          <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="name@swishhh.net"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={isAdmin}>
            <option value="">Select role…</option>
            {roles
              .filter((r) => r.id !== ADMIN_ROLE_ID)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
          <label className="checkline">
            <input
              type="checkbox"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.target.checked)}
            />
            Administrator
          </label>
          <button
            className="btn btn-primary"
            onClick={() =>
              act(async () => {
                await api.saveStaff({
                  op: 'create',
                  email,
                  name,
                  roleId: roleId || null,
                  isAdmin,
                });
                setName('');
                setEmail('');
                setRoleId('');
                setIsAdmin(false);
              })
            }
          >
            Add staff
          </button>
        </div>
        <p className="muted small">
          The staff member then signs in with <strong>Log in</strong>, and the password they type on
          that first login becomes their password.
        </p>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Admin</th>
              <th>Password</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => {
              const owner = member.email === 'phelo@swishhh.net';
              return (
                <tr key={member.email}>
                  <td>
                    {member.name}
                    {owner && <span className="badge badge-owner">Owner</span>}
                  </td>
                  <td>{member.email}</td>
                  <td>
                    <select
                      value={member.roleId ?? ''}
                      disabled={owner || member.isAdmin}
                      onChange={(e) =>
                        act(() =>
                          api.saveStaff({
                            op: 'update',
                            email: member.email,
                            name: member.name,
                            roleId: e.target.value || null,
                            isAdmin: member.isAdmin,
                          }),
                        )
                      }
                    >
                      <option value="">No role</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <div className="muted small">{roleName(member.roleId)}</div>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={member.isAdmin}
                      disabled={owner}
                      onChange={(e) =>
                        act(() =>
                          api.saveStaff({
                            op: 'update',
                            email: member.email,
                            name: member.name,
                            roleId: member.roleId,
                            isAdmin: e.target.checked,
                          }),
                        )
                      }
                    />
                  </td>
                  <td className="muted small">
                    {member.mustSetPassword ? 'Set on next login' : 'Set'}
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost small-btn"
                      disabled={owner}
                      onClick={() => act(() => api.saveStaff({ op: 'reset', email: member.email }))}
                    >
                      Reset password
                    </button>
                    <button
                      className="btn btn-ghost small-btn"
                      disabled={owner}
                      onClick={() => {
                        if (window.confirm(`Delete ${member.email}?`)) {
                          void act(() => api.deleteStaff(member.email));
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Roles (spec §20.2)                                                  */
/* ------------------------------------------------------------------ */

function RolesSection() {
  const [roles, setRoles] = useState<(Role & { protected: boolean })[]>([]);
  const [editing, setEditing] = useState<{ id?: string; name: string; permissions: RolePermissions } | null>(
    null,
  );
  const [error, setError] = useState('');

  async function load() {
    try {
      setRoles((await api.roles()).roles);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load roles.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function setTab(area: string, access: TabAccess) {
    setEditing((prev) =>
      prev ? { ...prev, permissions: { ...prev.permissions, tabs: { ...prev.permissions.tabs, [area]: access } } } : prev,
    );
  }

  function toggleBrand(brand: string) {
    setEditing((prev) => {
      if (!prev) return prev;
      const brands = prev.permissions.brands.includes(brand)
        ? prev.permissions.brands.filter((b) => b !== brand)
        : [...prev.permissions.brands, brand];
      return { ...prev, permissions: { ...prev.permissions, brands } };
    });
  }

  async function save() {
    if (!editing) return;
    setError('');
    try {
      await api.saveRole({ id: editing.id, name: editing.name, permissions: editing.permissions });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the role.');
    }
  }

  return (
    <>
      <div className="panel">
        <div className="head-actions">
          <button
            className="btn btn-primary"
            onClick={() => setEditing({ name: '', permissions: emptyPermissions() })}
          >
            New role
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      {editing && (
        <div className="panel">
          <h2>{editing.id ? 'Edit role' : 'Create role'}</h2>
          <div className="field">
            <label htmlFor="role-name">Role name</label>
            <input
              id="role-name"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </div>

          <h3 className="section-title">Tab access</h3>
          <table className="mini-table">
            <tbody>
              {TABS.map((tab) => (
                <tr key={tab.id}>
                  <td>{tab.name}</td>
                  <td className="right">
                    <select
                      value={editing.permissions.tabs[tab.id] ?? 'none'}
                      onChange={(e) => setTab(tab.id, e.target.value as TabAccess)}
                    >
                      <option value="none">None</option>
                      <option value="view">View</option>
                      <option value="manage">Manage</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="section-title">Brand access</h3>
          <p className="muted small">Selecting no brand grants access to all brands.</p>
          <div className="tiles">
            {BRANDS.map((brand) => {
              const on = editing.permissions.brands.includes(brand);
              return (
                <button
                  type="button"
                  key={brand}
                  className={`tile ${on ? 'tile-on' : ''}`}
                  onClick={() => toggleBrand(brand)}
                >
                  <span className="tile-box">{on ? '✓' : ''}</span>
                  {brand}
                </button>
              );
            })}
          </div>

          <h3 className="section-title">Access switches</h3>
          <label className="checkline">
            <input
              type="checkbox"
              checked={editing.permissions.forms}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  permissions: { ...editing.permissions, forms: e.target.checked },
                })
              }
            />
            Form access — can create requests
          </label>
          <label className="checkline">
            <input
              type="checkbox"
              checked={editing.permissions.submissions}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  permissions: { ...editing.permissions, submissions: e.target.checked },
                })
              }
            />
            Submission access — can see existing requests
          </label>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save}>
              Save role
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Tabs</th>
              <th>Brands</th>
              <th>Form</th>
              <th>Submissions</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>
                  {role.name}
                  {role.protected && <span className="badge badge-owner">Protected</span>}
                </td>
                <td className="small">
                  {TABS.filter((t) => role.permissions.tabs[t.id] !== 'none')
                    .map((t) => `${t.name} (${role.permissions.tabs[t.id]})`)
                    .join(', ') || 'None'}
                </td>
                <td className="small">
                  {role.permissions.brands.length ? role.permissions.brands.join(', ') : 'All brands'}
                </td>
                <td>{role.permissions.forms ? 'Yes' : 'No'}</td>
                <td>{role.permissions.submissions ? 'Yes' : 'No'}</td>
                <td>
                  <button
                    className="btn btn-ghost small-btn"
                    disabled={role.protected}
                    onClick={() =>
                      setEditing({ id: role.id, name: role.name, permissions: role.permissions })
                    }
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-ghost small-btn"
                    disabled={role.protected}
                    onClick={async () => {
                      if (!window.confirm(`Delete role "${role.name}"?`)) return;
                      await api.deleteRole(role.id);
                      await load();
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Submissions (spec §20.3)                                            */
/* ------------------------------------------------------------------ */

function SubmissionsSection({
  tickets,
  onOpen,
}: {
  tickets: Ticket[];
  onOpen: (ticket: Ticket) => void;
}) {
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (area && ticket.area !== area) return false;
      if (term && !`${ticket.id} ${ticket.title} ${ticket.requesterEmail}`.toLowerCase().includes(term))
        return false;
      return true;
    });
  }, [tickets, search, area]);

  return (
    <>
      <div className="filters">
        <input
          placeholder="Search by ID, title or requester"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">All tabs</option>
          {TABS.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.name}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Tab</th>
              <th>Brand</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Assignee</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ticket) => (
              <tr key={ticket.id} className="clickable" onClick={() => onOpen(ticket)}>
                <td>
                  <strong>{ticket.id}</strong>
                  <div className="muted small">{ticket.title}</div>
                </td>
                <td>{tabName(ticket.area)}</td>
                <td>{ticket.brand}</td>
                <td>{formatDateTime(ticket.createdAt)}</td>
                <td>
                  <span className={statusClass(ticket.status)}>{ticket.status}</span>
                </td>
                <td>{ticket.ownerEmail ?? '—'}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6} className="muted center">
                  No submissions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Form builder (spec §20.4)                                           */
/* ------------------------------------------------------------------ */

function FormBuilderSection({
  settings,
  onSaved,
}: {
  settings: FormSettings;
  onSaved: (settings: FormSettings) => void;
}) {
  const [area, setArea] = useState(TABS[0].id);
  const [draft, setDraft] = useState<AreaFormSettings>({});
  const [message, setMessage] = useState('');

  const tab = TABS.find((t) => t.id === area) ?? TABS[0];

  useEffect(() => {
    const next: AreaFormSettings = {};
    for (const field of tab.fields) next[field.label] = fieldSetting(settings, tab.id, field);
    setDraft(next);
    setMessage('');
  }, [area, settings, tab]);

  async function save() {
    setMessage('');
    try {
      const res = await api.saveFormSettings(area, draft);
      onSaved(res.settings);
      setMessage('Saved.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not save settings.');
    }
  }

  return (
    <>
      <div className="filters">
        <select value={area} onChange={(e) => setArea(e.target.value)}>
          {TABS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={save}>
          Save settings
        </button>
        {message && <span className="muted">{message}</span>}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Enabled</th>
              <th>Required</th>
            </tr>
          </thead>
          <tbody>
            {tab.fields.map((field) => {
              const entry = draft[field.label] ?? { enabled: true, required: field.required };
              return (
                <tr key={field.label}>
                  <td>{field.label}</td>
                  <td className="muted small">{field.type}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(e) =>
                        setDraft({ ...draft, [field.label]: { ...entry, enabled: e.target.checked } })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={entry.required}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [field.label]: { ...entry, required: e.target.checked },
                        })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Menu Updates conditional rules still control conditional visibility regardless of these
        settings.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Workflow documentation (spec §20.5)                                 */
/* ------------------------------------------------------------------ */

function WorkflowSection() {
  return (
    <div className="panel">
      <h2>Configured workflow</h2>
      <ol className="workflow-list">
        <li>
          <strong>New</strong> — the request is submitted and unassigned. A manager must accept or
          decline within 24 hours.
        </li>
        <li>
          <strong>Accepted or Declined</strong> — accepting assigns the request to the accepting
          staff member; declining requires a reason.
        </li>
        <li>
          <strong>In progress</strong> — the operational representation of Accepted. Campaign
          requests may be scheduled until their campaign date.
        </li>
        <li>
          <strong>Done</strong> — reached on or after the campaign date, immediately for Menu
          Issues, or automatically when a scheduled campaign date arrives.
        </li>
      </ol>
    </div>
  );
}
