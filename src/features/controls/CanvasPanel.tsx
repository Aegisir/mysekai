import { For } from 'solid-js';

import {
  CANVAS_PRESETS,
  clampCanvasRatioValue,
  formatCanvasAspectRatio,
  type CanvasAspectRatio,
  type CanvasPresetId,
} from '@/features/canvas/canvasPresets';

interface CanvasPanelProps {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly presetId: CanvasPresetId;
  readonly customRatio: CanvasAspectRatio;
  readonly resolvedRatio: CanvasAspectRatio | undefined;
  readonly onPresetChange: (presetId: CanvasPresetId) => void;
  readonly onCustomRatioChange: (ratio: CanvasAspectRatio) => void;
  readonly onReset: () => void;
}

export const CanvasPanel = (props: CanvasPanelProps) => {
  const handlePresetChange = (event: Event): void => {
    const target = event.currentTarget as HTMLSelectElement;

    props.onPresetChange(target.value as CanvasPresetId);
  };

  const handleCustomWidthChange = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement;

    props.onCustomRatioChange({
      ...props.customRatio,
      width: clampCanvasRatioValue(Number.parseFloat(target.value)),
    });
  };

  const handleCustomHeightChange = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement;

    props.onCustomRatioChange({
      ...props.customRatio,
      height: clampCanvasRatioValue(Number.parseFloat(target.value)),
    });
  };

  return (
    <section
      class="control-section editor-panel"
      classList={{ 'is-active': props.active }}
      hidden={!props.active}
      aria-hidden={props.active ? 'false' : 'true'}
      aria-labelledby="canvas-panel-title"
    >
      <div class="section-heading">
        <h2 id="canvas-panel-title">Canvas</h2>
      </div>

      <label class="field">
        <span>Aspect Preset</span>
        <select value={props.presetId} onChange={handlePresetChange} disabled={props.disabled}>
          <For each={CANVAS_PRESETS}>
            {(preset) => <option value={preset.id}>{`${preset.label} - ${preset.description}`}</option>}
          </For>
        </select>
      </label>

      <div class="canvas-ratio-summary" aria-live="polite">
        <span>Preview and export ratio</span>
        <strong>{formatCanvasAspectRatio(props.resolvedRatio)}</strong>
      </div>

      <div class="ratio-input-row" hidden={props.presetId !== 'custom'}>
        <label class="field">
          <span>Width Ratio</span>
          <input
            type="number"
            min="1"
            max="99"
            step="1"
            value={props.customRatio.width}
            onInput={handleCustomWidthChange}
            disabled={props.disabled || props.presetId !== 'custom'}
          />
        </label>

        <label class="field">
          <span>Height Ratio</span>
          <input
            type="number"
            min="1"
            max="99"
            step="1"
            value={props.customRatio.height}
            onInput={handleCustomHeightChange}
            disabled={props.disabled || props.presetId !== 'custom'}
          />
        </label>
      </div>

      <button class="ghost-button" type="button" onClick={props.onReset} disabled={props.disabled}>
        Reset to Original
      </button>
    </section>
  );
};
