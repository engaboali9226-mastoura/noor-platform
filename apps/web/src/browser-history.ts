export type HistoryListener =
  () => void;

export interface HistoryPort {
  pathname(): string;

  push(
    pathname: string,
  ): void;

  replace(
    pathname: string,
  ): void;

  subscribe(
    listener: HistoryListener,
  ): () => void;
}

export function createBrowserHistory(
  browserWindow: Window,
): HistoryPort {
  const listeners =
    new Set<HistoryListener>();

  const notify =
    () => {
      for (const listener of listeners) {
        listener();
      }
    };

  // A SPA route change does not fire beforeunload. Ask mounted views to
  // signal pending work without transferring private data to the shell.
  let acceptedUrl=browserWindow.location.href;
  let acceptedState:unknown=browserWindow.history.state;
  const allowLeave=(nextUrl:string):boolean=>{
    if(new URL(nextUrl,acceptedUrl).pathname===new URL(acceptedUrl).pathname)return true;
    const event=browserWindow.document.createEvent("Event");
    event.initEvent("noor:before-route-leave",false,true);
    if(browserWindow.dispatchEvent(event))return true;
    return browserWindow.confirm("توجد تغييرات لم يتأكد حفظها. قد تفقدها عند المغادرة. هل تريد المتابعة؟");
  };
  const remember=()=>{acceptedUrl=browserWindow.location.href;acceptedState=browserWindow.history.state;};
  const observePopState =
    () => {
      if(!allowLeave(browserWindow.location.href)){
        // popstate is not cancelable. Restore the mounted route before notifying
        // React. A canceled Back/Forward creates a new current history entry.
        browserWindow.history.pushState(acceptedState,"",acceptedUrl);
        return;
      }
      remember();notify();
    };

  const pathname =
    () =>
      browserWindow.location.pathname;

  const push =
    (
      nextPathname: string,
    ) => {
      if(!allowLeave(nextPathname))return;
      browserWindow.history.pushState(
        null,
        "",
        nextPathname,
      );

      remember();notify();
    };

  const replace =
    (
      nextPathname: string,
    ) => {
      if(!allowLeave(nextPathname))return;
      browserWindow.history.replaceState(
        null,
        "",
        nextPathname,
      );

      remember();notify();
    };

  const subscribe =
    (
      listener: HistoryListener,
    ) => {
      const subscription =
        () => {
          listener();
        };

      if (listeners.size === 0) {
        browserWindow.addEventListener(
          "popstate",
          observePopState,
        );
      }

      listeners.add(
        subscription,
      );

      let subscribed =
        true;

      return () => {
        if (!subscribed) {
          return;
        }

        subscribed =
          false;

        listeners.delete(
          subscription,
        );

        if (listeners.size === 0) {
          browserWindow.removeEventListener(
            "popstate",
            observePopState,
          );
        }
      };
    };

  return Object.freeze({
    pathname,
    push,
    replace,
    subscribe,
  });
}
