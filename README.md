# Lessonboard

Vietnamese product website and local teaching whiteboard. The verified production origin is **https://noteboardbymaikhuyen.vercel.app**. Public routes are `/`, `/updates`, `/help` and `/privacy`. The editor is loaded separately at `/app`.

The current public release is a **Preview**. `/app` reports its production availability explicitly. It requires `VITE_EDITOR_RELEASE_ENABLED=true` and an active tldraw license key that covers the deployed hostname. The SDK performs the actual license validation. Development runs the existing editor without those production settings.

Use Node 24.x and npm:

```powershell
npm ci
npm run dev
npm run typecheck
npm run build
npm run preview
```

The public site uses real editor screenshots, a shared product identity, typed update content and build-time static HTML for the public routes. Public visitors do not load the drawing/document engine or open lesson storage. Vercel uses `npm ci`, `npm run build` and `dist`. Clean public URLs and app-only rewrites preserve the static resources, PDF/PPTX/DOCX workers and current security policy.

The existing verified editor includes writing/object editing, text and equations, pages, independent scratchpad, laser, local persistence and portable `.teachboard` archives. PDF, structured DOCX/modern OMML and PPTX teaching are supported subsets with explicit limitations. Complex Office typography/media/animations and legacy MathType remain partial. Graphing, GeoGebra, simulations, GroupHub, Live Quiz and AI Tutor remain on the roadmap.

Lessons stay in IndexedDB at the same browser profile and origin. Moving between localhost, a preview URL and production does not transfer lessons. Download a `.teachboard` backup before changing origin, clearing site data or changing devices, then restore it through Open lesson. PNG/PDF are presentation exports. The app has no cloud synchronization or verified installable offline mode.

Production branch **main** uses the existing Vercel Git Integration in `sh1robus-projects/notebook-project`. The release workflow is code, typecheck/build, relevant browser checks, commit, normal push to main, Vercel build, then verify the public URL and commit status. Preview deployments remain subject to the project's configured Vercel access. A failed build must be diagnosed before another release. For rollback, select a previous ready deployment in the existing Vercel project or use a normal reviewed `git revert` and push after verification.

Product identity and the verified canonical hostname are in `src/config/product.ts`. `VITE_SITE_URL` can override the HTTPS canonical origin if the actual production domain changes. Never store provider secrets in public `VITE_` variables. See `.env.example` for the supported values.

Docs, verification source, fixtures and outputs remain local under the existing ignore rules. The compact verified recovery archives under `.recovery/` preserve the source tests for future milestones. Production code and required runtime/media assets are version controlled. Generated captures, traces, corpora, caches and recovery data are excluded from Git and deployment uploads.

- Public usage and data handling are available at `/help` and `/privacy`.
- Local release evidence is in `docs/release-feature-audit.md`, `docs/release-checklist.md`, `docs/release-notes.md` and `docs/verification/release-01/results.md`.
- Deployment and recovery details are in `docs/deployment.md`.
- S06 remains a separate milestone.
