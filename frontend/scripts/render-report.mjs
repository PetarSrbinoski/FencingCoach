import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const [input, output, layout] = process.argv.slice(2);
if (!input || !output) throw new Error("Expected input HTML and output PDF paths");
if (layout && layout !== "formal") throw new Error(`Unknown PDF layout: ${layout}`);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(input).href, { waitUntil: "load" });
  await page.pdf({
    path: output,
    format: "A4",
    printBackground: true,
    margin: layout === "formal"
      ? { top: "17mm", bottom: "18mm", left: "17mm", right: "17mm" }
      : { top: "12mm", bottom: "16mm", left: "12mm", right: "12mm" },
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: layout === "formal"
      ? '<div style="font:10px Georgia,serif;color:#444;width:100%;text-align:center"><span class="pageNumber"></span></div>'
      : '<div style="font:8px sans-serif;color:#5b6874;width:100%;text-align:center">FencingCoach testing · <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
  });
} finally {
  await browser.close();
}
