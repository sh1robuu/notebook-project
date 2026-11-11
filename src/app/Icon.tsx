const paths = {
  select: "M5 3v17l5-5 4 7 3-2-4-7h7L5 3Z",
  shapes: "M3 4h8v8H3V4Zm12 8 5 8H10l5-8ZM20 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  text: "M4 5h16M12 5v15M8 20h8",
  equation: "M20 4H8l6 8-6 8h12M4 8H2m2 8H2",
  image: "M3 4h18v16H3V4Zm0 12 5-5 5 5 3-3 5 5M16 8h.01",
  camera: "M3 7h4l2-3h6l2 3h4v13H3V7Zm12 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  pen: "m4 16 1 4 4-1L20 8l-5-5L4 16Zm9-11 5 5M5 16l4 4",
  highlight: "m4 14 7-10 7 5-8 9-6-4Zm0 0-1 6h6l1-2M14 3l6 4",
  erase:
    "m3 13 8-9a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-7 7H8l-5-4a2 2 0 0 1 0-3Zm3-3 9 8M13 20h8",
  partial: "M3 7h5m8 0h5M3 17h5m8 0h5M10 4v16m4-16v16",
  hand: "M8 13V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1c-2 0-4-1-5-3l-4-5a1.5 1.5 0 0 1 2-2l2 2Z",
  undo: "M9 5 3 11l6 5M3 11h10a7 7 0 0 1 7 7",
  redo: "m15 5 6 6-6 5m6-5H11a7 7 0 0 0-7 7",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  open: "M3 8V5h7l2 3h8v12H3V8Zm0 3h17",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  panelLeftOpen: "M4 4h16v16H4V4Zm5 0v16m4-5 3-3-3-3",
  panelLeftClose: "M4 4h16v16H4V4Zm5 0v16m7-5-3-3 3-3",
  pagePlus: "M6 3h8l4 4v14H6V3Zm8 0v4h4m-6 4v6m-3-3h6",
  up: "m6 15 6-6 6 6",
  down: "m6 9 6 6 6-6",
  trash: "M4 7h16M10 7V4h4v3m4 0-1 13H7L6 7m4 4v5m4-5v5",
  fit: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  previousSlide: "M5 5v14m12-13-6 6 6 6",
  nextSlide: "M19 5v14M7 6l6 6-6 6",
  previousBuild: "m15 6-6 6 6 6",
  nextBuild: "m9 6 6 6-6 6",
  restart: "M3 4v6h6M4 10a8 8 0 1 1 1 7",
  reveal: "m3 12 9-6 9 6-9 6-9-6Zm9-1v2",
  notebook:
    "M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 0v18m4-13h5m-5 4h5",
  simulation: "M4 5h16v14H4V5Zm2 3h12m-8 3 5 3-5 3v-6Z",
  graph: "M4 3v17h17M7 14l4-7 4 9 5-12",
  documents: "M8 5V3h9l4 4v12h-3m-2-16v5h5M4 7h8l5 5v9H4Zm8 0v6h5M7 17h6",
  slides: "M3 4h18M5 4v11h14V4M12 15v5m-4 1 4-3 4 3m-7-9 4-3-4-3Z",
  laser: "m3 21 8-8m3-3 4-4m0 5h3M13 6V3m4 11h3M9 7V4",
  scratch: "M4 3h14l3 3v15H4Zm4 5h7m-7 4h9m-9 4h5m5-13v4h3",
  scratchClose: "M4 3h14l3 3v15H4Zm4 5h7m3-5v4h3M8 12l6 5m0-5-6 5",
  minimize: "M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5",
  stop: "M6 6h12v12H6Z",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4m-6-6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm4-4a4 4 0 0 1 0 8",
  caller: "M5 18v-1a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v1M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm5 1 1 2 2 .5-1.5 1.5.3 2-1.8-.9-1.8.9.3-2L15 10.5l2-.5Z",
  settings: "M4 6h7m4 0h5M4 12h3m4 0h9M4 18h10m4 0h2M11 4v4m-4 2v4m7 2v4",
  more: "M5 12h.01m7 0h.01m7 0h.01",
  chevron: "m7 10 5 5 5-5",
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
