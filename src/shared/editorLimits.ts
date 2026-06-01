interface NumericLimit {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const EDITOR_CONTROL_LIMITS = {
  timeScale: { min: 0.1, max: 4, step: 0.1 },
  sizeScale: { min: 0.2, max: 3, step: 0.1 },
  rotation: { min: -180, max: 180, step: 1 },
} as const satisfies Record<string, NumericLimit>;

export const clampEditorValue = (value: number, limit: NumericLimit): number =>
  Math.min(Math.max(value, limit.min), limit.max);
