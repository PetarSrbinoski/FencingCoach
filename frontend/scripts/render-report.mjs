import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Expected input HTML and output PDF paths");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(input).href, { waitUntil: "load" });
  await page.pdf({
    path: output,
    format: "A4",
    printBackground: true,
    margin: { top: "12mm", bottom: "16mm", left: "12mm", right: "12mm" },
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: '<div style="font:8px sans-serif;color:#5b6874;width:100%;text-align:center">FencingCoach testing · <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
  });
} finally {
  await browser.close();
}
