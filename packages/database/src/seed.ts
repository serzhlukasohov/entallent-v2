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
import { isNull, and, eq } from 'drizzle-orm';
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

    const initialQuestions = [
      {
        stableKey: 'role_clarity',
        title: 'Role Clarity',
        canonicalMeaning: 'Does the employee clearly understand what is expected of them in their role?',
        dimension: 'engagement',
        questionGroup: 'growth',
        responseType: 'open_ended',
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
        stableKey: 'wellbeing_at_work',
        title: 'Wellbeing at Work',
        canonicalMeaning: 'How is the employee\'s overall wellbeing — energy, stress, and sense of balance at work?',
        dimension: 'wellbeing',
        questionGroup: 'belonging',
        responseType: 'open_ended',
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
        stableKey: 'professional_growth',
        title: 'Professional Growth',
        canonicalMeaning: 'Does the employee feel they are learning and growing professionally in their current role?',
        dimension: 'development',
        questionGroup: 'growth',
        responseType: 'open_ended',
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
    ];
    for (const q of initialQuestions) {
      await db
        .insert(surveyQuestions)
        .values({ surveyDefinitionId: surveyDef.id, ...q })
        .onConflictDoUpdate({
          target: [surveyQuestions.surveyDefinitionId, surveyQuestions.stableKey],
          set: {
            questionGroup: q.questionGroup,
            responseType: q.responseType,
          },
        });
    }

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

    // Upsert initial 3 questions (idempotent — also fixes group/type if they were inserted before migration)
    const initialGroupUpdates = [
      { stableKey: 'role_clarity',        questionGroup: 'growth',    responseType: 'open_ended' },
      { stableKey: 'wellbeing_at_work',   questionGroup: 'belonging', responseType: 'open_ended' },
      { stableKey: 'professional_growth', questionGroup: 'growth',    responseType: 'open_ended' },
    ];
    for (const { stableKey, questionGroup, responseType } of initialGroupUpdates) {
      await db
        .update(surveyQuestions)
        .set({ questionGroup, responseType })
        .where(
          and(
            eq(surveyQuestions.surveyDefinitionId, defId),
            eq(surveyQuestions.stableKey, stableKey),
          )
        );
    }
    console.log('✓ Updated question_group/response_type for initial 3 questions');

    const q12Questions = [
      {
        stableKey: 'q12_expectations',
        title: 'Clear Expectations',
        canonicalMeaning: 'Does the employee know what is expected of them at work?',
        dimension: 'engagement',
        questionGroup: 'autonomy',
        responseType: 'open_ended',
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
        questionGroup: 'autonomy',
        responseType: 'open_ended',
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
        questionGroup: 'purpose',
        responseType: 'open_ended',
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
        questionGroup: 'belonging',
        responseType: 'open_ended',
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
        questionGroup: 'autonomy',
        responseType: 'open_ended',
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
        questionGroup: 'growth',
        responseType: 'open_ended',
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
      await db
        .insert(surveyQuestions)
        .values({ surveyDefinitionId: defId, ...q })
        .onConflictDoUpdate({
          target: [surveyQuestions.surveyDefinitionId, surveyQuestions.stableKey],
          set: {
            questionGroup: q.questionGroup,
            responseType: q.responseType,
          },
        });
      console.log(`✓ Upserted Q12 question: ${q.stableKey}`);
    }

    // New pulse-check questions
    const newQuestions = [
      {
        stableKey: 'purpose_meaning',
        title: 'Work Meaningfulness',
        canonicalMeaning: 'Does the employee find their work meaningful?',
        dimension: 'purpose',
        questionGroup: 'purpose',
        responseType: 'open_ended',
        displayOrder: 20,
        positiveIndicators: ['finds work fulfilling', 'feels their work matters', 'energised by their tasks', 'connected to mission'],
        negativeIndicators: ['feels work is pointless', 'going through the motions', 'no passion left', 'disconnected'],
        probeStrategies: ['Ask what part of their work they find most meaningful', 'Explore what impact their work has had recently'],
        contraindications: ['active crisis', 'resignation announced'],
        confidenceThreshold: '0.70',
        completenessThreshold: '0.65',
      },
      {
        stableKey: 'purpose_contribution',
        title: 'Contribution Clarity',
        canonicalMeaning: 'Does the employee clearly see how their work contributes to something that matters?',
        dimension: 'purpose',
        questionGroup: 'purpose',
        responseType: 'open_ended',
        displayOrder: 21,
        positiveIndicators: ['can articulate impact', 'sees the bigger picture', 'understands how work fits the mission', 'feels relevant'],
        negativeIndicators: ['unsure why they do what they do', 'feels invisible', 'work feels siloed', 'no visibility into outcomes'],
        probeStrategies: ['Ask how their recent project connects to team goals', 'Explore whether they see the outcome of their work'],
        contraindications: ['active crisis'],
        confidenceThreshold: '0.70',
        completenessThreshold: '0.65',
      },
      {
        stableKey: 'belonging_psychological_safety',
        title: 'Psychological Safety',
        canonicalMeaning: 'Does the employee feel safe speaking up with concerns, ideas, or admitting mistakes?',
        dimension: 'relationship',
        questionGroup: 'belonging',
        responseType: 'open_ended',
        displayOrder: 22,
        positiveIndicators: ['comfortable raising concerns', 'feels heard when speaking up', 'can admit mistakes', 'team is non-judgmental'],
        negativeIndicators: ['afraid to speak up', 'fears retaliation', 'hides mistakes', 'silence in meetings'],
        probeStrategies: ['Ask about the last time they raised a concern or idea', 'Explore whether they feel safe disagreeing with their manager'],
        contraindications: ['active harassment signal', 'fear of termination'],
        confidenceThreshold: '0.75',
        completenessThreshold: '0.65',
      },
      {
        stableKey: 'engagement_nps',
        title: 'eNPS',
        canonicalMeaning: 'How likely is the employee to recommend this company as a place to work? (0–10)',
        dimension: 'engagement',
        questionGroup: 'engagement',
        responseType: 'numeric_0_10',
        displayOrder: 30,
        positiveIndicators: ['would definitely recommend', 'proud to work here', 'company is great employer'],
        negativeIndicators: ['would not recommend', 'embarrassed to mention employer', 'actively discouraging others'],
        probeStrategies: ['Ask how likely they are to recommend the company to a friend on a scale of 0 to 10'],
        contraindications: ['active crisis'],
        confidenceThreshold: '0.80',
        completenessThreshold: '0.80',
      },
      {
        stableKey: 'engagement_motivation',
        title: 'Motivation Frequency',
        canonicalMeaning: 'How often does the employee feel motivated to give their best effort at work? (0–10)',
        dimension: 'engagement',
        questionGroup: 'engagement',
        responseType: 'numeric_0_10',
        displayOrder: 31,
        positiveIndicators: ['almost always motivated', 'brings best self every day', 'driven to do excellent work'],
        negativeIndicators: ['rarely motivated', 'just doing the minimum', 'phone it in', 'disengaged'],
        probeStrategies: ['Ask how often they feel motivated to give their best, from 0 (never) to 10 (always)'],
        contraindications: [],
        confidenceThreshold: '0.80',
        completenessThreshold: '0.80',
      },
      {
        stableKey: 'engagement_current',
        title: 'Current Engagement',
        canonicalMeaning: 'How engaged does the employee feel with their work right now? (0–10)',
        dimension: 'engagement',
        questionGroup: 'engagement',
        responseType: 'numeric_0_10',
        displayOrder: 32,
        positiveIndicators: ['fully absorbed', 'time flies at work', 'invested in outcomes', 'energised'],
        negativeIndicators: ['checked out', 'watching the clock', 'present but absent', 'going through motions'],
        probeStrategies: ['Ask how engaged they feel with their current work on a scale of 0 to 10'],
        contraindications: [],
        confidenceThreshold: '0.80',
        completenessThreshold: '0.80',
      },
    ];

    for (const q of newQuestions) {
      await db
        .insert(surveyQuestions)
        .values({ surveyDefinitionId: defId, ...q })
        .onConflictDoUpdate({
          target: [surveyQuestions.surveyDefinitionId, surveyQuestions.stableKey],
          set: {
            questionGroup: q.questionGroup,
            responseType: q.responseType,
          },
        });
      console.log(`✓ Upserted new question: ${q.stableKey}`);
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
