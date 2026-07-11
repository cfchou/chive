export const DRAG_START_PX = 4;

export type ClientPointerPosition = {
  clientX: number;
  clientY: number;
};

export function hasPointerDragStarted(start: ClientPointerPosition, current: ClientPointerPosition) {
  return Math.hypot(current.clientX - start.clientX, current.clientY - start.clientY) >= DRAG_START_PX;
}

export function hasHorizontalPointerDragStarted(startX: number, currentX: number) {
  return Math.abs(currentX - startX) >= DRAG_START_PX;
}
