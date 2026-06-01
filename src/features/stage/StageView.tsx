import { onCleanup, onMount } from 'solid-js';

import type { StageController } from '@/renderer/StageController';
import { isCoarsePointer } from '@/shared/device';

interface StageViewProps {
  readonly onReady: (controller: StageController) => void;
  readonly onError: (error: unknown) => void;
  readonly onActiveIndexChange?: (index: number) => void;
}

interface DragStart {
  readonly pointerId: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly threshold: number;
  moved: boolean;
  nextX: number;
  nextY: number;
}

const POINTER_DRAG_THRESHOLD = 3;
const TOUCH_DRAG_THRESHOLD = 7;
const TOUCH_HIT_RADIUS = 26;

export const StageView = (props: StageViewProps) => {
  let host!: HTMLDivElement;
  let alive = true;
  let controller: StageController | undefined;
  let dragStart: DragStart | undefined;
  let dragFrame = 0;

  const releaseCapture = (pointerId: number): void => {
    if (host.hasPointerCapture(pointerId)) {
      host.releasePointerCapture(pointerId);
    }
  };

  const flushDrag = (): void => {
    dragFrame = 0;

    if (!dragStart || !controller || !dragStart.moved) {
      return;
    }

    controller.setCharacterOffset(dragStart.nextX, dragStart.nextY);
  };

  const scheduleDrag = (): void => {
    if (dragFrame === 0) {
      dragFrame = window.requestAnimationFrame(flushDrag);
    }
  };

  const clearDrag = (pointerId?: number, flush = true): void => {
    const current = dragStart;

    if (!current || (pointerId !== undefined && current.pointerId !== pointerId)) {
      return;
    }

    if (flush && current.moved && controller) {
      controller.setCharacterOffset(current.nextX, current.nextY);
    }

    dragStart = undefined;

    if (dragFrame !== 0) {
      window.cancelAnimationFrame(dragFrame);
      dragFrame = 0;
    }

    releaseCapture(current.pointerId);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!dragStart || !controller || event.pointerId !== dragStart.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragStart.pointerX;
    const deltaY = event.clientY - dragStart.pointerY;

    if (!dragStart.moved) {
      if (Math.hypot(deltaX, deltaY) < dragStart.threshold) {
        return;
      }

      dragStart.moved = true;
    }

    dragStart.nextX = dragStart.offsetX + deltaX;
    dragStart.nextY = dragStart.offsetY + deltaY;
    scheduleDrag();
    event.preventDefault();
  };

  const handlePointerUp = (event: PointerEvent): void => {
    clearDrag(event.pointerId);
  };

  const handlePointerCancel = (event: PointerEvent): void => {
    clearDrag(event.pointerId, false);
  };

  const handlePointerLost = (event: PointerEvent): void => {
    clearDrag(event.pointerId, false);
  };

  const handleWindowBlur = (): void => {
    clearDrag(undefined, false);
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (!controller || dragStart || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }

    const bounds = host.getBoundingClientRect();
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;
    const hitRadius = event.pointerType === 'mouse' && !isCoarsePointer() ? 0 : TOUCH_HIT_RADIUS;

    const pickedIndex = controller.pickActiveIndexAt(localX, localY, hitRadius);

    if (pickedIndex < 0) {
      return;
    }

    props.onActiveIndexChange?.(pickedIndex);

    const current = controller.readCharacterOffset();

    dragStart = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: current.x,
      offsetY: current.y,
      threshold: event.pointerType === 'mouse' ? POINTER_DRAG_THRESHOLD : TOUCH_DRAG_THRESHOLD,
      moved: false,
      nextX: current.x,
      nextY: current.y,
    };

    host.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  onMount(() => {
    window.addEventListener('blur', handleWindowBlur);

    void import('@/renderer/StageController')
      .then(({ StageController }) => StageController.create(host))
      .then((createdController) => {
        if (!alive) {
          createdController.destroy();
          return;
        }

        controller = createdController;
        props.onReady(createdController);
      })
      .catch(props.onError);
  });

  onCleanup(() => {
    alive = false;
    clearDrag(undefined, false);
    window.removeEventListener('blur', handleWindowBlur);
    controller?.destroy();
  });

  return (
    <div
      ref={host}
      class="stage-view"
      aria-label="Character stage"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerLost}
    />
  );
};
