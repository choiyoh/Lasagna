/** 앱 아이콘(`assets/icon.svg`)과 같은 그림. 둥근 사각형 안의 N + 노드 점. */
export function Logo({ size = 72 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="100 100 824 824" role="img" aria-label="Nopsidian">
      <defs>
        <linearGradient id="logo-bg" x1="140" y1="100" x2="880" y2="930" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7c7cf0" />
          <stop offset="1" stopColor="#4640c8" />
        </linearGradient>
        <linearGradient id="logo-gloss" x1="0" y1="100" x2="0" y2="560" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="188" fill="url(#logo-bg)" />
      <rect x="100" y="100" width="824" height="824" rx="188" fill="url(#logo-gloss)" />
      <path d="M338 702 V322 L686 702 V402" fill="none" stroke="#fff" strokeWidth="84" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="722" cy="296" r="52" fill="#ffd66b" stroke="#5c58db" strokeWidth="26" />
    </svg>
  );
}
