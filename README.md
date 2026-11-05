# Lessonboard — DEPLOY-01

Vietnamese product introduction at **/**; the existing local teaching workspace at **/app**. The landing is prerendered and loads independently from the lazy editor. Unknown /app paths show an intentional not-found view; other unknown public paths retain404 behavior.

**Public deployment status:** prepared locally, not deployed. No Vercel project/login/domain or tldraw production key was configured. The default production /app shows a clear activation notice and never mounts the SDK. Development retains the working editor. The SDK's real license/domain validation must pass on HTTPS before enabling the public editor; a localhost build is not that proof.

Use Node24.x (at least24.14.0):

```powershell
npm ci
npm run dev
```

The printed localhost root opens the landing; choose Mở bảng giảng for /app in development. Existing IndexedDB identity/migrations are unchanged on the same origin. A different Vercel hostname requires an explicit downloaded lesson archive; no cloud synchronization is implemented.

```powershell
npm run typecheck
npm test
npm run check:build
```

npm test runs retained filesystem/release tests, builds the site, checks the declared static production configuration, then checks local editor routing/recovery on an isolated test port. Installed Chrome is used; set CHROME_PATH if needed. The local static host tests the configuration, not Vercel's actual HTTPS platform. Scripts use separate runner-owned ports5186/5188. npm run preview uses Vite preview for manual inspection; its fallback behavior is not Vercel route verification.

Working S01–S05 capabilities remain: native writing/objects/text/equations, pages, independent scratchpad, laser/presentation, PDF annotation, supported structured DOCX/modernOMML, Word Terminal editing/recompilation/reveal, checked local recovery/archives and PNG/PDF export. The declared S05 subset is desktop-verified; editable legacy MathType/MTEF, Word visual fidelity, physical input/IME/Safari/reference acceptance, N01/N05 and production licensing remain open. Word PDF output is raster presentation. S05A/S06, slides, graphing/GeoGebra/simulations, GroupHub/Live Quiz/AI Tutor and classroom interactions remain required future work.

- [Deployment, environment, license activation and rollback](docs/deployment.md)
- [Exact cleanup and recovery procedure](docs/cleanup-inventory.md)
- [DEPLOY-01 results, screenshots and measurements](docs/verification/deploy-01/results.md)
- [Current roadmap](docs/implementation-roadmap.md)
- [S05 compatibility and limitations](docs/verification/s05/compatibility.md)

Original regression suites, experiments, fixtures and generated milestone artifacts are recoverable from verified local snapshots under .recovery/deploy-01/, excluded from Git/deployment. Important docs/ADRs and focused deployment tests stay active. Restore the post-verification snapshot with **--scope tests** before S05A; npm run test:legacy refuses to proceed when the legacy suite is absent. No uncommitted work is reset or overwritten, no Git history is purged, and no public production deployment or license purchase occurred. [Historical evidence policy](docs/verification/README.md).

Production configuration uses npm ci /npm run build /dist, app-only rewrites and scoped CSP/security/cache headers. VITE_EDITOR_RELEASE_ENABLED defaultsfalse; VITE_TLDRAW_LICENSE_KEY is an optional **public SDK identifier**; VITE_SITE_URL stays empty until the final public HTTPS domain is known. No private API credential belongs in VITE_ variables. Canonical/sitemap generation is omitted without that known domain. The temporary product identity is centralized in src/config/product.ts.

Stop after DEPLOY-01. **S05A and S06 have not started.**
