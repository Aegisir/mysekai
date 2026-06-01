export interface CanvasAspectRatio {
  readonly width: number;
  readonly height: number;
}

interface CanvasPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly ratio?: CanvasAspectRatio;
}

export const DEFAULT_CUSTOM_CANVAS_RATIO = {
  width: 9,
  height: 16,
} as const satisfies CanvasAspectRatio;

export const CANVAS_PRESETS = [
  { id: 'original', label: 'Original', description: 'Use current workspace size' },
  { id: 'mobile-portrait', label: 'Mobile 9:16', description: 'TikTok, Reels, Shorts', ratio: { width: 9, height: 16 } },
  { id: 'square', label: 'Square 1:1', description: 'Social posts', ratio: { width: 1, height: 1 } },
  { id: 'feed-portrait', label: 'Feed 4:5', description: 'Instagram feed', ratio: { width: 4, height: 5 } },
  { id: 'widescreen', label: 'Widescreen 16:9', description: 'YouTube landscape', ratio: { width: 16, height: 9 } },
  { id: 'classic', label: 'Classic 4:3', description: 'Classic screen', ratio: { width: 4, height: 3 } },
  { id: 'portrait', label: 'Portrait 3:4', description: 'Portrait frame', ratio: { width: 3, height: 4 } },
  { id: 'cinema', label: 'Cinema 21:9', description: 'Cinematic wide', ratio: { width: 21, height: 9 } },
  { id: 'custom', label: 'Custom', description: 'Set your own ratio' },
] as const satisfies readonly CanvasPreset[];

export type CanvasPresetId = (typeof CANVAS_PRESETS)[number]['id'];

export const clampCanvasRatioValue = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(99, Math.max(1, Math.round(value)));
};

export const normalizeCanvasAspectRatio = (ratio: CanvasAspectRatio): CanvasAspectRatio => ({
  width: clampCanvasRatioValue(ratio.width),
  height: clampCanvasRatioValue(ratio.height),
});

export const readCanvasPreset = (presetId: CanvasPresetId): (typeof CANVAS_PRESETS)[number] =>
  CANVAS_PRESETS.find((preset) => preset.id === presetId) ?? CANVAS_PRESETS[0];

export const resolveCanvasAspectRatio = (
  presetId: CanvasPresetId,
  customRatio: CanvasAspectRatio,
): CanvasAspectRatio | undefined => {
  if (presetId === 'custom') {
    return normalizeCanvasAspectRatio(customRatio);
  }

  const preset = readCanvasPreset(presetId);

  return 'ratio' in preset ? preset.ratio : undefined;
};

export const formatCanvasAspectRatio = (ratio: CanvasAspectRatio | undefined): string =>
  ratio ? `${ratio.width}:${ratio.height}` : 'Original';

export const toCssAspectRatio = (ratio: CanvasAspectRatio | undefined): string | undefined =>
  ratio ? `${ratio.width} / ${ratio.height}` : undefined;
