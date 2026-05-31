import { createMemo, createSignal, onCleanup } from 'solid-js';
import { Call, buildInputFile, type MagickInputFile } from 'wasm-imagemagick';

import { clampTimeScale, composePlayCommand, composeStopCommand } from '@/actions/actionComposer';
import { areaSdDefaultModelId, sampleManifest } from '@/data/sampleManifest';
import type { ActionDefinition, ModelDefinition } from '@/domain/manifest';
import { ActionPanel } from '@/features/controls/ActionPanel';
import { ModelPanel } from '@/features/controls/ModelPanel';
import { StageView } from '@/features/stage/StageView';
import type { StageController } from '@/renderer/StageController';

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

const GIF_EXPORT_DURATION_MS = 3000;
const GIF_EXPORT_FPS = 30;

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

const canvasToPngBlob = async (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('Cannot encode PNG frame.'));
    }, 'image/png');
  });

const buildFrameInputFile = async (canvas: HTMLCanvasElement, index: number): Promise<MagickInputFile> => {
  const blob = await canvasToPngBlob(canvas);
  const url = URL.createObjectURL(blob);

  try {
    return await buildInputFile(url, `f${index.toString().padStart(4, '0')}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
};

const buildGifCommand = (frames: readonly MagickInputFile[]): string[] => [
  'convert',
  '-dispose',
  'Background',
  '-delay',
  `1x${GIF_EXPORT_FPS}`,
  ...frames.map((frame) => frame.name),
  '-layers',
  'TrimBounds',
  '+remap',
  '-channel',
  'A',
  '-ordered-dither',
  '2x2',
  'animated.gif',
];

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
  const canUseStage = createMemo(() => Boolean(controller()) && status() !== 'loading');
  const canControlMotion = createMemo(
    () => Boolean(controller()) && status() === 'ready' && Boolean(activeActorId()),
  );
  const activeActor = createMemo(() => actors().find((actor) => actor.id === activeActorId()));
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
      stage.setGlobalTimeScale(timeScale());
      stage.setCharacterScale(1);
      stage.setCharacterRotation(0);
      stage.setCharacterMirror(false);
      const actorId = `actor-${nextActorNumber++}`;
      const nextActors = [...actors(), { id: actorId, model }];

      setActors(nextActors);
      setActiveActorId(actorId);
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
      setStatus('idle');
      setMessage('No characters on stage. Add one.');
      return;
    }

    const nextIndex = Math.min(removeIndex, nextActors.length - 1);
    const nextActor = nextActors[nextIndex];

    if (!nextActor) {
      setActiveActorId(undefined);
      setStatus('idle');
      setMessage('No characters on stage. Add one.');
      return;
    }

    stage.setActiveIndex(nextIndex);
    setActiveActorId(nextActor.id);
    setSizeScale(stage.readCharacterScale());
    setRotation(stage.readCharacterRotation());
    setMirrorEnabled(stage.readCharacterMirror());
    setMessage(`Active: ${nextActor.model.name}`);
  };

  const handleActiveActorChange = (actorId: string): void => {
    const stage = controller();
    const index = actors().findIndex((actor) => actor.id === actorId);

    if (!stage || index < 0) {
      return;
    }

    const actor = actors()[index];

    if (!actor) {
      return;
    }

    stage.setActiveIndex(index);
    setActiveActorId(actorId);
    setSizeScale(stage.readCharacterScale());
    setRotation(stage.readCharacterRotation());
    setMirrorEnabled(stage.readCharacterMirror());
    setMessage(`Active: ${actor.model.name}`);
  };

  const handleActiveIndexChange = (index: number): void => {
    const stage = controller();
    const nextActors = actors();

    if (!stage || index < 0 || index >= nextActors.length) {
      return;
    }

    const actor = nextActors[index];

    if (!actor) {
      return;
    }

    stage.setActiveIndex(index);
    setActiveActorId(actor.id);
    setSizeScale(stage.readCharacterScale());
    setRotation(stage.readCharacterRotation());
    setMirrorEnabled(stage.readCharacterMirror());
    setMessage(`Active: ${actor.model.name}`);
  };

  const handleRotationChange = (degrees: number): void => {
    const stage = controller();
    const next = Math.max(-180, Math.min(180, degrees));

    setRotation(next);
    stage?.setCharacterRotation(next);
  };

  const handleSizeScaleChange = (value: number): void => {
    const stage = controller();
    const next = Math.max(0.2, Math.min(3, value));

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
    controller()?.setGlobalTimeScale(nextValue);
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
    const totalFrames = Math.max(1, Math.round((GIF_EXPORT_DURATION_MS / 1000) * GIF_EXPORT_FPS));

    setExportingGif(true);
    setMessage('Rendering GIF frames...');

    try {
      const frameFiles: MagickInputFile[] = [];

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

        frameFiles.push(await buildFrameInputFile(frame, index));

        if (index % 10 === 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }

      if (frameFiles.length === 0) {
        throw new Error('No GIF frames were captured.');
      }

      setMessage('Encoding GIF...');

      const outputFiles = await Call(frameFiles, buildGifCommand(frameFiles));
      const outputFile = outputFiles.find((file) => file.name === 'animated.gif') ?? outputFiles[0];

      if (!outputFile) {
        throw new Error('GIF encoder returned no output.');
      }

      const url = URL.createObjectURL(outputFile.blob);

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
        <section class="stage-shell" aria-label="Preview">
          <StageView
            onReady={handleStageReady}
            onError={(error) => setMessage(toErrorMessage(error))}
            onActiveIndexChange={handleActiveIndexChange}
          />
        </section>

        <aside
          class="control-dock"
          aria-label="Controls"
          style={{
            '--dock-offset-x': `${dockOffset().x}px`,
            '--dock-offset-y': `${dockOffset().y}px`,
          }}
        >
          <ModelPanel
            characters={sampleManifest.characters}
            selectedModelId={selectedModel().id}
            disabled={!canUseStage()}
            actors={actors().map((actor, index) => ({ id: actor.id, label: `${index + 1}. ${actor.model.name}` }))}
            activeActorId={activeActorId()}
            onSelect={handleModelSelect}
            onAdd={(model) => void addModel(model)}
            onDeleteActive={handleDeleteActive}
            onActiveActorChange={handleActiveActorChange}
            onDragStart={handleDockDragStart}
          />

          <ActionPanel
            model={activeActor()?.model ?? selectedModel()}
            disabled={!canControlMotion()}
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
        </aside>
      </main>
    </div>
  );
};
