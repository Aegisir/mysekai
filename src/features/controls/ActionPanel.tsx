import { createMemo, createSignal, For } from 'solid-js';

import type { ActionDefinition, ModelDefinition } from '@/domain/manifest';

interface ActionPanelProps {
  readonly model: ModelDefinition;
  readonly disabled: boolean;
  readonly timeScale: number;
  readonly sizeScale: number;
  readonly rotation: number;
  readonly mirrorEnabled: boolean;
  readonly shadowEnabled: boolean;
  readonly onPlay: (action: ActionDefinition, loop: boolean) => void;
  readonly onStop: () => void;
  readonly onTimeScaleChange: (value: number) => void;
  readonly onSizeScaleChange: (value: number) => void;
  readonly onRotationChange: (degrees: number) => void;
  readonly onMirrorToggle: (enabled: boolean) => void;
  readonly onShadowToggle: (enabled: boolean) => void;
  readonly onResetTransform: () => void;
  readonly onDownloadPng: () => void;
  readonly onDownloadGif: (action: ActionDefinition | undefined, loop: boolean) => void;
  readonly exportingGif: boolean;
}

export const ActionPanel = (props: ActionPanelProps) => {
  const [query, setQuery] = createSignal('');
  const fallbackAction = (): ActionDefinition | undefined =>
    props.model.actions.find((action) => action.id === props.model.defaultActionId) ??
    props.model.actions.find((action) => action.loop) ??
    props.model.actions[0];
  const [selectedActionId, setSelectedActionId] = createSignal<string>(fallbackAction()?.id ?? '');
  const [loopEnabled, setLoopEnabled] = createSignal<boolean>(fallbackAction()?.loop ?? true);
  const selectedAction = createMemo(
    () => props.model.actions.find((action) => action.id === selectedActionId()) ?? fallbackAction(),
  );
  const filteredActions = createMemo(() => {
    const keyword = query().trim().toLowerCase();
    const allActions = props.model.actions;

    if (!keyword) {
      return allActions;
    }

    const filtered = allActions.filter((action) =>
      [action.label, action.animation, action.id].some((value) => value.toLowerCase().includes(keyword)),
    );

    if (filtered.length > 0) {
      return filtered;
    }

    const selected = selectedAction();

    if (selected && allActions.some((action) => action.id === selected.id)) {
      return [selected];
    }

    return allActions;
  });

  const handleActionSelect = (event: Event): void => {
    const target = event.currentTarget as HTMLSelectElement;
    const nextAction = props.model.actions.find((action) => action.id === target.value);

    setSelectedActionId(target.value);
    setLoopEnabled(nextAction?.loop ?? false);
  };

  const handleTimeScaleChange = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement;
    props.onTimeScaleChange(Number.parseFloat(target.value));
  };

  const handleShadowToggle = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement;
    props.onShadowToggle(target.checked);
  };

  const handleMirrorToggle = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement;
    props.onMirrorToggle(target.checked);
  };

  const handleLoopToggle = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement;
    setLoopEnabled(target.checked);
  };

  const handleRotationChange = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement;
    props.onRotationChange(Number.parseFloat(target.value));
  };

  const handleSizeScaleChange = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement;
    props.onSizeScaleChange(Number.parseFloat(target.value));
  };

  const handleQueryInput = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement;
    setQuery(target.value);
  };

  const handlePlay = (): void => {
    const action = selectedAction();

    if (action) {
      props.onPlay(action, loopEnabled());
    }
  };

  return (
    <section class="control-section" aria-labelledby="action-panel-title">
      <div class="section-heading">
        <h2 id="action-panel-title">Animation</h2>
      </div>

      <label class="field">
        <span>Search Motion</span>
        <input
          type="search"
          value={query()}
          onInput={handleQueryInput}
          placeholder="Label, animation, id"
          disabled={props.disabled}
        />
      </label>

      <label class="field">
        <span>Motion</span>
        <select value={selectedAction()?.id ?? ''} onChange={handleActionSelect} disabled={props.disabled}>
          <For each={filteredActions()}>
            {(action) => <option value={action.id}>{action.label}</option>}
          </For>
        </select>
      </label>

      <div class="button-row">
        <button class="primary-button" type="button" onClick={handlePlay} disabled={props.disabled}>
          Play
        </button>
        <button class="ghost-button" type="button" onClick={props.onStop} disabled={props.disabled}>
          Stop
        </button>
      </div>

      <label class="field range-field">
        <span>Speed</span>
        <input
          type="range"
          min="0.1"
          max="4"
          step="0.1"
          value={props.timeScale}
          onInput={handleTimeScaleChange}
          disabled={props.disabled}
        />
        <strong>{props.timeScale.toFixed(1)}x</strong>
      </label>

      <label class="field range-field">
        <span>Size</span>
        <input
          type="range"
          min="0.2"
          max="3"
          step="0.1"
          value={props.sizeScale}
          onInput={handleSizeScaleChange}
          disabled={props.disabled}
        />
        <strong>{props.sizeScale.toFixed(1)}x</strong>
      </label>

      <label class="field checkbox-field">
        <span>Loop</span>
        <input type="checkbox" checked={loopEnabled()} onChange={handleLoopToggle} disabled={props.disabled} />
      </label>

      <label class="field range-field">
        <span>Rotate</span>
        <input
          type="range"
          min="-180"
          max="180"
          step="1"
          value={props.rotation}
          onInput={handleRotationChange}
          disabled={props.disabled}
        />
        <strong>{props.rotation.toFixed(0)}°</strong>
      </label>

      <label class="field checkbox-field">
        <span>Mirror</span>
        <input type="checkbox" checked={props.mirrorEnabled} onChange={handleMirrorToggle} disabled={props.disabled} />
      </label>

      <button class="ghost-button" type="button" onClick={props.onResetTransform} disabled={props.disabled}>
        Reset Transform
      </button>

      <div class="button-row">
        <button class="ghost-button" type="button" onClick={props.onDownloadPng} disabled={props.disabled}>
          Download PNG
        </button>
        <button
          class="ghost-button"
          type="button"
          onClick={() => props.onDownloadGif(selectedAction(), loopEnabled())}
          disabled={props.disabled || props.exportingGif}
        >
          {props.exportingGif ? 'Exporting GIF...' : 'Download GIF'}
        </button>
      </div>

      <label class="field checkbox-field">
        <span>Shadow</span>
        <input type="checkbox" checked={props.shadowEnabled} onChange={handleShadowToggle} disabled={props.disabled} />
      </label>
    </section>
  );
};
