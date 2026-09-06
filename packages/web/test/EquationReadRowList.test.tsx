// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EquationReadRowList } from "../src/notebook/components/EquationReadRowList";
import type { VisibleEquationReadItem } from "../src/notebook/equationReadRows";

afterEach(() => cleanup());

function makeItems(count: number): VisibleEquationReadItem[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    key: `eq-${index}`,
    kind: "equation" as const
  }));
}

describe("EquationReadRowList", () => {
  it("renders every row when there is no scroll parent", () => {
    const items = makeItems(12);
    const { container } = render(
      <EquationReadRowList
        items={items}
        renderItem={(item) => <div data-testid={item.key}>{item.key}</div>}
      />
    );

    expect(container.querySelector(".notebook-equation-virtual-list")).toBeNull();
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(12);
  });

  it("renders every row when the scroll parent has no layout height", () => {
    const viewport = document.createElement("div");
    document.body.appendChild(viewport);
    const items = makeItems(12);
    const { container } = render(
      <EquationReadRowList
        items={items}
        viewportRoot={viewport}
        renderItem={(item) => <div data-testid={item.key}>{item.key}</div>}
      />
    );

    expect(container.querySelector(".notebook-equation-virtual-list")).toBeNull();
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(12);
    viewport.remove();
  });

  it("uses the virtual list when a scroll parent has a layout height", () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 400 });
    document.body.appendChild(viewport);
    const items = makeItems(40);
    const { container } = render(
      <EquationReadRowList
        items={items}
        viewportRoot={viewport}
        renderItem={(item) => <div data-testid={item.key}>{item.key}</div>}
      />
    );

    expect(container.querySelector(".notebook-equation-virtual-list")).not.toBeNull();
    viewport.remove();
  });
});
