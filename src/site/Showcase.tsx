import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ProductImage } from "./ProductImage.tsx";

const views = [
  {
    id: "viet-tay",
    label: "Viết tay",
    image: "overview",
    title: "Từ hình vẽ đến lời giải",
    text: "Viết, vẽ hình, chỉnh văn bản và công thức trên cùng một trang. Nét viết và các đối tượng vẫn có thể chỉnh sửa.",
    alt: "Bảng giảng thực tế với tam giác, công thức diện tích và nét chú thích màu xanh.",
  },
  {
    id: "nhap",
    label: "Nháp độc lập",
    image: "scratchpad",
    title: "Thử một hướng giải khác",
    text: "Mở khung nháp cạnh bài giảng. Mỗi mặt bảng có góc nhìn và lịch sử hoàn tác riêng.",
    alt: "Bảng chính và khung nháp độc lập mở cạnh nhau trong ứng dụng.",
  },
  {
    id: "pdf",
    label: "Dạy với PDF",
    image: "pdf",
    title: "Ghi chú ngay trên tài liệu",
    text: "Nhập PDF làm nền, viết và đánh dấu bằng các công cụ quen thuộc. Nội dung gốc được giữ trong tệp bài giảng.",
    alt: "PDF được nhập vào ứng dụng với nét đánh dấu màu đỏ trên trang.",
  },
  {
    id: "word",
    label: "Word và công thức",
    image: "word",
    title: "Soạn trước, giảng từng phần",
    text: "Chỉnh nguồn DOCX và công thức OMML được hỗ trợ, rồi biên soạn thành các khối để lần lượt trình bày. Bố cục Word và MathType cũ còn giới hạn.",
    alt: "Bài Word đã biên soạn trên bảng với phân số, căn thức và công thức có thể chỉnh nguồn.",
  },
  {
    id: "slides",
    label: "PowerPoint · thử nghiệm",
    image: "pptx",
    title: "Giải thích theo từng build",
    text: "Nhập PPTX và trình bày theo thứ tự nguồn trong tập được hỗ trợ. Phông chữ, đối tượng và hiệu ứng còn giới hạn; các cảnh báo xuất hiện khi nhập.",
    alt: "Slide PowerPoint trong Lessonboard với các nút tiến lùi build và phần chú thích.",
  },
] as const;

export function Showcase() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const sync = () => {
      const chosen = new URLSearchParams(location.search).get("view");
      const index = views.findIndex((view) => view.id === chosen);
      setSelected(index < 0 ? 0 : index);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function select(index: number) {
    setSelected(index);
    const url = new URL(location.href);
    url.searchParams.set("view", views[index].id);
    history.replaceState(null, "", url);
  }
  function move(event: KeyboardEvent, index: number) {
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? views.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % views.length
            : event.key === "ArrowLeft"
              ? (index + views.length - 1) % views.length
              : -1;
    if (next < 0) return;
    event.preventDefault();
    select(next);
    tabs.current[next]?.focus();
  }
  const view = views[selected];
  return (
    <div className="showcase">
      <div
        className="showcase-tabs"
        role="tablist"
        aria-label="Khám phá bảng giảng"
      >
        {views.map((view, index) => (
          <button
            key={view.id}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            role="tab"
            id={`tab-${view.id}`}
            aria-controls={`view-${view.id}`}
            aria-selected={index === selected}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => move(event, index)}
          >
            {view.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`view-${view.id}`}
        aria-labelledby={`tab-${view.id}`}
        tabIndex={0}
        className="showcase-panel"
      >
        <figure data-ui>
          <ProductImage key={view.image} name={view.image} alt={view.alt} />
        </figure>
        <div className="showcase-caption" aria-live="polite">
          <h3>{view.title}</h3>
          <p>{view.text}</p>
        </div>
      </div>
    </div>
  );
}
