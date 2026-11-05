import { renderToString } from "react-dom/server";
import { LandingPage } from "./LandingPage.tsx";
export function renderLanding(editorAvailable: boolean) {
  return renderToString(<LandingPage editorAvailable={editorAvailable} />);
}
