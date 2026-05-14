"""
pbit_generator.py
==================
Generates a Power BI Template (.pbit) file.

A .pbit file is a ZIP archive containing:
  - [Content_Types].xml
    - DataModelSchema (UTF-16LE encoded JSON without BOM - Tabular Object Model)
  - DiagramLayout (JSON)
  - Report/Layout (JSON - report pages and visuals)
  - Metadata (JSON)
  - Settings (JSON)
  - Version (plain text)
"""

import json
import re
import zipfile
import os


class PbitGenerator:
    """Generates a Power BI Template (.pbit) file from analyzed table data."""

    # Power BI data type mapping
    TYPE_MAP = {
        'string': {'dataType': 'string', 'sourceProviderType': 'nvarchar'},
        'int64': {'dataType': 'int64', 'sourceProviderType': 'bigint'},
        'double': {'dataType': 'double', 'sourceProviderType': 'float'},
        'boolean': {'dataType': 'boolean', 'sourceProviderType': 'bit'},
        'dateTime': {'dataType': 'dateTime', 'sourceProviderType': 'datetime2'},
        'decimal': {'dataType': 'decimal', 'sourceProviderType': 'decimal'},
    }

    def __init__(self, tables, table_schemas, relationships, source_file_path, header_rows=None):
        """
        Args:
            tables: dict of {table_name: DataFrame}
            table_schemas: dict of {table_name: schema_dict}
            relationships: list of relationship dicts
            source_file_path: original Excel file path (used for connection string)
            header_rows: dict of {table_name: int} header row offsets (0-based).
                Older dict payloads with a header_idx key are also accepted.
        """
        self.tables = tables
        self.schemas = table_schemas
        self.relationships = relationships
        self.source_file_path = self._normalize_source_file_path(source_file_path)
        self.header_rows = header_rows or {}

    def _encode_utf16le(self, text, with_bom=False):
        """Encode text as UTF-16LE without BOM (Power BI V3 requirement)."""
        encoded = text.encode('utf-16-le')
        return (b'\xff\xfe' + encoded) if with_bom else encoded

    def generate(self, output_path):
        """Generate the .pbit file."""
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            # [Content_Types].xml — OPC package part declarations
            zf.writestr('[Content_Types].xml', self._content_types())

            # _rels/.rels — OPC root relationships (required by Power BI)
            zf.writestr('_rels/.rels', self._root_rels())

            # Version must be UTF-16LE without BOM.
            zf.writestr('Version', self._encode_utf16le('1.25', with_bom=False))

            # DataModelSchema must be UTF-16LE without BOM.
            schema_json = self._data_model_schema()
            zf.writestr('DataModelSchema', self._encode_utf16le(schema_json, with_bom=False))

            # Report JSON parts use UTF-16LE without BOM.
            zf.writestr('DiagramLayout', self._encode_utf16le(json.dumps(self._diagram_layout(), indent=2), with_bom=False))

            zf.writestr('Report/Layout', self._encode_utf16le(json.dumps(self._report_layout(), indent=2), with_bom=False))

            zf.writestr('Metadata', self._encode_utf16le(json.dumps(self._metadata(), indent=2), with_bom=False))

            zf.writestr('Settings', self._encode_utf16le(json.dumps(self._settings(), indent=2), with_bom=False))

    def _content_types(self):
        """Generate [Content_Types].xml — OPC package content type declarations."""
        return '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="xml" ContentType="application/xml" />
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Override PartName="/Version" ContentType="" />
  <Override PartName="/DataModelSchema" ContentType="" />
  <Override PartName="/DiagramLayout" ContentType="" />
  <Override PartName="/Report/Layout" ContentType="" />
  <Override PartName="/Settings" ContentType="" />
  <Override PartName="/Metadata" ContentType="" />
</Types>'''

    def _root_rels(self):
        """Generate _rels/.rels — OPC root relationships file."""
        return '''<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships" />'''

    def _data_model_schema(self):
        """Generate the DataModelSchema JSON (Tabular Object Model)."""
        model = {
            "name": "Model",
            "compatibilityLevel": 1550,
            "model": {
                "culture": "en-US",
                "dataAccessOptions": {
                    "legacyRedirects": True,
                    "returnErrorValuesAsNull": True
                },
                "defaultPowerBIDataSourceVersion": "powerBI_V3",
                "sourceQueryCulture": "en-US",
                "tables": self._build_tables(),
                "relationships": self._build_relationships(),
                "expressions": self._build_expressions(),
                "annotations": [
                    {
                        "name": "PBI_QueryOrder",
                        "value": json.dumps(list(self.tables.keys()))
                    },
                    {
                        "name": "__PBI_TimeIntelligenceEnabled",
                        "value": "1"
                    },
                    {
                        "name": "PBIDesktopVersion",
                        "value": "2.128.0.0 (24.04)"
                    },
                    {
                        "name": "TabularEditor_SerializeOptions",
                        "value": json.dumps({
                            "IgnoreInferredObjects": True,
                            "IgnoreInferredProperties": True,
                            "IgnoreTimestamps": True
                        })
                    }
                ]
            }
        }

        return json.dumps(model, indent=2, ensure_ascii=False)

    def _build_tables(self):
        """Build table definitions for the tabular model."""
        tables = []

        for table_name, schema in self.schemas.items():
            table_def = {
                "name": table_name,
                "columns": self._build_columns(table_name, schema),
                "partitions": [
                    {
                        "name": f"{table_name}-partition",
                        "mode": "import",
                        "source": {
                            "type": "m",
                            "expression": self._build_m_query(table_name)
                        }
                    }
                ],
                "annotations": [
                    {
                        "name": "PBI_NavigationStepName",
                        "value": "Navigation"
                    },
                    {
                        "name": "PBI_ResultType",
                        "value": "Table"
                    }
                ]
            }

            # Add measures for numeric columns
            measures = self._build_measures(table_name, schema)
            if measures:
                table_def["measures"] = measures

            tables.append(table_def)

        # Add a Date table for time intelligence
        date_table = self._build_date_table()
        if date_table:
            tables.append(date_table)

        return tables

    def _build_columns(self, table_name, schema):
        """Build column definitions for a table."""
        columns = []

        for col in schema['columns']:
            type_info = self.TYPE_MAP.get(col['dataType'], self.TYPE_MAP['string'])

            col_def = {
                "name": col['name'],
                "dataType": type_info['dataType'],
                "sourceColumn": col['name'],
                "sourceProviderType": type_info['sourceProviderType']
            }

            # Add formatting for specific types
            if col['dataType'] == 'dateTime':
                col_def["formatString"] = "General Date"
            elif col['dataType'] in ('double', 'decimal'):
                col_def["formatString"] = "#,0.00"
            elif col['dataType'] == 'int64':
                col_def["formatString"] = "#,0"

            # Mark potential sort columns
            if col['uniqueCount'] == col['totalCount'] and col['totalCount'] > 1:
                col_def["annotations"] = [
                    {"name": "PBI_IsUnique", "value": "true"}
                ]

            columns.append(col_def)

        return columns

    def _build_measures(self, table_name, schema):
        """Generate basic DAX measures for numeric columns."""
        measures = []
        numeric_types = {'int64', 'double', 'decimal'}

        for col in schema['columns']:
            if col['dataType'] in numeric_types:
                # Sum measure
                measures.append({
                    "name": f"{table_name} Total {col['name']}",
                    "expression": f"SUM('{table_name}'[{col['name']}])",
                    "formatString": "#,0.00"
                })
                # Count measure for the first numeric column only
                if len(measures) == 1:
                    measures.append({
                        "name": f"{table_name} Count of Records",
                        "expression": f"COUNTROWS('{table_name}')",
                        "formatString": "#,0"
                    })

        return measures[:6]  # Limit to 6 measures per table

    def _build_m_query(self, table_name):
        """Build the minimal workbook query used by every imported sheet.

        This query intentionally stops after Navigation -> optional Skip ->
        PromoteHeaders. Power BI and the browser parser do not always normalize
        header cells identically, so extra transform steps make generated
        templates brittle when handed real-world workbooks.
        """
        escaped_table_name = self._escape_m_string(table_name)
        header_idx = self._header_row_index(table_name)

        m_lines = [
            f"let",
            f"    Source = Excel.Workbook(File.Contents(ExcelFilePath), null, true),",
            f"    Navigation = Source{{[Item=\"{escaped_table_name}\",Kind=\"Sheet\"]}}[Data],",
        ]

        # If the header row is not at row 0, skip the leading rows first
        if header_idx > 0:
            m_lines.append(f"    SkippedRows = Table.Skip(Navigation, {header_idx}),")
            m_lines.append(f"    PromotedHeaders = Table.PromoteHeaders(SkippedRows, [PromoteAllScalars=true])")
        else:
            m_lines.append(f"    PromotedHeaders = Table.PromoteHeaders(Navigation, [PromoteAllScalars=true])")

        m_lines.append(f"in")
        m_lines.append(f"    PromotedHeaders")

        return m_lines

    def _build_expressions(self):
        """Build shared expressions (parameters) for the model."""
        escaped_path = self._escape_m_string(self.source_file_path)
        return [
            {
                "name": "ExcelFilePath",
                "kind": "m",
                "expression": [
                    f"\"{escaped_path}\" meta [IsParameterQuery=true, Type=\"Text\", IsParameterQueryRequired=true]"
                ],
                "annotations": [
                    {
                        "name": "PBI_NavigationStepName",
                        "value": "Navigation"
                    },
                    {
                        "name": "PBI_ResultType",
                        "value": "Text"
                    }
                ]
            }
        ]

    def _escape_m_string(self, value):
        """Escape a value for use inside an M string literal."""
        return str(value).replace('"', '""')

    def _normalize_source_file_path(self, value):
        """Normalize user-provided workbook paths for use in M string literals."""
        normalized = str(value).strip()
        if len(normalized) >= 2 and normalized[0] == normalized[-1] and normalized[0] in ('"', "'"):
            normalized = normalized[1:-1].strip()
        normalized = os.path.normpath(normalized)
        return os.path.abspath(normalized)

    def _header_row_index(self, table_name):
        """Return the stored 0-based header row offset for a table."""
        header_info = self.header_rows.get(table_name, 0)
        if isinstance(header_info, dict):
            return header_info.get('header_idx', 0)
        return header_info

    def _build_relationships(self):
        """Build relationship definitions for the tabular model."""
        relationships = []

        for i, rel in enumerate(self.relationships):
            safe_from = re.sub(r'[^\w]', '_', rel['fromTable'])
            safe_to = re.sub(r'[^\w]', '_', rel['toTable'])
            rel_def = {
                "name": f"rel_{i}_{safe_from}_{safe_to}",
                "fromTable": rel['fromTable'],
                "fromColumn": rel['fromColumn'],
                "toTable": rel['toTable'],
                "toColumn": rel['toColumn'],
                "crossFilteringBehavior": rel.get('crossFilteringBehavior', 'oneDirection')
            }

            # Set cardinality
            cardinality = rel.get('cardinality', 'manyToOne')
            if cardinality == 'manyToMany':
                rel_def["fromCardinality"] = "many"
                rel_def["toCardinality"] = "many"
            elif cardinality == 'oneToOne':
                rel_def["fromCardinality"] = "one"
                rel_def["toCardinality"] = "one"
            # manyToOne is the default, no need to specify

            relationships.append(rel_def)

        return relationships

    def _build_date_table(self):
        """Build a standard Date dimension table using DAX."""
        # Check if any table has date columns
        has_dates = False
        for schema in self.schemas.values():
            for col in schema['columns']:
                if col['dataType'] == 'dateTime':
                    has_dates = True
                    break
            if has_dates:
                break

        if not has_dates:
            return None

        return {
            "name": "DateTable",
            "columns": [
                {"name": "Date", "dataType": "dateTime", "sourceColumn": "Date",
                 "formatString": "General Date", "isKey": True},
                {"name": "Year", "dataType": "int64", "sourceColumn": "Year"},
                {"name": "Month", "dataType": "int64", "sourceColumn": "Month"},
                {"name": "MonthName", "dataType": "string", "sourceColumn": "MonthName",
                 "sortByColumn": "Month"},
                {"name": "Quarter", "dataType": "int64", "sourceColumn": "Quarter"},
                {"name": "DayOfWeek", "dataType": "int64", "sourceColumn": "DayOfWeek"},
                {"name": "DayName", "dataType": "string", "sourceColumn": "DayName",
                 "sortByColumn": "DayOfWeek"}
            ],
            "partitions": [
                {
                    "name": "DateTable-partition",
                    "mode": "import",
                    "source": {
                        "type": "calculated",
                        "expression": [
                            "ADDCOLUMNS(",
                            "    CALENDAR(DATE(2020, 1, 1), DATE(2030, 12, 31)),",
                            "    \"Year\", YEAR([Date]),",
                            "    \"Month\", MONTH([Date]),",
                            "    \"MonthName\", FORMAT([Date], \"MMMM\"),",
                            "    \"Quarter\", QUARTER([Date]),",
                            "    \"DayOfWeek\", WEEKDAY([Date]),",
                            "    \"DayName\", FORMAT([Date], \"dddd\")",
                            ")"
                        ]
                    }
                }
            ],
            "annotations": [
                {"name": "PBI_ResultType", "value": "Table"}
            ]
        }

    def _diagram_layout(self):
        """Generate diagram layout for the model view."""
        nodes = []
        x_pos = 50
        y_pos = 50
        col_count = 0

        for table_name in self.tables.keys():
            nodes.append({
                "name": table_name,
                "nodeIndex": len(nodes),
                "x": x_pos,
                "y": y_pos,
                "width": 200,
                "height": 300
            })
            x_pos += 280
            col_count += 1
            if col_count >= 4:
                col_count = 0
                x_pos = 50
                y_pos += 380

        return {
            "version": "1.0",
            "pages": [
                {
                    "name": "Main",
                    "nodes": nodes
                }
            ]
        }

    def _build_readme_text(self):
        """Build the README text for the first report page."""
        table_names = list(self.schemas.keys())
        total_rows = sum(s['rowCount'] for s in self.schemas.values())
        total_cols = sum(len(s['columns']) for s in self.schemas.values())

        lines = [
            '\U0001f4cb POWER BI TEMPLATE \u2014 SETUP GUIDE',
            '',
            '\u2501' * 46,
            '',
            '1\ufe0f\u20e3  SET THE EXCEL FILE PATH',
            '\u2500' * 33,
            'This template loads data from an Excel workbook.',
            'On first open, Power BI will prompt you to set the file path.',
            '',
            '   Current path parameter:',
            f'   {self.source_file_path}',
            '',
            '   To change it later:',
            '   \u2022 Go to Home \u2192 Transform Data \u2192 Edit Parameters',
            '   \u2022 Update "ExcelFilePath" to the full Windows path of your .xlsx file',
            '   \u2022 Click Close & Apply',
            '',
            '\u2501' * 46,
            '',
            f'2\ufe0f\u20e3  DATA TABLES ({len(table_names)} tables, {total_rows:,} rows, {total_cols} columns)',
            '\u2500' * 33,
        ]

        for table_name, schema in self.schemas.items():
            col_types = {}
            for c in schema['columns']:
                col_types[c['dataType']] = col_types.get(c['dataType'], 0) + 1
            type_summary = ', '.join(f'{n} {t}' for t, n in col_types.items())
            lines.append(f'   \U0001f4ca {table_name}  \u2014  {schema["rowCount"]} rows \u00d7 {len(schema["columns"])} cols ({type_summary})')
            col_list = [f'{c["name"]} [{c["dataType"]}]' for c in schema['columns'][:12]]
            extra = f'  \u2026+{len(schema["columns"]) - 12} more' if len(schema['columns']) > 12 else ''
            lines.append(f'      Columns: {", ".join(col_list)}{extra}')

        lines.append('')
        lines.append('\u2501' * 46)
        lines.append('')
        lines.append(f'3\ufe0f\u20e3  RELATIONSHIPS ({len(self.relationships)} detected)')
        lines.append('\u2500' * 33)

        if not self.relationships:
            lines.append('   No relationships were auto-detected.')
            lines.append('   You can add them manually in the Model view.')
        else:
            card_labels = {'manyToOne': 'Many\u2192One', 'oneToOne': 'One\u2192One', 'manyToMany': 'Many\u2192Many'}
            for rel in self.relationships:
                card = card_labels.get(rel.get('cardinality', ''), rel.get('cardinality', ''))
                lines.append(f'   \U0001f517 {rel["fromTable"]}.{rel["fromColumn"]}  \u2192  {rel["toTable"]}.{rel["toColumn"]}  ({card})')

        lines.append('')
        lines.append('\u2501' * 46)
        lines.append('')
        lines.append('4\ufe0f\u20e3  NEXT STEPS')
        lines.append('\u2500' * 33)
        lines.append('   \u2022 Click "Data Overview" tab to see your data tables')
        lines.append('   \u2022 Switch to Model view to review/edit relationships')
        lines.append('   \u2022 Add new report pages with your own visuals')
        lines.append('   \u2022 Create DAX measures for custom calculations')
        lines.append('   \u2022 Save as .pbix once data is loaded successfully')
        lines.append('')
        lines.append('Generated by Power BI Template Builder')

        return '\n'.join(lines)

    def _report_layout(self):
        """Generate a report layout using the real Power BI section/visualContainer schema."""
        import uuid

        report_config = {
            "version": "5.50",
            "themeCollection": {
                "baseTheme": {
                    "name": "CY23SU08",
                    "version": "5.50",
                    "type": 2
                }
            },
            "activeSectionIndex": 0,
            "defaultDrillFilterOtherVisuals": True,
            "slowDataSourceSettings": {
                "isCrossHighlightingDisabled": False,
                "isSlicerSelectionsButtonEnabled": False,
                "isFilterSelectionsButtonEnabled": False,
                "isFieldWellButtonEnabled": False,
                "isApplyAllButtonEnabled": False
            }
        }

        visual_containers = []
        vx, vy, z_order = 50, 50, 0

        for table_name, schema in self.schemas.items():
            cols = schema['columns'][:8]
            projections = {}
            prototype_query = {
                "Version": 2,
                "From": [{"Name": "t", "Entity": table_name, "Type": 0}],
                "Select": []
            }
            for col in cols:
                prototype_query["Select"].append({
                    "Column": {
                        "Expression": {"SourceRef": {"Source": "t"}},
                        "Property": col['name']
                    },
                    "Name": f"{table_name}.{col['name']}"
                })
                projections.setdefault("Values", []).append(
                    {"queryRef": f"{table_name}.{col['name']}"}
                )

            vc_config = {
                "name": str(uuid.uuid4()),
                "layouts": [{
                    "id": 0,
                    "position": {"x": vx, "y": vy, "z": z_order, "width": 500, "height": 300}
                }],
                "singleVisual": {
                    "visualType": "tableEx",
                    "projections": projections,
                    "prototypeQuery": prototype_query,
                    "drillFilterOtherVisuals": True
                }
            }

            visual_containers.append({
                "x": vx,
                "y": vy,
                "z": z_order,
                "width": 500,
                "height": 300,
                "config": json.dumps(vc_config),
                "filters": "[]",
                "tabOrder": z_order
            })

            z_order += 1
            vx += 550
            if vx > 1100:
                vx = 50
                vy += 350

        section_config = {
            "name": "ReportSection",
            "layouts": [{"id": 0, "position": {}}],
            "singleVisualGroup": None
        }

        # --- README page (first page) ---
        readme_text = self._build_readme_text()
        readme_vc_config = {
            "name": str(uuid.uuid4()),
            "layouts": [{
                "id": 0,
                "position": {"x": 30, "y": 20, "z": 0, "width": 1220, "height": 660}
            }],
            "singleVisual": {
                "visualType": "textbox",
                "objects": {
                    "general": [{
                        "properties": {
                            "paragraphs": [{
                                "textRuns": [{
                                    "value": readme_text,
                                    "textStyle": {
                                        "fontFamily": "Segoe UI",
                                        "fontSize": "10pt"
                                    }
                                }]
                            }]
                        }
                    }]
                }
            }
        }

        readme_section_config = {
            "name": "ReadmeSection",
            "layouts": [{"id": 0, "position": {}}],
            "singleVisualGroup": None
        }

        readme_section = {
            "name": "ReadmeSection",
            "displayName": "README - Setup Guide",
            "filters": "[]",
            "ordinal": 0,
            "visualContainers": [{
                "x": 30,
                "y": 20,
                "z": 0,
                "width": 1220,
                "height": 660,
                "config": json.dumps(readme_vc_config),
                "filters": "[]",
                "tabOrder": 0
            }],
            "config": json.dumps(readme_section_config),
            "width": 1280,
            "height": 720
        }

        return {
            "id": 0,
            "reportId": str(uuid.uuid4()),
            "sections": [
                readme_section,
                {
                    "name": "ReportSection",
                    "displayName": "Data Overview",
                    "filters": "[]",
                    "ordinal": 1,
                    "visualContainers": visual_containers,
                    "config": json.dumps(section_config),
                    "width": 1280,
                    "height": 720
                }
            ],
            "config": json.dumps(report_config),
            "layoutOptimization": 0
        }

    def _metadata(self):
        """Generate metadata."""
        return {
            "Version": 5,
            "AutoCreatedRelationships": [],
            "FileDescription": "",
            "CreatedFrom": "Cloud",
            "CreatedFromRelease": "2022.03"
        }

    def _settings(self):
        """Generate settings."""
        return {
            "Version": 1,
            "ReportSettings": {},
            "QueriesSettings": {
                "TypeDetectionEnabled": True,
                "RelationshipImportEnabled": True,
                "RunBackgroundAnalysis": True,
                "Version": "2.81.5831.821"
            }
        }
