import { createMemo, createSignal, onCleanup } from 'solid-js';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

import { clampTimeScale, composePlayCommand, composeStopCommand } from '@/actions/actionComposer';
import { areaSdDefaultModelId, sampleManifest } from '@/data/sampleManifest';
import type { ActionDefinition, ModelDefinition } from '@/domain/manifest';
import { ActionPanel } from '@/features/controls/ActionPanel';
import { CanvasPanel } from '@/features/controls/CanvasPanel';
import { ModelPanel } from '@/features/controls/ModelPanel';
import {
  DEFAULT_CUSTOM_CANVAS_RATIO,
  formatCanvasAspectRatio,
  normalizeCanvasAspectRatio,
  resolveCanvasAspectRatio,
  toCssAspectRatio,
  type CanvasAspectRatio,
  type CanvasPresetId,
} from '@/features/canvas/canvasPresets';
import { EditorToolbar } from '@/features/editor/EditorToolbar';
import { readEditorToolLabel, type EditorToolId } from '@/features/editor/editorTools';
import { StageView } from '@/features/stage/StageView';
import type { StageController } from '@/renderer/StageController';
import { clampEditorValue, EDITOR_CONTROL_LIMITS } from '@/shared/editorLimits';

import './app.css';

type StageStatus = 'idle' | 'loading' | 'ready' | 'error';
interface ActorEntry {
  readonly id: string;
  readonly model: ModelDefinition;
}

const firstModel = (): ModelDefinition => {
  const models = sampleManifest.characters.flatMap((character) => character.models);
  const model = models.find((candidate) => candidate.id === areaSdDefaultModelId) ?? models[0];

  if (!model) {
    throw new Error('PJSK manifest must include at least one model.');
  }

  return model;
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown runtime error.';

const GIF_EXPORT_FPS = 30;
const GIF_EXPORT_FALLBACK_SECONDS = 2.5;
const GIF_EXPORT_MAX_SECONDS = 4;
const GIF_EXPORT_MAX_FRAMES = 120;
const GIF_EXPORT_MAX_SIDE = 320;
const GIF_EXPORT_COLORS = 256;

const pad = (value: number): string => value.toString().padStart(2, '0');

const buildDownloadName = (extension: 'png' | 'gif'): string => {
  const now = new Date();
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `sekai-chibi-lab-${stamp}.${extension}`;
};

const triggerDownload = (url: string, filename: string): void => {
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
};

const readStageCanvases = (): HTMLCanvasElement[] =>
  Array.from(document.querySelectorAll<HTMLCanvasElement>('.stage-shell .pixi-canvas'));

const composeStageSnapshot = (): HTMLCanvasElement | undefined => {
  const layers = readStageCanvases();
  const first = layers[0];

  if (!first) {
    return undefined;
  }

  const width = first.width;
  const height = first.height;

  if (width <= 0 || height <= 0) {
    return undefined;
  }

  const output = document.createElement('canvas');

  output.width = width;
  output.height = height;

  const context = output.getContext('2d');

  if (!context) {
    return undefined;
  }

  context.clearRect(0, 0, width, height);

  for (const layer of layers) {
    context.drawImage(layer, 0, 0, width, height);
  }

  return output;
};

const resizeCanvasForGif = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
  const longestSide = Math.max(canvas.width, canvas.height);

  if (longestSide <= GIF_EXPORT_MAX_SIDE) {
    return canvas;
  }

  const scale = GIF_EXPORT_MAX_SIDE / longestSide;
  const output = document.createElement('canvas');

  output.width = Math.max(1, Math.round(canvas.width * scale));
  output.height = Math.max(1, Math.round(canvas.height * scale));

  const context = output.getContext('2d');

  if (!context) {
    return canvas;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, output.width, output.height);

  return output;
};

const readCanvasImageData = (canvas: HTMLCanvasElement): ImageData | undefined => {
  const context = canvas.getContext('2d', { willReadFrequently: true });

  return context?.getImageData(0, 0, canvas.width, canvas.height);
};

const encodeGif = (frames: readonly ImageData[]): Blob => {
  const firstFrame = frames[0];

  if (!firstFrame) {
    throw new Error('No GIF frames were captured.');
  }

  const gif = GIFEncoder();
  const delay = Math.round(1000 / GIF_EXPORT_FPS);

  for (const [index, frame] of frames.entries()) {
    const palette = quantize(frame.data, GIF_EXPORT_COLORS, { format: 'rgba4444', oneBitAlpha: 16 });
    const indexedFrame = applyPalette(frame.data, palette, 'rgba4444');
    const options = {
      palette,
      delay,
      transparent: true,
      transparentIndex: 0,
      ...(index === 0 ? { repeat: 0 } : {}),
    };

    gif.writeFrame(indexedFrame, frame.width, frame.height, options);
  }

  gif.finish();
  const bytes = gif.bytes();
  const output = new ArrayBuffer(bytes.byteLength);
  const outputBytes = new Uint8Array(output);

  outputBytes.set(bytes);

  return new Blob([output], { type: 'image/gif' });
};

export const App = () => {
  const initialModel = firstModel();
  const [controller, setController] = createSignal<StageController>();
  const [selectedModel, setSelectedModel] = createSignal<ModelDefinition>(initialModel);
  const [status, setStatus] = createSignal<StageStatus>('idle');
  const [message, setMessage] = createSignal('Stage is booting.');
  const [timeScale, setTimeScale] = createSignal(1);
  const [sizeScale, setSizeScale] = createSignal(1);
  const [rotation, setRotation] = createSignal(0);
  const [mirrorEnabled, setMirrorEnabled] = createSignal(false);
  const [shadowEnabled, setShadowEnabled] = createSignal(true);
  const [dockOffset, setDockOffset] = createSignal({ x: 0, y: 0 });
  const [actors, setActors] = createSignal<readonly ActorEntry[]>([]);
  const [activeActorId, setActiveActorId] = createSignal<string | undefined>();
  const [exportingGif, setExportingGif] = createSignal(false);
  const [activeTool, setActiveTool] = createSignal<EditorToolId>('character');
  const [controlsVisible, setControlsVisible] = createSignal(true);
  const [canvasPresetId, setCanvasPresetId] = createSignal<CanvasPresetId>('original');
  const [customCanvasRatio, setCustomCanvasRatio] = createSignal<CanvasAspectRatio>(
    DEFAULT_CUSTOM_CANVAS_RATIO,
  );
  const canUseStage = createMemo(() => Boolean(controller()) && status() !== 'loading');
  const canControlMotion = createMemo(
    () => Boolean(controller()) && status() === 'ready' && Boolean(activeActorId()),
  );
  const activeActor = createMemo(() => actors().find((actor) => actor.id === activeActorId()));
  const canvasAspectRatio = createMemo(() => resolveCanvasAspectRatio(canvasPresetId(), customCanvasRatio()));
  const isCanvasTall = createMemo(() => {
    const ratio = canvasAspectRatio();

    return Boolean(ratio && ratio.height > ratio.width);
  });
  const canvasStageStyle = createMemo(() => {
    const ratio = canvasAspectRatio();

    return ratio
      ? {
          '--canvas-aspect-ratio': toCssAspectRatio(ratio),
          '--canvas-aspect-value': `${ratio.width / ratio.height}`,
        }
      : {};
  });
  let nextActorNumber = 1;
  let dragOrigin: { pointerX: number; pointerY: number; offsetX: number; offsetY: number } | undefined;
  let pendingDockOffset: { x: number; y: number } | undefined;
  let dockDragFrame = 0;

  const flushDockOffset = (): void => {
    dockDragFrame = 0;

    if (!pendingDockOffset) {
      return;
    }

    setDockOffset(pendingDockOffset);
    pendingDockOffset = undefined;
  };

  const scheduleDockOffset = (x: number, y: number): void => {
    pendingDockOffset = { x, y };

    if (dockDragFrame !== 0) {
      return;
    }

    dockDragFrame = window.requestAnimationFrame(flushDockOffset);
  };

  const handleDockDragMove = (event: PointerEvent): void => {
    if (!dragOrigin) {
      return;
    }

    scheduleDockOffset(
      dragOrigin.offsetX + event.clientX - dragOrigin.pointerX,
      dragOrigin.offsetY + event.clientY - dragOrigin.pointerY,
    );
  };

  const handleDockDragEnd = (): void => {
    if (dockDragFrame !== 0) {
      window.cancelAnimationFrame(dockDragFrame);
      dockDragFrame = 0;
    }

    if (pendingDockOffset) {
      setDockOffset(pendingDockOffset);
      pendingDockOffset = undefined;
    }

    dragOrigin = undefined;
    window.removeEventListener('pointermove', handleDockDragMove);
    window.removeEventListener('pointerup', handleDockDragEnd);
  };

  const handleDockDragStart = (event: PointerEvent): void => {
    if (event.button !== 0 || window.matchMedia('(max-width: 860px)').matches) {
      return;
    }

    event.preventDefault();

    const current = dockOffset();
    dragOrigin = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: current.x,
      offsetY: current.y,
    };

    window.addEventListener('pointermove', handleDockDragMove);
    window.addEventListener('pointerup', handleDockDragEnd);
  };

  onCleanup(() => {
    if (dockDragFrame !== 0) {
      window.cancelAnimationFrame(dockDragFrame);
      dockDragFrame = 0;
    }

    pendingDockOffset = undefined;
    window.removeEventListener('pointermove', handleDockDragMove);
    window.removeEventListener('pointerup', handleDockDragEnd);
  });

  const syncActiveActorFromIndex = (index: number, nextActors = actors()): boolean => {
    const stage = controller();
    const actor = nextActors[index];

    if (!stage || !actor || index < 0 || index >= nextActors.length) {
      return false;
    }

    stage.setActiveIndex(index);
    setActiveActorId(actor.id);
    setSizeScale(stage.readCharacterScale());
    setRotation(stage.readCharacterRotation());
    setMirrorEnabled(stage.readCharacterMirror());
    setShadowEnabled(stage.readCharacterShadow());
    setMessage(`Active: ${actor.model.name}`);

    return true;
  };

  const handleEditorToolSelect = (toolId: EditorToolId): void => {
    if (toolId !== 'character' && toolId !== 'canvas' && !activeActorId()) {
      setMessage('Add a character before using this tool.');
      setActiveTool('character');
      setControlsVisible(true);
      return;
    }

    setActiveTool(toolId);
    setControlsVisible(true);
    setMessage(`${readEditorToolLabel(toolId)} tools selected.`);
  };

  const handleControlsToggle = (): void => {
    setControlsVisible((visible) => !visible);
  };

  const handleCanvasPresetChange = (presetId: CanvasPresetId): void => {
    const nextRatio = resolveCanvasAspectRatio(presetId, customCanvasRatio());

    setCanvasPresetId(presetId);
    setMessage(`Canvas ratio: ${formatCanvasAspectRatio(nextRatio)}.`);
  };

  const handleCustomCanvasRatioChange = (ratio: CanvasAspectRatio): void => {
    const nextRatio = normalizeCanvasAspectRatio(ratio);

    setCustomCanvasRatio(nextRatio);
    setMessage(`Canvas ratio: ${formatCanvasAspectRatio(nextRatio)}.`);
  };

  const handleCanvasReset = (): void => {
    setCanvasPresetId('original');
    setCustomCanvasRatio(DEFAULT_CUSTOM_CANVAS_RATIO);
    setMessage('Canvas ratio reset to Original.');
  };

  const addModel = async (model: ModelDefinition): Promise<void> => {
    const stage = controller();

    if (!stage) {
      setMessage('Stage is not ready yet.');
      return;
    }

    setStatus('loading');
    setMessage('Loading remote skeleton, atlas, and texture.');

    try {
      await stage.loadModel(model);
      stage.setCharacterShadow(shadowEnabled());
      stage.setActiveTimeScale(timeScale());
      stage.setCharacterScale(1);
      stage.setCharacterRotation(0);
      stage.setCharacterMirror(false);
      const actorId = `actor-${nextActorNumber++}`;
      const nextActors = [...actors(), { id: actorId, model }];

      setActors(nextActors);
      setActiveActorId(actorId);
      setSizeScale(stage.readCharacterScale());
      setRotation(stage.readCharacterRotation());
      setMirrorEnabled(stage.readCharacterMirror());
      setShadowEnabled(stage.readCharacterShadow());
      setControlsVisible(true);
      setStatus('ready');
      setMessage(`Added: ${model.name}`);
    } catch (error) {
      setStatus('error');
      setMessage(toErrorMessage(error));
    }
  };

  const handleStageReady = (stage: StageController): void => {
    setController(() => stage);
    setMessage('Stage ready. Select a Project SEKAI area_sd model, then load it.');
  };

  const handleModelSelect = (model: ModelDefinition): void => {
    setSelectedModel(model);
    setMessage(`Selected: ${model.name}`);
  };

  const handleDeleteActive = (): void => {
    const stage = controller();
    const currentId = activeActorId();

    if (!stage || !currentId) {
      return;
    }

    const currentActors = actors();
    const removeIndex = currentActors.findIndex((actor) => actor.id === currentId);

    if (removeIndex < 0) {
      return;
    }

    stage.setActiveIndex(removeIndex);
    stage.removeActiveModel();

    const nextActors = currentActors.filter((actor) => actor.id !== currentId);

    setActors(nextActors);

    if (nextActors.length === 0) {
      setActiveActorId(undefined);
      setActiveTool('character');
      setSizeScale(1);
      setRotation(0);
      setMirrorEnabled(false);
      setShadowEnabled(true);
      setStatus('idle');
      setMessage('No characters on stage. Add one.');
      return;
    }

    const nextIndex = Math.min(removeIndex, nextActors.length - 1);

    if (!syncActiveActorFromIndex(nextIndex, nextActors)) {
      setActiveActorId(undefined);
      setActiveTool('character');
      setStatus('idle');
      setMessage('No characters on stage. Add one.');
    }
  };

  const handleActiveActorChange = (actorId: string): void => {
    const index = actors().findIndex((actor) => actor.id === actorId);

    syncActiveActorFromIndex(index);
  };

  const handleActiveIndexChange = (index: number): void => {
    syncActiveActorFromIndex(index);
  };

  const handleRotationChange = (degrees: number): void => {
    const stage = controller();
    const next = clampEditorValue(degrees, EDITOR_CONTROL_LIMITS.rotation);

    setRotation(next);
    stage?.setCharacterRotation(next);
  };

  const handleSizeScaleChange = (value: number): void => {
    const stage = controller();
    const next = clampEditorValue(value, EDITOR_CONTROL_LIMITS.sizeScale);

    setSizeScale(next);
    stage?.setCharacterScale(next);
  };

  const handleMirrorToggle = (enabled: boolean): void => {
    setMirrorEnabled(enabled);
    controller()?.setCharacterMirror(enabled);
  };

  const handleResetTransform = (): void => {
    const stage = controller();

    if (!stage) {
      return;
    }

    stage.setCharacterOffset(0, 0);
    stage.setCharacterScale(1);
    stage.setCharacterRotation(0);
    stage.setCharacterMirror(false);

    setSizeScale(1);
    setRotation(0);
    setMirrorEnabled(false);
  };

  const handlePlay = (action: ActionDefinition, loop: boolean): void => {
    controller()?.executeActive(composePlayCommand(action, timeScale(), loop));
  };

  const handleStop = (): void => {
    controller()?.executeActive(composeStopCommand());
  };

  const handleTimeScaleChange = (value: number): void => {
    const nextValue = clampTimeScale(value);

    setTimeScale(nextValue);
    controller()?.setActiveTimeScale(nextValue);
  };

  const handleShadowToggle = (enabled: boolean): void => {
    setShadowEnabled(enabled);
    controller()?.setCharacterShadow(enabled);
  };

  const handleDownloadPng = (): void => {
    try {
      const snapshot = composeStageSnapshot();

      if (!snapshot) {
        setMessage('Stage is not ready for PNG export.');
        return;
      }

      const url = snapshot.toDataURL('image/png');

      triggerDownload(url, buildDownloadName('png'));
      setMessage('PNG downloaded.');
    } catch (error) {
      setMessage(toErrorMessage(error));
    }
  };

  const handleDownloadGif = async (action: ActionDefinition | undefined, loop: boolean): Promise<void> => {
    if (exportingGif()) {
      return;
    }

    const stage = controller();
    const snapshot = composeStageSnapshot();

    if (!stage || !snapshot) {
      setMessage('Stage is not ready for GIF export.');
      return;
    }

    const frameDelta = 1 / GIF_EXPORT_FPS;
    const animationSeconds = action ? stage.readActiveAnimationDuration(action.animation) : undefined;
    const boundedSeconds = Math.min(
      GIF_EXPORT_MAX_SECONDS,
      Math.max(frameDelta, animationSeconds ?? GIF_EXPORT_FALLBACK_SECONDS),
    );
    const totalFrames = Math.min(GIF_EXPORT_MAX_FRAMES, Math.max(1, Math.ceil(boundedSeconds * GIF_EXPORT_FPS)));

    setExportingGif(true);
    setMessage('Rendering GIF frames...');

    try {
      const frames: ImageData[] = [];

      stage.setPaused(true);

      if (action) {
        stage.executeActive(composePlayCommand(action, timeScale(), false));
      }

      for (let index = 0; index < totalFrames; index += 1) {
        stage.captureFrame(index === 0 ? 0 : frameDelta);

        const frame = composeStageSnapshot();

        if (!frame) {
          continue;
        }

        const imageData = readCanvasImageData(resizeCanvasForGif(frame));

        if (imageData) {
          frames.push(imageData);
        }

        if (index % 5 === 0 || index === totalFrames - 1) {
          setMessage(`Rendering GIF frame ${Math.min(index + 2, totalFrames)}/${totalFrames}...`);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }

      if (frames.length === 0) {
        throw new Error('No GIF frames were captured.');
      }

      if (action) {
        stage.executeActive(composePlayCommand(action, timeScale(), loop));
      }

      stage.captureFrame(0);
      stage.setPaused(false);

      setMessage('Encoding GIF...');
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

      const blob = encodeGif(frames);
      const url = URL.createObjectURL(blob);

      try {
        triggerDownload(url, buildDownloadName('gif'));
      } finally {
        URL.revokeObjectURL(url);
      }

      setMessage('GIF downloaded.');
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      if (action) {
        stage.executeActive(composePlayCommand(action, timeScale(), loop));
      }

      stage.captureFrame(0);
      stage.setPaused(false);
      setExportingGif(false);
    }
  };

  return (
    <div class="app-shell">
      <header class="top-bar">
        <p class={`app-status status-${status()}`}>{message()}</p>
      </header>

      <main class="workspace">
        <section
          class="stage-shell"
          classList={{
            'has-canvas-ratio': Boolean(canvasAspectRatio()),
            'is-canvas-tall': isCanvasTall(),
          }}
          style={canvasStageStyle()}
          aria-label={`Preview canvas ${formatCanvasAspectRatio(canvasAspectRatio())}`}
        >
          <StageView
            onReady={handleStageReady}
            onError={(error) => setMessage(toErrorMessage(error))}
            onActiveIndexChange={handleActiveIndexChange}
          />
        </section>

        <aside
          id="editor-control-dock"
          class="control-dock"
          classList={{ 'is-hidden': !controlsVisible() }}
          aria-label="Controls"
          hidden={!controlsVisible()}
          style={{
            '--dock-offset-x': `${dockOffset().x}px`,
            '--dock-offset-y': `${dockOffset().y}px`,
          }}
        >
          <div class="control-dock-header">
            <div>
              <span class="control-dock-kicker">Editor panel</span>
              <h2>{readEditorToolLabel(activeTool())}</h2>
            </div>
            <button
              class="drag-handle"
              type="button"
              aria-label="Drag control panel"
              onPointerDown={(event) => handleDockDragStart(event as PointerEvent)}
            >
              ≡
            </button>
          </div>

          <div class="control-banner-shell" aria-hidden="true">
            <img
              class="control-banner control-banner-bg"
              src={`${import.meta.env.BASE_URL}control-banner.png`}
              alt="Sekai Chibi Lab banner"
            />
            <img
              class="control-banner control-banner-right"
              src={`${import.meta.env.BASE_URL}control-banner-right.png`}
              alt=""
            />
          </div>

          <div class="control-dock-scroll">
            <ModelPanel
              characters={sampleManifest.characters}
              selectedModelId={selectedModel().id}
              disabled={!canUseStage()}
              active={activeTool() === 'character'}
              actors={actors().map((actor, index) => ({ id: actor.id, label: `${index + 1}. ${actor.model.name}` }))}
              activeActorId={activeActorId()}
              onSelect={handleModelSelect}
              onAdd={(model) => void addModel(model)}
              onDeleteActive={handleDeleteActive}
              onActiveActorChange={handleActiveActorChange}
            />

            <CanvasPanel
              active={activeTool() === 'canvas'}
              disabled={status() === 'loading'}
              presetId={canvasPresetId()}
              customRatio={customCanvasRatio()}
              resolvedRatio={canvasAspectRatio()}
              onPresetChange={handleCanvasPresetChange}
              onCustomRatioChange={handleCustomCanvasRatioChange}
              onReset={handleCanvasReset}
            />

            <ActionPanel
              model={activeActor()?.model ?? selectedModel()}
              disabled={!canControlMotion()}
              activeTool={activeTool()}
              timeScale={timeScale()}
              sizeScale={sizeScale()}
              rotation={rotation()}
              mirrorEnabled={mirrorEnabled()}
              shadowEnabled={shadowEnabled()}
              exportingGif={exportingGif()}
              onPlay={handlePlay}
              onStop={handleStop}
              onTimeScaleChange={handleTimeScaleChange}
              onSizeScaleChange={handleSizeScaleChange}
              onRotationChange={handleRotationChange}
              onMirrorToggle={handleMirrorToggle}
              onShadowToggle={handleShadowToggle}
              onResetTransform={handleResetTransform}
              onDownloadPng={handleDownloadPng}
              onDownloadGif={(action, loop) => void handleDownloadGif(action, loop)}
            />
          </div>
        </aside>

        <button
          class="control-panel-toggle"
          type="button"
          aria-pressed={controlsVisible()}
          aria-controls="editor-control-dock"
          onClick={handleControlsToggle}
        >
          {controlsVisible() ? 'Hide Panel' : 'Show Panel'}
        </button>

        <EditorToolbar
          activeTool={activeTool()}
          hasActiveActor={Boolean(activeActorId())}
          onSelect={handleEditorToolSelect}
        />
      </main>
    </div>
  );
};
