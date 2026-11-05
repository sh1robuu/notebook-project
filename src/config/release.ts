/** This gate permits loading; the SDK still verifies signature, expiry and host. */
export function editorReleaseState({
  production,
  enabled,
  licenseKey,
}: {
  production: boolean;
  enabled: string | undefined;
  licenseKey: string | undefined;
}): "development" | "enabled" | "unavailable" {
  if (!production) return "development";
  return enabled === "true" && (licenseKey?.trim().length ?? 0) > 0
    ? "enabled"
    : "unavailable";
}
