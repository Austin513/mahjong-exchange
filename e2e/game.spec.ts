// End-to-end: independent browser contexts (separate storage = separate identities)
// against the production server. Run with `npm run e2e`.
import { expect, test, type Browser, type Page } from "@playwright/test";

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function createRoom(page: Page, mode: "house" | "exchange", name: string): Promise<string> {
  await page.goto("/");
  await page.getByTestId("home-name").fill(name);
  await page.getByTestId(`create-${mode}`).click();
  await expect(page.getByTestId("room-code")).toBeVisible();
  return (await page.getByTestId("room-code").locator("b").textContent())!.trim();
}

async function joinByLink(browser: Browser, code: string, name: string, mobile = false): Promise<Page> {
  const ctx = await browser.newContext(mobile ? MOBILE : {});
  const page = await ctx.newPage();
  await page.goto(`/r/${code}`);
  await page.getByTestId("join-name").fill(name);
  await page.getByTestId("join-submit").click();
  await expect(page.getByTestId("room-code")).toContainText(code);
  return page;
}

async function setBotSpeed(host: Page, value: "250" | "700" | "1500" | "3000") {
  // Host controls live in the sidebar's Table tab; return to whichever tab was open.
  const wasMarket = (await host.getByTestId("tab-market").getAttribute("aria-selected")) === "true";
  await host.getByTestId("tab-table").click();
  const details = host.getByTestId("host-panel").locator("details", { hasText: "Table timing" });
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await details.locator("summary").click();
  await details.locator("select").first().selectOption(value);
  if (wasMarket) await host.getByTestId("tab-market").click();
}

test("House mode: solo host with bot seats, a phone spectator joins by link, both trade and see settlement", async ({ page, browser }) => {
  const code = await createRoom(page, "house", "Host");
  await expect(page.getByTestId("mode-badge")).toHaveText("Trade Against the House");
  await page.getByTestId("fill-bots").click();
  await expect(page.getByTestId("seat-row-3")).toContainText("smart table bot");
  await setBotSpeed(page, "700");
  await page.getByTestId("btn-start").click();
  await expect(page.getByTestId("house-quotes")).toBeVisible();

  // A friend on a phone joins mid-hand via the invite URL.
  const phone = await joinByLink(browser, code, "Phone", true);
  await expect(phone.getByTestId("board")).toBeVisible();
  await expect(phone.getByTestId("hand-panel")).toHaveCount(0); // spectator: no private hand
  await expect(phone.getByTestId("market-status")).toHaveText("OPEN");

  // Both trade against the house; quotes show the total cost on the button.
  await expect(page.getByTestId("buy-SEAT_0")).toContainText("Buy 5");
  await page.getByTestId("buy-SEAT_0").click();
  await expect(page.getByTestId("toast-notice").first()).toContainText("Bought 5 Seat A");
  await expect(page.getByTestId("pos-SEAT_0")).toHaveText("+5");
  await phone.getByTestId("qty-10").click();
  await phone.getByTestId("buy-DRAW").click();
  await expect(phone.getByTestId("pos-DRAW")).toHaveText("+10");
  // The same live trade tape reaches both clients.
  await expect(page.getByTestId("tape")).toContainText("Phone");
  await expect(phone.getByTestId("tape")).toContainText("Host");
  await expect(page.getByTestId("price-explanation")).toBeVisible();

  // Speed the bots up and wait for the hand to finish on both screens.
  await setBotSpeed(page, "250");
  await expect(page.getByTestId("result-panel")).toBeVisible({ timeout: 150_000 });
  await expect(phone.getByTestId("result-panel")).toBeVisible();
  await expect(page.getByTestId("settlement")).toContainText("paid 100 per share");
  await expect(page.getByTestId("my-settlement")).toContainText("Hand P&L");
  await expect(phone.getByTestId("my-settlement")).toContainText("Hand P&L");
  await expect(page.getByTestId("market-status")).toContainText("CLOSED");
  // Host can deal a fresh hand; the market reopens.
  await page.getByTestId("btn-next-hand").click();
  await expect(page.getByTestId("market-status")).toHaveText("OPEN");
  await expect(phone.getByTestId("wall-count")).toBeVisible();
});

test("Open Exchange: friends-only book, true human-to-human fill, no house and no trading bots", async ({ page, browser }) => {
  const code = await createRoom(page, "exchange", "Host");
  await expect(page.getByTestId("mode-badge")).toHaveText("Open Exchange");
  await page.getByTestId("fill-bots").click();
  await setBotSpeed(page, "700");
  const bob = await joinByLink(browser, code, "Bob");
  const cara = await joinByLink(browser, code, "Cara", true);
  await page.getByTestId("btn-start").click();
  await expect(bob.getByTestId("market-status")).toHaveText("OPEN");
  await expect(bob.getByTestId("empty-book")).toBeVisible();
  await expect(bob.getByTestId("bot-list")).toHaveCount(0);

  // Bob bids 30 for 10 on Seat B.
  await bob.getByTestId("ctab-SEAT_1").click();
  await bob.getByTestId("side-buy").click();
  await bob.getByTestId("ticket-price").fill("30");
  await bob.getByTestId("ticket-qty").fill("10");
  await expect(bob.getByTestId("ticket-preview")).toContainText("Reserves 300");
  await bob.getByTestId("ticket-submit").click();
  await expect(bob.getByTestId("my-orders")).toContainText("resting");

  // Cara (phone) sees the bid and sells 4 into it.
  await cara.getByTestId("ctab-SEAT_1").click();
  await expect(cara.getByTestId("ladder")).toContainText("30");
  await cara.getByTestId("side-sell").click();
  await cara.getByTestId("ticket-price").fill("30");
  await cara.getByTestId("ticket-qty").fill("4");
  await cara.getByTestId("ticket-tif").selectOption("ioc");
  await cara.getByTestId("ticket-submit").click();
  await expect(cara.getByTestId("toast-notice").first()).toContainText("Sold 4");
  await expect(bob.getByTestId("my-orders")).toContainText("partially filled 4/10");
  await expect(bob.getByTestId("tape")).toContainText("Bob ← Cara");
  await expect(cara.getByTestId("positions")).toContainText("Seat B short 4");

  // Bob cancels the rest: available credit returns to cash.
  await bob.locator("[data-testid^=cancel-]").first().click();
  await expect(bob.getByTestId("my-orders")).not.toContainText("resting");
  await expect(bob.getByTestId("acct-available")).toHaveText("9,880");

  // Refresh: Bob keeps his identity and position.
  await bob.reload();
  await expect(bob.getByTestId("positions")).toContainText("Seat B long 4");
  await bob.getByTestId("tab-table").click();
  await expect(bob.getByTestId("seats-panel")).toBeVisible();
  await bob.getByTestId("tab-market").click();

  await setBotSpeed(page, "250");
  await expect(bob.getByTestId("settlement")).toBeVisible({ timeout: 150_000 });
  await expect(cara.getByTestId("my-settlement")).toBeVisible();
});

test("Seated human plays a full hand with three smart bots through the UI", async ({ page }) => {
  await createRoom(page, "house", "Player");
  await page.getByTestId("sit-0").click();
  await page.getByTestId("fill-bots").click();
  await setBotSpeed(page, "250");
  await page.getByTestId("btn-start").click();
  await expect(page.getByTestId("my-hand")).toBeVisible();
  const deadline = Date.now() + 150_000;
  while (!(await page.getByTestId("result-panel").isVisible())) {
    if (Date.now() > deadline) throw new Error("hand did not finish");
    for (const id of ["btn-tsumo", "btn-ron", "btn-pass"]) {
      const b = page.getByTestId(id);
      if (await b.isVisible().catch(() => false)) {
        await b.click().catch(() => {});
        break;
      }
    }
    const tile = page.locator("[data-testid=my-hand] button:not([disabled])").last();
    if (await tile.isVisible().catch(() => false)) {
      await tile.click().catch(() => {});
      await page.getByTestId("btn-discard").click({ timeout: 1000 }).catch(() => {});
    }
    await page.waitForTimeout(150);
  }
  await expect(page.getByTestId("result-title")).toBeVisible();
});

test("Open Exchange with trading bots: bots appear with identities and trade", async ({ page }) => {
  await createRoom(page, "exchange", "Host");
  await page.getByTestId("fill-bots").click();
  await page.getByTestId("bots-informed").selectOption("1");
  await page.getByTestId("bots-noise").selectOption("1");
  await page.getByTestId("bots-public").selectOption("1");
  await page.getByTestId("bot-pace").selectOption("1000");
  await setBotSpeed(page, "700");
  await page.getByTestId("btn-start").click();
  await expect(page.getByTestId("bot-list")).toContainText("Informed bot 1 (reads Seat A)");
  await expect(page.getByTestId("tape")).toContainText("bot", { timeout: 30_000 });
});

test("Invalid room code shows what happened and how to recover", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("join-code").fill("QQQQQ");
  await page.getByTestId("join-code-btn").click();
  await expect(page.getByRole("alert")).toContainText("No room with code QQQQQ");
  await page.goto("/r/QQQQQ");
  await expect(page.getByText("Room not found")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to the lobby" })).toBeVisible();
});
