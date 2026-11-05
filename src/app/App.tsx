import { Component, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { LocalWorkspace } from "../modules/workspace/local-workspace.ts";
import { BoardScreen } from "./BoardScreen.tsx";
import { product } from "../config/product.ts";
type Boot = { workspace?: LocalWorkspace; error?: string };
export function App() {
  const [boot, setBoot] = useState<Boot>({}),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let closed = false,
      opened: LocalWorkspace | undefined;
    LocalWorkspace.open()
      .then((workspace) => {
        opened = workspace;
        if (closed) workspace.close();
        else setBoot({ workspace });
      })
      .catch((error) => {
        if (!closed)
          setBoot({
            error:
              error instanceof Error
                ? error.message
                : "Local storage could not be opened.",
          });
      });
    return () => {
      closed = true;
      opened?.close();
    };
  }, [attempt]);
  if (boot.workspace)
    return (
      <EditorBoundary>
        <BoardScreen workspace={boot.workspace} />
      </EditorBoundary>
    );
  return (
    <main className="boot-screen">
      <img src="/mark.svg" width="48" height="48" alt="" />
      <h1>{product.name}</h1>
      {boot.error ? (
        <>
          <h2>Unable to open local lessons</h2>
          <p role="alert">{boot.error}</p>
          <p>Existing saved data has been kept.</p>
          <button
            onClick={() => {
              setBoot({});
              setAttempt((n) => n + 1);
            }}
          >
            Retry opening workspace
          </button>
        </>
      ) : (
        <p role="status">Opening your teaching workspace…</p>
      )}
    </main>
  );
}
class EditorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="boot-screen">
        <h1>The editor could not open</h1>
        <p>
          Your saved local data has been kept. Reload to reopen the last saved
          lesson.
        </p>
        <button onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
