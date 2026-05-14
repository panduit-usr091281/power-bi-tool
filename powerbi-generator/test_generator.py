"""
test_generator.py
==================
Creates a sample Excel file with related tables and runs the generator
to verify end-to-end functionality.
"""

import pandas as pd
import os
import sys

# Create sample data
customers = pd.DataFrame({
    'CustomerID': [1, 2, 3, 4, 5],
    'CustomerName': ['Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Corp', 'Stark Industries'],
    'Region': ['North', 'South', 'East', 'West', 'North'],
    'JoinDate': pd.to_datetime(['2022-01-15', '2022-03-20', '2022-06-10', '2023-01-05', '2023-04-12'])
})

products = pd.DataFrame({
    'ProductID': [101, 102, 103, 104, 105],
    'ProductName': ['Widget A', 'Widget B', 'Gadget X', 'Gadget Y', 'Tool Z'],
    'Category': ['Widgets', 'Widgets', 'Gadgets', 'Gadgets', 'Tools'],
    'UnitPrice': [25.50, 30.00, 45.75, 52.00, 15.99]
})

orders = pd.DataFrame({
    'OrderID': range(1, 16),
    'CustomerID': [1, 2, 3, 1, 4, 5, 2, 3, 1, 5, 4, 2, 3, 1, 5],
    'OrderDate': pd.to_datetime([
        '2023-01-10', '2023-01-15', '2023-02-01', '2023-02-14', '2023-03-01',
        '2023-03-15', '2023-04-01', '2023-04-10', '2023-05-01', '2023-05-15',
        '2023-06-01', '2023-06-15', '2023-07-01', '2023-07-10', '2023-08-01'
    ]),
    'TotalAmount': [150.00, 300.50, 45.75, 225.00, 104.00, 75.50, 180.25, 91.50, 320.00, 45.75, 52.00, 60.00, 137.25, 255.50, 95.97]
})

order_details = pd.DataFrame({
    'OrderDetailID': range(1, 21),
    'OrderID': [1, 1, 2, 2, 3, 4, 4, 5, 6, 7, 7, 8, 9, 9, 10, 11, 12, 13, 14, 15],
    'ProductID': [101, 102, 103, 104, 103, 101, 105, 104, 102, 101, 103, 105, 101, 104, 103, 104, 102, 101, 103, 105],
    'Quantity': [3, 2, 5, 1, 1, 4, 3, 2, 1, 3, 1, 6, 5, 2, 1, 1, 2, 3, 4, 2],
    'LineTotal': [76.50, 60.00, 228.75, 52.00, 45.75, 102.00, 47.97, 104.00, 30.00, 76.50, 45.75, 95.94, 127.50, 104.00, 45.75, 52.00, 60.00, 76.50, 183.00, 31.98]
})

# Write to Excel
test_file = 'test_sample.xlsx'
with pd.ExcelWriter(test_file, engine='openpyxl') as writer:
    customers.to_excel(writer, sheet_name='Customers', index=False)
    products.to_excel(writer, sheet_name='Products', index=False)
    orders.to_excel(writer, sheet_name='Orders', index=False)
    order_details.to_excel(writer, sheet_name='OrderDetails', index=False)

print(f"Created test Excel file: {test_file}")

# Run the generator
from excel_to_powerbi import read_excel_tables, analyze_table
from relationship_detector import RelationshipDetector
from pbit_generator import PbitGenerator

tables, header_rows = read_excel_tables(test_file)
print(f"\nLoaded {len(tables)} tables")

table_schemas = {}
for name, df in tables.items():
    schema = analyze_table(name, df)
    table_schemas[name] = schema
    print(f"  [{name}] {len(df)} rows, {len(schema['columns'])} columns")

detector = RelationshipDetector(tables, table_schemas)
relationships = detector.detect()

print(f"\nDetected {len(relationships)} relationships:")
for rel in relationships:
    print(f"  {rel['fromTable']}.{rel['fromColumn']} -> "
          f"{rel['toTable']}.{rel['toColumn']} "
          f"({rel['cardinality']}, confidence: {rel['confidence']:.2f})")

output_file = 'test_sample.pbit'
generator = PbitGenerator(tables, table_schemas, relationships, test_file, header_rows=header_rows)
generator.generate(output_file)

# Verify the .pbit file
import zipfile
print(f"\nGenerated: {output_file}")
print(f"File size: {os.path.getsize(output_file)} bytes")
print("Contents:")
with zipfile.ZipFile(output_file, 'r') as zf:
    for info in zf.infolist():
        print(f"  {info.filename} ({info.file_size} bytes)")

print("\nTest passed! Open the .pbit file in Power BI Desktop.")

# Clean up test files
# os.remove(test_file)
# os.remove(output_file)
