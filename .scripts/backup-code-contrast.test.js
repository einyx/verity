/** Local-only rendered CSS regression. All content is synthetic; no authentication or API calls. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compile } from "sass";

const require = createRequire(
  new URL("../packages/integration-tests/package.json", import.meta.url),
);
const puppeteer = require("puppeteer");
const root = fileURLToPath(new URL("../", import.meta.url));
const experience = `${root}packages/experience/src/`;
const panels = [
  "packages/experience/src/pages/MfaBinding/BackupCodeBinding/index.module.scss",
  "packages/account/src/pages/BackupCodeBinding/index.module.scss",
  "packages/account/src/pages/BackupCodeView/index.module.scss",
];
const importer = {
  findFileUrl(url) {
    if (url.startsWith("@/"))
      return new URL(url.slice(2), `file://${experience}`);
    if (url.startsWith("@experience/")) {
      return new URL(url.slice("@experience/".length), `file://${experience}`);
    }
    return null;
  },
};
const normalized = compile(`${experience}shared/scss/normalized.scss`).css;
const contrast = (foreground, background) => {
  const luminance = (value) => {
    const channels = value
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((channel) => {
        const s = channel / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
};

test("backup-code panels retain readable paired colors across themes and narrow layouts", async (context) => {
  const browser = await puppeteer.launch({
    executablePath:
      process.env.CHROME_BIN ||
      (existsSync(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      )
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
    headless: true,
    args: ["--disable-background-networking"],
  });
  try {
    const page = await browser.newPage();
    const client = await page.createCDPSession();
    await page.setRequestInterception(true);
    page.on("request", (request) => void request.abort());
    for (const panel of panels) {
      const css = compile(`${root}${panel}`, {
        importers: [importer],
      }).css.replaceAll(":global(body.mobile)", "body.mobile");
      await page.setContent(`<html data-theme="light"><head><style>${normalized}${css}
        /* Simulate branding overriding generic text/surface tokens independently. */
        .container { width: 100%; max-width: 400px; padding: 16px; }
        </style></head><body class="mobile" style="--color-type-primary: #f7f8f8; --color-bg-light: #eff1f1"><div class="container">
        <div class="backupCodes"><span>DEMO-ONLY-0001</span><span class="used">DEMO-ONLY-0002</span></div>
        <button>Copy (synthetic fixture, no handler)</button></div></body></html>`);
      for (const theme of ["light", "dark", "light"]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        for (const width of [400, 320, 200]) {
          await page.setViewport({ width, height: 700 });
          for (const focused of [false, true]) {
            if (focused) await page.focus("button");
            else await page.$eval("button", (element) => element.blur());
            const result = await page.evaluate(() => {
              const panel = document.querySelector(".backupCodes");
              const style = getComputedStyle(panel);
              const spans = [...panel.querySelectorAll("span")];
              const selection = getComputedStyle(spans[0], "::selection");
              return {
                foregrounds: spans.map((span) => getComputedStyle(span).color),
                background: style.backgroundColor,
                selectedForeground: selection.color,
                selectedBackground: selection.backgroundColor,
                unclipped: spans.every(
                  (span) => span.scrollWidth <= span.clientWidth,
                ),
                pageFits:
                  document.documentElement.scrollWidth <= window.innerWidth,
                text: spans.map((span) => span.textContent).join("\n"),
                forcedColorAdjust: style.forcedColorAdjust,
              };
            });
            for (const foreground of result.foregrounds) {
              assert.ok(
                contrast(foreground, result.background) >= 4.5,
                `${panel} ${theme}: ${foreground} on ${result.background}`,
              );
            }
            assert.equal(
              result.foregrounds[0],
              theme === "light" ? "rgb(25, 28, 29)" : "rgb(247, 248, 248)",
            );
            assert.equal(
              result.background,
              theme === "light" ? "rgb(239, 241, 241)" : "rgb(45, 49, 50)",
            );
            assert.ok(
              contrast(result.selectedForeground, result.selectedBackground) >=
                4.5,
            );
            assert.ok(
              result.unclipped,
              `${panel}: codes must reflow without clipping`,
            );
            assert.ok(
              result.pageFits,
              `${panel}: page must not overflow at ${width}px`,
            );
            assert.equal(result.text, "DEMO-ONLY-0001\nDEMO-ONLY-0002");
            assert.notEqual(result.forcedColorAdjust, "none");
            if (width === 400 && !focused) {
              context.diagnostic(
                `${panel} ${theme}: ${contrast(result.foregrounds[0], result.background).toFixed(2)}:1`,
              );
            }
          }
          // A real text selection must not change, truncate, or reformat the exported text.
          const selected = await page.$eval(".backupCodes span", (element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            return selection.toString();
          });
          assert.equal(selected, "DEMO-ONLY-0001");
          await page.evaluate(() => window.getSelection().removeAllRanges());
        }
        // Exercise layout scaling as well as the narrow CSS viewport equivalent of 400% zoom.
        await page.setViewport({ width: 1280, height: 900 });
        for (const zoom of [1, 2, 4]) {
          const fits = await page.evaluate((value) => {
            document.body.style.zoom = String(value);
            return (
              document.documentElement.scrollWidth <= window.innerWidth &&
              [...document.querySelectorAll(".backupCodes span")].every(
                (span) => span.scrollWidth <= span.clientWidth,
              )
            );
          }, zoom);
          assert.ok(
            fits,
            `${panel} ${theme}: codes must fit at ${zoom * 100}% layout zoom`,
          );
        }
        await page.evaluate(() => {
          document.body.style.zoom = "1";
        });
        if (process.env.MFA_CONTRAST_SCREENSHOT_DIR) {
          await page.setViewport({ width: 400, height: 700 });
          await page.screenshot({
            path: `${process.env.MFA_CONTRAST_SCREENSHOT_DIR}/${panels.indexOf(panel)}-${theme}.png`,
          });
        }
      }
      await client.send("Emulation.setEmulatedMedia", {
        features: [{ name: "forced-colors", value: "active" }],
      });
      const forced = await page.$eval(".backupCodes", (element) => {
        const spans = [...element.querySelectorAll("span")];
        return {
          colors: spans.map((span) => getComputedStyle(span).color),
          background: getComputedStyle(element).backgroundColor,
          selection: spans.map((span) => ({
            color: getComputedStyle(span, "::selection").color,
            background: getComputedStyle(span, "::selection").backgroundColor,
          })),
        };
      });
      for (const color of forced.colors)
        assert.ok(contrast(color, forced.background) >= 4.5);
      for (const selection of forced.selection)
        assert.ok(contrast(selection.color, selection.background) >= 4.5);
      await client.send("Emulation.setEmulatedMedia", { features: [] });
    }
  } finally {
    await browser.close();
  }
});
