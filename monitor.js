const fs = require("fs");
const { chromium } = require("playwright");

function safeName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function findVisiblePurchaseButton(page) {
  const candidates = page.locator(
    [
      "form[action*='/cart/add'] button[type='submit']",
      "form[action*='/cart/add'] button[name='add']",
      "button[name='add']",
      "button[type='submit']",
      "input[type='submit']"
    ].join(", ")
  );

  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);

    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    const text = (
      (await candidate.innerText().catch(() => "")) ||
      (await candidate.getAttribute("value")) ||
      ""
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

  return null;
}

async function readStatus(purchaseButton) {
  const buttonText = (
    (await purchaseButton.innerText().catch(() => "")) ||
    (await purchaseButton.getAttribute("value")) ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();

  const disabled =
    (await purchaseButton.isDisabled().catch(() => false)) ||
    (await purchaseButton.getAttribute("disabled")) !== null ||
    (await purchaseButton.getAttribute("aria-disabled")) === "true";

  let status = "OTHER";

  if (/ADD\s*TO\s*CART/i.test(buttonText) && !disabled) {
    status = "ADD TO CART";
  } else if (
    /SOLD\s*OUT|OUT\s*OF\s*STOCK|UNAVAILABLE/i.test(buttonText) ||
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

async function takeProductScreenshot(page, purchaseButton, path) {
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
    await productForm.screenshot({ path });
    return;
  }

  await purchaseButton.screenshot({ path });
}

async function selectKpopNaraVersion(page, version) {
  const exactVersion = new RegExp(
    `^\\s*${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
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

    for (let index = 0; index < await matches.count(); index += 1) {
      const candidate = matches.nth(index);

      if (await candidate.isVisible().catch(() => false)) {
        await candidate.scrollIntoViewIfNeeded();

        /*
         * Force-click is used because Kpop Nara may visually disable
         * sold-out version choices while still updating the variant.
         */
        await candidate.click({
          force: true,
          timeout: 10000
        });

        await page.waitForTimeout(2000);
        return true;
      }
    }
  }

  return false;
}

async function selectHello82Haze(page) {
  /*
   * First try a normal HTML select dropdown.
   */
  const selects = page.locator("select");

  for (let index = 0; index < await selects.count(); index += 1) {
    const select = selects.nth(index);

    if (!(await select.isVisible().catch(() => false))) {
      continue;
    }

    const options = await select
      .locator("option")
      .allTextContents()
      .catch(() => []);

    const hazeOption = options.find((option) =>
      /HAZE/i.test(option)
    );

    if (hazeOption) {
      await select.selectOption({
        label: hazeOption
      });

      await page.waitForTimeout(2500);
      return true;
    }
  }

  /*
   * Fallback for a custom dropdown like the one in the screenshot.
   */
  const dropdownTriggers = page.locator(
    [
      "[role='combobox']",
      "button",
      "[role='button']",
      ".select",
      ".dropdown",
      ".product-option"
    ].join(", ")
  );

  for (
    let index = 0;
    index < await dropdownTriggers.count();
    index += 1
  ) {
    const trigger = dropdownTriggers.nth(index);

    if (!(await trigger.isVisible().catch(() => false))) {
      continue;
    }

    const text = (
      await trigger.innerText().catch(() => "")
    )
      .replace(/\s+/g, " ")
      .trim();

    if (/HAZE\s*(VER\.?)?|CHOOSE\s*VERSION|VERSION/i.test(text)) {
      await trigger.click({
        force: true,
        timeout: 10000
      }).catch(() => {});

      await page.waitForTimeout(800);

      const hazeChoices = page
        .locator(
          "option, [role='option'], li, button, label, div"
        )
        .filter({
          hasText: /^\s*HAZE\s*(VER\.?)?\s*$/i
        });

      for (
        let choiceIndex = 0;
        choiceIndex < await hazeChoices.count();
        choiceIndex += 1
      ) {
        const choice = hazeChoices.nth(choiceIndex);

        if (await choice.isVisible().catch(() => false)) {
          await choice.click({
            force: true,
            timeout: 10000
          }).catch(() => {});

          await page.waitForTimeout(2500);
          return true;
        }
      }
    }
  }

  /*
   * The screenshot shows HAZE already selected by default.
   * If the page visibly says HAZE Ver., continue using that selection.
   */
  const bodyText = await page.locator("body").innerText();

  return /HAZE\s*VER\.?/i.test(bodyText);
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

  try {
    console.log(`Opening: ${monitor.url}`);
    console.log(`Store: ${monitor.store}`);
    console.log(`Version: ${version}`);

    await page.goto(monitor.url, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    await page.waitForTimeout(7000);

    let versionSelected = false;

    if (monitor.store === "kpopnara") {
      versionSelected = await selectKpopNaraVersion(
        page,
        version
      );
    } else if (
      monitor.store === "hello82" &&
      version === "HAZE"
    ) {
      versionSelected = await selectHello82Haze(page);
    }

    if (!versionSelected) {
      return {
        result: {
          status: "VERSION OPTION NOT FOUND",
          buttonText: "",
          disabled: null
        },
        change: null
      };
    }

    const purchaseButton =
      await findVisiblePurchaseButton(page);

    if (!purchaseButton) {
      return {
        result: {
          status: "PURCHASE BUTTON NOT FOUND",
          buttonText: "",
          disabled: null
        },
        change: null
      };
    }

    const result = await readStatus(purchaseButton);

    console.log(
      `${monitor.store} / ${version}: ` +
      `${result.status} | Button: ${result.buttonText}`
    );

    const screenshotName =
      `current-${safeName(monitor.id)}-${safeName(version)}.png`;

    await takeProductScreenshot(
      page,
      purchaseButton,
      screenshotName
    );

    const resultKey = `${monitor.id}:${version}`;
    const previous = previousResults[resultKey];

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
        version,
        previousStatus: previous.status,
        currentStatus: result.status,
        previousButtonText: previous.buttonText,
        currentButtonText: result.buttonText,
        url: monitor.url,
        screenshot: screenshotName
      };
    }

    return {
      result,
      change
    };
  } finally {
    await page.close();
  }
}

(async () => {
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
        const resultKey = `${monitor.id}:${version}`;

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
          changedVersions.push(check.change);
        }
      }
    }
  } finally {
    await browser.close();
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
        baselineExists,
        changed: changedVersions.length > 0,
        changedVersions,
        currentResults,
        checkedAt: new Date().toISOString()
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    "previous-status.json",
    JSON.stringify(currentResults, null, 2)
  );

  for (const monitor of monitors) {
    for (const version of monitor.versions) {
      const baseName =
        `${safeName(monitor.id)}-${safeName(version)}`;

      const currentImage = `current-${baseName}.png`;
      const previousImage = `previous-${baseName}.png`;

      if (fs.existsSync(currentImage)) {
        fs.copyFileSync(
          currentImage,
          previousImage
        );
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        changed: changedVersions.length > 0,
        changedVersions,
        currentResults
      },
      null,
      2
    )
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});