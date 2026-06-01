export const isCoarsePointer = (): boolean =>
  globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
