import { useEffect, useState } from "react";
type Renderer = typeof import("../math/render.ts").renderEquation;
let renderer: Renderer | undefined;
let pending: Promise<Renderer> | undefined;
/** Keep optional mathematics out of the board's required loading graph. */
export function loadWordMath(): Promise<Renderer> {
  return (pending ??= import("../math/render.ts").then((module) => {
    renderer = module.renderEquation;
    return renderer;
  }));
}
export function wordMath(source: string) {
  if (!renderer)
    throw new Error(
      "Equation renderer is unavailable. Source is retained; reload when application resources are available.",
    );
  return renderer(source);
}
export function useWordMath(source: string) {
  const [loaded, setLoaded] = useState(!!renderer),
    [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    void loadWordMath().then(
      () => {
        if (live) setLoaded(true);
      },
      () => {
        if (live)
          setError("Equation renderer could not load. Source is retained.");
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return loaded
    ? { ...wordMath(source), loading: false }
    : { source, error, loading: !error };
}
