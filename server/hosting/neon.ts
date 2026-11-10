const allowedParameters = new Set([
  "sslmode", "channel_binding", "connect_timeout", "application_name", "sslnegotiation",
]);

function invalidUrl(): never {
  throw new Error("A complete Neon PostgreSQL connection with verified TLS is required.");
}

/** Normalize a supplied credential without guessing a password or loading local files. */
export function normalizeNeonUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { return invalidUrl(); }
  const labels = url.hostname.split(".");
  if (!["postgresql:", "postgres:"].includes(url.protocol)
    || !url.hostname.endsWith(".neon.tech")
    || labels.length < 4
    || !/^ep-[a-z0-9-]+$/.test(labels[0])
    || labels.some(label => !/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    || (url.port !== "" && url.port !== "5432")
    || !url.username || !url.password || url.hash
    || !/^\/[^/]+$/.test(url.pathname)) return invalidUrl();
  try {
    const database = decodeURIComponent(url.pathname.slice(1));
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    if ([database, username, password].some(value => !value || /[\x00-\x1f\x7f]/.test(value))
      || /[\\/]/.test(database)) return invalidUrl();
  } catch { return invalidUrl(); }
  for (const key of url.searchParams.keys()) {
    if (!allowedParameters.has(key) || url.searchParams.getAll(key).length !== 1) return invalidUrl();
  }
  const tls = url.searchParams.get("sslmode");
  if (tls && !["require", "verify-ca", "verify-full"].includes(tls)) return invalidUrl();
  const binding = url.searchParams.get("channel_binding");
  if (binding && !["prefer", "require"].includes(binding)) return invalidUrl();
  const timeout = url.searchParams.get("connect_timeout");
  if (timeout !== null && (!/^\d+$/.test(timeout) || Number(timeout) < 1 || Number(timeout) > 120)) return invalidUrl();
  const negotiation = url.searchParams.get("sslnegotiation");
  if (negotiation && !["postgres", "direct"].includes(negotiation)) return invalidUrl();
  url.searchParams.set("sslmode", "verify-full");
  return url.href;
}

/** Neon documents the pooled endpoint as the first hostname label plus -pooler. */
export function neonDirectUrl(input: string) {
  const url = new URL(normalizeNeonUrl(input));
  const labels = url.hostname.split(".");
  labels[0] = labels[0].replace(/-pooler$/, "");
  url.hostname = labels.join(".");
  return url.href;
}

export function neonRuntimeUrl(ownerUrl: string, runtimePassword: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(runtimePassword))
    throw new Error("The independent runtime password must contain at least 32 random bytes encoded as base64url.");
  const url = new URL(normalizeNeonUrl(ownerUrl));
  url.username = "lessonboard_app";
  url.password = runtimePassword;
  return url.href;
}
