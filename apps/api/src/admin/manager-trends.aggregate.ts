export interface EngagementPoint {
  date: string; // YYYY-MM-DD
  activeUsers: number;
  inboundMessages: number;
}

export interface SignalPoint {
  date: string; // YYYY-MM-DD
  total: number;
  positive: number;
  negative: number;
  mixed: number;
  neutral: number;
}

export interface QuestionSentiment {
  stableKey: string;
  title: string;
  dimension: string;
  positive: number;
  negative: number;
  mixed: number;
  neutral: number;
  total: number;
  /** net = (positive - negative) / total, in [-1, 1]; null when no evidence */
  net: number | null;
}

export interface TrendsResult {
  rangeStart: string;
  rangeEnd: string;
  engagement: EngagementPoint[];
  signalCapture: SignalPoint[];
  coverageFunnel: Record<string, number>;
  questionSentiment: QuestionSentiment[];
}

export interface EngagementRow {
  day: string; // YYYY-MM-DD
  activeUsers: number;
  inboundMessages: number;
}
export interface SignalRow {
  day: string; // YYYY-MM-DD
  polarity: string;
  count: number;
}
export interface FunnelRow {
  status: string;
  count: number;
}
export interface QuestionRow {
  stableKey: string;
  title: string;
  dimension: string;
  polarity: string;
  count: number;
}

export interface BuildTrendsInput {
  /** Inclusive end date (YYYY-MM-DD), typically today in the reporting tz */
  rangeEnd: string;
  /** Number of days in the window (rangeEnd included) */
  days: number;
  engagement: EngagementRow[];
  signals: SignalRow[];
  funnel: FunnelRow[];
  questions: QuestionRow[];
}

const POLARITIES = ['positive', 'negative', 'mixed', 'neutral'] as const;

/** All assessment statuses, in funnel order, so the UI always renders every bucket. */
const FUNNEL_STATUSES = [
  'unknown',
  'insufficient_evidence',
  'partially_covered',
  'covered',
  'scored',
  'needs_review',
  'suppressed',
] as const;

/** YYYY-MM-DD strings for the `days` days ending at (and including) rangeEnd. */
export function dateRange(rangeEnd: string, days: number): string[] {
  const end = new Date(`${rangeEnd}T00:00:00Z`);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Shapes raw grouped query rows into continuous daily series (gaps filled with
 * zeros so charts don't lie about missing days), a complete coverage funnel, and
 * per-question cohort sentiment. Pure so it can be unit-tested without a database.
 */
export function buildTrends(input: BuildTrendsInput): TrendsResult {
  const dates = dateRange(input.rangeEnd, input.days);

  // Engagement — index by day, fill gaps
  const engByDay = new Map(input.engagement.map((r) => [r.day, r]));
  const engagement: EngagementPoint[] = dates.map((date) => {
    const r = engByDay.get(date);
    return {
      date,
      activeUsers: r?.activeUsers ?? 0,
      inboundMessages: r?.inboundMessages ?? 0,
    };
  });

  // Signal capture — bucket polarity counts per day, fill gaps
  const sigByDay = new Map<string, SignalPoint>();
  for (const date of dates) {
    sigByDay.set(date, { date, total: 0, positive: 0, negative: 0, mixed: 0, neutral: 0 });
  }
  for (const r of input.signals) {
    const point = sigByDay.get(r.day);
    if (!point) continue; // outside window
    if ((POLARITIES as readonly string[]).includes(r.polarity)) {
      point[r.polarity as (typeof POLARITIES)[number]] += r.count;
    }
    point.total += r.count;
  }
  const signalCapture = dates.map((d) => sigByDay.get(d)!);

  // Coverage funnel — ensure every status present
  const funnel: Record<string, number> = {};
  for (const s of FUNNEL_STATUSES) funnel[s] = 0;
  for (const r of input.funnel) funnel[r.status] = (funnel[r.status] ?? 0) + r.count;

  // Per-question sentiment
  const qMap = new Map<string, QuestionSentiment>();
  for (const r of input.questions) {
    let q = qMap.get(r.stableKey);
    if (!q) {
      q = {
        stableKey: r.stableKey,
        title: r.title,
        dimension: r.dimension,
        positive: 0,
        negative: 0,
        mixed: 0,
        neutral: 0,
        total: 0,
        net: null,
      };
      qMap.set(r.stableKey, q);
    }
    if ((POLARITIES as readonly string[]).includes(r.polarity)) {
      q[r.polarity as (typeof POLARITIES)[number]] += r.count;
    }
    q.total += r.count;
  }
  const questionSentiment = [...qMap.values()]
    .map((q) => ({
      ...q,
      net: q.total > 0 ? Math.round(((q.positive - q.negative) / q.total) * 100) / 100 : null,
    }))
    // most negative first — those need attention
    .sort((a, b) => (a.net ?? 1) - (b.net ?? 1));

  return {
    rangeStart: dates[0],
    rangeEnd: dates[dates.length - 1],
    engagement,
    signalCapture,
    coverageFunnel: funnel,
    questionSentiment,
  };
}
