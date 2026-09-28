# Railway deployment — Company Hierarchy demo

- Last deployed: 2026-09-28
- URL: https://site-production-7b9a.up.railway.app/
- Railway project: `entalent-company-hierarchy-demo` (`3af2d90c-df77-4c47-a865-499760eea523`)
- Environment: `production` (`b89b750a-c078-45a2-9908-6d0ba8b3066a`)
- Service: `site` (`b9fc56e8-0a4c-4112-b88c-cdcfd0b342fa`)
- Deployment: `fee97f23-c4ae-41e7-90be-02494126a9a8` — `SUCCESS` (English version)
- Previous deployment: `ecd8d48d-dcdf-489e-81a1-7af3268f5ed0` — `SUCCESS` (Russian version)
- Source: `railway-site/` static Docker image. The deployed image contains only `index.html` and four PNG screenshots.
- Verification: `/` and all four PNGs returned HTTP 200; README, speaker notes, and server source returned HTTP 404. English title, slides, browser navigation, zoom, and image loading passed.

The link is public and has no sign-in. The screenshots contain test names and internal pilot identifiers. The production API, worker, dashboard, and database are not connected to this project.
