const paths = {
  select: "M5 3v17l5-5 4 7 3-2-4-7h7L5 3Z",
  shapes: "M3 4h8v8H3V4Zm12 8 5 8H10l5-8ZM20 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  text: "M4 5h16M12 5v15M8 20h8",
  equation: "M20 4H8l6 8-6 8h12M4 8H2m2 8H2",
  image: "M3 4h18v16H3V4Zm0 12 5-5 5 5 3-3 5 5M16 8h.01",
  pen: "m4 16 1 4 4-1L20 8l-5-5L4 16Zm9-11 5 5M5 16l4 4",
  highlight: "m4 14 7-10 7 5-8 9-6-4Zm0 0-1 6h6l1-2M14 3l6 4",
  erase:
    "m3 13 8-9a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-7 7H8l-5-4a2 2 0 0 1 0-3Zm3-3 9 8M13 20h8",
  partial: "M3 7h5m8 0h5M3 17h5m8 0h5M10 4v16m4-16v16",
  hand: "M7 12V7a2 2 0 0 1 4 0v4-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v6-3a2 2 0 0 1 4 0v6c0 6-3 8-8 8-3 0-5-2-6-4l-4-5a2 2 0 0 1 3-3l3 3",
  undo: "M9 5 3 11l6 5M3 11h10a7 7 0 0 1 7 7",
  redo: "m15 5 6 6-6 5m6-5H11a7 7 0 0 0-7 7",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  open: "M3 8V5h7l2 3h8v12H3V8Zm0 3h17",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  fit: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  previousSlide: "M5 5v14m12-13-6 6 6 6",
  nextSlide: "M19 5v14M7 6l6 6-6 6",
  previousBuild: "m15 6-6 6 6 6",
  nextBuild: "m9 6 6 6-6 6",
  restart: "M3 4v6h6M4 10a8 8 0 1 1 1 7",
  reveal: "m3 12 9-6 9 6-9 6-9-6Zm9-1v2",
} as const;
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
