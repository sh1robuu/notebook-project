import { createRoot, hydrateRoot } from "react-dom/client";
import { SiteRouter } from "./site/SiteRouter.tsx";
import "./site/site.css";
const root = document.getElementById("root")!;
const path = location.pathname.replace(/\/$/, "") || "/";
if (root.dataset.prerenderPath === path) hydrateRoot(root, <SiteRouter />);
else createRoot(root).render(<SiteRouter />);
