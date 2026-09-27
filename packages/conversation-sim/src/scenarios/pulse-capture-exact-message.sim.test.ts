import { agent as agentTurn, run, succeed, user, userSimulatorAgent } from '@langwatch/scenario';
import type { SurveyRepositoryPort } from '@entalent/application';
import { describe, expect, it, vi } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { reportRun } from '../harness/report';
import { simulatorModel } from './config';

describe('CAP-8 exact-message pulse capture', () => {
  it.each(['quoted', 'descriptive', 'mixed-status'] as const)(
    'uses only the %s source message and records its provenance',
    async (wording) => {
      const mixedStatus = wording === 'mixed-status';
      const sourceText = 'The new desk plants made our shared workspace feel welcoming.';
      const otherText = 'The release schedule changed twice and made planning difficult.';
      const sourceSummary = 'The shared workspace feels welcoming.';
      const otherSummary = 'Release planning is difficult.';
      const mixedSummary = 'The shared workspace and release plan have mixed signals.';
      const findPulseCaptureForConversation = vi.fn(async (params: { sourceMessageId?: string }) =>
        [
          {
            evidenceSummary: sourceSummary,
            questionGroup: 'belonging',
            sourceMessageIds: [source.id],
            status: mixedStatus ? ('confirmed' as const) : ('temporary' as const),
          },
          {
            evidenceSummary: otherSummary,
            questionGroup: 'growth',
            sourceMessageIds: [other.id],
            status: 'temporary' as const,
          },
          ...(mixedStatus
            ? [
                {
                  evidenceSummary: mixedSummary,
                  questionGroup: 'belonging',
                  sourceMessageIds: [source.id, other.id],
                  status: 'temporary' as const,
                },
              ]
            : []),
        ].filter(
          (item) =>
            !params.sourceMessageId || item.sourceMessageIds.includes(params.sourceMessageId),
        ),
      );
      const { agent, harness } = createCoachAgent({
        surveyRepo: { findPulseCaptureForConversation } as unknown as SurveyRepositoryPort,
      });
      const source = await harness.conversationRepo.saveMessage({
        conversationId: 'sim-conversation',
        tenantId: 'sim-tenant',
        userId: 'sim-user',
        direction: 'inbound',
        text: sourceText,
        occurredAt: new Date(Date.now() - 60_000),
      });
      const other = await harness.conversationRepo.saveMessage({
        conversationId: 'sim-conversation',
        tenantId: 'sim-tenant',
        userId: 'sim-user',
        direction: 'inbound',
        text: otherText,
        occurredAt: new Date(Date.now() - 30_000),
      });
      const question =
        wording === 'quoted'
          ? `For this exact earlier message: “${sourceText}” What pulse information did you capture? Only that message, not the whole conversation.`
          : 'Did my exact message about the new desk plants making our shared workspace welcoming get captured as Pulse evidence? I mean only that message, not this whole conversation.';
      const scenarioName = `CAP-8 ${wording} exact-message pulse capture`;
      const result = await run({
        name: scenarioName,
        description:
          'A synthetic employee asks about one earlier message while another message has different persisted pulse evidence.',
        agents: [agent, userSimulatorAgent({ model: simulatorModel() })],
        script: [user(question), agentTurn(), succeed()],
        maxTurns: 3,
        langwatch: { apiKey: '' },
      });

      const reply = harness.replies[0] ?? '';
      const outbound = harness.transcript.find((message) => message.direction === 'outbound');
      expect(harness.turns[0]?.classification.primaryIntent).toBe('pulse_capture_explanation');
      expect(findPulseCaptureForConversation).toHaveBeenCalledOnce();
      expect(findPulseCaptureForConversation).toHaveBeenCalledWith(
        expect.objectContaining({ sourceMessageId: source.id }),
      );
      expect(reply).toContain(sourceSummary);
      expect(reply).not.toContain(otherSummary);
      if (mixedStatus) {
        expect(reply).toMatch(/The shared workspace feels welcoming\. — confirmed/);
        expect(reply).toMatch(
          /The shared workspace and release plan have mixed signals\. — temporary/,
        );
      }
      expect(outbound?.metadata?.pulseCaptureSourceMessageId).toBe(source.id);
      await reportRun(scenarioName, harness, result, false);
    },
  );
});
