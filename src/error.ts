/**
 * Specialized error type for Kleisli
 */
export class KleisliError<E> extends Error {
  constructor(readonly error: E) { super(String(error)); }
}
