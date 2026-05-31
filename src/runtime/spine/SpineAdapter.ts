import { Spine } from '@esotericsoftware/spine-pixi-v8';
import { Assets, Graphics } from 'pixi.js';

import type { ActionDefinition, ModelDefinition, RuntimeKind } from '@/domain/manifest';
import type {
  RuntimeAdapter,
  RuntimeCommand,
  RuntimeLoadContext,
  RuntimeModelInstance,
  StageSize,
} from '@/runtime/types';
import { createPixiApp, type PixiApp } from '@/renderer/createPixiApp';

type SpinePixiModelDefinition = Extract<ModelDefinition, { readonly runtime: 'spine-pixi-v8' }>;

const registeredAssets = new Set<string>();

const assetAlias = (model: SpinePixiModelDefinition, part: 'skeleton' | 'atlas'): string =>
  `model:${model.id}:${part}`;

const toSpinePixiModel = (model: ModelDefinition): SpinePixiModelDefinition => {
  if (model.runtime !== 'spine-pixi-v8') {
    throw new Error(`Invalid Spine Pixi model runtime: ${model.runtime}`);
  }

  return model;
};

const ensureAsset = (alias: string, src: string): void => {
  if (registeredAssets.has(alias)) {
    return;
  }

  Assets.add({ alias, src });
  registeredAssets.add(alias);
};

class SpineModelInstance implements RuntimeModelInstance {
  private shadowEnabled = true;
  private characterOffset = { x: 0, y: 0 };
  private characterScale = 1;
  private characterRotation = 0;
  private characterMirror = false;
  private readonly shadowSlots: { slot: { color: { a: number } }; alpha: number }[];
  constructor(
    private readonly app: PixiApp,
    private readonly shadow: Graphics,
    private readonly spine: Spine,
    private readonly model: SpinePixiModelDefinition,
    readonly actions: readonly ActionDefinition[],
  ) {
    this.shadowSlots = this.spine.skeleton.slots
      .filter((slot) => /shadow|kage/iu.test(slot.data.name))
      .map((slot) => {
        const colorSlot = slot as unknown as { color: { a: number } };

        return { slot: colorSlot, alpha: colorSlot.color.a };
      });
  }

  execute(command: RuntimeCommand): void {
    switch (command.kind) {
      case 'playAnimation': {
        const entry = command.interrupt
          ? this.spine.state.setAnimation(command.track, command.animation, command.loop)
          : this.spine.state.addAnimation(command.track, command.animation, command.loop, 0);

        entry.mixDuration = command.mixDuration;
        entry.timeScale = command.timeScale;
        return;
      }

      case 'stopAnimation': {
        this.spine.state.setEmptyAnimation(command.track, command.mixDuration);
        return;
      }
    }
  }

  setTimeScale(value: number): void {
    this.spine.state.timeScale = value;
  }

  setCharacterShadow(enabled: boolean): void {
    this.shadowEnabled = enabled;
    this.shadow.visible = enabled;

    for (const item of this.shadowSlots) {
      item.slot.color.a = enabled ? item.alpha : 0;
    }
  }

  setCharacterOffset(x: number, y: number): void {
    this.characterOffset = { x, y };
    this.layout({ width: this.app.renderer.width, height: this.app.renderer.height });
  }

  setCharacterScale(scale: number): void {
    this.characterScale = Math.max(0.2, Math.min(3, scale));
    this.layout({ width: this.app.renderer.width, height: this.app.renderer.height });
  }

  setCharacterRotation(degrees: number): void {
    this.characterRotation = degrees;
    this.layout({ width: this.app.renderer.width, height: this.app.renderer.height });
  }

  setCharacterMirror(enabled: boolean): void {
    this.characterMirror = enabled;
    this.layout({ width: this.app.renderer.width, height: this.app.renderer.height });
  }

  canDragCharacterAt(x: number, y: number): boolean {
    const bounds = this.spine.getBounds();

    return (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    );
  }

  readAnimationDuration(animation: string): number | undefined {
    return this.spine.skeleton.data.animations.find((candidate) => candidate.name === animation)?.duration;
  }

  captureFrame(deltaSeconds: number): void {
    this.spine.update(deltaSeconds);
    this.app.render();
  }

  resize(size: StageSize): void {
    this.app.renderer.resize(size.width, size.height);
    this.layout(size);
  }

  setPaused(paused: boolean): void {
    if (paused) {
      this.app.stop();
      return;
    }

    this.app.start();
  }

  destroy(): void {
    this.spine.autoUpdate = false;
    this.app.stage.removeChild(this.shadow);
    this.app.stage.removeChild(this.spine);
    this.shadow.destroy();
    this.spine.destroy({ children: true, texture: false, textureSource: false });
    this.app.destroy(true, { children: true });
  }

  private layout(size: StageSize): void {
    const baseScale = this.model.layout.scale * this.characterScale;
    const scaleX = this.characterMirror ? -baseScale : baseScale;

    this.spine.scale.set(scaleX, baseScale);
    const x = size.width * this.model.layout.anchorX + this.model.layout.offsetX + this.characterOffset.x;
    const y = size.height * this.model.layout.anchorY + this.model.layout.offsetY + this.characterOffset.y;

    this.spine.position.set(x, y);
    this.spine.rotation = (this.characterRotation * Math.PI) / 180;
    const radiusX = Math.max(18, 64 * baseScale);
    const radiusY = Math.max(6, 16 * baseScale);

    this.shadow.clear();
    this.shadow.ellipse(0, 0, radiusX, radiusY).fill({ color: 0x000000, alpha: 0.22 });
    this.shadow.position.set(x, y + radiusY * 0.35);
    this.shadow.visible = this.shadowEnabled;
  }
}

export class SpineAdapter implements RuntimeAdapter {
  readonly kind = 'spine-pixi-v8' satisfies RuntimeKind;

  async loadModel(model: ModelDefinition, context: RuntimeLoadContext): Promise<RuntimeModelInstance> {
    const spineModel = toSpinePixiModel(model);

    const skeleton = assetAlias(spineModel, 'skeleton');
    const atlas = assetAlias(spineModel, 'atlas');

    ensureAsset(skeleton, spineModel.assets.skeleton);
    ensureAsset(atlas, spineModel.assets.atlas);

    await Assets.load([skeleton, atlas]);

    const app = await createPixiApp();

    const spine = Spine.from({
      skeleton,
      atlas,
      autoUpdate: true,
      ticker: app.ticker,
    });
    const shadow = new Graphics();

    app.canvas.className = 'pixi-canvas';
    app.stage.addChild(shadow);
    app.stage.addChild(spine);
    context.host.append(app.canvas);

    const instance = new SpineModelInstance(app, shadow, spine, spineModel, spineModel.actions);

    instance.resize(context.size);

    return instance;
  }
}
