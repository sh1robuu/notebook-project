import type { Point } from "./geometry.ts";
export type TouchMode = "pan" | "write";
export type GestureIntent = "ink" | "pan" | "pinch" | "ignore";
type Contact = Point & { type: string };

/** Arbitration only. tldraw remains the event/geometry/gesture authority. */
export class InputPolicy {
  #contacts = new Map<number, Contact>();
  #suppressed = new Set<number>();
  #pen: number | null = null;
  #initialDistance = 0;
  mode: TouchMode;
  constructor(mode: TouchMode) {
    this.mode = mode;
  }
  get activeCount() {
    return this.#contacts.size;
  }
  get hasPen() {
    return this.#pen !== null;
  }
  get touchCount() {
    return [...this.#contacts.values()].filter((c) => c.type === "touch")
      .length;
  }
  owns(id: number) {
    return this.#contacts.has(id) && !this.#suppressed.has(id);
  }
  down(id: number, type: string, p: Point): GestureIntent {
    this.#contacts.set(id, { ...p, type });
    if (type === "pen") {
      if (this.#pen !== null && this.#pen !== id) {
        this.#suppressed.add(id);
        return "ignore";
      }
      this.#pen = id;
      for (const [key, c] of this.#contacts)
        if (c.type === "touch") this.#suppressed.add(key);
      return "ink";
    }
    if (type === "touch") {
      if (this.#pen !== null) {
        this.#suppressed.add(id);
        return "ignore";
      }
      if (this.touchCount === 2) this.#initialDistance = this.#distance();
      return this.touchCount >= 2 || this.mode === "pan" ? "pan" : "ink";
    }
    return "ink";
  }
  move(id: number, p: Point): GestureIntent {
    const c = this.#contacts.get(id);
    if (!c || this.#suppressed.has(id)) return "ignore";
    Object.assign(c, p);
    if (c.type !== "touch") return "ink";
    if (this.#pen !== null) return "ignore";
    if (this.touchCount >= 2)
      return this.#initialDistance > 0 &&
        Math.abs(this.#distance() / this.#initialDistance - 1) > 0.05
        ? "pinch"
        : "pan";
    return this.mode === "pan" ? "pan" : "ink";
  }
  up(id: number) {
    this.#contacts.delete(id);
    this.#suppressed.delete(id);
    if (this.#pen === id) this.#pen = null;
    if (this.touchCount < 2) this.#initialDistance = 0;
  }
  cancel() {
    this.#contacts.clear();
    this.#suppressed.clear();
    this.#pen = null;
    this.#initialDistance = 0;
  }
  #distance() {
    const [a, b] = [...this.#contacts.values()].filter(
      (c) => c.type === "touch",
    );
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
