/** 앱 아이콘(`assets/icon.svg`)과 같은 그림. 비스듬히 겹친 시트 3장 + 페이지 말림. */
export function Logo({ size = 72 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="100 100 824 824" role="img" aria-label="Lasagna">
      <defs>
        <linearGradient id="logo-bg" x1="150" y1="110" x2="880" y2="930" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9a3a22" />
          <stop offset="1" stopColor="#6f2416" />
        </linearGradient>
        <linearGradient id="logo-gloss" x1="0" y1="100" x2="0" y2="620" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="logo-tile">
          <rect x="100" y="100" width="824" height="824" rx="188" />
        </clipPath>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="188" fill="url(#logo-bg)" />
      <g clipPath="url(#logo-tile)">
        <rect x="100" y="100" width="824" height="824" fill="url(#logo-gloss)" />
        <g>
          <rect x="190" y="718" width="644" height="170" rx="46" fill="#4d1a11" opacity="0.55" />
          <rect x="190" y="700" width="644" height="170" rx="46" fill="#d8b183" />
          <rect x="216" y="478" width="592" height="170" rx="46" fill="#4d1a11" opacity="0.55" />
          <rect x="216" y="460" width="592" height="170" rx="46" fill="#efd3a9" />
          <rect x="242" y="238" width="540" height="170" rx="46" fill="#4d1a11" opacity="0.55" />
          <rect x="242" y="220" width="540" height="170" rx="46" fill="#fff2da" />
          <path d="M672 220 H782 V330 Z" fill="#efd3a9" />
          <path d="M672 220 L782 330" stroke="#4d1a11" strokeOpacity="0.38" strokeWidth="10" />
        </g>
      </g>
      <rect x="104" y="104" width="816" height="816" rx="184" fill="none" stroke="#fff" strokeOpacity="0.10" strokeWidth="6" />
    </svg>
  );
}
