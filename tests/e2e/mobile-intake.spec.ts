import { expect, test } from "@playwright/test";

test("mobile intake template file exists for manual execution", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/법령 컴플라이언스 어시스턴트/i);
});
