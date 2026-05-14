"""
Verify the .pbit file structure matches OPC package conventions.
Checks that Power BI can find all required parts.
"""
import os, sys, json, zipfile
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from excel_to_powerbi import read_excel_tables, analyze_table
from relationship_detector import RelationshipDetector
from pbit_generator import PbitGenerator

# Create test data
customers = pd.DataFrame({
    'CustomerID': [1, 2, 3],
    'CustomerName': ['Acme', 'Globex', 'Initech']
})
orders = pd.DataFrame({
    'OrderID': [1, 2, 3, 4],
    'CustomerID': [1, 2, 1, 3],
    'Amount': [100.0, 200.5, 50.0, 300.0]
})

xlsx_path = '_verify_opc.xlsx'
pbit_path = '_verify_opc.pbit'

with pd.ExcelWriter(xlsx_path, engine='openpyxl') as w:
    customers.to_excel(w, sheet_name='Customers', index=False)
    orders.to_excel(w, sheet_name='Orders', index=False)

tables, header_rows = read_excel_tables(xlsx_path)
schemas = {n: analyze_table(n, df) for n, df in tables.items()}
rels = RelationshipDetector(tables, schemas).detect()
PbitGenerator(tables, schemas, rels, xlsx_path, header_rows=header_rows).generate(pbit_path)

print("=== PBIT FILE VERIFICATION ===\n")

with zipfile.ZipFile(pbit_path, 'r') as zf:
    names = zf.namelist()
    print("ZIP entries:")
    for n in names:
        info = zf.getinfo(n)
        print(f"  {n} ({info.file_size} bytes)")

    # Check required OPC parts
    print("\n--- OPC Package Checks ---")
    required = {
        '[Content_Types].xml': 'Content types declaration',
        '_rels/.rels': 'Root relationships',
        'Version': 'Package version',
        'DataModelSchema': 'Tabular model (UTF-16LE)',
        'DiagramLayout': 'Model diagram layout',
        'Report/Layout': 'Report page layout',
        'Settings': 'Report settings',
        'Metadata': 'Package metadata'
    }

    all_ok = True
    for part, desc in required.items():
        if part in names:
            print(f"  OK  {part} ({desc})")
        else:
            print(f"  MISSING  {part} ({desc})")
            all_ok = False

    # Verify [Content_Types].xml has Override entries
    print("\n--- Content Types ---")
    ct = zf.read('[Content_Types].xml').decode('utf-8')
    print(ct)

    # Verify _rels/.rels
    print("\n--- Root Rels ---")
    rels_xml = zf.read('_rels/.rels').decode('utf-8')
    print(rels_xml)

    # Verify Version content (UTF-16LE without BOM)
    print(f"\n--- Version ---")
    ver_raw = zf.read('Version')
    ver_has_bom = ver_raw[:2] == b'\xff\xfe'
    print(f"  UTF-16LE BOM present: {ver_has_bom}")
    version = ver_raw.decode('utf-16-le')
    print(f"  Content: '{version}'")

    # Verify DataModelSchema has no BOM and is valid JSON
    print("\n--- DataModelSchema ---")
    raw = zf.read('DataModelSchema')
    has_bom = raw[:2] == b'\xff\xfe'
    print(f"  UTF-16LE BOM present: {has_bom}")
    decoded = raw.decode('utf-16-le')
    model = json.loads(decoded)
    print(f"  Valid JSON: True")
    print(f"  Tables: {[t['name'] for t in model['model']['tables']]}")
    print(f"  Relationships: {len(model['model'].get('relationships', []))}")

    print("\n--- Report JSON Parts ---")
    report_ok = True

    def has_only_string_configs(value):
        if isinstance(value, list):
            return all(has_only_string_configs(item) for item in value)
        if not isinstance(value, dict):
            return True
        for key, child in value.items():
            if key == 'config' and not isinstance(child, str):
                return False
            if not has_only_string_configs(child):
                return False
        return True

    for part in ['DiagramLayout', 'Report/Layout', 'Metadata', 'Settings']:
        part_raw = zf.read(part)
        has_utf16_bom = part_raw.startswith(b'\xff\xfe')
        try:
            parsed = json.loads(part_raw.decode('utf-16-le'))
            valid_json = True
        except Exception:
            valid_json = False
            report_ok = False
            parsed = None
        config_ok = True
        if parsed is not None and part == 'Report/Layout':
            config_ok = has_only_string_configs(parsed)
            if not config_ok:
                report_ok = False
        print(f"  {part}: utf16_bom={has_utf16_bom}, valid_json={valid_json}, config_ok={config_ok}")
        if has_utf16_bom:
            report_ok = False

    print("\n--- Metadata / Settings ---")
    metadata = json.loads(zf.read('Metadata').decode('utf-16-le'))
    settings = json.loads(zf.read('Settings').decode('utf-16-le'))
    metadata_ok = metadata.get('Version') == 5 and isinstance(metadata.get('AutoCreatedRelationships'), list)
    settings_ok = settings.get('Version') == 1 and isinstance(settings.get('ReportSettings'), dict) and isinstance(settings.get('QueriesSettings'), dict)
    print(f"  Metadata Version: {metadata.get('Version')} (ok={metadata_ok})")
    print(f"  Settings Version: {settings.get('Version')} (ok={settings_ok})")

    print(f"\n{'='*40}")
    if all_ok and not has_bom and report_ok and not ver_has_bom and version == '1.25' and metadata_ok and settings_ok:
        print("  ALL CHECKS PASSED")
    else:
        print("  SOME CHECKS FAILED")

# Cleanup
import gc
gc.collect()
for f in [xlsx_path, pbit_path]:
    try:
        os.remove(f)
    except Exception:
        pass
