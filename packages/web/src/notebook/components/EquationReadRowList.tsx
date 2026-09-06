import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  estimateEquationReadItemSize,
  type VisibleEquationReadItem
} from "../equationReadRows";

const EQUATION_READ_OVERSCAN = 8;

export function EquationReadRowList({
  editingIndex = null,
  items,
  renderItem,
  viewportRoot
}: {
  editingIndex?: number | null;
  items: readonly VisibleEquationReadItem[];
  renderItem(item: VisibleEquationReadItem): ReactNode;
  viewportRoot?: Element | null;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(() =>
    viewportRoot instanceof HTMLElement ? viewportRoot.clientHeight : 0
  );
  const canVirtualize = viewportRoot instanceof HTMLElement && viewportHeight > 0;

  useLayoutEffect(() => {
    if (!(viewportRoot instanceof HTMLElement)) {
      setViewportHeight(0);
      return;
    }

    const scroll = viewportRoot;
    function updateViewportHeight(): void {
      setViewportHeight(scroll.clientHeight);
    }

    updateViewportHeight();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [viewportRoot]);

  useLayoutEffect(() => {
    if (!canVirtualize || !listRef.current || !(viewportRoot instanceof HTMLElement)) {
      setScrollMargin(0);
      return;
    }

    const list = listRef.current;
    const scroll = viewportRoot;

    function updateScrollMargin(): void {
      const nextMargin =
        list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      setScrollMargin((current) => (Math.abs(current - nextMargin) < 0.5 ? current : nextMargin));
    }

    updateScrollMargin();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateScrollMargin);
    observer.observe(list);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [canVirtualize, items.length, viewportRoot]);

  const virtualizer = useVirtualizer({
    count: items.length,
    enabled: canVirtualize,
    estimateSize: (index) => {
      const item = items[index];
      return item ? estimateEquationReadItemSize(item) : 36;
    },
    getItemKey: (index) => items[index]?.key ?? index,
    getScrollElement: () => (canVirtualize ? viewportRoot : null),
    overscan: EQUATION_READ_OVERSCAN,
    scrollMargin
  });

  useEffect(() => {
    if (!canVirtualize || editingIndex == null) {
      return;
    }
    const itemIndex = items.findIndex(
      (item) => item.kind === "equation" && item.index === editingIndex
    );
    if (itemIndex < 0) {
      return;
    }
    virtualizer.scrollToIndex(itemIndex, { align: "center" });
  }, [canVirtualize, editingIndex, items, virtualizer]);

  if (!canVirtualize) {
    return (
      <>
        {items.map((item) => (
          <Fragment key={item.key}>{renderItem(item)}</Fragment>
        ))}
      </>
    );
  }

  return (
    <div
      ref={listRef}
      className="notebook-equation-virtual-list"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index];
        if (!item) {
          return null;
        }
        return (
          <div
            key={item.key}
            className="notebook-equation-virtual-item"
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              transform: `translateY(${virtualItem.start - scrollMargin}px)`
            }}
          >
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}
