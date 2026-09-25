"""Render the editable Macedonian testing documentation to an academic PDF."""

from __future__ import annotations

import subprocess
from pathlib import Path

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/testing/Dokumentacija_za_testiranje_FencingCoach.md"
HTML = ROOT / "docs/testing/.documentation-render.html"
PDF = ROOT / "docs/testing/Dokumentacija_za_testiranje_FencingCoach.pdf"

CSS = """
@page { size: A4; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: 'Liberation Serif', 'DejaVu Serif', serif;
       color: #171717; font-size: 10pt; line-height: 1.32; text-align: justify; }
.cover, .contents { break-after: page; page-break-after: always; }
.cover { height: 248mm; position: relative; text-align: center; }
.institution { font-size: 11.2pt; line-height: 1.25; padding-top: 8mm; }
.cover-title { font-size: 22pt; line-height: 1.23; margin-top: 43mm; }
.cover-title strong { font-weight: bold; }
.cover-subtitle { font-size: 15pt; margin-top: 5mm; }
.cover-people { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm;
                margin-top: 40mm; text-align: left; font-size: 11pt; line-height: 1.6; }
.cover-links { margin-top: 38mm; text-align: left; font-size: 10.3pt; line-height: 1.6; }
.cover-date { position: absolute; bottom: 0; left: 0; right: 0; font-size: 10pt; }
.contents { min-height: 248mm; }
.contents h1 { font-size: 17pt; border-bottom: 1px solid #2a68ab; padding-bottom: 5pt;
               margin: 0 0 16pt; }
.contents h2 { font-size: 12pt; margin: 14pt 0 8pt; }
.contents p { font-size: 10pt; }
.contents-note { margin-top: 16pt; color: #414b55; }
h1 { font-size: 14pt; line-height: 1.2; margin: 15pt 0 7pt; break-after: avoid; }
h1.page-start { break-before: page; page-break-before: always; margin-top: 0; }
h2 { font-size: 11.5pt; line-height: 1.2; margin: 12pt 0 6pt; break-after: avoid; }
p { margin: 0 0 8pt; orphans: 3; widows: 3; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 7pt 0 12pt;
        font-size: 9.1pt; line-height: 1.24; text-align: left; }
th, td { border: 1px solid #cbd5df; padding: 4.5pt 5.5pt; vertical-align: top;
         overflow-wrap: anywhere; }
th { background: #1d3553; color: white; font-weight: bold; text-align: center; }
tbody tr:nth-child(even) { background: #eef6fc; }
tr { break-inside: avoid; }
.contents-table th:first-child, .contents-table td:first-child { width: 19%; text-align: center; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f2f4f6;
      padding: 7pt; font-size: 8.5pt; break-inside: avoid; }
code { font-family: 'DejaVu Sans Mono', monospace; font-size: 8.2pt; }
a { color: #1b57a1; text-decoration: underline; }
"""


def main() -> None:
    rendered = MarkdownIt("commonmark").enable("table").render(SOURCE.read_text())
    HTML.write_text(
        '<!doctype html><html lang="mk"><head><meta charset="utf-8">'
        '<title>Документација за тестирање на FencingCoach</title>'
        f"<style>{CSS}</style></head><body>{rendered}</body></html>"
    )
    try:
        subprocess.run(
            ["node", str(ROOT / "frontend/scripts/render-report.mjs"), str(HTML), str(PDF), "formal"],
            cwd=ROOT,
            check=True,
        )
    finally:
        HTML.unlink(missing_ok=True)
    print(PDF)


if __name__ == "__main__":
    main()
