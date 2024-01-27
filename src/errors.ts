export function assertError(error: unknown): asserts error is Error {
  if (!(error instanceof Error)) {
    throw error;
  }
}