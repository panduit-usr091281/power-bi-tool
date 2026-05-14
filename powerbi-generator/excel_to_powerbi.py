"""
excel_to_powerbi.py
====================
Reads an Excel file (multiple sheets = multiple tables), analyzes column types,
detects relationships between tables, and generates a Power BI Template (.pbit)
file that can be opened directly in Power BI Desktop with all links and
relationships pre-formed.

Usage:
    python excel_to_powerbi.py <input.xlsx> [output.pbit]

Requirements:
    pip install pandas openpyxl
"""

import pandas as pd
import os
import sys
import re

# Local modules
from relationship_detector import RelationshipDetector
from pbit_generator import PbitGenerator


NULL_LIKE_TEXT = {'', 'null', 'none', 'n/a', 'na', 'nan', '-', 'tbd', 'tba', 'asap'}


def main():
    if len(sys.argv) < 2:
        print("Usage: python excel_to_powerbi.py <input.xlsx> [output.pbit]")
        print("\nReads an Excel file and generates a Power BI Template (.pbit) file")
        print("with detected table relationships.")
        sys.exit(1)

    input_path = sys.argv[1]
    if not os.path.isfile(input_path):
        print(f"Error: File not found: {input_path}")
        sys.exit(1)

    # Determine output path
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
    else:
        base = os.path.splitext(input_path)[0]
        output_path = f"{base}.pbit"

    print(f"Reading Excel file: {input_path}")
    tables, header_rows = read_excel_tables(input_path)

    if not tables:
        print("Error: No valid sheets/tables found in the Excel file.")
        sys.exit(1)

    print(f"Found {len(tables)} table(s): {', '.join(tables.keys())}")

    # Analyze each table
    table_schemas = {}
    for name, df in tables.items():
        schema = analyze_table(name, df)
        table_schemas[name] = schema
        print(f"  [{name}] {len(df)} rows, {len(schema['columns'])} columns")

    # Detect relationships
    print("\nDetecting relationships...")
    detector = RelationshipDetector(tables, table_schemas)
    relationships = detector.detect()

    if relationships:
        print(f"Found {len(relationships)} relationship(s):")
        for rel in relationships:
            print(f"  {rel['fromTable']}.{rel['fromColumn']} -> "
                  f"{rel['toTable']}.{rel['toColumn']} ({rel['cardinality']})")
    else:
        print("  No automatic relationships detected.")

    # Generate .pbit file
    print(f"\nGenerating Power BI Template: {output_path}")
    generator = PbitGenerator(tables, table_schemas, relationships, input_path, header_rows=header_rows)
    generator.generate(output_path)

    print(f"\nDone! Open '{output_path}' in Power BI Desktop.")
    print("Note: Power BI will prompt you to set the Excel file path parameter on first open.")


def read_excel_tables(filepath):
    """Read workbook sheets into cleaned DataFrames plus header-row offsets."""
    try:
        xl = pd.ExcelFile(filepath, engine='openpyxl')
    except Exception as e:
        print(f"Error reading Excel file: {e}")
        sys.exit(1)

    tables = {}
    header_rows = {}  # 0-based header row offsets used later by the M query.
    try:
        for sheet_name in xl.sheet_names:
            # Read raw (no header) to detect where actual data starts
            raw_df = xl.parse(sheet_name, header=None)
            if raw_df.empty or len(raw_df.columns) == 0:
                continue

            # Detect both header row and column range
            header_idx, start_col, end_col = detect_data_region(raw_df)

            # Re-read with the detected header row
            df = xl.parse(sheet_name, header=header_idx)
            if df.empty or len(df.columns) == 0:
                continue

            # Trim to the detected column range
            if start_col > 0 or end_col < len(df.columns) - 1:
                df = df.iloc[:, start_col:end_col + 1]

            # Drop columns that are entirely empty (no data in any row)
            df = df.dropna(axis=1, how='all')
            if df.empty or len(df.columns) == 0:
                continue

            df.columns = build_clean_column_names(df.columns)
            # Remove fully empty rows
            df = df.dropna(how='all').reset_index(drop=True)
            if not df.empty:
                safe_name = sanitize_table_name(sheet_name)
                tables[safe_name] = df
                header_rows[safe_name] = header_idx
    finally:
        xl.close()

    return tables, header_rows


def detect_data_region(raw_df):
    """
    Detect the data region in a raw DataFrame (parsed with header=None).
    Returns (header_row, start_col, end_col) — all 0-based indices.
    Finds the best row that looks like a header, and determines which
    columns contain the actual table data.
    """
    max_scan = min(len(raw_df), 40)
    num_cols = len(raw_df.columns)

    best_row = 0
    best_score = 0
    best_start_col = 0
    best_end_col = num_cols - 1

    for r in range(max_scan):
        row = raw_df.iloc[r]

        bounds = find_row_bounds(row, num_cols)
        if bounds is None:
            continue

        first_col, last_col, non_empty_count = bounds
        string_count = count_header_like_cells(row, first_col, last_col)

        if non_empty_count < 2 or first_col < 0:
            continue

        string_ratio = string_count / non_empty_count
        if string_ratio < 0.4:
            continue

        # Check that the next few rows have data in the same column range
        data_rows_below = 0
        for nr in range(r + 1, min(r + 6, len(raw_df))):
            next_row = raw_df.iloc[nr]
            next_non_empty = count_non_empty_cells(next_row, first_col, last_col)
            if next_non_empty >= 2:
                data_rows_below += 1
        if data_rows_below < 1:
            continue

        # Skip title rows (1-2 cells with long text)
        if non_empty_count <= 2:
            avg_len = average_cell_text_length(row, first_col, last_col, non_empty_count)
            if avg_len > 30:
                continue

        # Score: more non-empty header cells + data continuity = better
        score = non_empty_count * string_ratio * (2 if non_empty_count >= 3 else 1) * (1 + data_rows_below * 0.2)
        if score > best_score:
            best_score = score
            best_row = r
            best_start_col = first_col
            best_end_col = last_col

    return best_row, best_start_col, best_end_col


def build_clean_column_names(columns):
    """Sanitize and deduplicate a header sequence using stable placeholder names."""
    clean_names = []
    seen = {}

    for index, column in enumerate(columns, start=1):
        base_name = sanitize_column_name(column, index)
        suffix = seen.get(base_name, 0)
        clean_name = base_name if suffix == 0 else f"{base_name}_{suffix}"
        seen[base_name] = suffix + 1
        clean_names.append(clean_name)

    return clean_names


def find_row_bounds(row, num_cols):
    """Return (first_col, last_col, non_empty_count) for a candidate header row."""
    first_col = -1
    last_col = -1
    non_empty_count = 0

    for column_index in range(num_cols):
        if is_blank_cell(row.iloc[column_index]):
            continue

        non_empty_count += 1
        if first_col < 0:
            first_col = column_index
        last_col = column_index

    if first_col < 0:
        return None
    return first_col, last_col, non_empty_count


def count_header_like_cells(row, start_col, end_col):
    """Count cells that look like textual field labels rather than values."""
    count = 0

    for column_index in range(start_col, end_col + 1):
        value = row.iloc[column_index]
        if not isinstance(value, str):
            continue

        text = value.strip()
        if not text or len(text) >= 80:
            continue

        try:
            float(text.replace(',', ''))
        except ValueError:
            count += 1

    return count


def count_non_empty_cells(row, start_col, end_col):
    count = 0

    for column_index in range(start_col, end_col + 1):
        if not is_blank_cell(row.iloc[column_index]):
            count += 1

    return count


def average_cell_text_length(row, start_col, end_col, non_empty_count):
    total_length = 0

    for column_index in range(start_col, end_col + 1):
        value = row.iloc[column_index]
        if is_blank_cell(value):
            continue
        total_length += len(str(value))

    return total_length / max(non_empty_count, 1)


def is_blank_cell(value):
    return pd.isna(value) or str(value).strip() == ''


def sanitize_table_name(name):
    """Ensure table name is valid for Power BI."""
    name = str(name).strip()
    # Remove characters invalid in Power BI table names
    name = re.sub(r'[^\w\s\-]', '', name)
    name = name.strip()
    # Remove leading dashes/spaces that cause Power BI errors
    name = re.sub(r'^[\-\s]+', '', name)
    return name if name else "Table"


def sanitize_column_name(name, sequential_index=1):
    """Ensure column name is valid for Power BI."""
    name = str(name).strip()
    if not name or name.startswith('Unnamed'):
        return f"Column_{sequential_index}"
    return name


def analyze_table(name, df):
    """Analyze a DataFrame and return schema information."""
    columns = []
    for col in df.columns:
        col_info = {
            'name': col,
            'dataType': infer_powerbi_type(df[col]),
            'sourceColumn': col,
            'nullable': bool(df[col].isnull().any()),
            'uniqueCount': int(df[col].nunique()),
            'totalCount': len(df),
            'sampleValues': get_sample_values(df[col])
        }
        columns.append(col_info)

    return {
        'name': name,
        'columns': columns,
        'rowCount': len(df)
    }


def infer_powerbi_type(series):
    """Map pandas dtype to Power BI data type."""
    dtype = series.dtype

    if pd.api.types.is_bool_dtype(dtype):
        return 'boolean'
    elif pd.api.types.is_integer_dtype(dtype):
        return 'int64'
    elif pd.api.types.is_float_dtype(dtype):
        return 'double'
    elif pd.api.types.is_datetime64_any_dtype(dtype):
        return 'dateTime'
    else:
        non_null = series.dropna()
        if non_null.empty:
            return 'string'
        # Use a larger, spread-out sample for better coverage of dirty data
        sample_size = min(100, len(non_null))
        if sample_size <= 50:
            sample = non_null.head(sample_size)
        else:
            sample = pd.concat([non_null.head(30), non_null.tail(30), non_null.sample(min(40, sample_size - 60), random_state=42)]).drop_duplicates()
        # Filter out null-like text before counting
        clean_sample = [v for v in sample if str(v).strip().lower() not in NULL_LIKE_TEXT]
        if not clean_sample:
            return 'string'
        date_count = 0
        for val in clean_sample:
            try:
                pd.to_datetime(str(val))
                date_count += 1
            except (ValueError, TypeError):
                pass
        if date_count > len(clean_sample) * 0.8:
            return 'dateTime'
        numeric_count = 0
        for val in clean_sample:
            try:
                float(str(val).replace(',', ''))
                numeric_count += 1
            except (ValueError, TypeError):
                pass
        if numeric_count > len(clean_sample) * 0.8:
            return 'double'
        return 'string'


def get_sample_values(series, n=5):
    """Get sample non-null values from a series."""
    samples = series.dropna().head(n).tolist()
    return [str(v) for v in samples]


if __name__ == '__main__':
    main()
