// Drives a demo build (NEXT_PUBLIC_ERRAND_DEMO=1, `next start`) through every scripted flow in an owned
// headless Chrome, and fails on any step, console error or request that leaves the demo's origin.
// docs/DEPLOY-DEMO.md. Usage: node scripts/demo/drive-demo.mjs BASE_URL OUT_DIR light|dark
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [baseUrl, outDir, theme = "light"] = process.argv.slice(2);
if (baseUrl === undefined || outDir === undefined) {
  console.error("Usage: node scripts/demo/drive-demo.mjs BASE_URL OUT_DIR light|dark");
  process.exit(2);
}
// The browser driver control-errand uses (tools/verify), with the installed Chrome.
const require = createRequire(fileURLToPath(new URL("../../tools/verify/package.json", import.meta.url)));
const { chromium } = require("playwright-core");

fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "demo-chrome-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chrome",
  headless: true,
  viewport: { width: 1440, height: 1000 },
  args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking"],
});
const origin = new URL(baseUrl).origin;
const requests = [];
const problems = [];
context.on("request", (request) => requests.push(request.url()));
// Nothing may leave the demo's own origin: no backend, no model, no third party.
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
  problems.push(`blocked request: ${url}`);
  return route.abort("blockedbyclient");
});
if (theme === "dark") await context.addInitScript(() => localStorage.setItem("errand-theme", "dark"));

const page = context.pages()[0] ?? (await context.newPage());
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") problems.push(`console ${message.type()}: ${message.text()}`);
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

let shot = 0;
const results = [];
async function snap(name) {
  shot += 1;
  const file = path.join(outDir, `${String(shot).padStart(2, "0")}-${name}-${theme}.png`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
async function step(name, run) {
  try {
    await run();
    results.push({ step: name, ok: true });
  } catch (error) {
    results.push({ step: name, ok: false, error: String(error).slice(0, 400) });
    await snap(`FAIL-${name.replace(/\W+/g, "-")}`).catch(() => undefined);
  }
}
const role = (r, name, options = {}) => page.getByRole(r, { name, ...options });
const say = async (text) => {
  await role("textbox", "Message the errand agent").fill(text);
  await role("button", "Send").click();
};
const visible = (locator, timeout = 15_000) => locator.first().waitFor({ state: "visible", timeout });

await step("home", async () => {
  await page.goto(baseUrl);
  await visible(role("button", "Area: Koramangala (from memory)"));
  await visible(role("button", "Budget: Under ₹1,500 (from memory)"));
  await visible(role("button", "Time: This week"));
  await visible(role("button", "Plumber for a leaking kitchen tap this week"));
  await visible(page.getByRole("region", { name: "Alerts" }).getByText("Ravi Aircon Experts"));
  await visible(page.getByText("Demo mode — scripted responses, no model or backend."));
  await page.waitForTimeout(800);
  await snap("home");
  await page.mouse.wheel(0, 900);
  await snap("home-lists");
});

await step("plumber search, cards and insight", async () => {
  await page.goto(baseUrl);
  await role("button", "Plumber for a leaking kitchen tap this week").click();
  await page.waitForURL(/\/chat\//);
  await visible(role("region", "Options for plumber in Koramangala"));
  await visible(page.getByText("1 review tried to instruct the assistant and was ignored"));
  await visible(page.getByText("Tap a card's Choose button"));
  await role("region", "Options for plumber in Koramangala").scrollIntoViewIfNeeded();
  await snap("choice-cards");
  await role("region", "Review insight for Venkatesh Sanitary Solutions").scrollIntoViewIfNeeded();
  await snap("review-insight");
});

await step("details gallery", async () => {
  const cards = role("region", "Options for plumber in Koramangala");
  await cards.getByRole("article", { name: "Shiva Sanitary Solutions" }).getByRole("button", { name: "Details" }).click();
  await visible(role("region", "Shiva Sanitary Solutions details"));
  await role("region", "Shiva Sanitary Solutions details").scrollIntoViewIfNeeded();
  await snap("details-gallery");
});

await step("charts", async () => {
  await say("Compare their prices for me");
  await visible(role("figure", "Spend chart"));
  await page.waitForTimeout(1200);
  await role("figure", "Spend chart").scrollIntoViewIfNeeded();
  await snap("charts");
});

await step("choose holds and shows the card", async () => {
  const cards = role("region", "Options for plumber in Koramangala").first();
  await cards.getByRole("article", { name: "Shiva Sanitary Solutions" }).getByRole("button", { name: "Choose" }).click();
  await visible(page.getByText("Held the slot."));
  await visible(role("button", "Approve ₹399"));
  await visible(role("region", "Approve booking").getByText("left"));
  await role("region", "Approve booking").last().scrollIntoViewIfNeeded();
  await snap("approval-card");
});

await step("typed yes books nothing", async () => {
  await say("yes");
  await visible(page.getByText("a typed “yes” doesn't count"));
  await page.waitForFunction(() => document.querySelectorAll('[data-proposal-id]').length >= 2, null, { timeout: 10_000 });
  const approves = await role("button", "Approve ₹399").count();
  if (approves !== 2) throw new Error(`expected the card twice, saw ${approves} Approve buttons`);
  await snap("typed-yes-card-again");
});

let bookingId = "";
await step("approve: checking, then receipt", async () => {
  await role("button", "Approve ₹399").last().click();
  await visible(role("region", "Checking with the provider"), 5_000);
  await snap("checking-with-provider");
  await visible(role("region", "Booked"), 15_000);
  bookingId = (await role("region", "Booked").last().innerText()).match(/bkg_\w+/)?.[0] ?? "";
  if (bookingId === "") throw new Error("no booking id on the receipt");
  await snap("receipt");
});

let plumberChat = "";
await step("new errand card and hand-off", async () => {
  plumberChat = page.url();
  await say("She needs her AC repaired too, at my mom's place in HSR Layout");
  await visible(role("region", "New errand"));
  await visible(role("region", "New errand").getByText("HSR Layout"));
  await visible(role("region", "New errand").getByText("Your plumber booking in Koramangala stays as it is."));
  await snap("new-errand-card");
  await role("button", "Start in a new chat").click();
  await page.waitForURL((url) => url.toString() !== plumberChat, { timeout: 10_000 });
  await visible(role("link", "Open your Koramangala plumber chat"));
  await visible(role("region", "Options for ac servicing in HSR Layout"));
  await page.waitForTimeout(800);
  await snap("new-chat-ac-hsr");
  await role("link", "Open your Koramangala plumber chat").click();
  await visible(role("link", "Open the new chat"));
  await snap("moved-line");
});

await step("decline books nothing and goes back to options", async () => {
  await page.goto(baseUrl);
  await role("button", "Plumber for a leaking kitchen tap this week").click();
  await page.waitForURL(/\/chat\//);
  const cards = role("region", "Options for plumber in Koramangala").first();
  await visible(cards);
  await page.waitForTimeout(600);
  await cards.getByRole("article", { name: "Venkatesh Sanitary Solutions" }).getByRole("button", { name: "Choose" }).click();
  await visible(role("button", "Approve ₹499"));
  await role("button", "Decline").click();
  await visible(role("region", "Approve booking").getByText("Declined"));
  await visible(page.getByText("Nothing is booked and the hold is released"));
  const sets = await role("region", "Options for plumber in Koramangala").count();
  if (sets < 2) throw new Error(`expected the options again, saw ${sets} option sets`);
  await snap("declined-options-again");
});

await step("ask form when the time is missing", async () => {
  await page.goto(baseUrl);
  await role("textbox", "Describe your errand").fill("I need a plumber in Koramangala");
  await role("button", "Start errand").click();
  await page.waitForURL(/\/chat\//);
  const form = role("form", "When should the plumber come?");
  await visible(form);
  await snap("ask-form");
  await form.getByRole("option", { name: "This week", exact: true }).click();
  await form.getByRole("button", { name: "Send" }).click();
  await visible(role("region", "Options for plumber in Koramangala"));
  await snap("ask-form-answered");
});

await step("memory: confirm, correct, forget", async () => {
  await page.goto(baseUrl);
  await role("button", "Confirm in memory: Earliest start 09:00").click();
  const sheet = role("dialog", "Memory");
  await visible(sheet);
  await snap("memory-sheet");
  await sheet.getByRole("listitem", { name: "Earliest start · 09:00" }).getByRole("button", { name: /Confirm/ }).click();
  await visible(sheet.getByRole("listitem", { name: "Earliest start · 09:00" }).getByText("you confirmed"));
  await sheet.getByRole("listitem", { name: "Budget · ₹1,500" }).getByRole("button", { name: /More/ }).click();
  await role("menuitem", "Correct").click();
  await role("textbox", "New budget").fill("2000");
  await role("button", "Save budget").click();
  await visible(sheet.getByRole("listitem", { name: "Budget · ₹2,000" }));
  await sheet.getByRole("listitem", { name: "Area · Koramangala" }).getByRole("button", { name: /More/ }).click();
  await role("menuitem", "Forget").click();
  await visible(sheet.getByRole("listitem", { name: "Forgotten: Area" }));
  await snap("memory-changed");
  await page.reload();
  await visible(role("button", "Area: not set"));
  await role("button", "Budget: Under ₹2,000 (from memory)").waitFor({ timeout: 10_000 });
  await snap("memory-after-reload");
});

await step("ops: demo operator view", async () => {
  await page.goto(`${baseUrl}/ops`);
  await visible(page.getByText("Demo: operator view."));
  await visible(role("list", "Sessions"));
  await snap("ops-sessions");
  await role("list", "Sessions").getByRole("link").last().click();
  await visible(role("region", "Transcript"));
  await visible(role("complementary", "Run trace"));
  await page.waitForTimeout(1500);
  await snap("ops-committed-trace");
  // The trace panel scrolls on its own: wheel over it down to the waterfall.
  await page.mouse.move(1100, 600);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(800);
  await snap("ops-trace-waterfall");
  await page.goBack();
  await role("list", "Sessions").getByRole("link").first().click();
  await visible(role("region", "Transcript").getByText("Plumber for a leaking kitchen tap this week"));
  await page.waitForTimeout(1500);
  await snap("ops-demo-chat");
});

await step("reset demo", async () => {
  await page.goto(baseUrl);
  await role("button", "Reset demo").click();
  await page.waitForURL(baseUrl + "/");
  await visible(role("button", "Area: Koramangala (from memory)"));
});

await context.close();
fs.rmSync(profile, { recursive: true, force: true });
const offOrigin = requests.filter((url) => !url.startsWith(origin) && !url.startsWith("data:") && !url.startsWith("blob:"));
const backend = requests.filter((url) => url.includes(":3100") || url.includes("/api/v1") || url.includes("/eve/v1"));
const report = { theme, results, requests: requests.length, offOrigin, backend, problems, bookingId };
fs.writeFileSync(path.join(outDir, `report-${theme}.json`), JSON.stringify({ ...report, allRequests: requests }, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exit(results.every((result) => result.ok) && offOrigin.length === 0 && backend.length === 0 && problems.length === 0 ? 0 : 1);
