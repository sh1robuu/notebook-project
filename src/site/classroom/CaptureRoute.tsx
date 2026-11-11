import { useEffect, useRef, useState } from "react";
import { ClassroomError } from "../../modules/classroom/api.ts";
import {
  classroomImages,
  participationApi,
  uploadClassroomImage,
} from "../../modules/classroom/participation-api.ts";
import {
  clearCaptureDraft,
  loadCaptureDraft,
  saveCaptureDraft,
} from "../../modules/classroom/participation-outbox.ts";
import type { CaptureDraft } from "../../modules/classroom/participation-outbox.ts";
import { ClassroomFrame } from "./ClassroomFrame.tsx";
import { participationError } from "./ParticipationState.ts";
import "./classroom.css";
import "./participation.css";

type Session = Awaited<ReturnType<typeof participationApi.captureSession>>;

function readCode() {
  const fragment = location.hash.slice(1);
  const code = new URLSearchParams(fragment).get("code");
  if (code === null) return undefined;
  return /^[a-zA-Z0-9_-]{43}$/.test(code) ? code : null;
}

function unavailable(error: unknown) {
  return (
    error instanceof ClassroomError && [401, 403, 404].includes(error.status)
  );
}

export default function CaptureRoute() {
  const code = useRef(readCode());
  const request = useRef<{
    attempt: number;
    result: Promise<Session>;
    controller: AbortController;
  }>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  useEffect(() => {
    function scan() {
      const next = readCode();
      if (next === undefined) return;
      request.current?.controller.abort();
      code.current = next;
      setSession(undefined);
      setLoading(true);
      setError("");
      setRetryable(false);
      setAttempt((value) => value + 1);
    }
    window.addEventListener("hashchange", scan);
    return () => window.removeEventListener("hashchange", scan);
  }, []);
  useEffect(() => {
    if (new URLSearchParams(location.hash.slice(1)).has("code")) {
      const url = new URL(location.href);
      url.hash = "";
      history.replaceState(history.state, "", url);
    }
    if (request.current?.attempt !== attempt) {
      const controller = new AbortController();
      const result =
        code.current === null
          ? Promise.reject<Session>(
              new ClassroomError(404, "capture_unavailable"),
            )
          : code.current
            ? participationApi.redeem(code.current, controller.signal)
            : participationApi.captureSession(controller.signal);
      request.current = {
        attempt,
        result,
        controller,
      };
    }
    let current = true;
    void request.current.result
      .then(
        (result) => {
          if (!current) return;
          code.current = undefined;
          setSession(result);
          setError("");
        },
        (failure) => {
          if (!current) return;
          const invalid = unavailable(failure);
          setError(
            invalid
              ? "Mã chụp ảnh đã hết hạn hoặc không còn dùng được. Quét mã mới trên bảng giảng."
              : participationError(failure),
          );
          setRetryable(!invalid);
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [attempt]);

  return (
    <ClassroomFrame student>
      <div className="classroom-join">
        <section className="classroom-panel classroom-join-panel participation-phone">
          <h1>Gửi ảnh lên bảng</h1>
          {loading && <p role="status">Đang kiểm tra mã chụp ảnh…</p>}
          {error && <p role="alert">{error}</p>}
          {retryable && !loading && (
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError("");
                setAttempt((value) => value + 1);
              }}
            >
              Thử lại
            </button>
          )}
          {session && (
            <CaptureForm
              key={session.session.grantId}
              initial={session}
              expired={() => {
                setSession(undefined);
                setRetryable(false);
                setError(
                  "Phiên chụp ảnh đã hết hạn hoặc đã thu hồi. Quét mã mới trên bảng giảng.",
                );
              }}
            />
          )}
        </section>
      </div>
    </ClassroomFrame>
  );
}

function CaptureForm({
  initial,
  expired,
}: {
  initial: Session;
  expired: () => void;
}) {
  const scope = initial.session.grantId;
  const [draft, setDraft] = useState<CaptureDraft>();
  const [images, setImages] = useState<boolean>();
  const [preview, setPreview] = useState("");
  const [progress, setProgress] = useState<number>();
  const [accepted, setAccepted] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const action = useRef<AbortController | null>(null);
  const session = useRef(initial);
  const end = useRef(expired);
  end.current = expired;

  useEffect(() => {
    const controller = new AbortController();
    void participationApi.capabilities(controller.signal).then(
      (value) => setImages(value.images),
      () => {
        if (!controller.signal.aborted) setImages(false);
      },
    );
    void loadCaptureDraft(scope)
      .then(
        (value) => {
          if (!controller.signal.aborted) setDraft(value);
        },
        () => {
          if (!controller.signal.aborted)
            setError("Thiết bị chưa mở được bản nháp ảnh.");
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setReady(true);
      });
    let probing = false;
    function check() {
      if (document.visibilityState !== "visible" || probing) return;
      probing = true;
      void participationApi
        .captureSession(controller.signal)
        .then(
          (result) => {
            if (!controller.signal.aborted && result.session.grantId === scope)
              session.current = result;
            else if (!controller.signal.aborted) end.current();
          },
          (failure) => {
            if (!controller.signal.aborted && unavailable(failure)) {
              void clearCaptureDraft(scope).catch(() => {});
              end.current();
            }
          },
        )
        .finally(() => {
          probing = false;
        });
    }
    const timer = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      controller.abort();
      action.current?.abort();
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, [scope]);

  useEffect(() => {
    setPreview("");
    if (!draft) return;
    const url = URL.createObjectURL(draft.image.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft?.image.file]);

  function run(work: (signal: AbortSignal) => Promise<void>) {
    if (action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    setError("");
    void work(controller.signal)
      .catch((failure) => {
        if (controller.signal.aborted) return;
        if (unavailable(failure)) {
          void clearCaptureDraft(scope).catch(() => {});
          end.current();
        } else setError(participationError(failure));
      })
      .finally(() => {
        if (action.current === controller) action.current = null;
        if (!controller.signal.aborted) {
          setBusy(false);
          setProgress(undefined);
        }
      });
  }

  async function choose(file: File, signal: AbortSignal) {
    const [image] = classroomImages([file]);
    const next = { image, key: crypto.randomUUID() };
    await saveCaptureDraft(scope, next);
    signal.throwIfAborted();
    setAccepted("");
    setDraft(next);
  }

  function selected(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (file) run((signal) => choose(file, signal));
  }

  function send() {
    if (!draft) return;
    run(async (signal) => {
      const csrfToken = session.current.csrfToken;
      const mediaId =
        draft.mediaId ??
        (await uploadClassroomImage(
          "capture",
          draft.image,
          csrfToken,
          (bytes) => setProgress(bytes / draft.image.file.size),
          signal,
        ));
      const pending = { ...draft, mediaId };
      await saveCaptureDraft(scope, pending);
      signal.throwIfAborted();
      setDraft(pending);
      try {
        const { receipt } = await participationApi.acceptCapture(
          mediaId,
          csrfToken,
          draft.key,
          signal,
        );
        signal.throwIfAborted();
        await clearCaptureDraft(scope).catch(() => {});
        setDraft(undefined);
        setAccepted(
          "Đã gửi ảnh lúc " +
            new Date(receipt.acceptedAt).toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
            }) +
            ".",
        );
      } catch (failure) {
        if (
          failure instanceof ClassroomError &&
          failure.code === "media_expired"
        ) {
          await choose(draft.image.file, signal);
        }
        throw failure;
      }
    });
  }

  const disabled = busy || !ready || images !== true || !!draft?.mediaId;
  return (
    <>
      {images === false && (
        <p role="status">Kho ảnh chưa sẵn sàng. Hãy thử lại sau.</p>
      )}
      <div className="classroom-actions">
        <input
          ref={camera}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          hidden
          aria-label="Chụp ảnh"
          onChange={(event) => selected(event.currentTarget)}
        />
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          aria-label="Chọn ảnh"
          onChange={(event) => selected(event.currentTarget)}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => camera.current?.click()}
        >
          Chụp ảnh
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => picker.current?.click()}
        >
          Chọn ảnh
        </button>
      </div>
      {!preview && !accepted && (
        <p className="classroom-muted">
          Chụp ảnh bằng camera sau hoặc chọn ảnh JPEG, PNG hay WebP tối đa 10
          MB.
        </p>
      )}
      {preview && draft && (
        <>
          <img
            className="participation-capture-preview"
            src={preview}
            alt="Ảnh chuẩn bị gửi"
          />
          <div className="classroom-actions">
            <button
              type="button"
              className="classroom-primary"
              disabled={busy || images !== true}
              onClick={send}
            >
              {draft.mediaId ? "Kiểm tra lần gửi" : "Gửi ảnh"}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                run(async (signal) => {
                  await choose(await rotate(draft.image.file), signal);
                })
              }
            >
              Xoay ảnh
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                run(async (signal) => {
                  await clearCaptureDraft(scope);
                  signal.throwIfAborted();
                  setDraft(undefined);
                })
              }
            >
              Bỏ ảnh
            </button>
          </div>
        </>
      )}
      {progress !== undefined && (
        <p className="participation-progress">
          <span>
            {progress >= 1 ? "Đang xác nhận ảnh…" : "Đang tải ảnh lên…"}
          </span>
          <progress value={progress} max={1} aria-label="Tiến độ tải ảnh" />
        </p>
      )}
      {accepted && (
        <p role="status">{accepted} Có thể chèn ảnh trên bảng giảng.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

async function rotate(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.height * scale);
    canvas.height = Math.round(bitmap.width * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Thiết bị chưa xoay được ảnh này.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(bitmap, 0, 0, canvas.height, canvas.width);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("Không xoay được ảnh.")),
        "image/jpeg",
        0.92,
      ),
    );
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } finally {
    bitmap.close();
  }
}
