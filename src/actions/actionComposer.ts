import type { ActionId } from '@/domain/ids';
import type { ActionDefinition, ModelDefinition } from '@/domain/manifest';
import type { PlayAnimationCommand, RuntimeCommand, StopAnimationCommand } from '@/runtime/types';
import { clampEditorValue, EDITOR_CONTROL_LIMITS } from '@/shared/editorLimits';

export const clampTimeScale = (value: number): number =>
  clampEditorValue(value, EDITOR_CONTROL_LIMITS.timeScale);

export const findAction = (
  model: ModelDefinition,
  actionId: ActionId,
): ActionDefinition | undefined => model.actions.find((action) => action.id === actionId);

export const composePlayCommand = (
  action: ActionDefinition,
  timeScale = 1,
  loopOverride?: boolean,
): PlayAnimationCommand => ({
  kind: 'playAnimation',
  animation: action.animation,
  track: action.track,
  loop: typeof loopOverride === 'boolean' ? loopOverride : action.loop,
  timeScale: clampTimeScale(action.timeScale * timeScale),
  mixDuration: action.mixDuration,
  interrupt: action.interrupt,
});

export const composeStopCommand = (track = 0, mixDuration = 0.16): StopAnimationCommand => ({
  kind: 'stopAnimation',
  track,
  mixDuration,
});

export const composeDefaultCommands = (model: ModelDefinition): readonly RuntimeCommand[] => {
  const defaultAction = model.defaultActionId
    ? findAction(model, model.defaultActionId)
    : model.actions.find((action) => action.loop) ?? model.actions[0];

  return defaultAction ? [composePlayCommand(defaultAction)] : [];
};
