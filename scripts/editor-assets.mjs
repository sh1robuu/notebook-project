import { copyFile, cp, mkdir } from "node:fs/promises";

const source = "node_modules/@tldraw/assets";
const target = "public/tldraw";
await mkdir(`${target}/icons/icon`, { recursive: true });
await cp(`${source}/fonts`, `${target}/fonts`, { recursive: true });
await cp(`${source}/embed-icons`, `${target}/embed-icons`, { recursive: true });
await copyFile(`${source}/icons/icon/0_merged.svg`, `${target}/icons/icon/0_merged.svg`);
