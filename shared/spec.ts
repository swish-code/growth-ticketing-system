/**
 * Growth Department Ticketing System — shared specification.
 *
 * This module is imported by BOTH the Express server and the React client so
 * that field definitions, brands, statuses and permission shapes can never
 * drift apart. Everything here must stay runtime-agnostic (no node/browser
 * specific APIs).
 */

/* ------------------------------------------------------------------ */
/* Brands (spec §7)                                                    */
/* ------------------------------------------------------------------ */

export const BRANDS = [
  'Yelo! Pizza',
  'BBT',
  'Shawarma Shakir',
  'Pattie Pattie',
  'Mishmash',
  'Tabel',
  'Slice Doner',
  'Just C',
  'Chili Pepper',
  'Forevermore',
] as const;

export type Brand = (typeof BRANDS)[number];

/* ------------------------------------------------------------------ */
/* Field definitions (spec §6, §8–§13)                                 */
/* ------------------------------------------------------------------ */

export type FieldType = 'text' | 'textarea' | 'select' | 'multi' | 'date' | 'number' | 'url';

export interface FieldCondition {
  /** Label of the controlling field. */
  field: string;
  /** Field is visible when the controlling value is one of these. */
  values: string[];
}

export interface FieldDef {
  /** Label — also used as the storage key inside `tickets.data`. */
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  /** Minimum selectable date = today + N days. Admins bypass it. */
  minDaysFromToday?: number;
  /** This date field must be strictly after the referenced date field. */
  mustBeAfter?: string;
  /** Selecting this option reveals a free-text input for a custom value. */
  customOption?: string;
  /** Conditional visibility (Menu Updates). */
  visibleWhen?: FieldCondition;
  /** Rendered full width in the form grid. */
  wide?: boolean;
}

export interface TabDef {
  id: string;
  name: string;
  /** Request-ID prefix (spec §14). */
  prefix: string;
  fields: FieldDef[];
}

const BRAND_FIELD: FieldDef = {
  label: 'Brand',
  type: 'select',
  required: true,
  options: [...BRANDS],
};

const CHANNELS = ['Talabat', 'Keeta', 'Ordable', 'Deliveroo', 'Snoonu', 'V-thru', 'Jahez'];

/** Fields 1–9 shared by CRM WhatsApp and Digital Ads (spec §8, §9). */
function campaignBaseFields(minDays: number): FieldDef[] {
  return [
    BRAND_FIELD,
    { label: 'Campaign Name', type: 'text', required: true },
    { label: 'Campaign Date', type: 'date', required: true, minDaysFromToday: minDays },
    {
      label: 'Campaign Purpose',
      type: 'multi',
      required: true,
      options: ['Awareness', 'Offer', 'NPL'],
    },
    { label: 'CAPTION IN EN', type: 'textarea', required: false, wide: true },
    { label: 'CAPTION IN AR', type: 'textarea', required: false, wide: true },
    { label: 'Targeted Channel', type: 'select', required: true, options: CHANNELS },
    { label: 'Visual Link', type: 'url', required: true },
    { label: 'Additional Notes', type: 'textarea', required: false, wide: true },
  ];
}

export const TABS: TabDef[] = [
  /* ---------------------------- CRM WhatsApp (§8) --------------------------- */
  {
    id: 'crm-whatsapp',
    name: 'CRM WhatsApp',
    prefix: 'CW',
    fields: [
      ...campaignBaseFields(3),
      {
        label: 'Targeted Customers',
        type: 'multi',
        required: true,
        options: [
          'Top Spenders',
          'Champions',
          'Value Seekers',
          'High Frequent Customers',
          'Other customer group',
        ],
        customOption: 'Other customer group',
      },
      { label: 'Targeted Number Of Customers', type: 'number', required: true },
    ],
  },

  /* ---------------------------- Digital Ads (§9) ---------------------------- */
  {
    id: 'digital-ads',
    name: 'Digital Ads',
    prefix: 'DA',
    fields: [
      ...campaignBaseFields(3),
      {
        label: 'CAMPAIGN OBJECTIVE',
        type: 'multi',
        required: true,
        options: [
          'SALES CAMPAIGN',
          'TRAFFIC',
          'VIDEO VIEW',
          'AWARENESS',
          'ENGAGEMENT',
          'TIKTOK TOP VIEW',
          'Custom objective',
        ],
        customOption: 'Custom objective',
      },
      { label: 'BUDGET', type: 'number', required: true },
    ],
  },

  /* ---------------------------- Influencer (§10) ---------------------------- */
  {
    id: 'influencer',
    name: 'Influencer',
    prefix: 'IN',
    fields: [
      BRAND_FIELD,
      { label: 'Campaign Name', type: 'text', required: true },
      { label: 'Campaign Date', type: 'date', required: true, minDaysFromToday: 7 },
      { label: 'Budget', type: 'number', required: true },
      {
        label: 'Type Of Influencer',
        type: 'multi',
        required: true,
        options: ['Micro', 'Macro', 'Custom influencer type'],
        customOption: 'Custom influencer type',
      },
      {
        label: 'Platform',
        type: 'multi',
        required: true,
        options: ['Instagram', 'Snapchat', 'Facebook', 'TikTok', 'Custom platform'],
        customOption: 'Custom platform',
      },
      {
        label: 'Channel',
        type: 'multi',
        required: true,
        options: ['Post', 'Reel', 'Story', 'Collaboration'],
      },
      {
        label: 'Campaign Introduction (Tell Us About The Campaign)',
        type: 'textarea',
        required: true,
        wide: true,
      },
      { label: 'Objective', type: 'textarea', required: true, wide: true },
      { label: 'Target Audience', type: 'textarea', required: true, wide: true },
      { label: 'Product Influencers To Receive', type: 'textarea', required: true, wide: true },
      { label: 'Key Message', type: 'textarea', required: true, wide: true },
      { label: 'Secondary Message (If Available)', type: 'textarea', required: false, wide: true },
      {
        label: 'Suggested Talking Points / Lines For Creators ARABIC',
        type: 'textarea',
        required: true,
        wide: true,
      },
      {
        label: 'Suggested Talking Points / Lines For Creators ENGLISH',
        type: 'textarea',
        required: true,
        wide: true,
      },
      { label: 'Additional Notes', type: 'textarea', required: false, wide: true },
    ],
  },

  /* --------------------------- Menu Updates (§11) --------------------------- */
  {
    id: 'menu-updates',
    name: 'Menu Updates',
    prefix: 'MU',
    fields: [
      BRAND_FIELD,
      { label: 'Start Date', type: 'date', required: true, minDaysFromToday: 5 },
      { label: 'End Date', type: 'date', required: false, mustBeAfter: 'Start Date' },
      {
        label: 'Aggregator',
        type: 'multi',
        required: true,
        options: ['Talabat', 'Keeta', 'Deliveroo', 'Jahez', 'V-thru', 'Ordable', 'Snoonu'],
      },
      { label: 'MasterSheet Updated', type: 'select', required: true, options: ['Yes', 'No'] },
      { label: 'MasterSheet Link Updates', type: 'url', required: true },
      {
        label: 'Item Activity',
        type: 'select',
        required: true,
        options: [
          'New Product Launch',
          'New Product Offer',
          'New Campaign (MULTIPLE PRODUCTS ONLY)',
          'New Modifier Option',
          'Edit Current Item',
          'Remove / Delete Item',
        ],
      },
      {
        label: 'Item Name',
        type: 'text',
        required: true,
        visibleWhen: {
          field: 'Item Activity',
          values: [
            'New Product Launch',
            'New Product Offer',
            'Edit Current Item',
            'New Modifier Option',
          ],
        },
      },
      {
        label: 'Category Name',
        type: 'text',
        required: true,
        visibleWhen: {
          field: 'Item Activity',
          values: ['New Product Launch', 'New Product Offer'],
        },
      },
      {
        label: 'Category Order',
        type: 'number',
        required: true,
        visibleWhen: {
          field: 'Item Activity',
          values: ['New Product Launch', 'New Product Offer'],
        },
      },
      {
        label: 'Single Or Multiple Item Edit',
        type: 'select',
        required: true,
        options: ['Single', 'Multiple (Bulk)'],
        visibleWhen: { field: 'Item Activity', values: ['Edit Current Item'] },
      },
      {
        label: 'Type Of Edit',
        type: 'select',
        required: true,
        options: ['Product Name', 'Modifier Name', 'Description', 'Price', 'Category'],
        visibleWhen: { field: 'Item Activity', values: ['Edit Current Item'] },
      },
      {
        label: 'Modifier Group Name',
        type: 'text',
        required: true,
        visibleWhen: { field: 'Item Activity', values: ['New Modifier Option'] },
      },
      {
        label: 'Modifier Name',
        type: 'text',
        required: true,
        visibleWhen: { field: 'Item Activity', values: ['New Modifier Option'] },
      },
      {
        label: 'Remove / Delete Activity',
        type: 'select',
        required: true,
        options: ['Product', 'Modifier', 'Category'],
        visibleWhen: { field: 'Item Activity', values: ['Remove / Delete Item'] },
      },
      {
        label: 'Remove / Delete Name',
        type: 'text',
        required: true,
        visibleWhen: { field: 'Item Activity', values: ['Remove / Delete Item'] },
      },
      {
        label: 'Old Info',
        type: 'textarea',
        required: true,
        wide: true,
        visibleWhen: {
          field: 'Type Of Edit',
          values: ['Product Name', 'Modifier Name', 'Description', 'Category'],
        },
      },
      {
        label: 'New Info',
        type: 'textarea',
        required: true,
        wide: true,
        visibleWhen: {
          field: 'Type Of Edit',
          values: ['Product Name', 'Modifier Name', 'Description', 'Category'],
        },
      },
      {
        label: 'Old Price',
        type: 'number',
        required: true,
        visibleWhen: { field: 'Type Of Edit', values: ['Price'] },
      },
      {
        label: 'New Price',
        type: 'number',
        required: true,
        visibleWhen: { field: 'Type Of Edit', values: ['Price'] },
      },
      {
        label: 'Campaign Name',
        type: 'text',
        required: true,
        visibleWhen: {
          field: 'Item Activity',
          values: ['New Campaign (MULTIPLE PRODUCTS ONLY)'],
        },
      },
      {
        label: 'Number Of Products',
        type: 'number',
        required: true,
        visibleWhen: {
          field: 'Item Activity',
          values: ['New Campaign (MULTIPLE PRODUCTS ONLY)'],
        },
      },
      {
        label: 'Products Details',
        type: 'textarea',
        required: true,
        wide: true,
        visibleWhen: {
          field: 'Item Activity',
          values: ['New Campaign (MULTIPLE PRODUCTS ONLY)'],
        },
      },
    ],
  },

  /* ---------------------------- Menu Issues (§12) --------------------------- */
  {
    id: 'menu-issues',
    name: 'Menu Issues',
    prefix: 'MI',
    fields: [
      BRAND_FIELD,
      { label: 'Issue', type: 'select', required: true, options: ['Product', 'Modifier', 'Category'] },
      { label: 'Priority', type: 'select', required: true, options: ['Low', 'Medium', 'High'] },
      { label: 'Issue type', type: 'textarea', required: true, wide: true },
      {
        label: 'Aggregator',
        type: 'select',
        required: true,
        options: [
          'All Aggregator',
          'Talabat',
          'Keeta',
          'Ordable',
          'Deliveroo',
          'Snoonu',
          'V-thru',
          'Jahez',
        ],
      },
    ],
  },

  /* ------------------------ External Activities (§13) ----------------------- */
  {
    id: 'external-activities',
    name: 'External Activities',
    prefix: 'EA',
    fields: [
      BRAND_FIELD,
      {
        label: 'Activity',
        type: 'select',
        required: true,
        options: ['Cinema', 'Buses', 'Screens', 'Outdoor'],
      },
      { label: 'Start Date', type: 'date', required: true, minDaysFromToday: 7 },
      { label: 'End Date', type: 'date', required: true, mustBeAfter: 'Start Date' },
      { label: 'Campaign', type: 'text', required: true },
      { label: 'Company', type: 'text', required: true },
      { label: 'Budget', type: 'number', required: true },
      { label: 'Notes', type: 'textarea', required: false, wide: true },
    ],
  },
];

export const TAB_IDS = TABS.map((t) => t.id);

export function getTab(area: string): TabDef | undefined {
  return TABS.find((t) => t.id === area);
}

export function tabName(area: string): string {
  return getTab(area)?.name ?? area;
}

/** Menu Issues is the only tab without campaign-date / schedule handling (§12.1). */
export const MENU_ISSUES = 'menu-issues';

/* ------------------------------------------------------------------ */
/* Conditional visibility (spec §11.2 / §6.2)                          */
/* ------------------------------------------------------------------ */

export type FormValues = Record<string, unknown>;

function valueMatches(value: unknown, allowed: string[]): boolean {
  if (Array.isArray(value)) return value.some((v) => allowed.includes(String(v)));
  return allowed.includes(String(value ?? ''));
}

/**
 * A field is visible when its own condition matches AND the field it depends
 * on is itself visible (conditions chain, e.g. Old Price → Type Of Edit →
 * Item Activity).
 */
export function isFieldVisible(tab: TabDef, field: FieldDef, values: FormValues): boolean {
  const condition = field.visibleWhen;
  if (!condition) return true;
  const parent = tab.fields.find((f) => f.label === condition.field);
  if (parent && !isFieldVisible(tab, parent, values)) return false;
  return valueMatches(values[condition.field], condition.values);
}

/* ------------------------------------------------------------------ */
/* Form settings overrides (spec §20.4)                                */
/* ------------------------------------------------------------------ */

export interface FieldSetting {
  enabled: boolean;
  required: boolean;
}

export type AreaFormSettings = Record<string, FieldSetting>;
export type FormSettings = Record<string, AreaFormSettings>;

export function fieldSetting(
  settings: FormSettings | undefined,
  area: string,
  field: FieldDef,
): FieldSetting {
  const override = settings?.[area]?.[field.label];
  return {
    enabled: override?.enabled ?? true,
    required: override?.required ?? field.required,
  };
}

/* ------------------------------------------------------------------ */
/* Title & campaign date derivation (spec §6.6, §6.7)                  */
/* ------------------------------------------------------------------ */

const TITLE_ORDER = [
  'Campaign Name',
  'Update title',
  'Item Name',
  'Item Activity',
  'Issue type',
  'Campaign',
];

const CAMPAIGN_DATE_ORDER = ['Campaign Date', 'Effective date', 'Start Date'];

function firstFilled(values: FormValues, keys: string[]): string | null {
  for (const key of keys) {
    const raw = values[key];
    const value = Array.isArray(raw) ? raw.join(', ') : raw;
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

export function deriveTitle(values: FormValues): string {
  return firstFilled(values, TITLE_ORDER) ?? 'Untitled request';
}

export function deriveCampaignDate(values: FormValues, today: string): string {
  return firstFilled(values, CAMPAIGN_DATE_ORDER) ?? today;
}

/* ------------------------------------------------------------------ */
/* Workflow (spec §15)                                                 */
/* ------------------------------------------------------------------ */

export type TicketStatus = 'New' | 'In progress' | 'Declined' | 'Scheduled' | 'Done';

export const STATUSES: TicketStatus[] = ['New', 'In progress', 'Declined', 'Scheduled', 'Done'];

/** Statuses that no longer need staff action. */
export const CLOSED_STATUSES: TicketStatus[] = ['Declined', 'Scheduled', 'Done'];

export function isClosed(status: string): boolean {
  return CLOSED_STATUSES.includes(status as TicketStatus);
}

/* ------------------------------------------------------------------ */
/* SLA (spec §16)                                                      */
/* ------------------------------------------------------------------ */

export const ACCEPTANCE_SLA_MS = 24 * 60 * 60 * 1000;

/** Menu Issues response targets in milliseconds, keyed by priority. */
export const PRIORITY_TARGET_MS: Record<string, number> = {
  High: 1 * 60 * 60 * 1000,
  Medium: 2 * 60 * 60 * 1000,
  Low: 3 * 60 * 60 * 1000,
};

export function priorityTargetMs(priority: string | undefined): number | null {
  if (!priority) return null;
  return PRIORITY_TARGET_MS[priority] ?? null;
}

/* ------------------------------------------------------------------ */
/* Permissions (spec §5)                                               */
/* ------------------------------------------------------------------ */

export type TabAccess = 'none' | 'view' | 'manage';

export interface RolePermissions {
  /** area id → access level. Missing entries mean 'none'. */
  tabs: Record<string, TabAccess>;
  /** Selected brands. An EMPTY list means all brands (spec §5.4). */
  brands: string[];
  forms: boolean;
  submissions: boolean;
}

export interface Role {
  id: string;
  name: string;
  permissions: RolePermissions;
  createdAt: number;
}

export const ADMIN_ROLE_ID = 'admin';
export const OWNER_EMAIL = 'phelo@swishhh.net';
export const COMPANY_DOMAIN = '@swishhh.net';

export function emptyPermissions(): RolePermissions {
  const tabs: Record<string, TabAccess> = {};
  for (const id of TAB_IDS) tabs[id] = 'none';
  return { tabs, brands: [], forms: false, submissions: false };
}

export function adminPermissions(): RolePermissions {
  const tabs: Record<string, TabAccess> = {};
  for (const id of TAB_IDS) tabs[id] = 'manage';
  return { tabs, brands: [], forms: true, submissions: true };
}

/** Permissions granted by self-registration (spec §4.2). */
export function submitterPermissions(brands: string[]): RolePermissions {
  const tabs: Record<string, TabAccess> = {};
  for (const id of TAB_IDS) tabs[id] = 'view';
  return { tabs, brands, forms: true, submissions: true };
}

export function normalizePermissions(raw: unknown): RolePermissions {
  const base = emptyPermissions();
  if (!raw || typeof raw !== 'object') return base;
  const input = raw as Partial<RolePermissions>;
  const tabs: Record<string, TabAccess> = {};
  for (const id of TAB_IDS) {
    const value = input.tabs?.[id];
    tabs[id] = value === 'view' || value === 'manage' ? value : 'none';
  }
  return {
    tabs,
    brands: Array.isArray(input.brands) ? input.brands.filter((b) => BRANDS.includes(b as Brand)) : [],
    forms: Boolean(input.forms),
    submissions: Boolean(input.submissions),
  };
}

export interface Viewer {
  email: string;
  name: string;
  isAdmin: boolean;
  permissions: RolePermissions;
  roleId: string | null;
  roleName: string | null;
  brands: string[];
}

export function tabAccess(viewer: Viewer, area: string): TabAccess {
  if (viewer.isAdmin) return 'manage';
  return viewer.permissions.tabs[area] ?? 'none';
}

export function canManage(viewer: Viewer, area: string): boolean {
  return tabAccess(viewer, area) === 'manage';
}

/** Brands the viewer may pick from. An empty role brand list means all. */
export function allowedBrands(viewer: Viewer): string[] {
  if (viewer.isAdmin) return [...BRANDS];
  if (!viewer.permissions.brands.length) return [...BRANDS];
  return viewer.permissions.brands;
}

export function canUseBrand(viewer: Viewer, brand: string): boolean {
  return allowedBrands(viewer).includes(brand);
}

export function hasFormAccess(viewer: Viewer): boolean {
  return viewer.isAdmin || viewer.permissions.forms;
}

export function hasSubmissionAccess(viewer: Viewer): boolean {
  return viewer.isAdmin || viewer.permissions.submissions;
}

/** Tabs shown in the sidebar (spec §3.3). */
export function visibleTabs(viewer: Viewer): TabDef[] {
  if (viewer.isAdmin) return TABS;
  if (!viewer.permissions.forms && !viewer.permissions.submissions) return [];
  return TABS.filter((t) => tabAccess(viewer, t.id) !== 'none');
}

/** My Tasks requires Submission access + Manage on at least one tab (spec §3.2). */
export function canSeeMyTasks(viewer: Viewer): boolean {
  if (viewer.isAdmin) return true;
  if (!viewer.permissions.submissions) return false;
  return TAB_IDS.some((id) => viewer.permissions.tabs[id] === 'manage');
}

export function canSeeDashboard(viewer: Viewer): boolean {
  return hasSubmissionAccess(viewer);
}

/* ------------------------------------------------------------------ */
/* Ticket shape                                                        */
/* ------------------------------------------------------------------ */

export interface Ticket {
  id: string;
  area: string;
  brand: string;
  title: string;
  campaignDate: string;
  status: TicketStatus;
  ownerEmail: string | null;
  requesterEmail: string;
  requesterName: string;
  data: FormValues;
  notes: string;
  declineReason: string;
  createdAt: number;
  acceptedAt: number | null;
  completedAt: number | null;
}

export interface AuditEntry {
  id: string;
  ticketId: string;
  action: string;
  actorName: string;
  actorEmail: string;
  details: Record<string, unknown>;
  createdAt: number;
}

export interface ActivityEvent {
  id: string;
  type: string;
  title: string;
  message: string;
  ticketId: string | null;
  area: string | null;
  createdAt: number;
}

export interface StaffMember {
  email: string;
  name: string;
  roleId: string | null;
  isAdmin: boolean;
  mustSetPassword: boolean;
  hasAccount: boolean;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Date helpers — all dates are stored as YYYY-MM-DD (spec §25)        */
/* ------------------------------------------------------------------ */

export function toDateKey(value: Date | number): string {
  const date = typeof value === 'number' ? new Date(value) : value;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayKey(now = Date.now()): string {
  return toDateKey(now);
}

export function addDaysKey(days: number, now = Date.now()): string {
  return toDateKey(now + days * 24 * 60 * 60 * 1000);
}

/** Campaign date has arrived when it is on or before today. */
export function dateReached(campaignDate: string, now = Date.now()): boolean {
  return campaignDate <= todayKey(now);
}
