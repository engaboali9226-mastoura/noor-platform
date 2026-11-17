import {useEffect, useState, type CSSProperties} from "react";

export function useDialogViewport(open: boolean): CSSProperties | undefined {
  const [viewport, setViewport] = useState<CSSProperties>();
  useEffect(() => {
    if (!open) return;
    const visual = window.visualViewport;
    const update = () => setViewport({
      "--noor-dialog-top": `${visual?.offsetTop ?? 0}px`,
      "--noor-dialog-height": `${visual?.height ?? window.innerHeight}px`,
    } as CSSProperties);
    update();
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [open]);
  return open ? viewport : undefined;
}

export function useDashboardDialog(selector: string | null): CSSProperties | undefined {
  const viewport = useDialogViewport(selector !== null);
  useEffect(() => {
    if (!selector) return;
    const dialog = document.querySelector<HTMLElement>(selector);
    if (!dialog) return;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.querySelector<HTMLElement>("header button")?.focus({preventScroll:true});
    return () => trigger?.focus({preventScroll:true});
  }, [selector]);
  return viewport;
}
