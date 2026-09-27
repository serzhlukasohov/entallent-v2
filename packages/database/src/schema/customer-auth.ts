import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { people } from './people';
import { tenants } from './tenants';

/** One corporate OpenID Connect provider per tenant in the MVP. */
export const orgOidcProviders = pgTable('org_oidc_providers', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  issuerUrl: text('issuer_url').notNull(),
  clientId: text('client_id').notNull(),
  encryptedClientSecret: text('encrypted_client_secret').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  status: text('status').notNull().default('inactive'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  issuerHttps: check('org_oidc_providers_issuer_https', sql`${t.issuerUrl} LIKE 'https://%'`),
  redirectHttps: check('org_oidc_providers_redirect_https', sql`${t.redirectUri} LIKE 'https://%'`),
  clientIdNotBlank: check('org_oidc_providers_client_id_not_blank', sql`length(btrim(${t.clientId})) > 0`),
  statusValid: check('org_oidc_providers_status_valid', sql`${t.status} IN ('active', 'inactive')`),
}));

/** Stable issuer + subject binding; email is retained only for diagnostics. */
export const orgOidcSubjects = pgTable('org_oidc_subjects', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull(),
  issuerUrl: text('issuer_url').notNull(),
  subject: text('subject').notNull(),
  emailAtLink: text('email_at_link'),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (t) => ({
  personTenant: foreignKey({ columns: [t.personId, t.tenantId], foreignColumns: [people.id, people.tenantId] }),
  oneSubjectPerPerson: uniqueIndex('org_oidc_subjects_tenant_person_idx').on(t.tenantId, t.personId),
  onePersonPerSubject: uniqueIndex('org_oidc_subjects_tenant_issuer_subject_idx').on(t.tenantId, t.issuerUrl, t.subject),
  issuerHttps: check('org_oidc_subjects_issuer_https', sql`${t.issuerUrl} LIKE 'https://%'`),
  subjectNotBlank: check('org_oidc_subjects_subject_not_blank', sql`length(btrim(${t.subject})) > 0`),
}));

/** One-use browser login state. Only a digest of the browser secret is stored. */
export const orgOidcLoginAttempts = pgTable('org_oidc_login_attempts', {
  stateHash: text('state_hash').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  encryptedNonce: text('encrypted_nonce').notNull(),
  encryptedCodeVerifier: text('encrypted_code_verifier').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  expiryIdx: index('org_oidc_login_attempts_expiry_idx').on(t.expiresAt),
}));

/** Opaque, revocable customer session. The browser token is never stored in plaintext. */
export const orgCompanyAdminSessions = pgTable('org_company_admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull(),
  bindingFingerprint: text('binding_fingerprint'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  personTenant: foreignKey({ columns: [t.personId, t.tenantId], foreignColumns: [people.id, people.tenantId] }),
  expiryIdx: index('org_company_admin_sessions_expiry_idx').on(t.expiresAt),
  bindingFingerprintValid: check('org_company_admin_sessions_binding_fingerprint_valid',
    sql`${t.bindingFingerprint} IS NULL OR ${t.bindingFingerprint} ~ '^[0-9a-f]{64}$'`),
}));

export type DbOrgOidcProvider = typeof orgOidcProviders.$inferSelect;
export type DbOrgOidcSubject = typeof orgOidcSubjects.$inferSelect;
export type DbOrgOidcLoginAttempt = typeof orgOidcLoginAttempts.$inferSelect;
export type DbOrgCompanyAdminSession = typeof orgCompanyAdminSessions.$inferSelect;
