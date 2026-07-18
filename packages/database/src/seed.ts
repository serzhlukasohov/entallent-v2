/**
 * Development seed: creates a minimal tenant + workspace connection so you can test the
 * Slack vertical slice locally without a full OAuth flow.
 *
 * Usage:
 *   DATABASE_URL=... FIELD_ENCRYPTION_KEY=... SLACK_BOT_TOKEN=xoxb-... SLACK_SIGNING_SECRET=... \
 *     npx tsx packages/database/src/seed.ts
 *
 * Or with the root .env loaded:
 *   pnpm db:seed
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createCipheriv, randomBytes } from 'crypto';
import { isNull, eq } from 'drizzle-orm';
import { tenants, workspaceConnections, surveyDefinitions, surveyQuestions, featureFlags } from './schema';

function encryptField(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

async function seed(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const encKey = process.env['FIELD_ENCRYPTION_KEY'];
  const botToken = process.env['SLACK_BOT_TOKEN'];
  const signingSecret = process.env['SLACK_SIGNING_SECRET'];
  const slackTeamId = process.env['SLACK_TEAM_ID'] ?? 'T_DEV_TEAM';
  const withSlack = Boolean(botToken && signingSecret);

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!encKey || encKey.length < 64) throw new Error('FIELD_ENCRYPTION_KEY must be 64 hex chars');
  if (!withSlack) {
    console.log('ℹ  SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET not set — skipping workspace connection seed.');
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);

  console.log('Seeding development data...');

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'Dev Tenant',
      status: 'active',
      retentionPolicy: { messageDays: 90, memoryDays: 365, auditLogDays: 730 },
      safetyPolicy: {
        escalationEmail: 'safety@example.com',
        enableCrisisResponse: true,
        blockedTopics: [],
      },
      proactiveMessagingPolicy: {
        enabled: true,
        maxPerWeek: 3,
        minIntervalHours: 24,
        allowedDays: [1, 2, 3, 4, 5],
        allowedHoursStart: 9,
        allowedHoursEnd: 18,
      },
    })
    .onConflictDoNothing()
    .returning({ id: tenants.id });

  let tenantId: string;
  if (!tenant) {
    console.log('Tenant already exists, skipping...');
    const [existing] = await db.select({ id: tenants.id }).from(tenants).limit(1);
    console.log(`Using existing tenant: ${existing.id}`);
    tenantId = existing.id;
  } else {
    tenantId = tenant.id;
    console.log(`✓ Created tenant: ${tenantId}`);
  }

  if (withSlack) {
    const credentials = JSON.stringify({ botToken, signingSecret });
    const encryptedCredentials = encryptField(credentials, encKey!);
    await db
      .insert(workspaceConnections)
      .values({
        tenantId,
        channelType: 'slack',
        externalWorkspaceId: slackTeamId,
        encryptedCredentials,
        status: 'active',
        scopes: ['chat:write', 'im:history', 'users:read'],
      })
      .onConflictDoNothing();
    console.log(`✓ Created workspace connection: Slack / ${slackTeamId}`);
  }

  console.log(`\nTenant ID: ${tenantId}`);
  console.log('Set DEFAULT_TENANT_ID=' + tenantId + ' in your .env for dev convenience.');

  // Seed global survey definition (applies to all tenants)
  const [existingDef] = await db
    .select({ id: surveyDefinitions.id })
    .from(surveyDefinitions)
    .where(isNull(surveyDefinitions.tenantId))
    .limit(1);

  if (!existingDef) {
    const [surveyDef] = await db
      .insert(surveyDefinitions)
      .values({
        tenantId: null,
        name: 'Employee Engagement Survey v1',
        version: '1.0.0',
        active: true,
        configuration: { defaultPeriodType: 'quarter' },
      })
      .returning({ id: surveyDefinitions.id });

    await db.insert(surveyQuestions).values([
      {
        surveyDefinitionId: surveyDef.id,
        stableKey: 'role_clarity',
        title: 'Role Clarity',
        canonicalMeaning: 'Does the employee clearly understand what is expected of them in their role?',
        dimension: 'engagement',
        positiveIndicators: [
          'knows what their goals are',
          'understands their responsibilities',
          'has clear priorities',
          'knows how their work is measured',
        ],
        negativeIndicators: [
          'confused about expectations',
          'unclear about priorities',
          'does not know what success looks like',
          'role feels ambiguous',
        ],
        probeStrategies: [
          'Ask about day-to-day priorities',
          'Ask if they know what a successful quarter looks like for them',
        ],
        contraindications: ['active crisis', 'severe distress', 'potential self-harm'],
        confidenceThreshold: '0.75',
        completenessThreshold: '0.70',
        minimumEvidenceCount: 2,
        cooldownDays: 7,
        maxFollowUpProbes: 3,
        displayOrder: 0,
        version: '1',
      },
      {
        surveyDefinitionId: surveyDef.id,
        stableKey: 'wellbeing_at_work',
        title: 'Wellbeing at Work',
        canonicalMeaning: 'How is the employee\'s overall wellbeing — energy, stress, and sense of balance at work?',
        dimension: 'wellbeing',
        positiveIndicators: [
          'feeling energised',
          'manageable workload',
          'good work-life balance',
          'feels supported',
          'positive about their situation',
        ],
        negativeIndicators: [
          'feeling exhausted or burned out',
          'overwhelmed',
          'high stress',
          'struggling to switch off',
          'workload feels unsustainable',
        ],
        probeStrategies: [
          'Ask how they are managing their workload',
          'Ask if they are able to recharge outside of work',
        ],
        contraindications: ['active crisis', 'potential self-harm', 'medical emergency'],
        confidenceThreshold: '0.70',
        completenessThreshold: '0.65',
        minimumEvidenceCount: 2,
        cooldownDays: 5,
        maxFollowUpProbes: 3,
        displayOrder: 1,
        version: '1',
      },
      {
        surveyDefinitionId: surveyDef.id,
        stableKey: 'professional_growth',
        title: 'Professional Growth',
        canonicalMeaning: 'Does the employee feel they are learning and growing professionally in their current role?',
        dimension: 'development',
        positiveIndicators: [
          'learning new skills',
          'taking on new challenges',
          'progressing toward career goals',
          'receiving useful feedback',
          'feels supported in development',
        ],
        negativeIndicators: [
          'feels stuck',
          'no opportunity to grow',
          'work feels repetitive',
          'skills are not being used',
          'career path is unclear',
        ],
        probeStrategies: [
          'Ask about recent things they have learned',
          'Ask about career goals and whether they feel supported in reaching them',
        ],
        contraindications: ['active crisis', 'harassment report', 'fear of termination'],
        confidenceThreshold: '0.75',
        completenessThreshold: '0.70',
        minimumEvidenceCount: 2,
        cooldownDays: 10,
        maxFollowUpProbes: 2,
        displayOrder: 2,
        version: '1',
      },
    ]);

    console.log('✓ Created global survey definition with 3 questions (role_clarity, wellbeing_at_work, professional_growth)');
  } else {
    console.log('✓ Global survey definition already exists, skipping');
  }

  // Seed Gallup Q12 questions into existing definition (idempotent by stableKey)
  const defRow = await db
    .select({ id: surveyDefinitions.id })
    .from(surveyDefinitions)
    .where(isNull(surveyDefinitions.tenantId))
    .limit(1);

  if (defRow[0]) {
    const defId = defRow[0].id;
    const q12Questions = [
      {
        stableKey: 'q12_expectations',
        title: 'Clear Expectations',
        canonicalMeaning: 'Does the employee know what is expected of them at work?',
        dimension: 'engagement',
        positiveIndicators: [
          'knows what their goals and KPIs are',
          'understands what success looks like in their role',
          'has clear priorities from their manager',
          'knows how their performance is measured',
        ],
        negativeIndicators: [
          'unclear what is expected',
          'unsure about priorities',
          'does not know what success looks like',
          'gets conflicting instructions',
          'role feels vague or undefined',
        ],
        probeStrategies: [
          'Ask whether they know what a successful quarter looks like for them specifically',
          'Ask about their OKRs or goals — do they feel clear and achievable?',
          'Ask what their manager cares most about in their work',
        ],
        contraindications: ['active crisis', 'severe distress'],
        confidenceThreshold: '0.72',
        completenessThreshold: '0.65',
        minimumEvidenceCount: 2,
        cooldownDays: 14,
        maxFollowUpProbes: 3,
        displayOrder: 10,
        version: '1',
      },
      {
        stableKey: 'q12_strengths_opportunity',
        title: 'Opportunity to Do Best Work',
        canonicalMeaning: 'Does the employee have the opportunity to do what they do best every day?',
        dimension: 'engagement',
        positiveIndicators: [
          'feels energised by their tasks',
          'work plays to their strengths',
          'gets to use their best skills regularly',
          'finds the work meaningful and stimulating',
        ],
        negativeIndicators: [
          'stuck doing tasks that don\'t use their strengths',
          'work feels repetitive or below their level',
          'energy is drained by day-to-day tasks',
          'feels underutilised',
          'no space for the work they are best at',
        ],
        probeStrategies: [
          'Ask what kinds of tasks give them energy vs. drain them',
          'Ask when they last felt "in the zone" at work — what were they doing?',
          'Ask whether their role lets them use the skills they are most proud of',
        ],
        contraindications: ['active crisis', 'harassment report'],
        confidenceThreshold: '0.72',
        completenessThreshold: '0.65',
        minimumEvidenceCount: 2,
        cooldownDays: 14,
        maxFollowUpProbes: 3,
        displayOrder: 11,
        version: '1',
      },
      {
        stableKey: 'q12_recognition',
        title: 'Recent Recognition',
        canonicalMeaning: 'Has the employee received recognition or praise for good work in the last seven days?',
        dimension: 'engagement',
        positiveIndicators: [
          'received praise or thanks recently',
          'manager or colleague acknowledged their work',
          'feels seen and appreciated',
          'got positive feedback this week',
        ],
        negativeIndicators: [
          'no recognition recently',
          'work goes unnoticed',
          'feels invisible or taken for granted',
          'never gets feedback on what is going well',
          'efforts feel unappreciated',
        ],
        probeStrategies: [
          'Ask whether anyone noticed or appreciated something they did recently',
          'Ask how their manager gives feedback — is it frequent enough?',
          'Ask about a recent win and whether the team celebrated it',
        ],
        contraindications: ['active crisis', 'severe distress'],
        confidenceThreshold: '0.70',
        completenessThreshold: '0.60',
        minimumEvidenceCount: 1,
        cooldownDays: 7,
        maxFollowUpProbes: 2,
        displayOrder: 12,
        version: '1',
      },
      {
        stableKey: 'q12_supervisor_cares',
        title: 'Supervisor Cares',
        canonicalMeaning: 'Does the employee feel that their supervisor, or someone at work, genuinely cares about them as a person — not just as a resource?',
        dimension: 'relationship',
        positiveIndicators: [
          'feels their manager genuinely listens to them',
          'manager checks in on how they are doing, not just on tasks',
          'feels supported as a person, not just as an employee',
          'comfortable sharing concerns with their manager',
        ],
        negativeIndicators: [
          'manager only talks to them about deliverables',
          'feels invisible or replaceable',
          'manager dismissed their concern without engaging',
          'feels like a resource, not a person',
          'raised something personal and was brushed off',
        ],
        probeStrategies: [
          'Ask how their manager typically responds when they raise something that isn\'t a task or a deadline',
          'Ask if anyone at work has checked in on how they\'re actually doing lately — not on the project, but on them',
          'When they mention being dismissed or unheard, explore whether that\'s a pattern or a one-off',
        ],
        contraindications: ['active crisis', 'severe distress', 'harassment report'],
        confidenceThreshold: '0.70',
        completenessThreshold: '0.65',
        minimumEvidenceCount: 2,
        cooldownDays: 14,
        maxFollowUpProbes: 3,
        displayOrder: 13,
        version: '1',
      },
      {
        stableKey: 'q12_opinions_count',
        title: 'Opinions Count',
        canonicalMeaning: 'Does the employee feel that their opinions and input actually matter at work — that they are heard and taken seriously?',
        dimension: 'engagement',
        positiveIndicators: [
          'feels their ideas are taken seriously',
          'input led to visible change or decision',
          'team or manager asks for their perspective',
          'feels like a contributor, not just an executor',
        ],
        negativeIndicators: [
          'raised an idea and nothing happened',
          'feels like decisions are made without their input',
          'suggestions are acknowledged but never acted on',
          'feels like they are just told what to do',
          'had feedback dismissed or politely ignored',
        ],
        probeStrategies: [
          'When they mention raising something and getting no follow-through, explore whether that\'s typical or unusual',
          'Ask whether they feel their input actually shapes how things get done on their team',
          'Ask about a recent situation where they had a view on something — what happened when they shared it',
        ],
        contraindications: ['active crisis', 'harassment report'],
        confidenceThreshold: '0.72',
        completenessThreshold: '0.65',
        minimumEvidenceCount: 2,
        cooldownDays: 14,
        maxFollowUpProbes: 3,
        displayOrder: 14,
        version: '1',
      },
      {
        stableKey: 'q12_progress_discussion',
        title: 'Progress Discussion',
        canonicalMeaning: 'In the last six months, has someone at work talked to the employee about their progress — career development, growth, or how they\'re doing beyond immediate tasks?',
        dimension: 'development',
        positiveIndicators: [
          'had a meaningful 1:1 about growth or career direction recently',
          'manager gave feedback on how they are progressing',
          'feels their development is being tracked or supported',
          'had a conversation about what\'s next for them professionally',
        ],
        negativeIndicators: [
          '1:1s only cover task status, never the person',
          'no one has asked about their career goals in a long time',
          'feels like development conversations don\'t happen',
          'has not had a meaningful review or check-in on growth recently',
          'would like guidance on where they are headed but no one has offered it',
        ],
        probeStrategies: [
          'Ask whether anyone has sat down with them recently to talk about how they\'re progressing — not tasks, but them',
          'When they mention wanting something different (like architecture time), explore whether anyone has actually talked with them about where they want to go',
          'Ask when the last time was that their manager asked about their career, not their current sprint',
        ],
        contraindications: ['active crisis', 'fear_of_termination'],
        confidenceThreshold: '0.72',
        completenessThreshold: '0.65',
        minimumEvidenceCount: 2,
        cooldownDays: 21,
        maxFollowUpProbes: 2,
        displayOrder: 15,
        version: '1',
      },
    ];

    for (const q of q12Questions) {
      const existing = await db
        .select({ id: surveyQuestions.id })
        .from(surveyQuestions)
        .where(eq(surveyQuestions.stableKey, q.stableKey))
        .limit(1);
      if (!existing[0]) {
        await db.insert(surveyQuestions).values({ surveyDefinitionId: defId, ...q });
        console.log(`✓ Added Q12 question: ${q.stableKey}`);
      } else {
        console.log(`  Q12 question already exists: ${q.stableKey}`);
      }
    }
  }

  // Seed global feature flags (enabled by default for dev)
  const devFlags = [
    'memory_extraction',
    'conversational_survey',
    'risk_detection',
    'proactive_messaging',
    'manager_analytics',
  ];
  for (const key of devFlags) {
    await db
      .insert(featureFlags)
      .values({ key, tenantId: null, enabled: true, rolloutPercentage: 100 })
      .onConflictDoNothing();
  }
  console.log('✓ Global feature flags enabled:', devFlags.join(', '));

  console.log('\nYou can now send a Slack DM to the bot to test the vertical slice.');

  await sql.end();
}

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
