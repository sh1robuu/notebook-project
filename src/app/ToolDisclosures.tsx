import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";

/** Children stay mounted when the responsive flyout closes (dialogs and commands own their state). */
export function AdaptiveTools({
  label,
  children,
  className,
  icon = "more",
}: {
  label: string;
  children: ReactNode;
  className: string;
  icon?: "more" | "settings";
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !host.current?.contains(target) &&
        !target.closest("dialog[open]")
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.isComposing ||
        event.defaultPrevented ||
        document.querySelector("dialog[open]") ||
        !trigger.current?.getClientRects().length
      )
        return;
      setOpen(false);
      trigger.current.focus();
      event.preventDefault();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      className={"adaptive-tools " + className}
      ref={host}
      data-adaptive-menu
      data-open={open}
    >
      <button
        type="button"
        className="adaptive-trigger"
        ref={trigger}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={icon} />
      </button>
      <div id={id} className="adaptive-content">
        {children}
      </div>
    </div>
  );
}

export function closeToolDisclosures(workspace: HTMLElement) {
  const disclosures = () => [
    ...workspace.querySelectorAll<HTMLDetailsElement>(
      "details[data-tool-disclosure][open]",
    ),
  ];
  const outside = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("dialog[open]")) return;
    for (const open of disclosures())
      if (!open.contains(target)) open.open = false;
  };
  const escape = (event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      event.isComposing ||
      event.defaultPrevented ||
      document.querySelector("dialog[open]")
    )
      return;
    const open =
      disclosures().findLast((detail) =>
        detail.contains(document.activeElement),
      ) ?? disclosures().at(-1);
    if (!open) return;
    open.open = false;
    open.querySelector("summary")?.focus();
    event.preventDefault();
  };
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", escape, true);
  return () => {
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("keydown", escape, true);
  };
}
