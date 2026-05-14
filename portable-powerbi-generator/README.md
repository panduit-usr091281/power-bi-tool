# Power BI Generator Portable

This folder contains the browser-only Power BI generator as a standalone shareable bundle.

## What to send

Send the entire `portable-powerbi-generator` folder, not just `index.html`.

## How to use

1. Keep all files in this folder together.
2. Open `index.html` in a modern Chromium-based browser such as Microsoft Edge or Google Chrome.
3. Stay connected to the internet while using it. The page loads SheetJS, JSZip, and FileSaver from public CDNs.
4. Upload an `.xlsx` or `.xls` workbook.
5. Enter the workbook's real Windows file path before generating the `.pbit`.

## Included files

- `index.html`
- `styles-prompt-builder.css`
- `styles-powerbi-builder.css`
- `powerbi-excel-parser.js`
- `powerbi-relationship-detector.js`
- `powerbi-pbit-generator.js`
- `powerbi-app-controller.js`

## Notes

- This portable bundle does not require the rest of the repository.
- It is intended for browser use only.
- If you need a fully offline version later, the CDN libraries should be bundled locally in a separate offline package.
