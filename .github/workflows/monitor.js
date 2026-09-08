const fs = require("fs");
const crypto = require("crypto");
const { chromium } = require("playwright");

function hashFile(path) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path))
    .digest("hex");
}

(async () => {
  const monitors = JSON.parse(
    fs.readFileSync("monitors.json", "utf8")
  );

  const monitor = monitors[0];

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage({
    viewport: {
      width: 1365,
      height: 900,
    },
    deviceScaleFactor: 1,
  });

  console.log(`Opening ${monitor.url}`);

  await page.goto(monitor.url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(7000);

  /*
   * Find the product action button.
   * This matches either SOLD OUT or ADD TO CART.
   */
  let actionButton = page
    .locator("button, [role='button']")
    .filter({
      hasText: /SOLD\s*OUT|ADD\s*TO\s*CART|OUT\s*OF\s*STOCK/i,
    })
    .first();

  /*
   * Some shops use an input element instead of a button.
   */
  if ((await actionButton.count()) === 0) {
    actionButton = page
      .locator(
        "input[type='submit'][value*='SOLD'], " +
        "input[type='submit'][value*='ADD TO CART']"
      )
      .first();
  }

  if ((await actionButton.count()) === 0) {
    throw new Error(
      "Could not locate the SOLD OUT or ADD TO CART button."
    );
  }

  await actionButton.scrollIntoViewIfNeeded();

  /*
   * Start at the button and move upwards until an area containing
   * product options, quantity, and the stock button is found.
   */
  const areaHandle = await actionButton.evaluateHandle((button) => {
    let element = button;

    while (element && element !== document.body) {
      const text = (element.innerText || "")
        .replace(/\s+/g, " ")
        .toUpperCase();

      const hasStockText =
        text.includes("SOLD OUT") ||
        text.includes("ADD TO CART") ||
        text.includes("OUT OF STOCK");

      const hasOptions =
        text.includes("OPTIONS") ||
        text.includes("OPTION");

      const hasQuantity = text.includes("QUANTITY");

      if (hasStockText && (hasOptions || hasQuantity)) {
        return element;
      }

      element = element.parentElement;
    }

    return button.parentElement;
  });

  const productArea = areaHandle.asElement();

  if (!productArea) {
    throw new Error("Could not identify the product monitoring area.");
  }

  /*
   * Capture only the selected product area.
   */
  await productArea.screenshot({
    path: "current-area.png",
  });

  const areaText = await productArea.innerText();

  const normalizedText = areaText
    .replace(/\s+/g, " ")
    .trim();

  console.log("Current monitored text:");
  console.log(normalizedText);

  const currentStatus = /ADD\s*TO\s*CART/i.test(normalizedText)
    ? "ADD TO CART"
    : /SOLD\s*OUT|OUT\s*OF\s*STOCK/i.test(normalizedText)
    ? "SOLD OUT"
    : "OTHER";

  const baselineExists = fs.existsSync("previous-area.png");

  let changed = false;
  let previousHash = null;
  const currentHash = hashFile("current-area.png");

  if (baselineExists) {
    previousHash = hashFile("previous-area.png");
    changed = previousHash !== currentHash;
  }

  let previousText = "";

  if (fs.existsSync("previous-area.txt")) {
    previousText = fs.readFileSync(
      "previous-area.txt",
      "utf8"
    );
  }

  const textChanged =
    baselineExists &&
    previousText.trim() !== normalizedText.trim();

  /*
   * Alert if either the screenshot or visible text changed.
   */
  const areaChanged =
    baselineExists && (changed || textChanged);

  console.log(`Baseline exists: ${baselineExists}`);
  console.log(`Screenshot changed: ${changed}`);
  console.log(`Text changed: ${textChanged}`);
  console.log(`Current status: ${currentStatus}`);

  fs.writeFileSync(
    "monitor-result.json",
    JSON.stringify(
      {
        name: monitor.name,
        url: monitor.url,
        baselineExists,
        areaChanged,
        screenshotChanged: changed,
        textChanged,
        previousText,
        currentText: normalizedText,
        currentStatus,
        checkedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  /*
   * Save the current screenshot and text as the next baseline.
   */
  fs.copyFileSync(
    "current-area.png",
    "previous-area.png"
  );

  