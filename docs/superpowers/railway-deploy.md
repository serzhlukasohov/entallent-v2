# Railway Deploy Memory

Last verified: 2026-08-04.

Project: `reasonable-adaptation`.
Environment: `production`.
App services: `api`, `worker`, `dashboard`.

GitHub auto-deploy is currently working for pushes to `main` from `serzhlukasohov/entallent-v2`.

Evidence from 2026-08-04:
- Pushed commit `759d017c42cf8f46575f2374b9433121477a7d74`.
- Railway automatically deployed the same commit to all three app services without running `railway up`.
- `api` deployment `4d19fb5d-6f14-4469-af94-ff2b942b6dbc`: `SUCCESS`.
- `worker` deployment `d09b3cf7-28b9-4522-86d7-457354355599`: `SUCCESS`.
- `dashboard` deployment `b397f8a6-5860-4541-9f8f-59b558f2afef`: `SUCCESS`.
- API health returned `{"status":"ok"}`.
- Dashboard returned `HTTP 200`.

Before assuming auto-deploy is broken, check:

```sh
railway deployment list --service api --limit 3 --json
railway deployment list --service worker --limit 3 --json
railway deployment list --service dashboard --limit 3 --json
```

Use manual deploy only as a fallback if a pushed `main` commit does not appear in Railway:

```sh
railway up --service api --detach
railway up --service worker --detach
railway up --service dashboard --detach
```
