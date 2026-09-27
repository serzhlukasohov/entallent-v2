/** One-time operator bootstrap. Never accepts the OIDC client secret on the command line. */
import { and, eq, isNull, or } from 'drizzle-orm';
import { encryptField } from '@entalent/crypto-utils';
import {
  auditLogs, createDbClient, orgOidcProviders, orgOidcSubjects,
  orgPersonCapabilities, people, tenants, users,
} from '@entalent/database';
import { discoverCorporateOidc } from '../src/company-auth/oidc-verifier';

type BootstrapInput = {
  tenantId: string;
  personId: string;
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  subject: string;
  operatorId: string;
};

function parseArgs(args: string[]): BootstrapInput {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--') || values.has(key)) {
      throw new Error('Expected unique --name value argument pairs');
    }
    values.set(key, value);
  }
  const required = ['tenant-id', 'person-id', 'issuer', 'client-id', 'redirect-uri', 'subject', 'operator-id'];
  for (const key of required) if (!values.get(`--${key}`)) throw new Error(`Missing --${key}`);
  if (values.size !== required.length) throw new Error('Unexpected bootstrap argument');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(values.get('--tenant-id')!) || !uuid.test(values.get('--person-id')!)) {
    throw new Error('Tenant and Person IDs must be UUIDs');
  }
  const redirect = new URL(values.get('--redirect-uri')!);
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.hash || redirect.search ||
      redirect.pathname !== '/api/v1/company-auth/callback') {
    throw new Error('Redirect URI must be the HTTPS Company Admin callback');
  }
  return {
    tenantId: values.get('--tenant-id')!, personId: values.get('--person-id')!,
    issuerUrl: values.get('--issuer')!, clientId: values.get('--client-id')!,
    redirectUri: redirect.toString(), subject: values.get('--subject')!,
    operatorId: values.get('--operator-id')!,
  };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env['DATABASE_URL'];
  const key = process.env['FIELD_ENCRYPTION_KEY'];
  const clientSecret = process.env['OIDC_CLIENT_SECRET'];
  if (!databaseUrl || !key || !/^[0-9a-f]{64}$/i.test(key) || !clientSecret) {
    throw new Error('DATABASE_URL, FIELD_ENCRYPTION_KEY, and OIDC_CLIENT_SECRET are required');
  }
  if (!input.subject.trim() || !input.clientId.trim() || !input.operatorId.trim()) {
    throw new Error('Subject, client ID, and operator ID must be nonempty');
  }
  await discoverCorporateOidc(input.issuerUrl);
  const { db, sql } = createDbClient(databaseUrl);
  try {
    await db.transaction(async (tx) => {
      const [person] = await tx.select({
        personId: people.id, workEmail: people.workEmail,
        personStatus: people.lifecycleStatus, userStatus: users.status,
      }).from(people)
        .innerJoin(tenants, eq(tenants.id, people.tenantId))
        .innerJoin(users, and(eq(users.id, people.id), eq(users.tenantId, people.tenantId)))
        .where(and(eq(people.id, input.personId), eq(people.tenantId, input.tenantId),
          eq(tenants.status, 'active'), isNull(users.deletedAt),
          or(and(eq(people.lifecycleStatus, 'draft'), eq(users.status, 'inactive')),
            and(eq(people.lifecycleStatus, 'active'), eq(users.status, 'active'))))).limit(1);
      if (!person) throw new Error('No eligible same-tenant Person for bootstrap');
      const [existing] = await tx.select({ tenantId: orgOidcProviders.tenantId })
        .from(orgOidcProviders).where(eq(orgOidcProviders.tenantId, input.tenantId)).limit(1);
      if (existing) throw new Error('OIDC provider already configured; use a reviewed rotation workflow');

      await tx.insert(orgOidcProviders).values({
        tenantId: input.tenantId, issuerUrl: input.issuerUrl,
        clientId: input.clientId, encryptedClientSecret: encryptField(clientSecret, key),
        redirectUri: input.redirectUri, status: 'active',
      });
      await tx.insert(orgOidcSubjects).values({
        tenantId: input.tenantId, personId: input.personId,
        issuerUrl: input.issuerUrl, subject: input.subject, emailAtLink: person.workEmail,
      });
      await tx.insert(orgPersonCapabilities).values({
        tenantId: input.tenantId, personId: input.personId,
        capability: 'company_admin', lifecycleStatus: 'active',
      }).onConflictDoUpdate({
        target: [orgPersonCapabilities.personId, orgPersonCapabilities.capability],
        set: { lifecycleStatus: 'active' },
      });
      await tx.insert(auditLogs).values({
        tenantId: input.tenantId, actorType: 'operator', actorId: input.operatorId,
        action: 'org.company_admin.oidc.bootstrap', resourceType: 'person',
        resourceId: input.personId,
        metadata: { issuerUrl: input.issuerUrl, subject: input.subject },
      });
    }, { isolationLevel: 'serializable' });
    process.stdout.write('Company Admin OIDC bootstrap committed.\n');
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Bootstrap failed'}\n`);
  process.exitCode = 1;
});
