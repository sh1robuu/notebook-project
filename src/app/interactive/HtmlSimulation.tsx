import { useId, useState } from "react";
import type { HtmlBundleView } from "../../modules/interactive/bundle.ts";
import type { SliderState } from "../../modules/interactive/model.ts";

export function HtmlSimulation({
  view,
  title,
  savedState,
  onSave,
}: {
  view: HtmlBundleView;
  title: string;
  savedState?: SliderState;
  onSave?: (state: SliderState) => boolean;
}) {
  const slider = view.slider;
  const [value, setValue] = useState(savedState?.value ?? slider?.initial ?? 0);
  const [status, setStatus] = useState("");
  const inputId = useId();
  const output = slider
    ? new Intl.NumberFormat("vi-VN", { maximumSignificantDigits: 12 }).format(
        value * slider.multiplier + slider.offset,
      )
    : "";
  return (
    <div className="interactive-html">
      <iframe
        sandbox=""
        referrerPolicy="no-referrer"
        title={title}
        srcDoc={view.srcDoc}
        className="interactive-static-frame"
      />
      {slider ? (
        <section
          className="interactive-slider"
          aria-label="Điều khiển mô phỏng"
        >
          <label htmlFor={inputId}>
            {slider.label} <strong>{value}</strong>
          </label>
          <input
            id={inputId}
            aria-label={slider.label}
            type="range"
            value={value}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            onChange={(event) => {
              setValue(event.currentTarget.valueAsNumber);
              setStatus("");
            }}
          />
          <p aria-live="polite">
            <strong>{slider.outputLabel}</strong>{" "}
            <output htmlFor={inputId}>
              {output}
              {slider.unit ? " " + slider.unit : ""}
            </output>
          </p>
          <progress
            aria-label={slider.label}
            max={slider.max - slider.min}
            value={value - slider.min}
          />
          <div className="interactive-actions">
            <button
              type="button"
              onClick={() => {
                setValue(slider.initial);
                setStatus("");
              }}
            >
              Đặt lại mô phỏng
            </button>
            {onSave ? (
              <button
                type="button"
                onClick={() => {
                  setStatus(
                    onSave({ version: 1, value })
                      ? "Đã ghi trạng thái vào bài giảng."
                      : "Mô phỏng đã thay đổi. Hãy mở lại để lưu.",
                  );
                }}
              >
                Lưu trạng thái
              </button>
            ) : null}
          </div>
          {status ? <p role="status">{status}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
