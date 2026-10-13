/**
 * ADR-013 R4 latency check for the always-on safety assessment (Wave 1, G1/G9).
 *
 * Measures the model critical path of one conversation turn against the configured provider,
 * interleaving the two pipeline shapes on the same synthetic transcripts so model drift hits both:
 *
 *   before: classify → (detectRisk only when the classifier asks for it) → generate
 *   after:  (classify ‖ detectRisk) → generate
 *
 * Generation is identical in both shapes, so it is timed once per round and added to both.
 * DB/queue time is excluded (unchanged by this change), which makes the relative delta an upper
 * bound for the end-to-end turn.
 *
 * Opt-in: sends synthetic, non-personal transcripts to the model provider configured in .env.
 *   set -a; source .env; set +a; node --import tsx scripts/safety-latency-bench.ts [rounds]
 */
import { OpenAiProvider } from '../packages/ai-openai/src/index';
import type { ConversationTurn, LanguagePolicy } from '../packages/application/src/index';

const SAFETY_INTENTS = new Set(['burnout_signal', 'harassment_signal', 'potential_crisis']);

const SCENARIOS: Array<{ name: string; lang: 'en' | 'ru' | 'uk'; turns: string[] }> = [
  { name: 'en-casual', lang: 'en', turns: ['Hi!', 'Hey, how is your week going?', 'Pretty good, release went out on Tuesday.'] },
  { name: 'en-progress', lang: 'en', turns: ['I finished the onboarding doc.', 'Nice work. What is next?', 'Next I want to pair with the new hire on the API.'] },
  { name: 'en-planning', lang: 'en', turns: ['Can you help me plan my 1:1 agenda?', 'Sure, what topics matter most?', 'Career growth and the Q4 roadmap.'] },
  { name: 'ru-casual', lang: 'ru', turns: ['Привет', 'Привет! Как дела?', 'Нормально, сегодня было много встреч.'] },
  { name: 'uk-progress', lang: 'uk', turns: ['Я закінчила рев\'ю коду.', 'Чудово! Що далі?', 'Далі хочу взятися за тести.'] },
  { name: 'en-burnout', lang: 'en', turns: ['I am exhausted.', 'That sounds hard. What is going on?', 'I have worked every weekend for two months and I cannot sleep anymore.'] },
  { name: 'ru-conflict', lang: 'ru', turns: ['Мне тяжело с руководителем.', 'Что происходит?', 'Он постоянно кричит на меня при всей команде.'] },
  { name: 'en-stress', lang: 'en', turns: ['Work is a lot right now.', 'Tell me more.', 'I am afraid I will be fired after the reorg.'] },
];

function turnsOf(texts: string[]): ConversationTurn[] {
  const start = Date.now() - texts.length * 60_000;
  return texts.map((content, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
    timestamp: new Date(start + i * 60_000),
  }));
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const value = await fn();
  return [value, performance.now() - t];
}

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] ?? NaN);
}

async function main(): Promise<void> {
  const rounds = Number(process.argv[2] ?? 6);
  const provider = process.env.AZURE_OPENAI_ENDPOINT
    ? new OpenAiProvider({
      azure: true,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY ?? '',
      apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '',
      deploymentName: process.env.OPENAI_MODEL_BALANCED ?? 'gpt-4o',
    })
    : new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY ?? '' });

  const before: number[] = [];
  const after: number[] = [];
  const stageBefore: number[] = [];
  const stageAfter: number[] = [];
  const benignBefore: number[] = [];
  const benignAfter: number[] = [];
  let gatedRiskTurns = 0;
  let failures = 0;

  for (let round = 0; round < rounds; round += 1) {
    for (const scenario of SCENARIOS) {
      const turns = turnsOf(scenario.turns);
      const ctx = { userName: 'Sam', now: new Date().toISOString(), timezone: 'Europe/Kyiv' };
      try {
        // Alternate which shape runs first to cancel warm-cache ordering effects.
        const runBefore = async () => {
          const [classification, classifyMs] = await timed(() => provider.classifySituation(turns, ctx));
          const gated = classification.requiresSafetyCheck
            || [classification.primaryIntent, ...classification.secondaryIntents].some((i) => SAFETY_INTENTS.has(i));
          if (gated) gatedRiskTurns += 1;
          const riskMs = gated ? (await timed(() => provider.detectRisk(turns, { userName: 'Sam' })))[1] : 0;
          return { stage: classifyMs + riskMs, gated };
        };
        const runAfter = async () => {
          const [, stage] = await timed(() => Promise.all([
            provider.classifySituation(turns, ctx),
            provider.detectRisk(turns, { userName: 'Sam' }),
          ]));
          return stage;
        };
        let b: Awaited<ReturnType<typeof runBefore>>;
        let a: number;
        if ((round + SCENARIOS.indexOf(scenario)) % 2 === 0) {
          b = await runBefore();
          a = await runAfter();
        } else {
          a = await runAfter();
          b = await runBefore();
        }
        const languagePolicy: LanguagePolicy = {
          responseLanguage: scenario.lang, source: 'tenant_default', confidence: 0.4, shouldUpdateUserLocale: false,
        };
        const [, generateMs] = await timed(() => provider.generateResponse(turns, {
          mode: 'normal', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'short', forbiddenPatterns: [],
        }, { userName: 'Sam', languagePolicy }));
        stageBefore.push(b.stage);
        stageAfter.push(a);
        before.push(b.stage + generateMs);
        after.push(a + generateMs);
        if (!b.gated) {
          benignBefore.push(b.stage + generateMs);
          benignAfter.push(a + generateMs);
        }
        process.stderr.write('.');
      } catch (err) {
        failures += 1;
        process.stderr.write(`x(${scenario.name}: ${(err as Error).message.slice(0, 80)})`);
      }
    }
  }
  process.stderr.write('\n');

  const summary = {
    model: process.env.OPENAI_MODEL_BALANCED ?? 'default',
    turns: before.length,
    failures,
    gatedRiskTurnShare: Number((gatedRiskTurns / Math.max(1, before.length * 1)).toFixed(2)),
    stage: { before: { p50: pct(stageBefore, 50), p95: pct(stageBefore, 95) }, after: { p50: pct(stageAfter, 50), p95: pct(stageAfter, 95) } },
    turnModelPath: { before: { p50: pct(before, 50), p95: pct(before, 95) }, after: { p50: pct(after, 50), p95: pct(after, 95) } },
    // Worst case for R4: a production mix with almost no classifier-gated risk turns.
    benignOnlyTurnModelPath: {
      turns: benignBefore.length,
      before: { p50: pct(benignBefore, 50), p95: pct(benignBefore, 95) },
      after: { p50: pct(benignAfter, 50), p95: pct(benignAfter, 95) },
    },
  };
  const deltaP95 = (summary.turnModelPath.after.p95 - summary.turnModelPath.before.p95) / summary.turnModelPath.before.p95;
  console.log(JSON.stringify({ ...summary, turnModelPathP95Delta: Number(deltaP95.toFixed(3)), r4Budget: 0.1, withinBudget: deltaP95 <= 0.1 }, null, 2));
}

void main();
