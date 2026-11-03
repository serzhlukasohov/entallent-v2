import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScriptedAiProvider } from '../fakes/scripted-ai';
import { reportRun } from '../harness/report';
import { CANDIDATES_DIR, loadRecording } from './load';
import { recordPrecondition, writeCandidate } from './record';

// The `pnpm sim:record` runner (report/record-precondition.mjs). It runs only when that command
// sets the environment below; in every other Vitest run it is skipped and calls no model.
// SIM_RECORD_RUNNER is set only by that command, so a stray SIM_RECORD_FILE in a shell cannot start a recording.
const file = process.env.SIM_RECORD_RUNNER === '1' ? process.env.SIM_RECORD_FILE : undefined;
/** Live recordings are chains of model calls; the 5-minute default would kill a long one mid-run. */
const RECORDING_TIMEOUT_MS = 30 * 60_000;
const provider = process.env.SIM_RECORD_PROVIDER;
const candidatesDir = process.env.SIM_RECORD_CANDIDATES_DIR || CANDIDATES_DIR;

describe.skipIf(!file)('record precondition', () => {
  it(`records ${file ? basename(file) : 'nothing'}`, async () => {
    if (provider !== 'live' && provider !== 'scripted') {
      throw new Error(`SIM_RECORD_PROVIDER must be live or scripted, got ${JSON.stringify(provider)}`);
    }
    const recording = loadRecording(file!);
    const { harness, candidate } = await recordPrecondition(recording, provider === 'scripted'
      ? { provider, aiProvider: new ScriptedAiProvider() }
      : { provider });
    await reportRun(`Record ${recording.name}`, harness, {
      success: true, metCriteria: [], unmetCriteria: [], reasoning: 'Recording run: no expectations are judged.',
    }, false);
    const path = writeCandidate(candidate, candidatesDir);
    console.log(`candidate precondition: ${path}`);
    expect(harness.failures).toEqual([]);
  }, RECORDING_TIMEOUT_MS);
});
