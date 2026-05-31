import '@pixi/sprite';
import '@pixi/mesh-extras';
import '@pixi/graphics';

import { Application } from '@pixi/app';
import { BaseTexture, BatchRenderer, extensions } from '@pixi/core';
import { Graphics } from '@pixi/graphics';
import { TickerPlugin } from '@pixi/ticker';
import {
  AtlasAttachmentLoader,
  BoundingBoxAttachment,
  ClippingAttachment,
  PathAttachment,
  PointAttachment,
  SkeletonBinary,
  Spine,
} from 'pixi-spine-runtime-3.6';
import { TextureAtlas, type TextureAtlasRegion } from 'pixi-spine-base-3';

import type { ActionDefinition, ModelDefinition, RuntimeKind } from '@/domain/manifest';
import type { RuntimeAdapter, RuntimeCommand, RuntimeLoadContext, RuntimeModelInstance, StageSize } from '@/runtime/types';
import { pickRenderQuality } from '@/renderer/renderQuality';
import { loadBinary, loadImage, loadText } from '@/runtime/spineLegacy/areaSdLoader';
import { installPjsekBinaryPatch } from '@/runtime/spineLegacy/legacyBinaryPatch';

type LegacyApplication = Application;
type SpineLegacyModelDefinition = Extract<ModelDefinition, { readonly runtime: 'spine-legacy-webgl' }>;

let legacyPixiPluginsInstalled = false;

const installLegacyPixiPlugins = (): void => {
  if (legacyPixiPluginsInstalled) {
    return;
  }

  extensions.add(TickerPlugin);
  extensions.add(BatchRenderer);
  legacyPixiPluginsInstalled = true;
};

const normalizeRegionName = (name: string): string => name.replace(/(\D)(\d)(?!\d)/g, '$10$2');

const toSpineLegacyModel = (model: ModelDefinition): SpineLegacyModelDefinition => {
  if (model.runtime !== 'spine-legacy-webgl') {
    throw new Error(`Invalid legacy model runtime: ${model.runtime}`);
  }

  return model;
};

const patchAtlasLookup = (atlas: TextureAtlas): void => {
  const findRegion = atlas.findRegion.bind(atlas);
  const fallbackRegion = atlas.regions[0];

  atlas.findRegion = (name: string): TextureAtlasRegion => {
    const directRegion = findRegion(name);

    if (directRegion) {
      return directRegion;
    }

    const paddedRegion = findRegion(normalizeRegionName(name));

    if (paddedRegion) {
      return paddedRegion;
    }

    if (!fallbackRegion) {
      throw new Error(`No fallback atlas region for ${name}`);
    }

    return fallbackRegion;
  };
};

const attachmentName = (name: unknown, fallback: string): string =>
  typeof name === 'string' && name.length > 0 ? name : fallback;

const patchAttachmentLoader = (loader: AtlasAttachmentLoader): void => {
  loader.newBoundingBoxAttachment = (skin, name) => {
    void skin;
    return new BoundingBoxAttachment(attachmentName(name, 'bbox'));
  };
  loader.newPathAttachment = (skin, name) => {
    void skin;
    return new PathAttachment(attachmentName(name, 'path'));
  };
  loader.newPointAttachment = (skin, name) => {
    void skin;
    return new PointAttachment(attachmentName(name, 'point'));
  };
  loader.newClippingAttachment = (skin, name) => {
    void skin;
    return new ClippingAttachment(attachmentName(name, 'clip'));
  };
};

class SpineLegacyModelInstance implements RuntimeModelInstance {
  private shadowEnabled = true;
  private characterOffset = { x: 0, y: 0 };
  private characterScale = 1;
  private characterRotation = 0;
  private characterMirror = false;
  private readonly shadowSlots: { slot: { color: { a: number } }; alpha: number }[];
  private readonly tick = (deltaTime: number): void => {
    this.renderFrame(deltaTime / 60);
  };

  constructor(
    private readonly app: LegacyApplication,
    private readonly shadow: Graphics,
    private readonly spine: Spine,
    private readonly model: SpineLegacyModelDefinition,
    readonly actions: readonly ActionDefinition[],
  ) {
    this.shadowSlots = this.spine.skeleton.slots
      .filter((slot) => /shadow|kage/iu.test(slot.data.name))
      .map((slot) => ({ slot, alpha: slot.color.a }));
    this.app.ticker.add(this.tick);
  }

  execute(command: RuntimeCommand): void {
    switch (command.kind) {
      case 'playAnimation': {
        const entry = command.interrupt
          ? this.spine.state.setAnimation(command.track, command.animation, command.loop)
          : this.spine.state.addAnimation(command.track, command.animation, command.loop, 0);

        entry.mixDuration = command.mixDuration;
        entry.timeScale = command.timeScale;
        this.renderFrame(0);
        return;
      }

      case 'stopAnimation': {
        this.spine.state.setEmptyAnimation(command.track, command.mixDuration);
        this.renderFrame(0);
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

    this.renderFrame(0);
  }

  setCharacterOffset(x: number, y: number): void {
    this.characterOffset = { x, y };
    this.layout({ width: this.app.renderer.width, height: this.app.renderer.height });
    this.renderFrame(0);
  }

  setCharacterScale(scale: number): void {
    this.characterScale = Math.max(0.2, Math.min(3, scale));
    this.layout({ width: this.app.renderer.width, height: this.app.renderer.height });
    this.renderFrame(0);
  }

  setCharacterRotation(degrees: number): void {
    this.characterRotation = degrees;
    this.layout({ width: this.app.renderer.width, height: this.app.renderer.height });
    this.renderFrame(0);
  }

  setCharacterMirror(enabled: boolean): void {
    this.characterMirror = enabled;
    this.layout({ width: this.app.renderer.width, height: this.app.renderer.height });
    this.renderFrame(0);
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

  captureFrame(deltaSeconds: number): void {
    this.renderFrame(deltaSeconds);
  }

  resize(size: StageSize): void {
    this.app.renderer.resize(size.width, size.height);
    this.layout(size);
    this.renderFrame(0);
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
    this.app.ticker.remove(this.tick);
    this.app.stage.removeChild(this.shadow);
    this.app.stage.removeChild(this.spine);
    this.shadow.destroy();
    this.spine.destroy({ children: true });
    this.app.destroy(true, { children: true });
  }

  private renderFrame(deltaSeconds: number): void {
    this.spine.update(deltaSeconds);
    this.app.render();
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
    this.shadow.beginFill(0x000000, 0.22);
    this.shadow.drawEllipse(0, 0, radiusX, radiusY);
    this.shadow.endFill();
    this.shadow.position.set(x, y + radiusY * 0.35);
    this.shadow.visible = this.shadowEnabled;
  }
}

export class SpineLegacyAdapter implements RuntimeAdapter {
  readonly kind = 'spine-legacy-webgl' satisfies RuntimeKind;

  async loadModel(model: ModelDefinition, context: RuntimeLoadContext): Promise<RuntimeModelInstance> {
    const legacyModel = toSpineLegacyModel(model);

    installPjsekBinaryPatch();
    installLegacyPixiPlugins();

    const quality = pickRenderQuality();
    const [skeletonBytes, atlasText, image] = await Promise.all([
      loadBinary(legacyModel.assets.sharedSkeleton),
      loadText(legacyModel.assets.atlas),
      loadImage(legacyModel.assets.texture),
    ]);
    const baseTexture = BaseTexture.from(image);

    baseTexture.setSize(image.naturalWidth || image.width, image.naturalHeight || image.height);

    const atlas = new TextureAtlas(atlasText, (_path, load) => load(baseTexture));

    patchAtlasLookup(atlas);

    const attachmentLoader = new AtlasAttachmentLoader(atlas);

    patchAttachmentLoader(attachmentLoader);

    const skeletonData = new SkeletonBinary(attachmentLoader).readSkeletonData(skeletonBytes);
    const app = new Application({
      width: context.size.width,
      height: context.size.height,
      autoStart: false,
      autoDensity: true,
      antialias: quality.antialias,
      backgroundAlpha: 0,
      preserveDrawingBuffer: true,
      resolution: quality.resolution,
    });
    const spine = new Spine(skeletonData);
    const shadow = new Graphics();

    app.ticker.maxFPS = quality.maxFps;
    app.ticker.remove(app.render, app);
    app.view.className = 'pixi-canvas';
    spine.autoUpdate = false;
    spine.skeleton.setSkinByName('default');
    spine.skeleton.setToSetupPose();
    app.stage.addChild(shadow);
    app.stage.addChild(spine);
    context.host.append(app.view);

    const instance = new SpineLegacyModelInstance(app, shadow, spine, legacyModel, legacyModel.actions);

    instance.resize(context.size);
    app.start();

    return instance;
  }
}
