# Power BI Generator Hosted Site

This `docs` folder contains a host-ready static site version of the browser-only Power BI generator.

## What it does

- Uploads an `.xlsx` or `.xls` workbook in the browser
- Detects tables and likely relationships
- Builds and downloads a `.pbit` template
- Requires no server-side code

## Important limitation

The browser can read the uploaded workbook contents, but it cannot discover the workbook's real local Windows file path. Users must still type the actual workbook path before generating the `.pbit`, so Power BI Desktop can reconnect to the source when the template opens.

## Hosting options

### GitHub Pages

1. Push this repository to GitHub.
2. Enable GitHub Actions for the repository if needed.
3. Run or allow the included Pages workflow to deploy the `docs` folder.
4. Open the published Pages URL.

### Any static host

Upload the contents of the `docs` folder to any static web host, such as Azure Static Web Apps, Netlify, or an internal web server.

## Runtime requirements

- Modern Chromium-based browser such as Edge or Chrome
- Internet access for CDN-hosted SheetJS, JSZip, and FileSaver libraries

## Files in this hosted site

- `index.html`
- `styles-prompt-builder.css`
- `styles-powerbi-builder.css`
- `powerbi-excel-parser.js`
- `powerbi-relationship-detector.js`
- `powerbi-pbit-generator.js`
- `powerbi-app-controller.js`

## Optional next step

If you need the hosted page to work with no internet access, replace the CDN script references with local copies of those libraries and deploy the same `docs` folder again.
