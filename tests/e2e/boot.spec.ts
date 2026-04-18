import { expect, test } from "@playwright/test";

test("landing page boot smoke", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /로그인 링크 요청/i
    })
  ).toBeVisible();
  await expect(page.getByText(/개발 환경에서는 즉시 열 수 있는 magic link/i)).toBeVisible();
});
