# enTalent — Internal Pulse Dashboard

Internal product-testing dashboard showing pulse collection state: per-employee coverage,
signal polarity, and self-contained evidence insights.

## Running

```bash
pnpm --filter @entalent/dashboard dev   # http://localhost:3002 (3001 is the worker's health port)
```

## Configuration (`.env.local`)

| Var                | Purpose                                                     |
| ------------------ | ---------------------------------------------------------- |
| `API_INTERNAL_URL` | Base URL of the API (e.g. `http://localhost:3000/api/v1`) |
| `ADMIN_API_KEY`    | Sent as `x-api-key` to the API's admin endpoints           |
| `TENANT_ID`        | Which tenant's team to display                             |
| `INTERNAL_DASHBOARD_ENABLED` | Must be `true` or `1` before the dashboard fetches or posts admin data |

## Security model

- The dashboard has **no user-facing login**. It authenticates to the API with a
  shared `ADMIN_API_KEY` from server-side env — the key never reaches the browser
  (data is fetched in a React Server Component).
- The dashboard and its named employee API routes are disabled unless
  `INTERNAL_DASHBOARD_ENABLED=true` or `1`.
- Anyone who can reach the dashboard's port sees the configured tenant's data.
  **It must be network-restricted** (VPN / internal network / auth proxy) in any
  non-local deployment.
- The API enforces `ADMIN_API_KEY` and **fails closed in production**: if the key
  is unset while `NODE_ENV=production`, admin endpoints reject all requests.
- Cohort-safety: aggregate analytics endpoints suppress data below a minimum
  cohort size; the per-employee manager view is intentionally identifiable and is
  therefore gated behind the admin key.
