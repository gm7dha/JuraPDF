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
  Undo: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  ),
  Redo: (p: IconProps) => (
    <Svg {...p}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Svg>
  ),
  /** A watermark: a page with a slanted line of words across it. */
  Stamp: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3Z" />
      <path d="M8 16.5 16 7.5" />
    </Svg>
  ),
  Print: (p: IconProps) => (
    <Svg {...p}>
      <path d="M7 9V3.5h10V9" />
      <rect x="3.5" y="9" width="17" height="8" rx="1.5" />
      <path d="M7 14h10v6.5H7z" />
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
  /** Turn a page anticlockwise. */
  TurnLeft: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4.5 4v5h5" />
      <path d="M4.8 9A8 8 0 1 1 4 13.5" />
    </Svg>
  ),
  /** Turn a page clockwise. */
  TurnRight: (p: IconProps) => (
    <Svg {...p}>
      <path d="M19.5 4v5h-5" />
      <path d="M19.2 9A8 8 0 1 0 20 13.5" />
    </Svg>
  ),
  Bin: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 6.5h16M9.5 6.5V4h5v2.5M6 6.5l1 13A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5l1-13M10 10.5v6.5M14 10.5v6.5" />
    </Svg>
  ),
  /** Move pages earlier: a page with an arrow up. */
  MoveUp: (p: IconProps) => (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="12" rx="1.5" />
      <path d="M5 15V4M2 7l3-3 3 3" />
    </Svg>
  ),
  /** Move pages later: a page with an arrow down. */
  MoveDown: (p: IconProps) => (
    <Svg {...p}>
      <rect x="9" y="3" width="11" height="12" rx="1.5" />
      <path d="M5 9v11M2 17l3 3 3-3" />
    </Svg>
  ),
  /** A new blank page. */
  AddPage: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6.5 3h8l4 4v12.5A1.5 1.5 0 0 1 17 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3Z" />
      <path d="M14.5 3v4h4M12 10.5v6M9 13.5h6" />
    </Svg>
  ),
  /** Pages from another PDF: two pages, one arriving. */
  BringIn: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 3.5h9.5A1.5 1.5 0 0 1 20 5v12a1.5 1.5 0 0 1-1.5 1.5H9" />
      <path d="M3 11h10M10 8l3 3-3 3" />
    </Svg>
  ),
  /** Save some pages as a new PDF: a page going out. */
  SaveOut: (p: IconProps) => (
    <Svg {...p}>
      <path d="M15 3.5H5.5A1.5 1.5 0 0 0 4 5v12a1.5 1.5 0 0 0 1.5 1.5H15" />
      <path d="M11 11h10M18 8l3 3-3 3" />
    </Svg>
  ),
  /** One page at a time: a single page with arrows above and below it. */
  OnePage: (p: IconProps) => (
    <Svg {...p}>
      <rect x="6.5" y="6" width="11" height="12" rx="1.3" />
      <path d="M9.5 3.5 12 1.8l2.5 1.7M9.5 20.5l2.5 1.7 2.5-1.7" />
    </Svg>
  ),
  /** Rename: a pencil. */
  Pencil: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </Svg>
  ),
  /** Point at this page: a target. */
  Target: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </Svg>
  ),
  /** Put inside the one above: lines with an arrow pointing in. */
  Indent: (p: IconProps) => (
    <Svg {...p}>
      <path d="M11 6h9M11 12h9M11 18h9M3 9l3 3-3 3" />
    </Svg>
  ),
  /** Take out a level: lines with an arrow pointing out. */
  Outdent: (p: IconProps) => (
    <Svg {...p}>
      <path d="M11 6h9M11 12h9M11 18h9M6 9l-3 3 3 3" />
    </Svg>
  ),
  /** Fold or unfold: a small arrow pointing right (turned down when open). */
  Chevron: (p: IconProps) => (
    <Svg {...p}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  ),
  /** Bookmarks: a ribbon. */
  Bookmark: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6.5 3h11v18L12 16.5 6.5 21z" />
    </Svg>
  ),
  /** Add words: a T in a box. */
  Words: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M8 8h8M12 8v9" />
    </Svg>
  ),
  /** Add a picture: a framed landscape. */
  Picture: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m3.5 17 5-5 4 4 3-3 5 5" />
    </Svg>
  ),
  /** Move: arrows four ways. */
  Move: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </Svg>
  ),
  /** Highlight: a marker pen over a stripe. */
  Highlight: (p: IconProps) => (
    <Svg {...p}>
      <path d="m14.5 4.5 5 5-7.5 7.5H7v-5z" />
      <path d="M3 21h18" strokeWidth={3} opacity={0.5} />
    </Svg>
  ),
  /** Draw a box. */
  Box: (p: IconProps) => (
    <Svg {...p}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </Svg>
  ),
  /** Draw an oval. */
  Oval: (p: IconProps) => (
    <Svg {...p}>
      <ellipse cx="12" cy="12" rx="8.5" ry="6" />
    </Svg>
  ),
  /** Draw a line. */
  Line: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 19 19 5" />
    </Svg>
  ),
  /** Draw an arrow. */
  Arrow: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 19 18 6M10 6h8v8" />
    </Svg>
  ),
  /** Copy: two sheets, one over the other. */
  Copy: (p: IconProps) => (
    <Svg {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </Svg>
  ),
  /** Draw freehand: a pen and a squiggle. */
  Pen: (p: IconProps) => (
    <Svg {...p}>
      <path d="m15 4 5 5-9 9H6v-5z" />
      <path d="M3 21c2-1.5 3.5-1.5 5 0s3 1.5 5 0" />
    </Svg>
  ),
  /** Underline words: a U with a line under it. */
  Underline: (p: IconProps) => (
    <Svg {...p}>
      <path d="M7 4v6a5 5 0 0 0 10 0V4M5 20h14" />
    </Svg>
  ),
  /** Cross out words: an S with a line through it. */
  CrossOut: (p: IconProps) => (
    <Svg {...p}>
      <path d="M16.5 6.5C15.5 5 14 4.5 12 4.5c-2.5 0-4.5 1.3-4.5 3.4 0 1.6 1.1 2.6 3 3.1M8 17c1 1.7 2.6 2.5 4.5 2.5 2.6 0 4.5-1.4 4.5-3.5 0-.9-.3-1.6-.8-2.1M4 12h16" />
    </Svg>
  ),
  /** A form box: a box with a text cursor in it, and a tick box. */
  Form: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <path d="M7 6v3" />
      <rect x="3" y="14" width="6" height="6" rx="1" />
      <path d="m4.5 17 1.2 1.2 2-2.4M12 17h8" />
    </Svg>
  ),
  /** Empty a form: an eraser. */
  Eraser: (p: IconProps) => (
    <Svg {...p}>
      <path d="m14.5 4.5 5 5-9 9H6l-2.5-2.5z" />
      <path d="m9 10 5 5M10.5 18.5H20" />
    </Svg>
  ),
  /** Make a form's answers part of the page: a closed padlock. */
  Lock: (p: IconProps) => (
    <Svg {...p}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3M12 14.5v2" />
    </Svg>
  ),
  /** Headers, footers and page numbers: a page with lines at its top and a number at its foot. */
  PageNumbers: (p: IconProps) => (
    <Svg {...p}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8 6.5h8M10.5 17.5h1.2v-2.5l-1 .6M13.5 15h1.5l-1.5 2.5h1.7" />
    </Svg>
  ),
  /** Black out (redact): lines of words with one blacked out. */
  BlackOut: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 6h16M4 18h10" />
      <rect x="4" y="10" width="13" height="4" rx="0.5" fill="currentColor" />
    </Svg>
  ),
  /** Pick things on a page: an arrow pointer. */
  Pointer: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 3.5v15l4-3.8 2.6 5.8 2.6-1.2-2.6-5.7H18z" />
    </Svg>
  ),
  /** Read words in pictures: a picture with lines of words coming out of it. */
  ReadWords: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="4" width="10" height="10" rx="1.5" />
      <path d="m3.5 12 3-3 2.5 2.5 1.5-1.5 2.5 2.5" />
      <path d="M16 7h5M16 11h5M3 18h18M3 21h12" />
    </Svg>
  ),
  /** Save pages as pictures: a picture with an arrow out. */
  SavePicture: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="5" width="12" height="11" rx="1.5" />
      <path d="m3.5 14 3.5-3.5 3 3 1.5-1.5 3 3" />
      <path d="M18 9v10M14.5 15.5 18 19l3.5-3.5" />
    </Svg>
  ),
  /** Find words: a magnifying glass. */
  Search: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </Svg>
  ),
  /** Match capitals: a capital and a small letter. */
  MatchCase: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 18 7.5 6 12 18M4.7 13.5h5.6" />
      <circle cx="17.5" cy="15" r="3" />
      <path d="M20.5 12v6" />
    </Svg>
  ),
  /** Save the words as text: lines of words with an arrow out. */
  SaveText: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 6h11M4 10h11M4 14h7" />
      <path d="M18 9v10M14.5 15.5 18 19l3.5-3.5" />
    </Svg>
  ),
};
