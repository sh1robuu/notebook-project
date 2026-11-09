import { useEffect, useRef, useState } from "react";
import type { BoardEngine } from "../../modules/board/engine.ts";
import {
  inspectGeoGebraFile,
  inspectHtmlFiles,
} from "../../modules/interactive/import-client.ts";
import type { InspectedHtmlBundle } from "../../modules/interactive/bundle.ts";
import type { GeoGebraInspection } from "../../modules/interactive/geogebra.ts";
import { dataImage } from "../../modules/media/image-format.ts";
import { insertInteractive } from "../../modules/interactive/board.ts";
import { makeInteractiveSource } from "../../modules/interactive/sources.ts";
import { HtmlSimulation } from "./HtmlSimulation.tsx";
import { beginOperation } from "../../modules/workspace/activity.ts";

type Intake =
  | { kind: "html"; result: InspectedHtmlBundle }
  | { kind: "geogebra"; bytes: Uint8Array; inspection: GeoGebraInspection };

export function InsertInteractive({
  engine,
  scope,
  onDone,
}: {
  engine: BoardEngine;
  scope: string;
  onDone: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [intake, setIntake] = useState<Intake | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  function select(picked: File[]) {
    active.current?.abort();
    setIntake(null);
    setPreview(false);
    setBusy(false);
    setError("");
    setFiles(picked);
    const entry = picked.find((file) => /\.(html?|zip|ggb)$/i.test(file.name));
    setTitle(
      (entry?.name.replace(/\.[^.]+$/, "") ?? "")
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, 160),
    );
  }
  async function analyze() {
    const finish = beginOperation("Kiểm tra mô phỏng");
    const job = new AbortController();
    active.current?.abort();
    active.current = job;
    setBusy(true);
    setError("");
    setPreview(false);
    try {
      const next: Intake =
        files.length === 1 && /\.ggb$/i.test(files[0].name)
          ? {
              kind: "geogebra",
              ...(await inspectGeoGebraFile(files[0], job.signal)),
            }
          : { kind: "html", result: await inspectHtmlFiles(files, job.signal) };
      if (!job.signal.aborted) {
        setIntake(next);
        setPreview(next.kind === "html");
      }
    } catch (failure) {
      if (!job.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Không đọc được gói mô phỏng.",
        );
    } finally {
      finish();
      if (active.current === job && !job.signal.aborted) setBusy(false);
    }
  }
  async function insert() {
    if (!intake || busy || !title.trim()) return;
    const finish = beginOperation("Chèn mô phỏng");
    const job = new AbortController();
    active.current = job;
    setBusy(true);
    setError("");
    try {
      const source = await makeInteractiveSource(
        intake.kind,
        intake.kind === "html" ? intake.result.bytes : intake.bytes,
      );
      const previewUrl =
        intake.kind === "html" ? intake.result.view.previewDataUrl : undefined;
      const poster = previewUrl
        ? await makeInteractiveSource("preview", dataImage(previewUrl).bytes)
        : undefined;
      if (job.signal.aborted) return;
      const common = {
        version: 1 as const,
        title: title.trim(),
        sourceId: source.id,
        ...(poster ? { snapshotId: poster.id } : {}),
      };
      const material =
        intake.kind === "html"
          ? {
              ...common,
              kind: "html" as const,
              entry: intake.result.summary.entry,
            }
          : { ...common, kind: "geogebra" as const };
      if (
        insertInteractive(
          engine,
          scope,
          material,
          poster ? [source, poster] : [source],
        )
      )
        onDone();
      else
        setError(
          engine.editing.state.message ||
            "Trang đã đổi. Hãy mở lại cửa sổ chèn mô phỏng.",
        );
    } catch (failure) {
      if (!job.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Không chèn được mô phỏng.",
        );
    } finally {
      finish();
      if (!job.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="interactive-panel">
      <p>
        Chọn một tệp HTML, ZIP, GGB hoặc thư mục tài nguyên. Tệp gốc được giữ
        cùng bài giảng.
      </p>
      <div className="interactive-file-inputs">
        <label>
          Tệp mô phỏng
          <input
            aria-label="Tệp mô phỏng"
            type="file"
            multiple
            disabled={busy}
            onChange={(event) =>
              select(Array.from(event.currentTarget.files ?? []))
            }
          />
        </label>
        <label>
          Thư mục mô phỏng
          <input
            aria-label="Thư mục mô phỏng"
            type="file"
            multiple
            disabled={busy}
            ref={(input) => {
              input?.setAttribute("webkitdirectory", "");
            }}
            onChange={(event) =>
              select(Array.from(event.currentTarget.files ?? []))
            }
          />
        </label>
      </div>
      <p>{files.length ? `Đã chọn ${files.length} tệp` : "Chưa chọn tệp."}</p>
      <button
        type="button"
        disabled={!files.length || busy}
        onClick={() => void analyze()}
      >
        Xem trước
      </button>
      {busy ? <p role="status">Đang xử lý mô phỏng…</p> : null}
      {intake?.kind === "html" ? (
        <>
          <dl className="interactive-summary">
            <dt>Tệp mở đầu</dt>
            <dd>{intake.result.summary.entry}</dd>
            <dt>Gói tài nguyên</dt>
            <dd>
              {intake.result.summary.files.length} tệp ·{" "}
              {intake.result.summary.expandedBytes.toLocaleString("vi-VN")} byte
            </dd>
            <dt>Điều khiển</dt>
            <dd>
              {intake.result.summary.hasSlider
                ? "Thanh trượt có thể lưu giá trị"
                : "Nội dung tĩnh"}
            </dd>
            <dt>Ảnh xuất</dt>
            <dd>
              {intake.result.summary.hasPreview
                ? "Có ảnh minh họa"
                : "Dùng thẻ tên nếu chưa thêm ảnh"}
            </dd>
          </dl>
          <p>
            Tài nguyên từ xa và JavaScript trong tệp sẽ được bỏ qua khi hiển
            thị.
          </p>
          <details>
            <summary>Danh sách tài nguyên</summary>
            <ul className="interactive-inventory">
              {intake.result.summary.files.map((file) => (
                <li key={file.path}>
                  {file.path} · {file.byteLength.toLocaleString("vi-VN")} byte
                </li>
              ))}
            </ul>
          </details>
          {intake.result.summary.diagnostics.length ? (
            <ul
              className="interactive-inventory"
              aria-label="Thông báo kiểm tra gói"
            >
              {intake.result.summary.diagnostics.map(({ message }, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          ) : null}
          {preview ? (
            <HtmlSimulation
              key={intake.result.summary.entry}
              view={intake.result.view}
              title="Xem trước mô phỏng"
            />
          ) : null}
        </>
      ) : intake ? (
        <>
          <dl className="interactive-summary">
            <dt>Định dạng</dt>
            <dd>GeoGebra · {intake.inspection.app}</dd>
            <dt>Tệp gốc</dt>
            <dd>{intake.bytes.length.toLocaleString("vi-VN")} byte</dd>
            <dt>Thanh trượt tìm thấy</dt>
            <dd>{intake.inspection.sliders.length}</dd>
          </dl>
          <p>
            Giữ tệp GGB gốc để mở bằng GeoGebra. Bản nhúng hiện chưa khả dụng.
          </p>
          {intake.inspection.diagnostics.length ? (
            <ul>
              {intake.inspection.diagnostics.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      ) : null}
      {intake ? (
        <div className="interactive-footer">
          <label>
            Tên mô phỏng
            <input
              aria-label="Tên mô phỏng"
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </label>
          <button
            className="primary"
            type="button"
            disabled={busy || !title.trim()}
            onClick={() => void insert()}
          >
            Chèn vào bảng
          </button>
        </div>
      ) : null}
    </div>
  );
}
