# Power BI Generator

Converts Excel files (`.xlsx`) into Power BI Templates (`.pbit`) — available as both a **browser-based UI** and a **Python CLI**.

## Features

- All sheets imported as separate tables with auto-detected column types
- Relationships between tables auto-detected (column name matching, FK patterns, data overlap analysis)
- Basic DAX measures generated for numeric columns
- Date dimension table created when date columns exist
- Power Query M expressions pre-configured to load from the Excel source
- `ExcelFilePath` parameter so the connection can be updated after download

## Two Ways to Use

### Option A: Browser UI (no install required)

Open `powerbi-builder.html` in any modern browser. This is the same interface as the Data Visualization Prompt Builder.

1. Drag & drop your `.xlsx` file
2. Review detected tables, column types, and relationships
3. Add or remove relationships manually if needed
4. Click **Generate & Download .pbit**
5. Open the downloaded file in Power BI Desktop

The browser version uses [SheetJS](https://sheetjs.com/), [JSZip](https://stuk.github.io/jszip/), and [FileSaver.js](https://github.com/nickstenning/FileSaver.js) — all loaded from CDN, no server needed.

### Option B: Python CLI

```bash
cd powerbi-generator
pip install -r requirements.txt
python excel_to_powerbi.py <your-file.xlsx> [output.pbit]
```

If no output path is specified, the `.pbit` file is created alongside the input file.

## How It Works

### Table Detection
Each sheet in the Excel workbook becomes a table in the Power BI model. The first row is treated as headers.

### Relationship Detection
The tool uses three strategies to find relationships:

1. **Exact Name Match** — Columns with the same name across tables (e.g., `CustomerID` in both `Orders` and `Customers`)
2. **FK Pattern Match** — Columns named like `{TableName}ID` or `{TableName}_id` (e.g., `CustomerID` in `Orders` linking to the `Customers` table)
3. **Data Overlap Validation** — Candidate relationships are validated by checking that values actually overlap between the two columns (>=30% match required)

Cardinality (one-to-many, one-to-one, many-to-many) is determined by analyzing column uniqueness.

### Generated Measures
For each numeric column, a `Total {ColumnName}` SUM measure is created. A `Count of Records` measure is added to the first table with numeric data.

### Date Table
If any date columns are detected, a `DateTable` calculated table is generated spanning 2020-2030 with Year, Month, Quarter, and Day breakdowns.

## File Structure

```
Data Visualization Tool/
├── powerbi-builder.html              # Browser UI entry point
├── powerbi-app-controller.js          # Browser UI controller
├── powerbi-excel-parser.js            # Browser Excel parser (SheetJS)
├── powerbi-relationship-detector.js   # Browser relationship detection
├── powerbi-pbit-generator.js          # Browser .pbit generation (JSZip)
├── styles-powerbi-builder.css         # Browser UI styles
├── visualization-prompt-builder.html  # Prompt Builder (linked)
│
└── powerbi-generator/                 # Python CLI version
    ├── excel_to_powerbi.py            # CLI entry point
    ├── relationship_detector.py       # Relationship detection
    ├── pbit_generator.py              # .pbit file generation
    ├── requirements.txt               # Python dependencies (pandas, openpyxl)
    ├── test_generator.py              # Functional test with sample data
    ├── stress_test.py                 # 29-test stress test suite
    ├── QUICKSTART.md                  # Step-by-step quick start guide
    └── README.md                      # This file
```

## Example

Given an Excel file with sheets:
- **Customers** (CustomerID, Name, Region)
- **Orders** (OrderID, CustomerID, OrderDate, Amount)
- **Products** (ProductID, ProductName, Category, Price)
- **OrderDetails** (OrderDetailID, OrderID, ProductID, Quantity)

The generator will:
1. Create 4 tables in the Power BI model
2. Detect relationships:
   - `Orders.CustomerID` -> `Customers.CustomerID` (many-to-one)
   - `OrderDetails.OrderID` -> `Orders.OrderID` (many-to-one)
   - `OrderDetails.ProductID` -> `Products.ProductID` (many-to-one)
3. Generate measures like `Total Amount`, `Total Price`, `Total Quantity`
4. Create a DateTable linked to `Orders.OrderDate`

## Testing

The stress test suite covers 29 tests across 5 categories:

```bash
cd powerbi-generator
python stress_test.py
```

| Category | Tests | What's covered |
|----------|-------|----------------|
| Scale | 5 | 10K-100K rows, 50 columns, 15 sheets |
| Edge Cases | 10 | Empty sheets, nulls, unicode, mixed types, special chars, booleans |
| Relationships | 6 | Star schema, FK patterns, chains, many-to-many, no-match |
| Integrity | 6 | ZIP structure, UTF-16LE encoding, measures, parameters, DateTable |
| Performance | 2 | 100K rows under 15s, 10-table detection under 5s |

All 29 tests pass.

## Limitations

- The `.pbit` template requires Power BI Desktop to open and refresh data
- Very large Excel files (>100MB) may be slow to analyze
- Complex multi-level headers in Excel are not supported (use flat headers)
- Many-to-many relationships require Power BI composite models to work properly

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "File path not found" on open | Update the ExcelFilePath parameter in Power BI to point to your Excel file |
| Missing relationships | Check that column names match between tables, or add relationships manually in Model view |
| Wrong data types | Adjust types in Power Query Editor after opening the template |
| Import errors | Ensure sheet names in Excel match the table names (no special characters) |
| Browser: nothing downloads | Check that popups/downloads are not blocked; try a different browser |
