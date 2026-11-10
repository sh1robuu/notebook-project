import baseline from "./vercel-base.json" with { type: "json" };

const productionClassroomApi = "https://noteboard-29bo.onrender.com";

export function classroomVercelConfig(env: NodeJS.ProcessEnv) {
  const production = env.VERCEL_ENV === "production";
  const enabled = env.VITE_CLASSROOM_ENABLED ?? (production ? "true" : "false");
  if (!["true", "false"].includes(enabled))
    throw new Error("VITE_CLASSROOM_ENABLED must be true or false.");
  if (enabled === "false") return baseline;

  const origin = env.CLASSROOM_API_ORIGIN ?? (production ? productionClassroomApi : undefined);
  let url: URL;
  try { url = new URL(origin ?? ""); }
  catch { throw new Error("CLASSROOM_API_ORIGIN must be the actual Render HTTPS origin."); }
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password ||
      !url.hostname.endsWith(".onrender.com"))
    throw new Error("CLASSROOM_API_ORIGIN must be the canonical Render HTTPS origin without a path.");

  const privateHeaders = [
    { key: "Cache-Control", value: "private, no-store" },
    { key: "CDN-Cache-Control", value: "no-store" },
    { key: "Vercel-CDN-Cache-Control", value: "no-store" },
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  ];
  return {
    ...baseline,
    buildCommand: "VITE_CLASSROOM_ENABLED=true npm run build",
    rewrites: [
      { source: "/api/classroom/:path*", destination: origin + "/api/classroom/:path*" },
      { source: "/join", destination: "/classroom" },
      ...baseline.rewrites,
    ],
    headers: [
      ...baseline.headers,
      ...["/classroom", "/join", "/api/classroom/:path*"].map(source => ({ source, headers: privateHeaders })),
    ],
  };
}
