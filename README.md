# Growth Department — Campaign Requests

Internal request-management system for campaign work, menu work and external activities,
built to the *Growth Department Ticketing System* specification v1.0 (13 August 2026).

Authorized `@swishhh.net` staff create requests through tab-specific forms, see only the
tabs, brands and submissions their role permits, accept or decline work, schedule or
complete it, and review a full audit history. Administrators manage staff, roles, forms,
submissions and password resets.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript, built with Vite |
| Backend | Express route handlers under `/api/*` |
| Database | PostgreSQL (`pg`), schema created automatically on boot |
| Auth | Application-owned accounts, PBKDF2-SHA-256 hashes, HTTP-only session cookies |
| Hosting | Railway (`railway.json` included) |

> The specification describes a Cloudflare D1 / Next.js deployment. This implementation
> keeps every rule, permission and workflow identical but runs on Express + Postgres so it
> deploys on Railway alongside the other SWiSH systems.

---

## Layout

```
shared/spec.ts          Field definitions, brands, statuses, SLA and permission rules
                        (imported by BOTH the server and the client so they cannot drift)
server/
  index.ts              Express app, static SPA hosting
  db.ts                 Pool, schema creation, atomic per-tab ticket counter
  auth.ts               Password hashing, sessions, viewer/permission resolution
  tickets.ts            Row mapping, audit/activity writers, scheduled + SLA processing
  validate.ts           Server-side re-validation of every submitted form
  forms.ts              Form Builder overrides
  routes/               auth · tickets · admin (staff/roles/forms) · events
client/
  App.tsx               Shell, navigation, polling
  components/           AuthScreen · Dashboard · MyTasks · TabView · RequestForm ·
                        RequestDetail · AdminPanel · AccountPanel · Notifications
  lib/format.ts         Dates, durations, SLA display, CSV export
```

---

## Running locally

```bash
npm install
```

Create `.env` from `.env.example` and point `DATABASE_URL` at a Postgres database, then:

```bash
npm run build && npm start
```

For frontend development with hot reload, run the API on `:8080` (`npm start`) and in a
second terminal:

```bash
npm run dev
```

Vite serves the client on `:5173` and proxies `/api` to the Express server.

Type-check both projects without emitting:

```bash
npm run check
```

---

## Deploying to Railway

1. Create a Railway project and add a **PostgreSQL** database.
2. Deploy this repository as a service. `railway.json` sets the build (`npm run build`) and
   start (`npm start`) commands.
3. Set variables on the service:
   - `DATABASE_URL` — reference the Postgres plugin variable.
   - `NODE_ENV=production` so session cookies are marked `Secure`.
   - `PORT` is provided by Railway; the server reads it and falls back to `8080`.
4. On first boot the schema is created and the protected owner account
   `phelo@swishhh.net` is seeded as a **pending** account.

### First sign-in

`phelo@swishhh.net` uses **Log in** (not Create account). The password typed at that first
login becomes the owner's password. The same flow applies to any staff member an
administrator creates.

---

## Roles and permissions

Each non-admin staff member holds exactly one role. A role carries:

- **Per-tab access** — `None`, `View` or `Manage`.
- **Brand access** — selected brands; an empty list means all brands.
- **Form access** — may create requests.
- **Submission access** — may see existing requests.

| Permission | Tab shown | Create (needs Form) | See submissions (needs Submission) | Workflow actions | Staff notes |
|---|---|---|---|---|---|
| None | No | No | No | No | No |
| View | Yes | Yes | Yes | No | No |
| Manage | Yes | Yes | Yes | Yes | Yes |

Permissions are read from the currently assigned role on every request, so editing a role
immediately changes every staff member assigned to it. `phelo@swishhh.net` and the `Admin`
role are protected: they cannot be demoted, edited or deleted.

Backend routes repeat every check — hiding UI is never treated as security.

---

## Request tabs

| Tab | Prefix | Notes |
|---|---|---|
| CRM WhatsApp | `CW` | Campaign date ≥ today + 3 days |
| Digital Ads | `DA` | Campaign date ≥ today + 3 days |
| Influencer | `IN` | Campaign date ≥ today + 7 days |
| Menu Updates | `MU` | Start date ≥ today + 5 days; 16 conditional fields |
| Menu Issues | `MI` | No campaign date, no scheduling; priority-based response SLA |
| External Activities | `EA` | Start date ≥ today + 7 days; end date after start |

IDs are six digits behind the prefix (`CW-000001`) and come from an atomic per-tab counter.
Administrators bypass every minimum-date restriction.

---

## Workflow

```
New ──(decline + reason)──► Declined
 │
 └──(accept, self-assign)──► In progress ──► Done          (on/after campaign date,
                                  │                          or any time for Menu Issues)
                                  └──► Scheduled ──► Done  (automatically when the
                                                            campaign date arrives)
```

- A manager must accept or decline within **24 hours**; after that the request counts as
  delayed and an admin-only SLA escalation is recorded.
- The first person to accept becomes the assignee. Nobody else — except an administrator —
  can continue that request or edit its staff notes. Concurrent acceptance returns
  *Already assigned*.
- Declining always requires a reason, enforced in the browser **and** on the backend.
- Scheduled requests convert to Done automatically, recorded as a `System` audit event.
- Menu Issues response targets: High 1h, Medium 2h, Low 3h, measured from submission.

Scheduled conversion and SLA evaluation run whenever the ticket list is requested; there is
no separate cron worker.

---

## API

| Endpoint | Methods | Access |
|---|---|---|
| `/api/auth` | `GET`, `POST` (`register`, `login`, `logout`, `updateName`, `changePassword`) | Public / signed-in |
| `/api/tickets` | `GET`, `GET ?audit=<id>`, `POST`/`PATCH` (`create`, `update`), `DELETE` | Signed-in; delete is admin-only |
| `/api/staff` | `GET`, `POST` (`create`, `update`, `reset`), `DELETE` | Administrators |
| `/api/roles` | `GET`, `POST`, `DELETE` | Administrators |
| `/api/forms` | `GET` (any signed-in), `POST` (administrators) | Mixed |
| `/api/events` | `GET ?since=<ms>` | Signed-in; SLA events admin-only, max 20 per poll |

The client refreshes tickets every 60 seconds and polls events every 8 seconds; toasts
close automatically after 5 seconds.

---

## Database

Tables created on boot: `tickets`, `staff`, `roles`, `accounts`, `sessions`,
`form_settings`, `ticket_counters`, `activity_events`, `ticket_audit`.

Form answers are stored as JSON in `tickets.data` alongside indexed metadata, so each tab
keeps its own fields. Dates are stored as `YYYY-MM-DD`; timestamps as epoch milliseconds.

---

## Security

- Sessions are HTTP-only, `SameSite=Lax`, `Secure` in production, and expire after 7 days.
- Passwords use PBKDF2-SHA-256 with 60,000 iterations and a random 16-byte salt per
  password. Legacy 150,000-iteration hashes are accepted and migrated on next login.
- Logout deletes the server session, expires the cookie, sends `Clear-Site-Data`, and the
  client clears Cache Storage, local storage and session storage before reloading.
- Admin password reset removes every session for that account.
- CSV export quotes all values and prefixes formula characters to blunt spreadsheet
  formula injection.
