# Company Hierarchy: first Company Admin sign-in

Company Admin signs in through the customer's corporate OpenID Connect provider. Slack OAuth only connects a workspace. An email match never grants Company Admin access: the operator explicitly binds an OIDC issuer and `sub` to a Person with an active `company_admin` capability.

## Before bootstrap

1. Create a confidential OIDC application for enTalent at the customer's identity provider. Enable Authorization Code, PKCE S256, `client_secret_basic` token endpoint authentication, and `openid email profile`. Register the HTTPS redirect URI ending in `/api/v1/company-auth/callback` on the API origin.
2. Record the exact issuer URL from the provider discovery document, client ID, client secret, and the first administrator's **ID token `sub` for this OIDC application**. Entra `oid`, email, and Slack user ID are not substitutes for `sub`.
3. Create the administrator as a same-tenant Person. A draft Person with an inactive runtime user is valid before Unit rollout. Record the Person UUID and tenant UUID.
4. Apply the migration chain through `0025` in order. The API migration runner applies outstanding migrations on startup; identify the database environment before starting a new deployment.

## Operator bootstrap

The one-time script is [bootstrap-company-admin-oidc.ts](../apps/api/scripts/bootstrap-company-admin-oidc.ts). It requires `DATABASE_URL`, `FIELD_ENCRYPTION_KEY`, and `OIDC_CLIENT_SECRET` in the process environment. Keep the client secret out of command arguments and logs. The script refuses to overwrite an existing provider.

```sh
pnpm --filter @entalent/api company-admin:oidc:bootstrap \
  --tenant-id "$TENANT_ID" --person-id "$PERSON_ID" \
  --issuer "$OIDC_ISSUER" --client-id "$OIDC_CLIENT_ID" \
  --redirect-uri "$OIDC_REDIRECT_URI" \
  --subject "$OIDC_SUBJECT" --operator-id "$OPERATOR_ID"
```

The script validates discovery and the Person/tenant lifecycle, then commits the encrypted provider secret, subject binding, active capability, and operator audit record in one serializable transaction. If the first administrator is already configured, review a separate rotation or additional-admin procedure; do not rerun bootstrap with different credentials.

## Customer flow

The Company Admin opens `/api/v1/company-setup/ui?tenantId=<tenant-uuid>` on the API origin. After corporate sign-in, the OIDC callback redirects to the dedicated setup UI. Browser login state is single-use and expires after 10 minutes. The opaque Company Admin session expires after eight hours and is revalidated against tenant, the exact issuer/subject binding used at login, Person lifecycle, and capability on each request. Migration `0025` makes pre-existing sessions without this binding fail closed, requiring a new sign-in. Setup writes require a CSRF token returned by `/api/v1/company-auth/me`.

The setup UI previews CSV errors, appends draft hierarchy data, links or reserves Slack identities, moves active Employees, checks Unit readiness, and activates a ready Unit. Rollout and Slack delivery still need live acceptance before customer use.
