"""
stress_test.py
===============
Comprehensive stress test for the Power BI Generator.
Tests parsing, relationship detection, and .pbit generation
across a wide range of scenarios:

1. Scale tests        — large row counts, many columns, many sheets
2. Edge case tests    — empty sheets, special chars, mixed types, nulls
3. Relationship tests — complex FK patterns, ambiguous names, no matches
4. Integrity tests    — validate .pbit file structure and encoding
5. Performance        — timing benchmarks
"""

import pandas as pd
import numpy as np
import os
import sys
import time
import json
import zipfile
import traceback
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from excel_to_powerbi import read_excel_tables, analyze_table
from relationship_detector import RelationshipDetector
from pbit_generator import PbitGenerator

# ── Test Infrastructure ──────────────────────────────────────

PASS = 0
FAIL = 0
RESULTS = []

def _test_label(name):
    """Decorator to register and run a test."""
    def decorator(fn):
        fn._test_name = name
        return fn
    return decorator

def run_test(fn):
    global PASS, FAIL
    name = getattr(fn, '_test_name', fn.__name__)
    t0 = time.perf_counter()
    try:
        fn()
        elapsed = time.perf_counter() - t0
        PASS += 1
        status = 'PASS'
        detail = f'{elapsed:.3f}s'
        print(f'  [PASS] {name} ({elapsed:.3f}s)')
    except Exception as e:
        elapsed = time.perf_counter() - t0
        FAIL += 1
        status = 'FAIL'
        detail = str(e)
        print(f'  [FAIL] {name} -- {e}')
        traceback.print_exc(limit=3)
    RESULTS.append({'name': name, 'status': status, 'time': elapsed, 'detail': detail})

def assert_eq(actual, expected, msg=''):
    if actual != expected:
        raise AssertionError(f'{msg}: expected {expected}, got {actual}')

def assert_gte(actual, minimum, msg=''):
    if actual < minimum:
        raise AssertionError(f'{msg}: expected >= {minimum}, got {actual}')

def assert_true(val, msg=''):
    if not val:
        raise AssertionError(f'{msg}: expected True')

def assert_relationship_graph_is_forest(relationships, msg=''):
    parents = {}
    ranks = {}

    def find(node):
        if parents[node] != node:
            parents[node] = find(parents[node])
        return parents[node]

    def union(left, right):
        left_root = find(left)
        right_root = find(right)
        if left_root == right_root:
            return False
        if ranks[left_root] < ranks[right_root]:
            parents[left_root] = right_root
        elif ranks[left_root] > ranks[right_root]:
            parents[right_root] = left_root
        else:
            parents[right_root] = left_root
            ranks[left_root] += 1
        return True

    for rel in relationships:
        for table_name in (rel['fromTable'], rel['toTable']):
            if table_name not in parents:
                parents[table_name] = table_name
                ranks[table_name] = 0

        if not union(rel['fromTable'], rel['toTable']):
            raise AssertionError(f'{msg}: cycle detected between {rel["fromTable"]} and {rel["toTable"]}')

def write_excel(path, sheets_dict):
    """Write dict of {sheet_name: DataFrame} to Excel."""
    with pd.ExcelWriter(path, engine='openpyxl') as w:
        for name, df in sheets_dict.items():
            df.to_excel(w, sheet_name=name, index=False)

def full_pipeline(xlsx_path):
    """Run the full pipeline: parse → analyze → detect → generate."""
    tables, header_rows = read_excel_tables(xlsx_path)
    schemas = {}
    for name, df in tables.items():
        schemas[name] = analyze_table(name, df)
    detector = RelationshipDetector(tables, schemas)
    rels = detector.detect()
    pbit_path = xlsx_path.replace('.xlsx', '.pbit')
    gen = PbitGenerator(tables, schemas, rels, xlsx_path, header_rows=header_rows)
    gen.generate(pbit_path)
    return tables, schemas, rels, pbit_path

def validate_pbit(pbit_path):
    """Validate .pbit ZIP structure and the Power BI-specific part encodings."""
    assert_true(os.path.isfile(pbit_path), 'pbit file exists')
    assert_true(os.path.getsize(pbit_path) > 100, 'pbit file not empty')

    with zipfile.ZipFile(pbit_path, 'r') as zf:
        names = zf.namelist()
        required = ['[Content_Types].xml', '_rels/.rels', 'DataModelSchema',
                     'DiagramLayout', 'Report/Layout', 'Metadata', 'Settings', 'Version']
        for req in required:
            assert_true(req in names, f'{req} in zip')

        # Helper to decode UTF-16LE with optional BOM.
        def decode_part(name):
            raw = zf.read(name)
            if raw[:2] == b'\xff\xfe':
                raw = raw[2:]
            return raw.decode('utf-16-le')

        # Version is UTF-16LE without BOM.
        version_raw = zf.read('Version')
        assert_true(version_raw[:2] != b'\xff\xfe', 'Version has no BOM')
        version_text = version_raw.decode('utf-16-le')
        assert_true(version_text == '1.25', f'Version is "1.25" (got "{version_text}")')

        # DataModelSchema is valid UTF-16LE JSON without BOM.
        schema_raw = zf.read('DataModelSchema')
        assert_true(schema_raw[:2] != b'\xff\xfe', 'DataModelSchema has no BOM')
        decoded = decode_part('DataModelSchema')
        model = json.loads(decoded)
        assert_true('model' in model, 'model key in schema')
        assert_true('tables' in model['model'], 'tables in model')

        measure_names = []
        for table in model['model']['tables']:
            measure_names.extend(measure['name'] for measure in table.get('measures', []))
        assert_true(len(measure_names) == len(set(measure_names)), 'measure names are unique across the model')

        relationships = model['model'].get('relationships', [])
        rel_pairs = [tuple(sorted((rel['fromTable'], rel['toTable']))) for rel in relationships]
        assert_true(len(rel_pairs) == len(set(rel_pairs)), 'relationship table pairs are unique across the model')
        assert_relationship_graph_is_forest(relationships, 'relationship graph avoids ambiguous multi-paths')

        for table in model['model']['tables']:
            for partition in table.get('partitions', []):
                source = partition.get('source', {})
                if source.get('type') != 'm':
                    continue
                expression = source.get('expression', [])
                expression_text = '\n'.join(expression) if isinstance(expression, list) else str(expression)
                assert_true('_Sheet =' not in expression_text, 'M queries avoid raw table-name step identifiers')
                assert_true('Navigation = Source' in expression_text, 'M queries use a stable Navigation step')
                assert_true('PromoteHeaders' in expression_text, 'M queries promote headers')
                assert_true('in\n    PromotedHeaders' in expression_text, 'M queries end at PromotedHeaders step')

        def assert_string_configs(value):
            if isinstance(value, list):
                for item in value:
                    assert_string_configs(item)
                return
            if not isinstance(value, dict):
                return
            for key, child in value.items():
                if key == 'config':
                    assert_true(isinstance(child, str), 'Report/Layout config fields are strings')
                assert_string_configs(child)

        # Report JSON parts are UTF-16LE without BOM.
        for part in ['DiagramLayout', 'Report/Layout', 'Metadata', 'Settings']:
            raw = zf.read(part)
            assert_true(not raw.startswith(b'\xff\xfe'), f'{part} has no UTF-16 BOM')
            parsed = json.loads(raw.decode('utf-16-le'))
            if part == 'Report/Layout':
                assert_string_configs(parsed)
            elif part == 'Metadata':
                assert_true(parsed.get('Version') == 5, 'Metadata Version is 5')
                assert_true(isinstance(parsed.get('AutoCreatedRelationships'), list), 'Metadata AutoCreatedRelationships is a list')
            elif part == 'Settings':
                assert_true(parsed.get('Version') == 1, 'Settings Version is 1')
                assert_true(isinstance(parsed.get('ReportSettings'), dict), 'Settings ReportSettings is an object')
                assert_true(isinstance(parsed.get('QueriesSettings'), dict), 'Settings QueriesSettings is an object')
        return model

def cleanup(*paths):
    import gc
    gc.collect()
    for p in paths:
        if os.path.isfile(p):
            try:
                os.remove(p)
            except PermissionError:
                pass  # Windows file lock; cleaned up at end


# ── 1. SCALE TESTS ──────────────────────────────────────────

@_test_label('Scale: 10,000 rows single table')
def test_10k_rows():
    path = '_stress_10k.xlsx'
    try:
        df = pd.DataFrame({
            'ID': range(1, 10001),
            'Name': [f'Item_{i}' for i in range(1, 10001)],
            'Value': np.random.uniform(0, 1000, 10000),
            'Category': np.random.choice(['A', 'B', 'C', 'D', 'E'], 10000),
            'Date': pd.date_range('2020-01-01', periods=10000, freq='h')
        })
        write_excel(path, {'Data': df})
        tables, schemas, rels, pbit = full_pipeline(path)
        assert_eq(schemas['Data']['rowCount'], 10000)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Scale: 50,000 rows single table')
def test_50k_rows():
    path = '_stress_50k.xlsx'
    try:
        df = pd.DataFrame({
            'ID': range(1, 50001),
            'Amount': np.random.uniform(1, 10000, 50000),
            'Region': np.random.choice(['North', 'South', 'East', 'West'], 50000)
        })
        write_excel(path, {'BigTable': df})
        tables, schemas, rels, pbit = full_pipeline(path)
        assert_eq(schemas['BigTable']['rowCount'], 50000)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Scale: 50 columns wide table')
def test_50_columns():
    path = '_stress_50cols.xlsx'
    try:
        data = {'ID': range(1, 101)}
        for i in range(49):
            data[f'Metric_{i+1}'] = np.random.uniform(0, 100, 100)
        write_excel(path, {'Wide': pd.DataFrame(data)})
        tables, schemas, rels, pbit = full_pipeline(path)
        assert_eq(len(schemas['Wide']['columns']), 50)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Scale: 15 sheets')
def test_15_sheets():
    path = '_stress_15sheets.xlsx'
    try:
        sheets = {}
        for i in range(15):
            sheets[f'Sheet_{i+1}'] = pd.DataFrame({
                'ID': range(1, 51),
                'Value': np.random.uniform(0, 100, 50)
            })
        write_excel(path, sheets)
        tables, schemas, rels, pbit = full_pipeline(path)
        assert_eq(len(tables), 15)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Scale: 100,000 rows with relationships')
def test_100k_with_rels():
    path = '_stress_100k_rels.xlsx'
    try:
        customers = pd.DataFrame({
            'CustomerID': range(1, 1001),
            'Name': [f'Customer_{i}' for i in range(1, 1001)]
        })
        orders = pd.DataFrame({
            'OrderID': range(1, 100001),
            'CustomerID': np.random.randint(1, 1001, 100000),
            'Amount': np.random.uniform(10, 5000, 100000)
        })
        write_excel(path, {'Customers': customers, 'Orders': orders})
        tables, schemas, rels, pbit = full_pipeline(path)
        assert_gte(len(rels), 1, 'relationships found')
        # Verify the CustomerID relationship was detected
        rel_cols = [(r['fromColumn'], r['toColumn']) for r in rels]
        assert_true(any('CustomerID' in c for pair in rel_cols for c in pair), 'CustomerID rel found')
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))


# ── 2. EDGE CASE TESTS ──────────────────────────────────────

@_test_label('Edge: empty sheet is skipped')
def test_empty_sheet():
    path = '_stress_empty.xlsx'
    try:
        sheets = {
            'Data': pd.DataFrame({'A': [1, 2, 3]}),
            'Empty': pd.DataFrame()
        }
        write_excel(path, sheets)
        tables, schemas, rels, pbit = full_pipeline(path)
        assert_eq(len(tables), 1, 'only non-empty table')
        assert_true('Empty' not in tables, 'empty sheet skipped')
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Edge: special characters in sheet/column names')
def test_special_chars():
    path = '_stress_special.xlsx'
    try:
        df = pd.DataFrame({
            'Product Name!': ['A', 'B'],
            'Price ($)': [10.5, 20.0],
            'Qty/Unit': [5, 10]
        })
        write_excel(path, {'Sales & Revenue': df})
        tables, schemas, rels, pbit = full_pipeline(path)
        assert_eq(len(tables), 1)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Edge: columns with all nulls')
def test_all_nulls():
    path = '_stress_nulls.xlsx'
    try:
        df = pd.DataFrame({
            'ID': [1, 2, 3],
            'Name': ['a', 'b', 'c'],
            'Empty1': [None, None, None],
            'Empty2': [np.nan, np.nan, np.nan]
        })
        write_excel(path, {'NullTest': df})
        tables, schemas, rels, pbit = full_pipeline(path)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Edge: mixed data types in column')
def test_mixed_types():
    path = '_stress_mixed.xlsx'
    try:
        df = pd.DataFrame({
            'MixedCol': [1, 'hello', 3.14, True, None],
            'Normal': [10, 20, 30, 40, 50]
        })
        write_excel(path, {'Mixed': df})
        tables, schemas, rels, pbit = full_pipeline(path)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Edge: literal null strings in typed columns')
def test_literal_null_strings_in_typed_columns():
    path = '_stress_literal_nulls.xlsx'
    try:
        df = pd.DataFrame({
            'StartDate': ['2022-01-01', '2022-02-01', '2022-03-01', '2022-04-01', '2022-05-01', 'null'],
            'Amount': ['100', '200', '300', '400', '500', 'null'],
            'Label': ['A', 'B', 'C', 'D', 'E', 'null']
        })
        write_excel(path, {'DirtyTypes': df})
        _, schemas, _, pbit = full_pipeline(path)
        assert_eq(schemas['DirtyTypes']['columns'][0]['dataType'], 'dateTime', 'date-like column still inferred as dateTime')
        assert_eq(schemas['DirtyTypes']['columns'][1]['dataType'], 'double', 'numeric-like column still inferred as numeric')
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Edge: date-like column with ASAP token')
def test_date_like_column_with_asap():
    path = '_stress_asap_dates.xlsx'
    try:
        df = pd.DataFrame({
            'BidDate': ['2022-01-01', '2022-02-01', '2022-03-01', '2022-04-01', '2022-05-01', 'ASAP'],
            'Label': ['A', 'B', 'C', 'D', 'E', 'F']
        })
        write_excel(path, {'Schedule': df})
        _, schemas, _, pbit = full_pipeline(path)
        assert_eq(schemas['Schedule']['columns'][0]['dataType'], 'dateTime', 'date-like column still inferred as dateTime')
        model = validate_pbit(pbit)
        # Verify the schema still declares the column as dateTime type in the data model
        schedule_table = [t for t in model['model']['tables'] if t['name'] == 'Schedule'][0]
        date_col = [c for c in schedule_table['columns'] if c['name'] == 'BidDate'][0]
        assert_eq(date_col['dataType'], 'dateTime', 'date column declared as dateTime in model schema')
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Edge: single row of data')
def test_single_row():
    path = '_stress_1row.xlsx'
    try:
        df = pd.DataFrame({'X': [42], 'Y': ['hello']})
        write_excel(path, {'OneRow': df})
        tables, schemas, rels, pbit = full_pipeline(path)
        assert_eq(schemas['OneRow']['rowCount'], 1)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Edge: single column of data')
def test_single_column():
    path = '_stress_1col.xlsx'
    try:
        df = pd.DataFrame({'OnlyColumn': range(1, 101)})
        write_excel(path, {'OneCol': df})
        tables, schemas, rels, pbit = full_pipeline(path)
        assert_eq(len(schemas['OneCol']['columns']), 1)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Edge: unicode content')
def test_unicode():
    path = '_stress_unicode.xlsx'
    try:
        df = pd.DataFrame({
            'Name': ['José', 'Müller', '田中', 'Ñoño', 'Ürümqi'],
            'Value': [1, 2, 3, 4, 5]
        })
        write_excel(path, {'Unicode': df})
        tables, schemas, rels, pbit = full_pipeline(path)
        validate_pbit(pbit)
        # Verify unicode survived in the model
        model = None
        with zipfile.ZipFile(path.replace('.xlsx', '.pbit'), 'r') as zf:
            raw = zf.read('DataModelSchema')
            if raw[:2] == b'\xff\xfe':
                raw = raw[2:]
            model = json.loads(raw.decode('utf-16-le'))
        assert_true(model is not None, 'model parsed')
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Edge: very long column names (100+ chars)')
def test_long_col_names():
    path = '_stress_longnames.xlsx'
    try:
        df = pd.DataFrame({
            'A' * 120: [1, 2],
            'B' * 100: [3, 4],
            'Short': [5, 6]
        })
        write_excel(path, {'LongNames': df})
        tables, schemas, rels, pbit = full_pipeline(path)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Edge: duplicate column names in sheet')
def test_duplicate_cols():
    path = '_stress_dupcols.xlsx'
    try:
        # openpyxl/pandas will auto-rename duplicates to "Col.1", "Col.2" etc.
        df = pd.DataFrame([[1, 2, 3]], columns=['Col', 'Col', 'Col'])
        write_excel(path, {'DupCols': df})
        tables, schemas, rels, pbit = full_pipeline(path)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Edge: boolean columns')
def test_boolean_cols():
    path = '_stress_bools.xlsx'
    try:
        df = pd.DataFrame({
            'ID': [1, 2, 3, 4, 5],
            'IsActive': [True, False, True, True, False],
            'HasPaid': [False, True, True, False, True]
        })
        write_excel(path, {'Booleans': df})
        tables, schemas, rels, pbit = full_pipeline(path)
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))


# ── 3. RELATIONSHIP TESTS ───────────────────────────────────

@_test_label('Rel: standard FK pattern (TableNameID)')
def test_rel_standard_fk():
    path = '_stress_rel_fk.xlsx'
    try:
        customers = pd.DataFrame({'CustomerID': [1, 2, 3], 'Name': ['A', 'B', 'C']})
        orders = pd.DataFrame({'OrderID': [1, 2, 3, 4], 'CustomerID': [1, 2, 1, 3], 'Amount': [10, 20, 30, 40]})
        write_excel(path, {'Customers': customers, 'Orders': orders})
        _, _, rels, pbit = full_pipeline(path)
        assert_gte(len(rels), 1, 'at least 1 relationship')
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Rel: multi-table star schema (5 tables)')
def test_rel_star_schema():
    path = '_stress_rel_star.xlsx'
    try:
        dim_product = pd.DataFrame({'ProductID': range(1, 11), 'ProductName': [f'P{i}' for i in range(1, 11)]})
        dim_customer = pd.DataFrame({'CustomerID': range(1, 6), 'CustName': [f'C{i}' for i in range(1, 6)]})
        dim_store = pd.DataFrame({'StoreID': range(1, 4), 'StoreName': ['NYC', 'LA', 'CHI']})
        dim_date = pd.DataFrame({'DateKey': range(20230101, 20230113), 'Month': ['Jan'] * 12})

        fact_sales = pd.DataFrame({
            'SaleID': range(1, 101),
            'ProductID': np.random.randint(1, 11, 100),
            'CustomerID': np.random.randint(1, 6, 100),
            'StoreID': np.random.randint(1, 4, 100),
            'DateKey': np.random.randint(20230101, 20230113, 100),
            'Revenue': np.random.uniform(5, 500, 100)
        })

        write_excel(path, {
            'Products': dim_product, 'Customers': dim_customer,
            'Stores': dim_store, 'Dates': dim_date, 'Sales': fact_sales
        })
        _, _, rels, pbit = full_pipeline(path)
        assert_gte(len(rels), 3, 'at least 3 star schema relationships')
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Rel: no relationships (unrelated tables)')
def test_rel_none():
    path = '_stress_rel_none.xlsx'
    try:
        t1 = pd.DataFrame({'Alpha': ['a', 'b'], 'Beta': [1, 2]})
        t2 = pd.DataFrame({'Gamma': ['x', 'y'], 'Delta': [3, 4]})
        write_excel(path, {'TableA': t1, 'TableB': t2})
        _, _, rels, pbit = full_pipeline(path)
        assert_eq(len(rels), 0, 'no relationships expected')
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Rel: underscore FK pattern (customer_id)')
def test_rel_underscore_fk():
    path = '_stress_rel_uscore.xlsx'
    try:
        customers = pd.DataFrame({'customer_id': [10, 20, 30], 'name': ['X', 'Y', 'Z']})
        orders = pd.DataFrame({'order_id': [1, 2, 3], 'customer_id': [10, 20, 10], 'total': [100, 200, 150]})
        write_excel(path, {'customers': customers, 'orders': orders})
        _, _, rels, pbit = full_pipeline(path)
        assert_gte(len(rels), 1, 'underscore FK detected')
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Rel: many-to-many (both sides non-unique)')
def test_rel_many_to_many():
    path = '_stress_rel_m2m.xlsx'
    try:
        students = pd.DataFrame({'StudentID': [1, 1, 2, 2, 3], 'CourseID': [101, 102, 101, 103, 102]})
        courses = pd.DataFrame({'CourseID': [101, 101, 102, 103, 103], 'Instructor': ['A', 'B', 'C', 'D', 'E']})
        write_excel(path, {'Students': students, 'Courses': courses})
        _, _, rels, pbit = full_pipeline(path)
        # Should detect manyToMany or at least attempt a relationship
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Rel: chain of relationships (A→B→C)')
def test_rel_chain():
    path = '_stress_rel_chain.xlsx'
    try:
        departments = pd.DataFrame({'DeptID': [1, 2, 3], 'DeptName': ['Eng', 'Sales', 'HR']})
        employees = pd.DataFrame({'EmployeeID': range(1, 11), 'DeptID': np.random.randint(1, 4, 10), 'Name': [f'E{i}' for i in range(1, 11)]})
        tasks = pd.DataFrame({'TaskID': range(1, 21), 'EmployeeID': np.random.randint(1, 11, 20), 'Hours': np.random.uniform(1, 8, 20)})
        write_excel(path, {'Departments': departments, 'Employees': employees, 'Tasks': tasks})
        _, _, rels, pbit = full_pipeline(path)
        assert_gte(len(rels), 2, 'chain relationships')
        validate_pbit(pbit)
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Rel: ambiguous multi-path graph is pruned')
def test_rel_ambiguous_multi_path():
    tables = {
        'Overview': pd.DataFrame({
            'RequestID': [1, 1, 2, 2],
            'BuildID': [10, 20, 10, 20],
            'OverviewMetric': [100, 200, 300, 400]
        }),
        'RFP Requests': pd.DataFrame({
            'RequestID': [1, 2],
            'CableLookupA': [100, 200],
            'RfpName': ['R1', 'R2']
        }),
        'Cable Build Request Q2-26': pd.DataFrame({
            'BuildID': [10, 20],
            'CableLookupB': [100, 200],
            'BuildName': ['B1', 'B2']
        }),
        '2026 UL1400 Test Cable': pd.DataFrame({
            'CableLookupA': [100, 200],
            'CableLookupB': [100, 200],
            'ManufacturerID': [1000, 2000],
            'CableName': ['C1', 'C2']
        }),
        'Cable Manufacturers': pd.DataFrame({
            'ManufacturerID': [1000, 2000],
            'ManufacturerName': ['M1', 'M2']
        })
    }

    schemas = {name: analyze_table(name, df) for name, df in tables.items()}
    rels = RelationshipDetector(tables, schemas).detect()

    assert_eq(len(rels), 4, 'forest keeps one path across five connected tables')
    assert_relationship_graph_is_forest(rels, 'relationship graph avoids ambiguous multi-paths')


# ── 4. PBIT INTEGRITY TESTS ─────────────────────────────────

@_test_label('Integrity: DataModelSchema valid JSON with all tables')
def test_integrity_schema():
    path = '_stress_integrity.xlsx'
    try:
        t1 = pd.DataFrame({'ID': [1, 2], 'Val': [10, 20]})
        t2 = pd.DataFrame({'ID': [1, 2], 'Name': ['A', 'B']})
        write_excel(path, {'Alpha': t1, 'Beta': t2})
        _, schemas, rels, pbit = full_pipeline(path)
        model = validate_pbit(pbit)
        table_names_in_model = [t['name'] for t in model['model']['tables']]
        assert_true('Alpha' in table_names_in_model, 'Alpha table in model')
        assert_true('Beta' in table_names_in_model, 'Beta table in model')
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Integrity: relationships in model match detected')
def test_integrity_rels_in_model():
    path = '_stress_integ_rels.xlsx'
    try:
        c = pd.DataFrame({'CID': [1, 2, 3], 'Name': ['A', 'B', 'C']})
        o = pd.DataFrame({'OID': [1, 2, 3], 'CID': [1, 2, 1], 'Amt': [10, 20, 30]})
        write_excel(path, {'Custs': c, 'Ords': o})
        _, _, rels, pbit = full_pipeline(path)
        model = validate_pbit(pbit)
        model_rels = model['model'].get('relationships', [])
        assert_eq(len(model_rels), len(rels), 'rel count matches')
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Integrity: measures generated for numeric columns')
def test_integrity_measures():
    path = '_stress_integ_measures.xlsx'
    try:
        df = pd.DataFrame({'ID': [1, 2, 3], 'Revenue': [100.5, 200.0, 300.75], 'Units': [10, 20, 30]})
        write_excel(path, {'Sales': df})
        _, _, _, pbit = full_pipeline(path)
        model = validate_pbit(pbit)
        sales_table = [t for t in model['model']['tables'] if t['name'] == 'Sales'][0]
        measures = sales_table.get('measures', [])
        measure_names = [m['name'] for m in measures]
        assert_true('Sales Total Revenue' in measure_names, 'has table-qualified Total measure')
        assert_true('Sales Count of Records' in measure_names, 'has table-qualified Count measure')
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Integrity: ExcelFilePath parameter in expressions')
def test_integrity_expression():
    path = '_stress_integ_expr.xlsx'
    try:
        write_excel(path, {'T': pd.DataFrame({'A': [1]})})
        _, _, _, pbit = full_pipeline(path)
        model = validate_pbit(pbit)
        expressions = model['model'].get('expressions', [])
        expr_names = [e['name'] for e in expressions]
        assert_true('ExcelFilePath' in expr_names, 'ExcelFilePath parameter exists')
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Integrity: ExcelFilePath strips wrapping quotes')
def test_integrity_expression_quoted_path():
    df = pd.DataFrame({'A': [1]})
    tables = {'QuotedPath': df}
    schemas = {'QuotedPath': analyze_table('QuotedPath', df)}
    gen = PbitGenerator(tables, schemas, [], '"C:\\Users\\Example User\\Documents\\Quoted Workbook.xlsx"')
    expressions = gen._build_expressions()
    expr_text = '\n'.join(expressions[0].get('expression', []))
    expected = '"C:\\Users\\Example User\\Documents\\Quoted Workbook.xlsx" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]'
    assert_eq(expr_text, expected, 'quoted ExcelFilePath is normalized for M')

@_test_label('Integrity: DateTable generated when dates exist')
def test_integrity_date_table():
    path = '_stress_integ_date.xlsx'
    try:
        df = pd.DataFrame({
            'ID': [1, 2, 3],
            'OrderDate': pd.to_datetime(['2023-01-01', '2023-06-15', '2023-12-31'])
        })
        write_excel(path, {'Orders': df})
        _, _, _, pbit = full_pipeline(path)
        model = validate_pbit(pbit)
        table_names = [t['name'] for t in model['model']['tables']]
        assert_true('DateTable' in table_names, 'DateTable created')
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Integrity: no DateTable when no date columns')
def test_integrity_no_date_table():
    path = '_stress_integ_nodate.xlsx'
    try:
        df = pd.DataFrame({'ID': [1, 2], 'Name': ['A', 'B']})
        write_excel(path, {'Simple': df})
        _, _, _, pbit = full_pipeline(path)
        model = validate_pbit(pbit)
        table_names = [t['name'] for t in model['model']['tables']]
        assert_true('DateTable' not in table_names, 'no DateTable')
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))


# ── 5. PERFORMANCE BENCHMARKS ───────────────────────────────

@_test_label('Perf: 100k rows parse + analyze under 15s')
def test_perf_100k():
    path = '_stress_perf_100k.xlsx'
    try:
        df = pd.DataFrame({
            'ID': range(100000),
            'Val': np.random.uniform(0, 1000, 100000),
            'Cat': np.random.choice(['A', 'B', 'C'], 100000)
        })
        write_excel(path, {'Perf': df})
        t0 = time.perf_counter()
        full_pipeline(path)
        elapsed = time.perf_counter() - t0
        assert_true(elapsed < 15, f'completed in {elapsed:.1f}s (limit 15s)')
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))

@_test_label('Perf: 10 tables × 1000 rows relationship detection under 5s')
def test_perf_10_tables():
    path = '_stress_perf_10t.xlsx'
    try:
        sheets = {}
        for i in range(10):
            sheets[f'Table{i}'] = pd.DataFrame({
                'ID': range(1, 1001),
                'Table0ID': np.random.randint(1, 1001, 1000) if i > 0 else range(1, 1001),
                f'Metric{i}': np.random.uniform(0, 100, 1000)
            })
        write_excel(path, sheets)
        t0 = time.perf_counter()
        _, _, rels, _ = full_pipeline(path)
        elapsed = time.perf_counter() - t0
        assert_true(elapsed < 5, f'completed in {elapsed:.1f}s (limit 5s)')
    finally:
        cleanup(path, path.replace('.xlsx', '.pbit'))


# ── Run All Tests ────────────────────────────────────────────

def main():
    print('=' * 60)
    print('  POWER BI GENERATOR — STRESS TEST SUITE')
    print('=' * 60)
    print()

    all_tests = [
        # Scale
        test_10k_rows, test_50k_rows, test_50_columns, test_15_sheets, test_100k_with_rels,
        # Edge cases
        test_empty_sheet, test_special_chars, test_all_nulls, test_mixed_types,
        test_literal_null_strings_in_typed_columns, test_date_like_column_with_asap, test_single_row, test_single_column, test_unicode, test_long_col_names,
        test_duplicate_cols, test_boolean_cols,
        # Relationships
        test_rel_standard_fk, test_rel_star_schema, test_rel_none, test_rel_underscore_fk,
        test_rel_many_to_many, test_rel_chain, test_rel_ambiguous_multi_path,
        # Integrity
        test_integrity_schema, test_integrity_rels_in_model, test_integrity_measures,
        test_integrity_expression, test_integrity_expression_quoted_path, test_integrity_date_table, test_integrity_no_date_table,
        # Performance
        test_perf_100k, test_perf_10_tables
    ]

    sections = [
        ('SCALE TESTS', all_tests[:5]),
        ('EDGE CASE TESTS', all_tests[5:17]),
        ('RELATIONSHIP TESTS', all_tests[17:24]),
        ('INTEGRITY TESTS', all_tests[24:31]),
        ('PERFORMANCE BENCHMARKS', all_tests[31:])
    ]

    for section_name, tests in sections:
        print(f'-- {section_name} {"-" * (45 - len(section_name))}')
        for t in tests:
            run_test(t)
        print()

    # Summary
    total = PASS + FAIL
    print('=' * 60)
    print(f'  RESULTS: {PASS}/{total} passed, {FAIL} failed')
    total_time = sum(r['time'] for r in RESULTS)
    print(f'  TOTAL TIME: {total_time:.2f}s')
    print('=' * 60)

    if FAIL > 0:
        print('\n  FAILED TESTS:')
        for r in RESULTS:
            if r['status'] == 'FAIL':
                print(f'    [FAIL] {r["name"]}: {r["detail"]}')
        print()

    return FAIL == 0


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    success = main()

    # Final cleanup of any leftover stress test files
    import glob, gc
    gc.collect()
    for f in glob.glob('_stress_*'):
        try:
            os.remove(f)
        except Exception:
            pass

    sys.exit(0 if success else 1)
