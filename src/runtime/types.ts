import type { ActionDefinition, ModelDefinition, RuntimeKind } from '@/domain/manifest';

export interface StageSize {
  readonly width: number;
  readonly height: number;
}

export interface PlayAnimationCommand {
  readonly kind: 'playAnimation';
  readonly animation: string;
  readonly track: number;
  readonly loop: boolean;
  readonly timeScale: number;
  readonly mixDuration: number;
  readonly interrupt: boolean;
}

export interface StopAnimationCommand {
  readonly kind: 'stopAnimation';
  readonly track: number;
  readonly mixDuration: number;
}

export type RuntimeCommand = PlayAnimationCommand | StopAnimationCommand;

export interface RuntimeModelInstance {
  readonly actions: readonly ActionDefinition[];
  execute(command: RuntimeCommand): void;
  setTimeScale(value: number): void;
  setCharacterShadow(enabled: boolean): void;
  setCharacterOffset(x: number, y: number): void;
  setCharacterScale(scale: number): void;
  setCharacterRotation(degrees: number): void;
  setCharacterMirror(enabled: boolean): void;
  canDragCharacterAt(x: number, y: number): boolean;
  captureFrame(deltaSeconds: number): void;
  resize(size: StageSize): void;
  setPaused(paused: boolean): void;
  destroy(): void;
}

export interface RuntimeLoadContext {
  readonly host: HTMLElement;
  readonly size: StageSize;
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  loadModel(model: ModelDefinition, context: RuntimeLoadContext): Promise<RuntimeModelInstance>;
}
