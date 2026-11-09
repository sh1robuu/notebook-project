import { Component, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { LocalWorkspace } from "../modules/workspace/local-workspace.ts";
import { BoardScreen } from "./BoardScreen.tsx";
import { product } from "../config/product.ts";
import type { Lesson } from "../modules/workspace/model.ts";
import { installActivityGuards } from "../modules/workspace/activity.ts";
import { offlineWorkspace } from "../modules/pwa/client.ts";
import { WorkspaceRecovery } from "./workspace/WorkspaceRecovery.tsx";
import { lessonAddress } from "./workspace/WorkspaceTools.tsx";
type Boot = { workspace?: LocalWorkspace; error?: string };
type BootRequest = { id?: string; create?: true; candidate?: Lesson };
export function App() {
  const [boot, setBoot] = useState<Boot>({});
  const [request, setRequest] = useState<BootRequest>(() => ({
    id: new URLSearchParams(location.search).get("lesson") ?? undefined,
  }));
  useEffect(() => offlineWorkspace.start(), []);
  useEffect(installActivityGuards, []);
  useEffect(() => {
    let closed = false,
      opened: LocalWorkspace | undefined;
    const opening = request.create
      ? LocalWorkspace.startNew(undefined, request.candidate)
      : LocalWorkspace.open(undefined, request.id);
    void opening
      .then((workspace) => {
        opened = workspace;
        if (closed) workspace.close();
        else {
          if (request.create || request.id)
            history.replaceState(null, "", lessonAddress(workspace.lesson.id));
          setBoot({ workspace });
        }
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
  }, [request]);
  function open(next: BootRequest) {
    setBoot({});
    setRequest(next);
  }
  const recovery = (error: string) => (
    <WorkspaceRecovery
      error={error}
      retry={() =>
        open({
          id: new URLSearchParams(location.search).get("lesson") ?? undefined,
        })
      }
      select={(id) => open({ id })}
      create={(candidate) => open({ create: true, candidate })}
    />
  );
  if (boot.workspace)
    return (
      <EditorBoundary
        key={boot.workspace.lesson.id}
        fallback={recovery(
          "Không mở được bảng. Hãy thử mở lại bản lưu hoặc chọn một bài khác.",
        )}
      >
        <BoardScreen workspace={boot.workspace} />
      </EditorBoundary>
    );
  return (
    <main className="boot-screen">
      <img src="/mark.svg" width="48" height="48" alt="" />
      <h1>{product.name}</h1>
      {boot.error ? (
        recovery(boot.error)
      ) : (
        <p role="status">Opening your teaching workspace…</p>
      )}
    </main>
  );
}
class EditorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="boot-screen">
        <h1>{product.name}</h1>
        {this.props.fallback}
      </main>
    ) : (
      this.props.children
    );
  }
}
