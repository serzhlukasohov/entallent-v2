const MAX_ATTEMPTS = 4;

export async function withSerializableRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw new Error('serializable_retry_exhausted');
}

function isSerializationFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && error.code === '40001';
}
