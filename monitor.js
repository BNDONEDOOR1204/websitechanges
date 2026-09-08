const fs = require("fs");
const { chromium } = require("playwright");

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function findVersionOption(page, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactVersion = new RegExp(`^\\s*${escapedVersion}\\s*$`, "i");

  const selectors = [
    "button",
    "label",
    "[role='button']",
    "[role='radio']",
    ".swatch-element",
    ".product-form__input label",
    ".variant-input label",
  ];

  for (const selector of selectors) {
    const matches = page.locator(selector).filter({
      hasText: exactVersion,
    });

    const count = await matches.count();

    for (let index = 0; index < count; index += 1) {
      const candidate = matches.nth(index);

      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
  }

  return null;
}

async function findPurchaseButton(page) {
  const selectors = [
    "form[action*='/cart/add'] button[name='add']",
    "form[action*='/cart/add'] button[type='submit']",
    "button[name='add']",
    "button[type='submit']",
  ];

  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count();

    for (let index = 0; index < count; index += 1) {
      const candidate = matches.nth(index);

      if (await candidate.isVisible().catch(() => false)) {
        const text = (
          await candidate.innerText().catch(() => "")
        )
          .replace(/\s+/g, " ")
          .trim();

        if (
          /ADD\s*TO\s*CART|SOLD\s*OUT|OUT\s*OF\s*STOCK|UNAVAILABLE/i.test(
            text
          )
        ) {
          return candidate;
        }
      }
    }
  }

  return null;
}

async function getProductArea(page, purchaseButton) {
  const productForm = page.locator(
    "form[action*='/cart/add']"
  ).first();

  if (
    (await productForm.count()) > 0 &&
    (await productForm.isVisible().catch(() => false))
  ) {
    return productForm;
  }

  const handle = await purchaseButton.evaluateHandle((button) => {
    let element = button;

    while (element && element !== document.body) {
      const text = (element.innerText || "")
        .replace(/\s+/g, " ")
        .toUpperCase();

      const hasOptions = text.includes("OPTIONS");
      const hasQuantity = text.includes("QUANTITY");
      const hasPurchaseText =
        text.includes("ADD TO CART") ||
        text.includes("SOLD OUT") ||
        text.includes("OUT OF STOCK");

      if (hasPurchaseText && (hasOptions || hasQuantity)) {
        return element;
      }

      element = element.parentElement;
    }

    return button.parentElement;
  });

  return handle.asElement();
}

(async () => {
  const [monitor] = JSON.parse(
    fs.readFileSync("monitors.json", "utf8")
  );

  const previousResults = fs.existsSync("previous-status.json")
    ? JSON.parse(
        fs.readFileSync("previous-status.json", "utf8")
      )
    : {};

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage({
    viewport: {
      width: 1365,
      height: 1000,
    },
    deviceScaleFactor: 1,
  });

  console.log(`Opening ${monitor.url}`);

  await page.goto(monitor.url, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });

  await page.waitForTimeout(7000);

  const currentResults = {};
  const changedVersions = [];

  for (const version of monitor.versions) {
    console.log(`Checking version: ${version}`);

    const versionOption = await findVersionOption(
      page,
      version
    );

    if (!versionOption) {
      currentResults[version] = {
        status: "VERSION OPTION NOT FOUND",
        buttonText: "",
        disabled: null,
      };

      console.log(`${version}: version option not found`);
      continue;
    }

    await versionOption.scrollIntoViewIfNeeded();

    await versionOption.click({
      force: true,
    });

    await page.waitForTimeout(2500);

    const purchaseButton = await findPurchaseButton(page);

    if (!purchaseButton) {
      currentResults[version] = {
        status: "PURCHASE BUTTON NOT FOUND",
        buttonText: "",
        disabled: null,
      };

      console.log(`${version}: purchase button not found`);
      continue;
    }

    const buttonText = (
      await purchaseButton.innerText().catch(() => "")
    )
      .replace(/\s+/g, " ")
      .trim();

    const disabled =
      (await purchaseButton.isDisabled().catch(() => false)) ||
      (await purchaseButton.getAttribute("aria-disabled")) ===
        "true";

    let status = "OTHER";

    if (/ADD\s*TO\s*CART/i.test(buttonText) && !disabled) {
      status = "ADD TO CART";
    } else if (
      /SOLD\s*OUT|OUT\s*OF\s*STOCK|UNAVAILABLE/i.test(
        buttonText
      ) ||
      disabled
    ) {
      status = "SOLD OUT";
    }

    currentResults[version] = {
      status,
      buttonText,
      disabled,
    };

    console.log(
      `${version}: ${status} | Button: ${buttonText}`
    );

    const productArea = await getProductArea(
      page,
      purchaseButton
    );

    const screenshotName =
      `current-${safeName(version)}.png`;

    if (productArea) {
      await productArea.screenshot({
        path: screenshotName,
      });
    } else {
      await purchaseButton.screenshot({
        path: screenshotName,
      });
    }

    const previous = previousResults[version];

    if (
      previous &&
      (
        previous.status !== status ||
        previous.buttonText !== buttonText ||
        previous.disabled !== disabled
      )
    ) {
      changedVersions.push({
        version,
        previousStatus: previous.status,
        currentStatus: status,
        previousButtonText: previous.buttonText,
        currentButtonText: buttonText,
        screenshot: screenshotName,
      });
    }
  }

  const baselineExists =
    Object.keys(previousResults).length > 0;

  fs.writeFileSync(
    "current-status.json",
    JSON.stringify(currentResults, null, 2)
  );

  fs.writeFileSync(
    "monitor-result.json",
    JSON.stringify(
      {
        name: monitor.name,
        url: monitor.url,
        baselineExists,
        changed: true,
        changedVersions,
        currentResults,
        checkedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    "previous-status.json",
    JSON.stringify(currentResults, null, 2)
  );

  for (const version of monitor.versions) {
    const name = safeName(version);
    const currentImage = `current-${name}.png`;
    const previousImage = `previous-${name}.png`;

    if (fs.existsSync(currentImage)) {
      fs.copyFileSync(currentImage, previousImage);
    }
  }

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});