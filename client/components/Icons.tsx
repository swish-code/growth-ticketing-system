/**
 * Inline icon set — 20×20, 1.6px stroke, currentColor.
 * Kept local so the app ships no icon-font or external request.
 */

interface IconProps {
  size?: number;
  className?: string;
}

function svg(path: React.ReactNode, { size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) =>
  svg(
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>,
    p,
  );

export const IconTasks = (p: IconProps) =>
  svg(
    <>
      <path d="M9 5h10M9 12h10M9 19h10" />
      <path d="m3 5 1.5 1.5L7 4" />
      <path d="m3 12 1.5 1.5L7 11" />
      <path d="m3 19 1.5 1.5L7 18" />
    </>,
    p,
  );

export const IconChat = (p: IconProps) =>
  svg(<path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1.8-4.6A7.5 7.5 0 1 1 20 11.5Z" />, p);

export const IconAds = (p: IconProps) =>
  svg(
    <>
      <path d="M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1Z" />
      <path d="M16.5 9a4 4 0 0 1 0 6" />
      <path d="M19 6.5a7.5 7.5 0 0 1 0 11" />
    </>,
    p,
  );

export const IconInfluencer = (p: IconProps) =>
  svg(
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="m17.5 4 1.1 2.3 2.4.35-1.75 1.7.42 2.45-2.17-1.15-2.17 1.15.42-2.45L14 6.65l2.4-.35Z" />
    </>,
    p,
  );

export const IconMenu = (p: IconProps) =>
  svg(
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>,
    p,
  );

export const IconIssue = (p: IconProps) =>
  svg(
    <>
      <path d="M10.6 4.2 2.9 17.5A1.6 1.6 0 0 0 4.3 20h15.4a1.6 1.6 0 0 0 1.4-2.5L13.4 4.2a1.6 1.6 0 0 0-2.8 0Z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>,
    p,
  );

export const IconExternal = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 9h17.6M3.2 15h17.6" />
      <path d="M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
    </>,
    p,
  );

export const IconShield = (p: IconProps) =>
  svg(
    <>
      <path d="M12 3l7 3v5.5c0 4.3-2.9 8.2-7 9.5-4.1-1.3-7-5.2-7-9.5V6Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </>,
    p,
  );

export const IconLogout = (p: IconProps) =>
  svg(
    <>
      <path d="M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3" />
      <path d="M15.5 15.5 19 12l-3.5-3.5" />
      <path d="M19 12H9" />
    </>,
    p,
  );

export const IconPlus = (p: IconProps) => svg(<path d="M12 5v14M5 12h14" />, p);

export const IconClose = (p: IconProps) => svg(<path d="M6 6l12 12M18 6 6 18" />, p);

export const IconSearch = (p: IconProps) =>
  svg(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>,
    p,
  );

export const IconDownload = (p: IconProps) =>
  svg(
    <>
      <path d="M12 3v11" />
      <path d="m8 10.5 4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>,
    p,
  );

export const IconBars = (p: IconProps) => svg(<path d="M4 6h16M4 12h16M4 18h16" />, p);

export const IconUser = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>,
    p,
  );

export const IconClock = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </>,
    p,
  );

export const IconInbox = (p: IconProps) =>
  svg(
    <>
      <path d="M3.5 13h4l1.2 2.4h6.6L16.5 13h4" />
      <path d="M5.6 5h12.8l2.1 8v4a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-4Z" />
    </>,
    p,
  );

export const IconCheck = (p: IconProps) => svg(<path d="m5 12.5 4.5 4.5L19 7" />, p);

export const IconAlert = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V13M12 16.2h.01" />
    </>,
    p,
  );

export const IconCalendar = (p: IconProps) =>
  svg(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9.5h18M8 3v4M16 3v4" />
      <path d="M7.5 13.5h.01M12 13.5h.01M16.5 13.5h.01M7.5 17h.01M12 17h.01" />
    </>,
    p,
  );

export const IconChevronLeft = (p: IconProps) => svg(<path d="m14.5 5.5-6 6.5 6 6.5" />, p);

export const IconChevronRight = (p: IconProps) => svg(<path d="m9.5 5.5 6 6.5-6 6.5" />, p);

export const IconSun = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" />
    </>,
    p,
  );

export const IconMoon = (p: IconProps) =>
  svg(<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />, p);

export const IconMonitor = (p: IconProps) =>
  svg(
    <>
      <rect x="3" y="4.5" width="18" height="13" rx="2" />
      <path d="M9 21h6M12 17.5V21" />
    </>,
    p,
  );

/** Sidebar icon per view id. */
export const NAV_ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  dashboard: IconDashboard,
  'my-tasks': IconTasks,
  calendar: IconCalendar,
  'crm-whatsapp': IconChat,
  'digital-ads': IconAds,
  influencer: IconInfluencer,
  'menu-updates': IconMenu,
  'menu-issues': IconIssue,
  'external-activities': IconExternal,
  admin: IconShield,
};
