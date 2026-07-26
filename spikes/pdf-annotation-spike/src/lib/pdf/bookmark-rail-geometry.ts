export type BookmarkRailRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type PagePositionPx = {
  left: number;
  top: number;
};

export const bookmarkRailAnchorWidthPx = 12;
export const bookmarkRailAnchorHeightPx = 22;
export const bookmarkRailMarkerTranslateYPx = -2;
export const bookmarkRailFocusCueSizePx = 22;
export const bookmarkRailAddCueSizePx = 36;
export const bookmarkRailAddCueOffsetPx = 22;

const railMarkerDmzLeftTolerancePx = 28;
const railMarkerDmzRightTolerancePx = 8;

export function clampPdfY(value: number, pageHeight: number) {
  return Math.max(0, Math.min(pageHeight, value));
}

export function railMarkerRectAt(leftPx: number, anchorTopPx: number): BookmarkRailRect {
  const top = anchorTopPx + bookmarkRailMarkerTranslateYPx;
  return {
    left: leftPx,
    right: leftPx + bookmarkRailAnchorWidthPx,
    top,
    bottom: top + bookmarkRailAnchorHeightPx,
  };
}

export function railMarkerContentRectForOffset(
  pagePosition: PagePositionPx,
  offsetIntoPage: number,
): BookmarkRailRect {
  return railMarkerRectAt(pagePosition.left, pagePosition.top + offsetIntoPage);
}

export function bookmarkRailRectsConflict(candidateRect: BookmarkRailRect, markerRect: BookmarkRailRect) {
  const markerDmzTop = markerRect.top - bookmarkRailAnchorHeightPx;
  const markerDmzBottom = markerRect.bottom + bookmarkRailAnchorHeightPx;
  return (
    candidateRect.left <= markerRect.right + railMarkerDmzRightTolerancePx &&
    candidateRect.right >= markerRect.left - railMarkerDmzLeftTolerancePx &&
    candidateRect.bottom >= markerDmzTop &&
    candidateRect.top <= markerDmzBottom
  );
}

export function renderedPageScale(renderedHeightPx: number, pageHeight: number) {
  return renderedHeightPx > 0 ? renderedHeightPx / pageHeight : 1;
}

export function offsetIntoPageForTargetY(targetY: number, pageHeight: number, renderedHeightPx: number) {
  return ((pageHeight - targetY) / pageHeight) * renderedHeightPx;
}

export function targetYForOffsetIntoPage(offsetIntoPage: number, scale: number, pageHeight: number) {
  return clampPdfY(pageHeight - offsetIntoPage / scale, pageHeight);
}

export function bookmarkAnchorInsetForScale(scale: number) {
  return bookmarkRailAnchorHeightPx / scale;
}

export function bookmarkDestinationYForInset(targetY: number, anchorInsetPdfPoints: number, pageHeight: number) {
  return clampPdfY(targetY + anchorInsetPdfPoints, pageHeight);
}

export function bookmarkAnchorYForInset(destinationY: number, anchorInsetPdfPoints: number, pageHeight: number) {
  return clampPdfY(destinationY - anchorInsetPdfPoints, pageHeight);
}

export function withinSquareCue(
  pointX: number,
  pointY: number,
  centerX: number,
  centerY: number,
  cueSizePx: number,
) {
  return Math.abs(pointX - centerX) <= cueSizePx / 2 && Math.abs(pointY - centerY) <= cueSizePx / 2;
}
