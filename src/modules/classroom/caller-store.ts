import Dexie from "dexie";
import type { Table } from "dexie";
import { importRoomRoster, validateCallerClass } from "./roster.ts";
import type { CallerClass } from "./roster.ts";

type Settings = { key: "activeClass"; classId: string };
const MAX_CLASSES = 40;

class CallerDatabase extends Dexie {
  classes!: Table<CallerClass, string>;
  settings!: Table<Settings, Settings["key"]>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ classes: "id", settings: "key" });
    this.on("versionchange", () => this.close());
  }
}

export class CallerStore {
  #db: CallerDatabase;

  constructor(name = "lessonboard-caller") {
    this.#db = new CallerDatabase(name);
  }

  async read() {
    const { classes, settings } = this.#db;
    return this.#db.transaction("r", classes, settings, async () => {
      const lists = (await classes.toArray())
        .map(validateCallerClass)
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
      const selected = (await settings.get("activeClass"))?.classId;
      return {
        lists,
        active: lists.find((list) => list.id === selected)?.id ?? lists[0]?.id,
      };
    });
  }

  async get(id: string) {
    const value = await this.#db.classes.get(id);
    if (!value) throw new Error("Danh sách này đã được xóa.");
    return validateCallerClass(value);
  }

  async select(id: string) {
    const { classes, settings } = this.#db;
    await this.#db.transaction("rw", classes, settings, async () => {
      await this.get(id);
      await settings.put({ key: "activeClass", classId: id });
    });
  }

  async add(list: CallerClass) {
    const checked = validateCallerClass(list);
    const { classes, settings } = this.#db;
    return this.#db.transaction("rw", classes, settings, async () => {
      if ((await classes.count()) >= MAX_CLASSES)
        throw new Error("Thiết bị có tối đa 40 danh sách lớp.");
      await classes.add(checked);
      await settings.put({ key: "activeClass", classId: checked.id });
      return checked;
    });
  }

  async change(id: string, update: (list: CallerClass) => CallerClass) {
    return this.#db.transaction("rw", this.#db.classes, async () => {
      const checked = validateCallerClass(update(await this.get(id)));
      if (checked.id !== id) throw new Error("Không thể đổi mã danh sách.");
      await this.#db.classes.put(checked);
      return checked;
    });
  }

  async remove(id: string) {
    const { classes, settings } = this.#db;
    await this.#db.transaction("rw", classes, settings, async () => {
      await classes.delete(id);
      if ((await settings.get("activeClass"))?.classId === id)
        await settings.delete("activeClass");
    });
  }

  async importHosted(room: Parameters<typeof importRoomRoster>[0]) {
    const { classes, settings } = this.#db;
    return this.#db.transaction("rw", classes, settings, async () => {
      const lists = (await classes.toArray()).map(validateCallerClass);
      const current = lists.find((list) => list.source?.roomId === room.id);
      if (!current && lists.length >= MAX_CLASSES)
        throw new Error("Thiết bị có tối đa 40 danh sách lớp.");
      const next = importRoomRoster(room, undefined, undefined, current);
      await classes.put(next);
      await settings.put({ key: "activeClass", classId: next.id });
      return next;
    });
  }

  close() {
    this.#db.close();
  }
}
