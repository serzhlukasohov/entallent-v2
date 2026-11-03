import { z } from 'zod';

/** The only recording format this harness understands; anything else is rejected, never guessed. */
export const RECORDING_SCHEMA_VERSION = 1;

/** Becomes the candidate folder and the approved file name, so it stays a safe file name. */
export const RECORDING_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const recordingSchema = z.object({
  schemaVersion: z.literal(RECORDING_SCHEMA_VERSION),
  name: z.string().regex(RECORDING_NAME, 'use lowercase letters, digits and single dashes (kebab-case)'),
  description: z.string().optional(),
  /**
   * Starting state: a path inside `preconditions/` or an inline precondition object (for example
   * presets only). Absent: an empty conversation with default user.
   */
  base: z.union([z.string().trim().min(1), z.record(z.unknown())]).optional(),
  /** Employee messages, sent in order; each gets one bot reply. */
  replies: z.array(z.string().trim().min(1)).min(1),
}).strict();

export type RecordingFile = z.output<typeof recordingSchema>;
