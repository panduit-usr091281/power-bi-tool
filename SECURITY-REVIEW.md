# Security Review — Data Visualization Tool

**Review Date:** May 21, 2026  
**Reviewer:** Claude Opus 4.6 (AI-assisted deep security analysis)  
**Scope:** Full codebase — JavaScript (browser), Python (CLI), HTML/CSS, hosted deployment  

---

## 0. Executive Summary — Security Code Review

### Overall Risk Rating: **LOW**

The Data Visualization Tool is a **client-side-only** application with no backend server, no database, no authentication system, and no network API calls (beyond loading CDN libraries). The attack surface is inherently narrow.

**No critical or high-severity vulnerabilities were identified.**

| Category | Finding |
|----------|---------|
| XSS (Cross-Site Scripting) | ✅ Mitigated — `escapeHtml()` used consistently on all user data before DOM insertion |
| Injection (SQL/Command/Code) | ✅ N/A — No database, no shell commands, no `eval()` |
| Sensitive Data Exposure | ✅ No secrets, keys, tokens, or credentials in codebase |
| Insecure Dependencies | ⚠️ Low — CDN libraries without SRI hashes (see §3) |
| File Upload Handling | ⚠️ Low — No file size cap in browser (DoS-self only) |
| Prototype Pollution | ✅ N/A — No deep-merge of untrusted objects |
| SSRF/Network Attacks | ✅ N/A — No server-side code, no outbound requests |

---

## 1. Security Context

### 1.1 Deployment Model

| Aspect | Description |
|--------|-------------|
| **Architecture** | Static client-side web application (HTML + JS + CSS). Optional Python CLI tool. |
| **Hosting** | GitHub Pages, Azure Static Web Apps, or any static file server. No backend. |
| **Server-side processing** | None. All logic executes in the browser or locally via Python CLI. |
| **Database** | None. |
| **Authentication** | None required — tool is stateless and processes only local files. |
| **Network calls** | None, except CDN script loads at page load time. |

### 1.2 Intended Users

| User Role | Description |
|-----------|-------------|
| **Primary** | Internal data analysts, business intelligence developers, report creators at Panduit Corporation |
| **Secondary** | Other technical staff who need to convert Excel data into Power BI templates |
| **Access level** | Users who already have legitimate access to the Excel data they're processing |

### 1.3 Secrets & Proprietary Content

| Item | Present? | Notes |
|------|----------|-------|
| API keys/tokens | ❌ No | No external APIs used |
| Database credentials | ❌ No | No database |
| Proprietary algorithms | ⚠️ Minimal | Relationship detection heuristics are novel but not trade-secret level |
| User data persistence | ❌ No | Nothing stored — all processing is ephemeral in-browser |
| PII handling | ⚠️ Indirect | Excel files may contain PII, but the tool does not store, transmit, or log it |

### 1.4 Data Classification

- **Input data**: Excel workbooks (potentially containing business-sensitive or PII data)
- **Output data**: `.pbit` template files (contain schema metadata and sample data)
- **In-transit**: No data leaves the user's machine (browser-only processing)
- **At-rest**: No data persisted by the application

---

## 2. Threat Model

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER'S MACHINE                                │
│                                                                     │
│  ┌──────────────┐    ┌───────────────────────────────────────────┐  │
│  │  Excel File  │───▶│  BROWSER (Chrome/Edge)                    │  │
│  │  (.xlsx)     │    │                                           │  │
│  └──────────────┘    │  ┌─────────────────────────────────────┐  │  │
│                      │  │  Static HTML/JS Application          │  │  │
│                      │  │                                     │  │  │
│                      │  │  ┌──────────────┐ ┌──────────────┐  │  │  │
│                      │  │  │ ExcelParser  │ │ Relationship │  │  │  │
│                      │  │  │ (SheetJS)    │ │ Detector     │  │  │  │
│                      │  │  └──────┬───────┘ └──────┬───────┘  │  │  │
│                      │  │         │                 │          │  │  │
│                      │  │         ▼                 ▼          │  │  │
│                      │  │  ┌──────────────────────────────┐   │  │  │
│                      │  │  │  PbitGenerator (JSZip)       │   │  │  │
│                      │  │  └──────────────┬───────────────┘   │  │  │
│                      │  │                 │                    │  │  │
│                      │  └─────────────────┼────────────────────┘  │  │
│                      │                    ▼                       │  │
│                      │             ┌────────────┐                │  │
│                      │             │  Download  │                │  │
│                      │             │  .pbit     │                │  │
│                      │             └────────────┘                │  │
│                      └───────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  PYTHON CLI (alternative)                                    │   │
│  │  excel_to_powerbi.py → pbit_generator.py → output.pbit      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

         ╔═══════════════════════════════════════╗
         ║   EXTERNAL (Internet, page load only) ║
         ║                                       ║
         ║  cdn.sheetjs.com  (SheetJS v0.20.3)  ║
         ║  cdnjs.cloudflare.com (JSZip v3.10.1)║
         ║  cdnjs.cloudflare.com (FileSaver 2.0) ║
         ╚═══════════════════════════════════════╝
```

### 2.2 Data Flow Diagram

```
┌──────────┐         ┌────────────────┐         ┌─────────────────┐
│  USER    │──(1)──▶ │  File Upload   │──(2)──▶ │  ExcelParser    │
│          │         │  (FileReader)  │         │  (SheetJS)      │
└──────────┘         └────────────────┘         └────────┬────────┘
                                                         │
                                                    (3) parsed tables
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │ Relationship    │
                                                │ Detector        │
                                                └────────┬────────┘
                                                         │
                                                    (4) relationships[]
                                                         │
         ┌──────────┐         ┌──────────────┐          │
         │  USER    │◀──(6)── │ FileSaver.js │◀──(5)────┘
         │(download)│         │ (blob→file)  │   PbitGenerator
         └──────────┘         └──────────────┘   (JSZip → blob)
```

**Data Flow Legend:**

| # | Flow | Data | Trust Boundary Crossed? |
|---|------|------|------------------------|
| 1 | User → Browser | Excel file (binary) | Yes — untrusted user input enters application |
| 2 | FileReader → SheetJS | ArrayBuffer | No — same browser context |
| 3 | SheetJS → App Logic | Parsed table objects | No — same context, but data is sanitized here |
| 4 | Detector → Generator | Relationship metadata | No — internal |
| 5 | Generator → Blob | ZIP binary | No — internal |
| 6 | Browser → User download | .pbit file | Yes — output leaves application to file system |

**External Data Flows (page load only):**

| Flow | Direction | Data | Purpose |
|------|-----------|------|---------|
| CDN → Browser | Inbound | JavaScript libraries | SheetJS, JSZip, FileSaver |

### 2.3 Trust Boundaries

1. **User Input Boundary** — Where user-supplied Excel file enters the application
2. **CDN Boundary** — Where third-party JavaScript is loaded and executed
3. **Output Boundary** — Where generated .pbit file is delivered to the user's filesystem

---

## 3. Threat Analysis (STRIDE Model)

### 3.1 Spoofing

| Threat | Risk | Analysis |
|--------|------|----------|
| CDN compromise / supply-chain attack | **Medium** | If `cdn.sheetjs.com` or `cdnjs.cloudflare.com` is compromised, malicious JS could execute in the user's browser with full page access. No Subresource Integrity (SRI) hashes are present. |
| Fake/phishing deployment | **Low** | An attacker could host a modified version of this tool. Mitigated by deploying to a trusted internal domain. |

### 3.2 Tampering

| Threat | Risk | Analysis |
|--------|------|----------|
| Malicious Excel file crafted to exploit SheetJS | **Low** | SheetJS is a mature library. However, a zero-day in the parser could allow unexpected behavior. The tool does not execute any formula or macro content. |
| Modified CDN library | **Medium** | Same as supply-chain attack above. No SRI hashes to detect tampering. |
| Generated .pbit contains injected M code | **Very Low** | All M language strings are escaped via `escapeMString()` / `_escape_m_string()`. Template output is deterministic from sanitized inputs. |

### 3.3 Repudiation

| Threat | Risk | Analysis |
|--------|------|----------|
| No audit logging | **Informational** | The tool has no logging. Since it's a local tool with no multi-user state, repudiation threats are not applicable. |

### 3.4 Information Disclosure

| Threat | Risk | Analysis |
|--------|------|----------|
| Excel data visible in browser memory | **Low** | Standard for any web app processing data. Cleared on page reload. |
| .pbit output contains source data samples | **Low** | By design — the .pbit includes schema and reference to source path. Users should understand this. |
| Source Excel path embedded in .pbit | **Low** | User explicitly provides this. Could reveal internal directory structure if .pbit is shared externally. |
| CDN requests reveal usage | **Very Low** | CDN logs could show that someone loaded these libraries, but no data is transmitted. |

### 3.5 Denial of Service

| Threat | Risk | Analysis |
|--------|------|----------|
| Extremely large Excel file crashes browser tab | **Low** | No file size validation. A 500MB+ file could exhaust browser memory. Self-DoS only (single-user tool). |
| Malformed Excel with thousands of sheets | **Very Low** | Would slow processing. Not exploitable by a remote attacker. |

### 3.6 Elevation of Privilege

| Threat | Risk | Analysis |
|--------|------|----------|
| XSS via crafted Excel content | **Very Low** | All user data is passed through `escapeHtml()` before DOM insertion. Sheet names, column names, and cell values are all escaped. |
| Prototype pollution via parsed data | **Very Low** | No `Object.assign` with deep merge from untrusted sources. SheetJS returns plain arrays/objects. |
| Code execution via Excel formulas | **Not Applicable** | SheetJS `cellDates: true` mode processes values, not formulas. No `eval()` anywhere. |

---

## 4. Recommendations

### Priority 1 — Recommended (Medium-Effort Improvements)

#### 4.1 Add Subresource Integrity (SRI) Hashes to CDN Scripts

**Risk mitigated:** Supply-chain attack / CDN compromise  
**Current state:** CDN scripts loaded without integrity verification  
**Impact if exploited:** Full XSS in context of the application page

```html
<!-- BEFORE (current) -->
<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"></script>

<!-- AFTER (recommended) -->
<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"
        integrity="sha384-<HASH>" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
        integrity="sha384-<HASH>" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"
        integrity="sha384-<HASH>" crossorigin="anonymous"></script>
```

> Generate actual hashes with: `shasum -b -a 384 <file> | xxd -r -p | base64`  
> Or retrieve from cdnjs.com which publishes SRI hashes for each version.

#### 4.2 Add Content Security Policy (CSP) Meta Tag

**Risk mitigated:** XSS, unauthorized script execution  
**Applicable when:** Hosted on GitHub Pages or internal web server

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' https://cdn.sheetjs.com https://cdnjs.cloudflare.com; 
               style-src 'self' 'unsafe-inline'; 
               img-src 'self' data:; 
               connect-src 'none';">
```

This policy:
- Blocks inline scripts (prevents reflected XSS)
- Restricts script sources to known CDNs
- Blocks all network requests (`connect-src 'none'`)
- Prevents loading resources from unexpected origins

#### 4.3 Add File Size Validation (Browser)

**Risk mitigated:** Browser tab crash from oversized files

```javascript
function handleFile(file) {
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
    if (file.size > MAX_FILE_SIZE) {
        alert('File is too large. Maximum supported size is 100 MB. Use the Python CLI for larger files.');
        return;
    }
    if (!file.name.match(/\.xlsx?$/i)) {
        alert('Please upload an .xlsx or .xls file.');
        return;
    }
    // ... rest of handler
}
```

### Priority 2 — Good Practice (Low-Effort Hardening)

#### 4.4 Pin CDN Library Versions (Already Done ✅)

The codebase already pins specific versions (SheetJS 0.20.3, JSZip 3.10.1, FileSaver 2.0.5). This is good practice.

#### 4.5 Consider Bundling Libraries Locally

For air-gapped or high-security deployments, bundle the three CDN libraries locally to eliminate all external dependencies:

```
docs/
  lib/
    xlsx.full.min.js
    jszip.min.js
    FileSaver.min.js
```

This eliminates the CDN trust boundary entirely.

#### 4.6 Add `X-Content-Type-Options` Header (Server Configuration)

If hosting on a server you control, add:
```
X-Content-Type-Options: nosniff
```

This prevents MIME-type sniffing attacks on served files.

#### 4.7 Document the Source-Path Disclosure

The `.pbit` output embeds the user-specified Excel file path (e.g., `C:\Users\jsmith\Data\Sales.xlsx`). If `.pbit` files are shared externally, this reveals internal directory structure. Consider adding a UI warning:

> "The file path you enter will be embedded in the .pbit template. Avoid including sensitive directory names if you plan to share this template externally."

### Priority 3 — Informational (No Action Required)

#### 4.8 No Server-Side Threats

Since there is no backend server, the following OWASP Top 10 categories are **not applicable**:
- A01 Broken Access Control — No access control needed (local tool)
- A02 Cryptographic Failures — No data encryption needed (no transit/storage)
- A07 Identification & Authentication Failures — No auth system
- A08 Software & Data Integrity Failures — Partially applicable (CDN, addressed above)
- A09 Security Logging & Monitoring — No server to monitor
- A10 Server-Side Request Forgery — No server-side code

#### 4.9 Python CLI — Minimal Additional Surface

The Python CLI (`excel_to_powerbi.py`) adds minimal attack surface:
- Takes file path as command-line argument (validated with `os.path.isfile()`)
- Uses only `pandas`, `openpyxl`, and standard library
- No network calls, no shell commands, no `eval()`/`exec()`
- Output path is derived from input or explicitly specified
- No path traversal risk — paths are used only for reading/writing specific files

---

## 5. Risk Summary Matrix

| # | Threat | Likelihood | Impact | Risk Level | Mitigation |
|---|--------|-----------|--------|------------|------------|
| 1 | CDN supply-chain compromise | Low | High | **Medium** | Add SRI hashes + CSP (§4.1, §4.2) |
| 2 | XSS via crafted Excel data | Very Low | Medium | **Low** | Already mitigated by `escapeHtml()` |
| 3 | Browser memory exhaustion (large file) | Low | Low | **Low** | Add file size cap (§4.3) |
| 4 | Source path disclosure in .pbit | Low | Low | **Low** | Document behavior (§4.7) |
| 5 | SheetJS zero-day exploit | Very Low | Medium | **Low** | Keep library updated; consider local bundle |
| 6 | Phishing via fake deployment | Very Low | Medium | **Low** | Host on trusted internal domain |

---

## 6. Conclusion

This application has an **inherently minimal attack surface** due to its architecture:

- **No server** = No server-side vulnerabilities
- **No database** = No injection attacks
- **No authentication** = No credential theft
- **No network API calls** = No SSRF, no data exfiltration by the app
- **No data persistence** = No stored data to breach

The primary residual risk is **CDN supply-chain compromise** (Threat #1), which is easily mitigated by adding SRI hashes to the three `<script>` tags. All other findings are low or informational.

The codebase demonstrates strong security hygiene:
- Consistent use of `escapeHtml()` for XSS prevention
- Input validation at system boundaries
- No dangerous patterns (`eval`, `innerHTML` with raw data, `document.write`)
- Proper string escaping for generated M language code
- Comprehensive error handling

**Recommended immediate action:** Add SRI integrity attributes to the CDN script tags in both [powerbi-builder.html](powerbi-builder.html) and [docs/index.html](docs/index.html).
