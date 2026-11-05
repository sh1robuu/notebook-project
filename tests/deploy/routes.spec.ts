import { test, expect } from "@playwright/test";

test("landing introduces the product without loading editor bundles or opening local lessons", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Giảng theo mạch riêng", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Mở bảng giảng", exact: true }).first(),
  ).toHaveAttribute("href", "/app");
  expect(
    requests.some((url) =>
      /BoardScreen|tldraw|pdfjs-dist|docx-preview/.test(url),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).map((d) => d.name),
    ),
  ).toEqual([]);
});

test("editor route survives refresh, keeps authored local work and returns by browser history", async ({
  page,
}) => {
  await page.goto("/app");
  await expect(
    page.getByRole("button", { name: "Pen", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Lesson title", { exact: true })
    .fill("Bài giảng giữ trên thiết bị");
  await expect(page.getByTestId("save-status")).toContainText(
    "Saved on this device",
  );
  await page.goto("/");
  await page
    .getByRole("link", { name: "Mở bảng giảng", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Lesson title", { exact: true })).toHaveValue(
    "Bài giảng giữ trên thiết bị",
  );
  await page.reload();
  await expect(page.getByLabel("Lesson title", { exact: true })).toHaveValue(
    "Bài giảng giữ trên thiết bị",
  );
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Giảng theo mạch riêng", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel("Lesson title", { exact: true })).toHaveValue(
    "Bài giảng giữ trên thiết bị",
  );
});

test("unknown app paths are intentional and query flags cannot create a separate lesson route", async ({
  page,
}) => {
  await page.goto("/app/not-supported");
  await expect(
    page.getByRole("heading", { name: "Không tìm thấy trang", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Về trang giới thiệu", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
});
