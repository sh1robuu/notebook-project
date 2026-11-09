import { useEffect, useRef, useState } from "react";
import type { BoardEngine } from "../../modules/board/engine.ts";
import { beginOperation } from "../../modules/workspace/activity.ts";
import { changeInteractive } from "../../modules/interactive/board.ts";
import type { InteractiveShape } from "../../modules/interactive/InteractiveShape.tsx";
import type {
  InteractiveMaterial,
  SliderState,
} from "../../modules/interactive/model.ts";
import { prepareStoredHtml } from "../../modules/interactive/import-client.ts";
import type { OpenedHtmlBundle } from "../../modules/interactive/bundle.ts";
import { validHtmlSliderValue } from "../../modules/interactive/bundle.ts";
import { makeInteractiveSource } from "../../modules/interactive/sources.ts";
import { readImageHeader } from "../../modules/media/image-format.ts";
import { HtmlSimulation } from "./HtmlSimulation.tsx";
import { PredictionPanel } from "./PredictionPanel.tsx";

type Mode = "details" | "interact" | "prediction";

export function MaterialPanel({
  engine,
  scope,
  shape,
  readOnly,
}: {
  engine: BoardEngine;
  scope: string;
  shape: InteractiveShape;
  readOnly: boolean;
}) {
  const material = shape.props.material;
  const source = engine.session.interactiveSources[material.sourceId];
  const [mode, setMode] = useState<Mode>("details");
  const [fromPrediction, setFromPrediction] = useState(false);
  const [title, setTitle] = useState(material.title);
  const [error, setError] = useState("");
  const [posterBusy, setPosterBusy] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState("");
  const [html, setHtml] = useState<OpenedHtmlBundle | null>(null);
  const [retry, setRetry] = useState(0);
  const posterJob = useRef<AbortController | null>(null);
  const entry = material.kind === "html" ? material.entry : undefined;

  useEffect(() => () => posterJob.current?.abort(), []);
  useEffect(() => {
    if (mode !== "interact" || !entry || !source) return;
    const job = new AbortController();
    setHtml(null);
    setError("");
    void prepareStoredHtml(source.bytes, entry, job.signal).then(
      (result) => {
        if (!job.signal.aborted) setHtml(result);
      },
      (failure) => {
        if (!job.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Không mở được mô phỏng.",
          );
      },
    );
    return () => job.abort();
  }, [mode, source, entry, retry]);

  function update(next: InteractiveMaterial) {
    try {
      return changeInteractive(engine, scope, shape.id, material, next);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Không lưu được thay đổi.",
      );
      return false;
    }
  }
  function navigate(next: Mode, observation = false) {
    setError("");
    setHtml(null);
    setMode(next);
    setFromPrediction(observation);
  }
  function downloadSource() {
    if (!source) return;
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(source.bytes).buffer], {
        type: "application/octet-stream",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      (material.title.replace(/[<>:"/\\|?*]/g, "_") || "Mo-phong") +
      (material.kind === "html" ? ".zip" : ".ggb");
    try {
      link.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }
  async function attachPoster(file: File) {
    const finish = beginOperation("Thêm ảnh minh họa");
    const job = new AbortController();
    posterJob.current?.abort();
    posterJob.current = job;
    setPosterBusy(true);
    setError("");
    setSnapshotStatus("");
    try {
      if (!file.size || file.size > 512_000)
        throw new Error("Chọn ảnh PNG hoặc JPEG dưới 512 KB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const header = readImageHeader(bytes);
      const poster = await makeInteractiveSource("preview", bytes);
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: header.mime }),
      );
      try {
        if (bitmap.width * bitmap.height !== header.width * header.height)
          throw new Error("Kích thước ảnh không khớp với tệp.");
      } finally {
        bitmap.close();
      }
      if (job.signal.aborted) return;
      if (
        !changeInteractive(
          engine,
          scope,
          shape.id,
          material,
          { ...material, snapshotId: poster.id },
          [poster],
        )
      )
        throw new Error("Mô phỏng đã thay đổi. Hãy chọn lại ảnh.");
      setSnapshotStatus("Đã thêm ảnh minh họa.");
    } catch (failure) {
      if (!job.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Không đọc được ảnh minh họa.",
        );
    } finally {
      finish();
      if (!job.signal.aborted) setPosterBusy(false);
    }
  }
  function saveSlider(state: SliderState) {
    return (
      material.kind === "html" &&
      !!html?.view.slider &&
      validHtmlSliderValue(html.view.slider, state.value) &&
      update({ ...material, state })
    );
  }
  if (!source) return <p role="alert">Thiếu tệp nguồn của mô phỏng này.</p>;
  const canObserve = material.kind === "html";
  return (
    <div className="interactive-panel">
      <div className="interactive-mode">
        <span className="interactive-tag">
          {mode === "interact"
            ? "Tương tác"
            : mode === "prediction"
              ? "Hoạt động"
              : "Chỉnh sửa"}
        </span>
        <strong>{material.title}</strong>
      </div>
      <nav className="interactive-actions" aria-label="Chế độ mô phỏng">
        {mode !== "details" ? (
          <button type="button" onClick={() => navigate("details")}>
            Thông tin tệp
          </button>
        ) : null}
        {mode === "details" && canObserve ? (
          <button type="button" onClick={() => navigate("interact")}>
            Chạy mô phỏng
          </button>
        ) : null}
        {mode === "interact" && fromPrediction ? (
          <button type="button" onClick={() => navigate("prediction")}>
            Về hoạt động
          </button>
        ) : mode !== "prediction" ? (
          <button type="button" onClick={() => navigate("prediction")}>
            Dự đoán – Quan sát – Giải thích
          </button>
        ) : null}
      </nav>
      {mode === "details" ? (
        <>
          <dl className="interactive-summary">
            <dt>Nguồn</dt>
            <dd>
              {material.kind === "html" ? material.entry : "Tệp GeoGebra GGB"} ·{" "}
              {source.size.toLocaleString("vi-VN")} byte
            </dd>
            <dt>Ảnh xuất</dt>
            <dd>
              {material.snapshotId ? "Có ảnh minh họa" : "Chưa có ảnh minh họa"}
            </dd>
            <dt>Trạng thái</dt>
            <dd>
              {material.state
                ? "Đã lưu thông số hỗ trợ"
                : material.kind === "html"
                  ? "Mở từ trạng thái ban đầu"
                  : "Giữ tệp gốc"}
            </dd>
          </dl>
          {material.kind === "geogebra" ? (
            <p>Bản nhúng chưa khả dụng. Tải tệp gốc để mở bằng GeoGebra.</p>
          ) : (
            <p>
              Mô phỏng dùng tài nguyên trong gói. Thanh trượt khai báo có thể
              lưu giá trị vào bài giảng.
            </p>
          )}
          <button type="button" onClick={downloadSource}>
            {material.kind === "geogebra" ? "Tải tệp GGB gốc" : "Tải gói nguồn"}
          </button>
          {!readOnly ? (
            <>
              <form
                className="interactive-footer"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    title.trim() &&
                    !update({ ...material, title: title.trim() })
                  )
                    setError("Mô phỏng đã thay đổi. Hãy mở lại để sửa.");
                }}
              >
                <label>
                  Tên mô phỏng
                  <input
                    aria-label="Tên mô phỏng"
                    maxLength={160}
                    value={title}
                    onChange={(event) => setTitle(event.currentTarget.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={!title.trim() || title.trim() === material.title}
                >
                  Lưu tên
                </button>
              </form>
              <label className="interactive-poster">
                Thêm ảnh minh họa cho PNG/PDF
                <input
                  aria-label="Ảnh minh họa mô phỏng"
                  type="file"
                  accept="image/png,image/jpeg"
                  disabled={posterBusy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void attachPoster(file);
                  }}
                />
              </label>
            </>
          ) : null}
          {snapshotStatus ? <p role="status">{snapshotStatus}</p> : null}
        </>
      ) : mode === "prediction" ? (
        <PredictionPanel
          value={material.prediction ?? null}
          materialName={material.title}
          readOnly={readOnly}
          canObserve={canObserve}
          onChange={(next, previous) =>
            previous === (material.prediction ?? null) &&
            update({ ...material, prediction: next })
          }
          onObserve={() => navigate("interact", true)}
        />
      ) : material.kind === "html" ? (
        html ? (
          <>
            <HtmlSimulation
              view={html.view}
              title={material.title}
              savedState={
                html.view.slider &&
                material.state &&
                validHtmlSliderValue(html.view.slider, material.state.value)
                  ? material.state
                  : undefined
              }
              onSave={readOnly ? undefined : saveSlider}
            />
            {html.view.slider ? null : (
              <p>Gói này mở lại từ nội dung ban đầu.</p>
            )}
            {html.summary.diagnostics.length ? (
              <details>
                <summary>Tài nguyên bị bỏ qua</summary>
                <ul className="interactive-inventory">
                  {html.summary.diagnostics.map(({ message }, index) => (
                    <li key={index}>{message}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : error ? (
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Thử mở lại
          </button>
        ) : (
          <p role="status">Đang mở nội dung cục bộ…</p>
        )
      ) : null}
      {error ? (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
