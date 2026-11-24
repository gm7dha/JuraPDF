import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icons = {
  Import: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3v10M8 9.5l4 4 4-4" />
      <path d="M4 14.5v4A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-4" />
    </Svg>
  ),
  Export: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v3h16v-3" />
    </Svg>
  ),
  Help: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01" />
    </Svg>
  ),
  Cross: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  Plus: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  Settings: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </Svg>
  ),
  Open: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 6h6l2 2h10v11H3z" />
      <path d="M3 10h18" />
    </Svg>
  ),
  Save: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v5h7V3M8 21v-7h8v7" />
    </Svg>
  ),
  Fit: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Svg>
  ),
  Up: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </Svg>
  ),
  Down: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12l7 7 7-7" />
    </Svg>
  ),
  Warning: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 17h.01" />
    </Svg>
  ),
  Tick: (p: IconProps) => (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  ),
  Check: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3 4 6v6c0 4.4 3.4 8.2 8 9 4.6-.8 8-4.6 8-9V6z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </Svg>
  ),
  Minus: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 12h14" />
    </Svg>
  ),
  /** The page-thumbnail sidebar: a panel down the left. */
  Sidebar: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M9 4.5v15M5.5 8h1.5M5.5 11h1.5M5.5 14h1.5" />
    </Svg>
  ),
  /** A page with a folded corner. */
  Page: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6.5 3h8l4 4v12.5A1.5 1.5 0 0 1 17 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3Z" />
      <path d="M14.5 3v4h4M8.5 12h7M8.5 15.5h7" />
    </Svg>
  ),
  /** Fit the page's width to the window. */
  FitWidth: (p: IconProps) => (
    <Svg {...p}>
      <rect x="6" y="3.5" width="12" height="17" rx="1.5" />
      <path d="M2.5 12h5M5 9.5 2.5 12 5 14.5M21.5 12h-5M19 9.5l2.5 2.5-2.5 2.5" />
    </Svg>
  ),
  /** Fit the whole page in the window. */
  FitPage: (p: IconProps) => (
    <Svg {...p}>
      <rect x="7" y="5" width="10" height="14" rx="1.2" />
      <path d="M3 8V4.5A1.5 1.5 0 0 1 4.5 3H8M16 3h3.5A1.5 1.5 0 0 1 21 4.5V8M21 16v3.5a1.5 1.5 0 0 1-1.5 1.5H16M8 21H4.5A1.5 1.5 0 0 1 3 19.5V16" />
    </Svg>
  ),
};
