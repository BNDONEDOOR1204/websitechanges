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

async function findPurchaseButton(page) {
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

      const innerText = await candidate
        .innerText()
        .catch(() => "");

      const value = await candidate
        .getAttribute("value")
        .catch(() => "");

      const ariaLabel = await candidate
        .getAttribute("aria-label")
        .catch(() => "");

      const text = cleanText(
        innerText || value || ariaLabel || ""
      );

      if (
        /ADD\s*TO\s*CART|ADD\s*TO\s*BAG|SOLD\s*OUT|OUT\s*OF\s*STOCK|UNAVAILABLE/i.test(
        * text
        )
      ) {
        *eturn candidate;
      }
    }
  }*
  return null;
}

async function *eadButtonStatus(button) {
  const *nnerText = await button
    .inner*ext()
    .catch(() => "");

  con*t value = await button
    .getAtt*ibute("value")
    .catch(() => ""*;

  const ariaLabel = await butto*
    .getAttribute("aria-label")
 *  .catch(() => "");

  const butto*Text = cleanText(
    innerText ||*value || ariaLabel || ""
  );

  c*nst isDisabled = await button
    *isDisabled()
    .catch(() => false);

  const disabledAttribute = await button
    .getAttribute("disabled")
    .catch(() => null);

  const ariaDisabled = await button
    .getAttribute("aria-disabled")
    .catch(() => null);

  const disabled =
    isDisabled ||
    disabledAttribute !== null ||
    ariaDisabled === "true";

  let status = "OTHER";

  if (
    /ADD\s*TO\s*CART|ADD\s*TO\s*BAG/i.test(buttonText) &&
    !dis*bled
  ) {
    status = "ADD TO CA*T";
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

async function takeScreenshot(
  page,
  button,
  screenshotPath
) {
  const form = page
    .locator("form[action*='/cart/add']")
    .f*rst();

  if (
    (await form.cou*t()) > 0 &&
    (await form.isVisi*le().catch(() => false))
  ) {
   *await form.screenshot({
      path* screenshotPath
    });

    retur*;
  }

  const parentHandle = awai* button.evaluateHandle(
    (purch*seButton) => {
      let element =*purchaseButton;

      while (elem*nt && element !== document.body) {*        const text = String(elemen*.innerText || "")
          .repla*e(/\s+/g, " ")
          .toUpperC*se();

        const hasPurchaseTe*t =
          text.includes("ADD T* CART") ||
          text.includes*"ADD TO BAG") ||
          text.in*ludes("SOLD OUT") ||
          tex*.includes("OUT OF STOCK") ||
     *    text.includes("UNAVAILABLE");
*        const hasProductControls =*          text.includes("QUANTITY"* ||
          text.includes("OPTIO*") ||
          text.includes("VER*ION") ||
          text.includes("*AZE");

        if (hasPurchaseText && hasProductControls) {
          return element;
        }

        element = element.parentElement;
      }

      return purchaseButton;
    }
  );

  const parentElement = parentHandle.asElement();

  if (parentElement) {
    await parentElement.screenshot({
      path: screenshotPath
    });

    return;
  }

  await button.screenshot({
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

      await candidate
        .scrollIntoViewIfNeeded()
        .catch(() => {});

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
    `Kpop Nara version not found: ${version}`
  );

  return false;
}

async function confirmHello82Haze(page) {
  /*
   * Do not press the Hello82 dropdown.
   * Check whether HAZE is already displayed.
   */

  await page.waitForTimeout(3000);

  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");

  if (/HAZE\s*(VER\.?)?/i.test(bodyText)) {
    console.log(
      "Hello82 HAZE is visible. No dropdown click needed."
    );

    return true;
  }

  console.log(
    "Hello82 HAZE could not be confirmed."
  );

  return false;
}

async function checkVersion(
  browser,
  monitor,
  version,
  previousResults
) {
  const page = await browser.newPage({
    viewport: {
      width: 1365,
      height: 1100
    },
    deviceScaleFactor: 1
  });

  const resultKey = `${monitor.id}:${version}`;

  try {
    console.log("");
    console.log("--------------------------------");
    console.log(`Opening: ${monitor.url}`);
    console.log(`Store: ${monitor.store}`);
    console.log(`Version: ${version}`);

    await page.goto(monitor.url, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    await page.waitForTimeout(7000);

    let versionConfirmed = false;

    if (monitor.store === "kpopnara") {
      versionConfirmed =
        await selectKpopNaraVersion(
          page,
          version
        );
    } else if (
      monitor.store === "hello82" &&
      version.toUpperCase() === "HAZE"
    ) {
      versionConfirmed =
        await confirmHello82Haze(page);
    }

    if (!versionConfirmed) {
      console.log(
        `${monitor.store} / ${version}: version not confirmed`
      );

      return {
        result:
          previousResults[resultKey] || {
            status: "VERSION OPTION NOT FOUND",
            buttonText: "",
            disabled: null
          },
        change: null
      };
    }

    const purchaseButton =
      await findPurchaseButton(page);

    if (!purchaseButton) {
      console.log(
        `${monitor.store} / ${version}: purchase button not found`
      );

      return {
        result:
          previousResults[resultKey] || {
            status: "PURCHASE BUTTON NOT FOUND",
            buttonText: "",
            disabled: null
          },
        change: null
      };
    }

    const result =
      await readButtonStatus(purchaseButton);

    console.log(
      `${monitor.store} / ${version}: ` +
      `${result.status} | Button: ${result.buttonText}`
    );

    const screenshotName =
      `current-${safeName(monitor.id)}-${safeName(version)}.png`;

    await takeScreenshot(
      page,
      purchaseButton,
      screenshotName
    );

    const previous =
      previousResults[resultKey];

    let change = null;

    if (
      previous &&
      (
        previous.status !== result.status ||
        previous.buttonText !== result.buttonText ||
        previous.disabled !== result.disabled
      )
    ) {
      change = {
        monitorId: monitor.id,
        store: monitor.store,
        product: monitor.name,
        version:
          `${monitor.store.toUpperCase()} - ${version}`,
        previousStatus: previous.status,
        currentStatus: result.status,
        previousButtonText:
          previous.buttonText || "",
        currentButtonText:
          result.buttonText || "",
        url: monitor.url,
        screenshot: screenshotName
      };
    }

    return {
      result,
      change
    };
  } catch (error) {
    console.error(
      `${monitor.store} / ${version} failed: ${error.message}`
    );

    /*
     * Preserve the previous good value if one check fails.
     */
    return {
      result:
        previousResults[resultKey] || {
          status: "CHECK ERROR",
          buttonText: error.message,
          disabled: null
        },
      change: null
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const monitors = JSON.parse(
    fs.readFileSync("monitors.json", "utf8")
  );

  const previousResults =
    fs.existsSync("previous-status.json")
      ? JSON.parse(
          fs.readFileSync(
            "previous-status.json",
            "utf8"
          )
        )
      : {};

  const browser = await chromium.launch({
    headless: true
  });

  const currentResults = {};
  const changedVersions = [];

  try {
    for (const monitor of monitors) {
      for (const version of monitor.versions) {
        const resultKey =
          `${monitor.id}:${version}`;

        const check = await checkVersion(
          browser,
          monitor,
          version,
          previousResults
        );

        currentResults[resultKey] = {
          monitorId: monitor.id,
          store: monitor.store,
          product: monitor.name,
          version,
          url: monitor.url,
          ...check.result
        };

        if (check.change) {
          changedVersions.push(
            check.change
          );
        }
      }
    }
  } finally {
    await browser.close();
  }

  const output = {
    baselineExists:
      Object.keys(previousResults).length > 0,
    changed:
      changedVersions.length > 0,
    changedVersions,
    currentResults,
    checkedAt:
      new Date().toISOString()
  };

  fs.writeFileSync(
    "current-status.json",
    JSON.stringify(
      currentResults,
      null,
      2
    )
  );

  fs.writeFileSync(
    "monitor-result.json",
    JSON.stringify(
      output,
      null,
      2
    )
  );

  fs.writeFileSync(
    "previous-status.json",
    JSON.stringify(
      currentResults,
      null,
      2
    )
  );

  for (const monitor of monitors) {
    for (const version of monitor.versions) {
      const baseName =
        `${safeName(monitor.id)}-${safeName(version)}`;

      const currentImage =
        `current-${baseName}.png`;

      const previousImage =
        `previous-${baseName}.png`;

      if (fs.existsSync(currentImage)) {
        fs.copyFileSync(
          currentImage,
          previousImage
        );
      }
    }
  }

  console.log("");
  console.log("Final monitoring result:");
  console.log(
    JSON.stringify(
      output,
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});