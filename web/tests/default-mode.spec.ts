import { test, expect } from "@playwright/test";

/**
 * Manual-only is the app DEFAULT on a fresh load (no stored preference), so the 185MB automatic model
 * is never downloaded unless the user opts in. This spec deliberately does NOT use the seeding fixture,
 * so it sees the real first-visit default.
 */
test("fresh load defaults to manual detection (model is opt-in)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "בחירה ידנית", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "זיהוי אוטומטי", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
