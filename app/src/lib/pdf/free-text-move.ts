export const FREE_TEXT_MOVE_GRIP_SIZE_PX = 14;
// The visual grip straddles the selected border; its rendered corner stays
// outside the editable surface while this hit box remains touch-friendly.
export const FREE_TEXT_MOVE_GRIP_INSET_PX = -6;

export type FreeTextMoveRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ClientPointerPosition = {
  clientX: number;
  clientY: number;
};

export function isFreeTextMoveGripHit(rect: FreeTextMoveRect, clientX: number, clientY: number) {
  const left = rect.left + FREE_TEXT_MOVE_GRIP_INSET_PX;
  const top = rect.top + FREE_TEXT_MOVE_GRIP_INSET_PX;
  return (
    clientX >= left &&
    clientX < left + FREE_TEXT_MOVE_GRIP_SIZE_PX &&
    clientY >= top &&
    clientY < top + FREE_TEXT_MOVE_GRIP_SIZE_PX
  );
}

export function incrementalFreeTextClientDelta(previous: ClientPointerPosition, current: ClientPointerPosition) {
  return {
    clientDx: current.clientX - previous.clientX,
    clientDy: current.clientY - previous.clientY,
  };
}
