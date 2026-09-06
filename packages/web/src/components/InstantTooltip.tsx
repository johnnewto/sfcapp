import {
  type ComponentPropsWithoutRef,
  type ElementType,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom";

type InstantTooltipProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  className?: string;
  tooltip?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

const VIEWPORT_PADDING = 8;
const TOOLTIP_GAP = 10;

export const FORMULA_TOOLTIP_ATTR = "data-formula-tooltip";

export function InstantTooltip<T extends ElementType = "span">({
  as,
  children,
  className,
  tooltip,
  ...rest
}: InstantTooltipProps<T>) {
  const Component = (as ?? "span") as ElementType;
  const anchorRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();
  const [isVisible, setIsVisible] = useState(false);
  const [layout, setLayout] = useState<{ left: number; placement: Placement; top: number }>({
    left: 0,
    placement: "top",
    top: 0
  });

  const updatePosition = useCallback(() => {
    if (!tooltip || !anchorRef.current || !tooltipRef.current) {
      return;
    }

    setLayout(computeInstantTooltipLayout(anchorRef.current, tooltipRef.current));
  }, [tooltip]);

  useLayoutEffect(() => {
    if (!isVisible || !tooltip) {
      return;
    }

    updatePosition();

    function handleViewportChange(): void {
      updatePosition();
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isVisible, tooltip, updatePosition]);

  const componentProps = rest as ComponentPropsWithoutRef<T> & {
    onBlur?: (event: FocusEvent<HTMLElement>) => void;
    onFocus?: (event: FocusEvent<HTMLElement>) => void;
    onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
    onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
  };

  return (
    <>
      <Component
        {...componentProps}
        aria-describedby={tooltip ? tooltipId : undefined}
        className={className}
        onBlur={(event: FocusEvent<HTMLElement>) => {
          componentProps.onBlur?.(event);
          setIsVisible(false);
        }}
        onFocus={(event: FocusEvent<HTMLElement>) => {
          componentProps.onFocus?.(event);
          if (tooltip) {
            setIsVisible(true);
          }
        }}
        onMouseEnter={(event: MouseEvent<HTMLElement>) => {
          componentProps.onMouseEnter?.(event);
          if (tooltip) {
            setIsVisible(true);
          }
        }}
        onMouseLeave={(event: MouseEvent<HTMLElement>) => {
          componentProps.onMouseLeave?.(event);
          setIsVisible(false);
        }}
        ref={(node: HTMLElement | null) => {
          anchorRef.current = node;
          const externalRef = (
            componentProps as {
              ref?: ((node: HTMLElement | null) => void) | { current: HTMLElement | null };
            }
          ).ref;
          if (typeof externalRef === "function") {
            externalRef(node);
          } else if (externalRef && typeof externalRef === "object") {
            externalRef.current = node;
          }
        }}
      >
        {children}
      </Component>
      {isVisible && tooltip
        ? createPortal(
            <InstantTooltipBubble
              id={tooltipId}
              layout={layout}
              tooltipRef={tooltipRef}
              text={tooltip}
            />,
            document.body
          )
        : null}
    </>
  );
}

export function DelegatedFormulaTooltip() {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<{
    layout: { left: number; placement: Placement; top: number };
    text: string;
  } | null>(null);

  useEffect(() => {
    function resolveToken(node: EventTarget | null): HTMLElement | null {
      if (!(node instanceof Element)) {
        return null;
      }
      return node.closest(`[${FORMULA_TOOLTIP_ATTR}]`);
    }

    function handlePointerOver(event: PointerEvent): void {
      const token = resolveToken(event.target);
      if (!token) {
        return;
      }
      const text = token.getAttribute(FORMULA_TOOLTIP_ATTR);
      if (!text) {
        return;
      }
      anchorRef.current = token;
      setState({
        layout: { left: 0, placement: "top", top: 0 },
        text
      });
    }

    function hideTooltip(): void {
      anchorRef.current = null;
      setState(null);
    }

    function handlePointerOut(event: PointerEvent): void {
      const leaving = resolveToken(event.target);
      const entering = resolveToken(event.relatedTarget);
      if (!leaving || leaving === entering) {
        return;
      }
      if (anchorRef.current === leaving) {
        hideTooltip();
      }
    }

    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointerout", handlePointerOut);
    return () => {
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointerout", handlePointerOut);
    };
  }, []);

  useLayoutEffect(() => {
    if (!state) {
      return;
    }
    if (!anchorRef.current?.isConnected) {
      anchorRef.current = null;
      setState(null);
      return;
    }
    if (!tooltipRef.current) {
      return;
    }

    const layout = computeInstantTooltipLayout(anchorRef.current, tooltipRef.current);
    setState((current) =>
      current == null
        ? current
        : current.layout.left === layout.left &&
            current.layout.top === layout.top &&
            current.layout.placement === layout.placement
          ? current
          : { ...current, layout }
    );

    function handleViewportChange(): void {
      if (!anchorRef.current?.isConnected) {
        anchorRef.current = null;
        setState(null);
        return;
      }
      if (!tooltipRef.current) {
        return;
      }
      const nextLayout = computeInstantTooltipLayout(anchorRef.current, tooltipRef.current);
      setState((current) =>
        current == null
          ? current
          : current.layout.left === nextLayout.left &&
              current.layout.top === nextLayout.top &&
              current.layout.placement === nextLayout.placement
            ? current
            : { ...current, layout: nextLayout }
      );
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [state?.text]);

  if (!state) {
    return null;
  }

  return createPortal(
    <InstantTooltipBubble layout={state.layout} tooltipRef={tooltipRef} text={state.text} />,
    document.body
  );
}

function InstantTooltipBubble({
  id,
  layout,
  text,
  tooltipRef
}: {
  id?: string;
  layout: { left: number; placement: Placement; top: number };
  text: string;
  tooltipRef: { current: HTMLDivElement | null };
}) {
  return (
    <div
      id={id}
      ref={(node) => {
        tooltipRef.current = node;
      }}
      className={`instant-tooltip-bubble instant-tooltip-${layout.placement}`}
      role="tooltip"
      style={{
        left: `${layout.left}px`,
        maxWidth: `${Math.min(448, Math.max(window.innerWidth - VIEWPORT_PADDING * 2, 160))}px`,
        top: `${layout.top}px`
      }}
    >
      {text}
    </div>
  );
}

function computeInstantTooltipLayout(
  anchor: HTMLElement,
  tooltip: HTMLElement
): { left: number; placement: Placement; top: number } {
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - tooltipRect.width - VIEWPORT_PADDING);
  const left = Math.min(
    Math.max(anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2, VIEWPORT_PADDING),
    maxLeft
  );
  const preferredTop = anchorRect.top - tooltipRect.height - TOOLTIP_GAP;
  const placement: Placement = preferredTop >= VIEWPORT_PADDING ? "top" : "bottom";
  const top =
    placement === "top"
      ? preferredTop
      : Math.min(
          anchorRect.bottom + TOOLTIP_GAP,
          Math.max(VIEWPORT_PADDING, window.innerHeight - tooltipRect.height - VIEWPORT_PADDING)
        );
  return { left, placement, top };
}
