import {useEffect, useState, type CSSProperties} from "react";

export function useDashboardDialog(selector: string | null): CSSProperties | undefined {
  const [viewport, setViewport] = useState<CSSProperties>();
  useEffect(() => {
    if (!selector) return;
    const dialog = document.querySelector<HTMLElement>(selector);
    if (!dialog) return;
    const trigger = document.activeElement as HTMLElement | null;
    const visual = window.visualViewport;
    const update = () => setViewport({
      "--noor-dialog-top": `${visual?.offsetTop ?? 0}px`,
      "--noor-dialog-height": `${visual?.height ?? window.innerHeight}px`,
    } as CSSProperties);
    update();
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    dialog.querySelector<HTMLElement>("header button")?.focus({preventScroll:true});
    return () => {
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      trigger?.focus({preventScroll:true});
    };
  }, [selector]);
  return selector ? viewport : undefined;
}
