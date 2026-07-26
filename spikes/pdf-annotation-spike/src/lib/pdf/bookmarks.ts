export type BookmarkEntry = {
  id: string;
  title: string;
  pageNumber: number;
  pageRef: string;
  pageHeight: number;
  targetY: number;
  destinationY: number;
  color: string | null;
};

export function sortBookmarkEntries(entries: BookmarkEntry[]) {
  return [...entries].sort((left, right) => {
    const pageOrder = left.pageNumber - right.pageNumber;
    if (pageOrder !== 0) return pageOrder;
    const pagePositionOrder = right.targetY - left.targetY;
    if (pagePositionOrder !== 0) return pagePositionOrder;
    return left.id.localeCompare(right.id);
  });
}
