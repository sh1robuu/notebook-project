// Public, hostname-bound SDK license. tldraw validates its signature and expiry.
// Hobby attribution is supplied by the SDK and must remain visible.
const personalLicenseKey =
  "tldraw-nam-pham-2027-11-08/WyI1MmI4OGt4SiIsWyIqLm5vdGVib2FyZGJ5bWFpa2h1eWVuLnZlcmNlbC5hcHAiXSw3MywiMjAyNy0xMS0wOCJd.tQAn/GNMNEOzMMV3bMvMYleqSi64ZH50nCQIFzfU9cziDAJ2L/wvbewmIzoO5KNF/nqgzMmU/SMmGFE0Fv0hIg";

export function getEditorLicenseKey(configuredKey?: string): string {
  return configuredKey?.trim() || personalLicenseKey;
}

/** This gate permits loading; the SDK still verifies signature, expiry and host. */
export function editorReleaseState({
  production,
  licenseKey,
}: {
  production: boolean;
  licenseKey: string | undefined;
}): "development" | "enabled" | "unavailable" {
  if (!production) return "development";
  return (licenseKey?.trim().length ?? 0) > 0 ? "enabled" : "unavailable";
}
