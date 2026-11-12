import type { ReactNode, SVGProps } from 'react';

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;

/** 사이드바·목록의 단색 아이콘. 색은 항상 currentColor 를 따른다. */
function Icon({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6.8" cy="6.8" r="4.2" />
      <path d="M10 10l4 4" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3v10M3 8h10" />
    </Icon>
  );
}

/** 머리줄 `⋯` — 더 보기 메뉴 */
export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props} strokeWidth={0}>
      <circle cx="3.4" cy="8" r="1.1" fill="currentColor" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" />
      <circle cx="12.6" cy="8" r="1.1" fill="currentColor" />
    </Icon>
  );
}

export function NewFolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.8 4.2a1.2 1.2 0 0 1 1.2-1.2h3l1.4 1.8h5.6a1.2 1.2 0 0 1 1.2 1.2v5.8a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2z" />
      <path d="M8 7.2v3.6M6.2 9h3.6" />
    </Icon>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="2.7" />
      <path d="M8 1.6v1.4M8 13v1.4M1.6 8h1.4M13 8h1.4M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1" />
    </Icon>
  );
}

export function GraphIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="3.6" cy="11.4" r="1.6" />
      <circle cx="8" cy="4.2" r="1.6" />
      <circle cx="12.4" cy="11.4" r="1.6" />
      <path d="M4.8 10.1l2.4-4.1M9.2 6l2.4 4.1M5.2 11.4h6" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.8 4.4h10.4M6.2 2.4h3.6M4.2 4.4l.7 8.2a1.2 1.2 0 0 0 1.2 1.1h3.8a1.2 1.2 0 0 0 1.2-1.1l.7-8.2" />
      <path d="M6.6 6.8v4.4M9.4 6.8v4.4" />
    </Icon>
  );
}

/** Lucide "sun" (ISC) — Copyright (c) 2026 Lucide Icons and Contributors. 전체 고지: docs/THIRD-PARTY.md */
export function ThemeSunIcon(props: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" strokeWidth={2} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </Icon>
  );
}

/** Lucide "moon" (ISC) — Copyright (c) 2026 Lucide Icons and Contributors. 전체 고지: docs/THIRD-PARTY.md */
export function ThemeMoonIcon(props: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" strokeWidth={2} {...props}>
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    </Icon>
  );
}

/** Lucide "monitor" (ISC) — Copyright (c) 2026 Lucide Icons and Contributors. 전체 고지: docs/THIRD-PARTY.md */
export function ThemeMonitorIcon(props: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" strokeWidth={2} {...props}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    // Lucide "settings" (ISC) — Copyright (c) 2026 Lucide Icons and Contributors.
    // 전체 라이선스 고지는 docs/THIRD-PARTY.md 참고. https://lucide.dev/icons/settings
    <Icon viewBox="0 0 24 24" strokeWidth={2} {...props}>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function DatabaseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <ellipse cx="8" cy="3.9" rx="4.8" ry="2" />
      <path d="M3.2 3.9v8.2c0 1.1 2.1 2 4.8 2s4.8-.9 4.8-2V3.9" />
      <path d="M3.2 8c0 1.1 2.1 2 4.8 2s4.8-.9 4.8-2" />
    </Icon>
  );
}
