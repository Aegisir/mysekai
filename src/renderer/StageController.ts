import { composeDefaultCommands } from '@/actions/actionComposer';
import type { ModelDefinition } from '@/domain/manifest';
import { createRuntimeRegistry, type RuntimeRegistry } from '@/runtime/registry';
import type { RuntimeCommand, RuntimeModelInstance, StageSize } from '@/runtime/types';
import { clampEditorValue, EDITOR_CONTROL_LIMITS } from '@/shared/editorLimits';

interface StageActorRuntimeState {
  readonly instance: RuntimeModelInstance;
  offset: { readonly x: number; readonly y: number };
  scale: number;
  rotation: number;
  mirror: boolean;
  shadow: boolean;
}

export class StageController {
  private readonly actors: StageActorRuntimeState[] = [];
  private activeIndex = -1;
  private readonly resizeObserver: ResizeObserver;
  private loadToken = 0;
  private disposed = false;

  private constructor(
    private readonly host: HTMLElement,
    private readonly registry: RuntimeRegistry,
  ) {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.resize();
  }

  static async create(
    host: HTMLElement,
    registry: RuntimeRegistry = createRuntimeRegistry(),
  ): Promise<StageController> {
    return new StageController(host, registry);
  }

  async loadModel(model: ModelDefinition): Promise<void> {
    const token = ++this.loadToken;
    const adapter = await this.registry.get(model.runtime);
    const instance = await adapter.loadModel(model, {
      host: this.host,
      size: this.readSize(),
    });

    if (this.disposed || token !== this.loadToken) {
      instance.destroy();
      return;
    }

    const actor: StageActorRuntimeState = {
      instance,
      offset: { x: 0, y: 0 },
      scale: 1,
      rotation: 0,
      mirror: false,
      shadow: true,
    };

    this.actors.push(actor);
    this.activeIndex = this.actors.length - 1;
    this.applyActorState(actor);

    for (const command of composeDefaultCommands(model)) {
      instance.execute(command);
    }
  }

  executeActive(command: RuntimeCommand): void {
    this.readActiveInstance()?.execute(command);
  }

  setActiveTimeScale(value: number): void {
    this.readActiveInstance()?.setTimeScale(clampEditorValue(value, EDITOR_CONTROL_LIMITS.timeScale));
  }

  setCharacterShadow(enabled: boolean): void {
    const actor = this.readActiveActor();

    if (!actor) {
      return;
    }

    actor.shadow = enabled;
    actor.instance.setCharacterShadow(enabled);
  }

  setCharacterOffset(x: number, y: number): void {
    const actor = this.readActiveActor();

    if (!actor) {
      return;
    }

    actor.offset = { x, y };
    actor.instance.setCharacterOffset(x, y);
  }

  setCharacterScale(scale: number): void {
    const actor = this.readActiveActor();

    if (!actor) {
      return;
    }

    const nextScale = clampEditorValue(scale, EDITOR_CONTROL_LIMITS.sizeScale);

    actor.scale = nextScale;
    actor.instance.setCharacterScale(nextScale);
  }

  setCharacterRotation(degrees: number): void {
    const actor = this.readActiveActor();

    if (!actor) {
      return;
    }

    const nextRotation = clampEditorValue(degrees, EDITOR_CONTROL_LIMITS.rotation);

    actor.rotation = nextRotation;
    actor.instance.setCharacterRotation(nextRotation);
  }

  setCharacterMirror(enabled: boolean): void {
    const actor = this.readActiveActor();

    if (!actor) {
      return;
    }

    actor.mirror = enabled;
    actor.instance.setCharacterMirror(enabled);
  }

  readCharacterOffset(): { readonly x: number; readonly y: number } {
    return this.readActiveActor()?.offset ?? { x: 0, y: 0 };
  }

  readCharacterRotation(): number {
    return this.readActiveActor()?.rotation ?? 0;
  }

  readCharacterScale(): number {
    return this.readActiveActor()?.scale ?? 1;
  }

  readCharacterMirror(): boolean {
    return this.readActiveActor()?.mirror ?? false;
  }

  readCharacterShadow(): boolean {
    return this.readActiveActor()?.shadow ?? true;
  }

  canDragActiveCharacterAt(x: number, y: number): boolean {
    return this.readActiveInstance()?.canDragCharacterAt(x, y) ?? false;
  }

  readActiveAnimationDuration(animation: string): number | undefined {
    return this.readActiveInstance()?.readAnimationDuration(animation);
  }

  captureFrame(deltaSeconds: number): void {
    for (const actor of this.actors) {
      actor.instance.captureFrame(deltaSeconds);
    }
  }

  setPaused(paused: boolean): void {
    for (const actor of this.actors) {
      actor.instance.setPaused(paused);
    }
  }

  pickActiveIndexAt(x: number, y: number, radius = 0): number {
    const points =
      radius > 0
        ? [
            { x, y },
            { x: x - radius, y },
            { x: x + radius, y },
            { x, y: y - radius },
            { x, y: y + radius },
          ]
        : [{ x, y }];

    for (let index = this.actors.length - 1; index >= 0; index -= 1) {
      const actor = this.actors[index];

      if (actor && points.some((point) => actor.instance.canDragCharacterAt(point.x, point.y))) {
        this.activeIndex = index;
        return index;
      }
    }

    return -1;
  }

  readActiveIndex(): number {
    return this.activeIndex;
  }

  readInstanceCount(): number {
    return this.actors.length;
  }

  setActiveIndex(index: number): void {
    if (index < 0 || index >= this.actors.length) {
      return;
    }

    this.activeIndex = index;
  }

  removeActiveModel(): void {
    const active = this.readActiveInstance();

    if (!active || this.activeIndex < 0) {
      return;
    }

    active.destroy();
    this.actors.splice(this.activeIndex, 1);

    if (this.actors.length === 0) {
      this.activeIndex = -1;
      return;
    }

    this.activeIndex = Math.min(this.activeIndex, this.actors.length - 1);
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.loadToken += 1;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.resizeObserver.disconnect();
    this.clearActiveInstance();
  }

  private readonly handleVisibilityChange = (): void => {
    for (const actor of this.actors) {
      actor.instance.setPaused(document.hidden);
    }
  };

  private resize(): void {
    const size = this.readSize();

    for (const actor of this.actors) {
      actor.instance.resize(size);
    }
  }

  private readSize(): StageSize {
    const bounds = this.host.getBoundingClientRect();

    return {
      width: Math.max(1, Math.floor(bounds.width)),
      height: Math.max(1, Math.floor(bounds.height)),
    };
  }

  private applyActorState(actor: StageActorRuntimeState): void {
    actor.instance.setCharacterOffset(actor.offset.x, actor.offset.y);
    actor.instance.setCharacterScale(actor.scale);
    actor.instance.setCharacterRotation(actor.rotation);
    actor.instance.setCharacterMirror(actor.mirror);
    actor.instance.setCharacterShadow(actor.shadow);
  }

  private clearActiveInstance(): void {
    while (this.actors.length > 0) {
      const actor = this.actors.pop();

      actor?.instance.destroy();
    }

    this.activeIndex = -1;
  }

  private readActiveInstance(): RuntimeModelInstance | undefined {
    return this.readActiveActor()?.instance;
  }

  private readActiveActor(): StageActorRuntimeState | undefined {
    if (this.activeIndex < 0 || this.activeIndex >= this.actors.length) {
      return undefined;
    }

    return this.actors[this.activeIndex];
  }
}
