const fs = require("fs");
const { chromium } = require("playwright");

function safeName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function findVisiblePurchaseButton(page) {
  const selectors = [
    "form[action*='/cart/add'] button[type='submit']",
    "form[action*='/cart/add'] button[name='add']",
    "button[name='add']",
    "button[type='submit']",
    "input[type='submit']",
    "[role='button']"
  ];

  for (const selector of selectors) {
    const candidates = page.locator(selector);
    const count = await candidates.count();

    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);

      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      const text = cleanText(
        (await candidate.innerText().catch(() => "")) ||
        (await candidate.getAttribute("value")) ||
        (await candidate.getAttribute("aria-label")) ||
        ""
      );

      if (
        /ADD\s*TO\s*CART|ADD\s*TO\s*BAG|SOLD\s*OUT|OUT\s*OF\s*STOCK|UNAVAILABLE/i.test(
          text
        )
      ) {
        return candidate;
      }
    }
  }

  return null;
}

async function readStatus(purchaseButton) {
  const buttonText = cleanText(
    (await purchaseButton.innerText().catch(() => "")) ||
    (await purchaseButton.getAttribute("value")) ||
    (await purchaseButton.getAttribute("aria-label")) ||
    ""
  );

  const disabled =
    (await purchaseButton.isDisabled().catch(() => false)) ||
    (await purchaseButton.getAttribute("disabled")) !== null ||
    (await purchaseButton.getAttribute("aria-disabled")) === "true";

  let status = "OTHER";

  if (
    /ADD\s*TO\s*CART|ADD\s*TO\s*BAG/i.test(buttonText) &&
    !disabled
  ) {
    status = "ADD TO CART";
  } else if (
    /SOLD\s*OUT|OUT\s*OF\s*STOCK|UNAVAILABLE/i.test(
      buttonText
    ) ||
    disabled
  ) {
    status = "SOLD OUT";
  }

  return {
    status,
    buttonText,
    disabled
  };
}

async function takeProductScreenshot(
  page,
  purchaseButton,
  screenshotPath
) {
  const productForm = page
    .locator("form[action*='/cart/add']")
    .filter({
      has: purchaseButton
    })
    .first();

  if (
    (await productForm.count()) > 0 &&
    (await productForm.isVisible().catch(() => false))
  ) {
    await productForm.screenshot({
      path: screenshotPath
    });

    return;
  }

  /*
   * Find a visible parent area containing the purchase button
   * and nearby product controls.
   */
  const areaHandle = await purchaseButton.evaluateHandle(
    (button) => {
      let element = button;

      while (element && element !== document.body) {
        const text = (element.innerText || "")
          .replace(/\s+/g, " ")
          .toUpperCase();

        const containsPurchaseButton =
          text.includes("ADD TO CART") ||
          text.includes("ADD TO BAG") ||
          text.includes("SOLD OUT") ||
          text.includes("OUT OF STOCK") ||
          text.includes("UNAVAILABLE");

        const containsProductControls =
          text.includes("QUANTITY") ||
          text.includes("OPTION") ||
          text.includes("VERSION") ||
          text.includes("HAZE");

        if (
          containsPurchaseButton &&
          containsProductControls
        ) {
          return element;
        }

        element = element.parentElement;
      }

      return button;
    }
  );

  const productArea = areaHandle.asElement();

  if (productArea) {
    await productArea.screenshot({
      path: screenshotPath
    });

    return;
  }

  await purchaseButton.screenshot({
    path: screenshotPath
  });
}

async function selectKpopNaraVersion(page, version) {
  const escapedVersion = version.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  const exactVersion = new RegExp(
    `^\\s*${escapedVersion}\\s*$`,
    "i"
  );

  const selectors = [
    "button",
    "label",
    "[role='button']",
    "[role='radio']",
    ".swatch-element",
    ".product-form__input label",
    ".variant-input label"
  ];

  for (const selector of selectors) {
    const matches = page.locator(selector).filter({
      hasText: exactVersion
    });

    const count = await matches.count();

    for (let index = 0; index < count; index += 1) {
      const candidate = matches.nth(index);

      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      await candidate.scrollIntoViewIfNeeded();

      /*
       * Kpop Nara may visually disable unavailable options.
       * Force-click allows Playwright to inspect each displayed
       * version without waiting for the control to be enabled.
       */
      await candidate
        .click({
          force: true,
          timeout: 10000
        })
        .catch(() => {});

      await page.waitForTimeout(2500);

      console.log(
        `Kpop Nara version confirmed: ${version}`
      );

      return true;
    }
  }

  console.log(
    `Kpop Nara version could not be found: ${version}`
  );

  return false;
}

async function confirmHello82Haze(page) {
  /*
   * Do not open or press the Hello82 dropdown.
   * The monitor checks the HAZE version already displayed
   * as the selected option.
   */

  await page.waitForTimeout(3000);

  const exactHaze = page
    .getByText(/^\s*HAZE\s*(VER\.?)?\s*$/i)
    .first();

  if (await exactHaze.isVisible().catch(() => false)) {
    console.log(
      "Hello82 HAZE is visible. No dropdown click needed."
    );

    return true;
  }

  const selectors = [
    "select",
    "[role='combobox']",
    ".select",
    ".dropdown",
    ".product-option",
    "button"
  ];

  for (const selector of selectors) {
    const candidates = page.locator(selector);
    const count = await candidates.count();

    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);

      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      const text = cleanText(
        (await candidate.innerText().catch(() => "")) ||
        (await candidate.inputValue().catch(() =>