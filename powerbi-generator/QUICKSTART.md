# Quick Start Guide — Excel to Power BI Generator

Two ways to generate a `.pbit` file from your Excel data — pick whichever fits your workflow.

---

## Option A: Browser UI (fastest, no install)

### Step 1: Open the tool

Open `powerbi-builder.html` in any modern browser (Chrome, Edge, Firefox). No server or install needed.

### Step 2: Upload your Excel file

Drag and drop your `.xlsx` file onto the upload area (or click to browse). Each sheet becomes a table.

### Step 3: Review what was detected

- **Tables** — Each sheet is shown as a card with column names, data types, and a data preview
- **Relationships** — Auto-detected links between tables are listed with cardinality and confidence scores
- **Edit** — Remove incorrect relationships with the X button, or click **+ Add Relationship** to add your own

### Step 4: Set options and generate

- Enter the **Excel file path** that Power BI should use to load data (e.g. `C:\Data\my-file.xlsx`)
- Toggle DAX measures and Date table generation on/off
- Click **Generate & Download .pbit** — the file saves to your downloads folder

### Step 5: Open in Power BI Desktop

1. Double-click the `.pbit` file — Power BI Desktop opens
2. Confirm or update the Excel file path when prompted
3. Click **Load** — tables, relationships, and measures are ready

---

## Option B: Python CLI

### Prerequisites

- **Python 3.8+** installed
- **Power BI Desktop** installed ([free download](https://powerbi.microsoft.com/desktop/))

### Step 1: Install Dependencies

Open a terminal in the `powerbi-generator` folder and run:

```bash
pip install -r requirements.txt
```

This installs `pandas` and `openpyxl`.

### Step 2: Prepare Your Excel File

Your `.xlsx` file should follow these rules:

| Rule | Example |
|------|---------|
| Each sheet = one table | Sheets named `Customers`, `Orders`, `Products` |
| First row = column headers | `CustomerID`, `Name`, `Region` |
| No merged cells | Each cell stands alone |
| Consistent data per column | Don't mix dates and text in one column |

**Tip:** Name columns with matching IDs across sheets for automatic relationship detection:
- `Orders` sheet has a `CustomerID` column
- `Customers` sheet has a `CustomerID` column
- The tool links them automatically

### Step 3: Generate the .pbit File

```bash
python excel_to_powerbi.py my-data.xlsx
```

You'll see output like:

```
Reading Excel file: my-data.xlsx
Found 3 table(s): Customers, Orders, Products

Detecting relationships...
Found 2 relationship(s):
  Orders.CustomerID -> Customers.CustomerID (manyToOne)
  Orders.ProductID -> Products.ProductID (manyToOne)

Generating Power BI Template: my-data.pbit

Done! Open 'my-data.pbit' in Power BI Desktop.
```

To specify a custom output name:

```bash
python excel_to_powerbi.py my-data.xlsx dashboard.pbit
```

### Step 4: Open in Power BI Desktop

1. Double-click the generated `.pbit` file — it opens in Power BI Desktop
2. A dialog appears asking for the **ExcelFilePath** parameter
3. Paste the full path to your Excel file (e.g. `C:\Data\my-data.xlsx`)
4. Click **Load**

Power BI will import all tables with relationships already connected.

---

## After Loading in Power BI

Once loaded, you'll find:

- **Tables** in the Fields pane — one per Excel sheet
- **Relationships** already set up in Model view (click the model icon on the left)
- **Measures** auto-generated for numeric columns (e.g. `Total Amount`, `Count of Records`)
- **Date Table** if your data has date columns (for time intelligence)

From here you can drag fields onto the canvas to build visuals, add slicers, and create dashboards.

## How Relationships Are Detected

The tool uses three strategies in order:

1. **Name match** — Same column name in two tables (e.g. `CustomerID` in both `Orders` and `Customers`)
2. **FK pattern** — Column named `{Table}ID` linking to another table (e.g. `CustomerID` to `Customers.ID`)
3. **Data validation** — Checks that values actually overlap between columns (>=30% match required)

Relationships that don't meet the confidence threshold are excluded. In the browser UI you can add relationships manually. In Power BI, use Model view.

## Common Scenarios

### Single-sheet Excel file
Works fine — creates one table with measures, no relationships needed.

### Many sheets (5+)
All sheets are imported. The tool checks every pair of tables for relationships. Large files may take a few seconds to analyze.

### Updating data later
After opening the `.pbit` in Power BI and saving as `.pbix`:
- Click **Refresh** in Power BI to pull updated data from the Excel file
- The Excel path is stored as a parameter — change it in **Transform Data > Manage Parameters**

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No data provided error | Ensure your Excel file has at least one non-empty sheet |
| No relationships detected | Use matching column names across sheets (e.g. `CustomerID`) |
| Wrong data types in Power BI | Edit types in Power Query Editor: **Home > Transform Data** |
| Power BI can't find the file | Re-enter the Excel path in **Transform Data > Manage Parameters** |
| `ModuleNotFoundError: pandas` | Run `pip install -r requirements.txt` first |
| Browser: download doesn't start | Check that popups/downloads are not blocked; try a different browser |
| Browser: file won't parse | Ensure the file is `.xlsx` format (not `.xls` or `.csv`) |
