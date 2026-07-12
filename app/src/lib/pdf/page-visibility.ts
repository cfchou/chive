export type VerticalRectSource = {
  getBoundingClientRect(): { top: number; bottom: number };
};

export function isPageInView(container: VerticalRectSource, pageElement: VerticalRectSource): boolean {
  const containerRect = container.getBoundingClientRect();
  const pageRect = pageElement.getBoundingClientRect();
  return pageRect.bottom > containerRect.top && pageRect.top < containerRect.bottom;
}
