"""Render the editable testing report to an A4 PDF with local evidence links."""

from __future__ import annotations

import subprocess
from pathlib import Path

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "docs/testing/report.md"
HTML = ROOT / "docs/testing/.report-render.html"
PDF = ROOT / "docs/testing/report.pdf"

CSS = """
@page { size: A4; margin: 12mm 12mm 16mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'DejaVu Sans', Arial, sans-serif; font-size: 9.0pt;
       line-height: 1.36; color: #16202a; }
h1 { font-size: 17pt; line-height: 1.2; color: #14293f; margin: 0 0 13pt; }
h2 { font-size: 12.5pt; color: #183c60; margin: 18pt 0 7pt;
     border-bottom: 1px solid #bccbd9; padding-bottom: 3pt; break-after: avoid; }
h2:nth-of-type(5) { break-before: page; }
p, ul { margin: 0 0 8pt; }
li { margin-bottom: 3pt; }
pre, table, blockquote { break-inside: avoid; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f2f5f8;
      padding: 8pt; font-size: 8pt; }
code { font-family: 'DejaVu Sans Mono', monospace; font-size: 8.4pt; }
table { border-collapse: collapse; width: 100%; table-layout: fixed;
        margin: 8pt 0 12pt; font-size: 7.7pt; }
th, td { border: 1px solid #bfccd7; padding: 4pt; vertical-align: top;
         overflow-wrap: anywhere; }
th { background: #e9f0f6; text-align: left; }
a { color: #1d5684; text-decoration: none; }
"""


def main() -> None:
    rendered = MarkdownIt("commonmark").enable("table").render(REPORT.read_text())
    HTML.write_text(
        '<!doctype html><html lang="mk"><head><meta charset="utf-8">'
        f"<style>{CSS}</style></head><body>{rendered}</body></html>"
    )
    try:
        subprocess.run(
            ["node", str(ROOT / "frontend/scripts/render-report.mjs"), str(HTML), str(PDF)],
            check=True,
            cwd=ROOT,
        )
    finally:
        HTML.unlink(missing_ok=True)
    print(PDF)


if __name__ == "__main__":
    main()
