/* ===========================================
   powerbi-pbit-generator.js
   Generates a Power BI Template (.pbit) file
   in the browser using JSZip. The .pbit is a
   ZIP archive with the Tabular Object Model.
   =========================================== */

const PbitGenerator = (() => {
    'use strict';

    const TYPE_MAP = {
        'string':   { dataType: 'string',   sourceProviderType: 'nvarchar' },
        'int64':    { dataType: 'int64',    sourceProviderType: 'bigint' },
        'double':   { dataType: 'double',   sourceProviderType: 'float' },
        'boolean':  { dataType: 'boolean',  sourceProviderType: 'bit' },
        'dateTime': { dataType: 'dateTime', sourceProviderType: 'datetime2' },
        'decimal':  { dataType: 'decimal',  sourceProviderType: 'decimal' }
    };

    /**
     * Generate a .pbit file and trigger download.
     * @param {Object} tables - parsed tables
     * @param {Object} schemas - analyzed schemas
     * @param {Array} relationships - detected relationships
     * @param {Object} options - { excelFilePath, generateMeasures, generateDateTable, fileName }
     * @returns {Promise<{ blob: Blob, modelJson: string, stats: Object }>}
     */
    async function generate(tables, schemas, relationships, options) {
        const excelPath = normalizeExcelPath(options.excelFilePath || 'C:\\Data\\YourFile.xlsx');
        const genMeasures = options.generateMeasures !== false;
        const genDateTable = options.generateDateTable !== false;

        const modelSchema = buildDataModelSchema(tables, schemas, relationships, excelPath, genMeasures, genDateTable);
        const modelJson = JSON.stringify(modelSchema, null, 2);

        const reportLayout = buildReportLayout(tables, schemas, relationships, excelPath);

        const schemaUtf16 = encodeUTF16LE(modelJson, false);

        const zip = new JSZip();

        // OPC package structure. All JSON/string parts are UTF-16LE without BOM.
        zip.file('[Content_Types].xml', buildContentTypes());
        zip.file('_rels/.rels', buildRootRels());
        zip.file('Version', encodeUTF16LE('1.25', false));
        zip.file('DataModelSchema', schemaUtf16);
        zip.file('DiagramLayout', encodeUTF16LE(JSON.stringify(buildDiagramLayout(tables), null, 2), false));
        zip.file('Report/Layout', encodeUTF16LE(JSON.stringify(reportLayout, null, 2), false));
        zip.file('Metadata', encodeUTF16LE(JSON.stringify(buildMetadata(), null, 2), false));
        zip.file('Settings', encodeUTF16LE(JSON.stringify(buildSettings(), null, 2), false));

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await validateGeneratedPackage(blob);

        const stats = {
            tableCount: Object.keys(tables).length,
            relationshipCount: relationships.length,
            totalRows: Object.values(schemas).reduce((sum, s) => sum + s.rowCount, 0),
            totalColumns: Object.values(schemas).reduce((sum, s) => sum + s.columns.length, 0),
            fileSize: blob.size
        };

        return { blob, modelJson, stats };
    }

    async function validateGeneratedPackage(blob) {
        const zip = await JSZip.loadAsync(blob);
        const required = ['[Content_Types].xml', '_rels/.rels', 'Version', 'DataModelSchema', 'DiagramLayout', 'Report/Layout', 'Metadata', 'Settings'];
        for (const name of required) {
            if (!zip.file(name)) {
                throw new Error('Generated package is missing required part: ' + name);
            }
        }

        const versionBytes = await zip.file('Version').async('uint8array');
        if (hasUtf16Bom(versionBytes)) {
            throw new Error('Generated package has an invalid BOM in Version.');
        }
        if (decodeUtf16LE(versionBytes) !== '1.25') {
            throw new Error('Generated package has an invalid Version part.');
        }

        const schemaBytes = await zip.file('DataModelSchema').async('uint8array');
        if (hasUtf16Bom(schemaBytes)) {
            throw new Error('Generated package has an invalid BOM in DataModelSchema.');
        }
        const schemaJson = decodeUtf16LE(schemaBytes);
        const model = JSON.parse(schemaJson);
        if (!model.model || !Array.isArray(model.model.tables)) {
            throw new Error('Generated DataModelSchema is invalid.');
        }

        for (const name of ['DiagramLayout', 'Report/Layout', 'Metadata', 'Settings']) {
            const bytes = await zip.file(name).async('uint8array');
            if (hasUtf16Bom(bytes)) {
                throw new Error('Generated package has an unexpected BOM in ' + name + '.');
            }
            const parsed = JSON.parse(decodeUtf16LE(bytes));
            if (name === 'Report/Layout') {
                validateStringConfigs(parsed);
            } else if (name === 'Metadata') {
                validateMetadata(parsed);
            } else if (name === 'Settings') {
                validateSettings(parsed);
            }
        }
    }

    function validateStringConfigs(value) {
        if (Array.isArray(value)) {
            for (const item of value) validateStringConfigs(item);
            return;
        }
        if (!value || typeof value !== 'object') return;

        for (const [key, child] of Object.entries(value)) {
            if (key === 'config' && typeof child !== 'string') {
                throw new Error('Generated report layout has a non-string config field.');
            }
            validateStringConfigs(child);
        }
    }

    function validateMetadata(value) {
        if (value.Version !== 5 || !Array.isArray(value.AutoCreatedRelationships)) {
            throw new Error('Generated report metadata has an invalid shape.');
        }
    }

    function validateSettings(value) {
        if (value.Version !== 1 || typeof value.ReportSettings !== 'object' || typeof value.QueriesSettings !== 'object') {
            throw new Error('Generated report settings has an invalid shape.');
        }
    }

    function hasUtf16Bom(bytes) {
        return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
    }

    function decodeUtf16LE(bytes, stripBom) {
        let view = bytes;
        if (stripBom && hasUtf16Bom(bytes)) {
            view = bytes.slice(2);
        }
        return new TextDecoder('utf-16le').decode(view);
    }

    function encodeUTF16LE(str, withBOM) {
        const encoder = new TextEncoder();
        const bomLen = withBOM ? 1 : 0;
        const buf = new ArrayBuffer((str.length + bomLen) * 2);
        const view = new Uint16Array(buf);
        let offset = 0;
        if (withBOM) {
            view[0] = 0xFEFF;
            offset = 1;
        }
        for (let i = 0; i < str.length; i++) {
            view[i + offset] = str.charCodeAt(i);
        }
        return new Uint8Array(buf);
    }

    // --- Content Types ---
    function buildContentTypes() {
        return `<?xml version="1.0" encoding="utf-8"?>
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
</Types>`;
    }

    function buildRootRels() {
        return `<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships" />`;
    }

    // --- Data Model Schema ---
    function buildDataModelSchema(tables, schemas, relationships, excelPath, genMeasures, genDateTable) {
        const modelTables = buildTables(tables, schemas, excelPath, genMeasures);

        if (genDateTable) {
            const dateTable = buildDateTable(schemas);
            if (dateTable) modelTables.push(dateTable);
        }

        return {
            name: 'Model',
            compatibilityLevel: 1550,
            model: {
                culture: 'en-US',
                dataAccessOptions: {
                    legacyRedirects: true,
                    returnErrorValuesAsNull: true
                },
                defaultPowerBIDataSourceVersion: 'powerBI_V3',
                sourceQueryCulture: 'en-US',
                tables: modelTables,
                relationships: buildRelationships(relationships),
                expressions: buildExpressions(excelPath),
                annotations: [
                    { name: 'PBI_QueryOrder', value: JSON.stringify(Object.keys(tables)) },
                    { name: '__PBI_TimeIntelligenceEnabled', value: '1' },
                    { name: 'PBIDesktopVersion', value: '2.128.0.0 (24.04)' }
                ]
            }
        };
    }

    function buildTables(tables, schemas, excelPath, genMeasures) {
        const result = [];

        for (const [tableName, schema] of Object.entries(schemas)) {
            const table = tables[tableName];
            const tableDef = {
                name: tableName,
                columns: buildColumns(schema),
                partitions: [{
                    name: tableName + '-partition',
                    mode: 'import',
                    source: {
                        type: 'm',
                        expression: buildMQuery(tableName, table.sheetName, table.headerRowIndex || 0)
                    }
                }],
                annotations: [
                    { name: 'PBI_NavigationStepName', value: 'Navigation' },
                    { name: 'PBI_ResultType', value: 'Table' }
                ]
            };

            if (genMeasures) {
                const measures = buildMeasures(tableName, schema);
                if (measures.length > 0) tableDef.measures = measures;
            }

            result.push(tableDef);
        }

        return result;
    }

    function buildColumns(schema) {
        return schema.columns.map(col => {
            const typeInfo = TYPE_MAP[col.dataType] || TYPE_MAP['string'];
            const colDef = {
                name: col.name,
                dataType: typeInfo.dataType,
                sourceColumn: col.name,
                sourceProviderType: typeInfo.sourceProviderType
            };

            if (col.dataType === 'dateTime') colDef.formatString = 'General Date';
            else if (col.dataType === 'double' || col.dataType === 'decimal') colDef.formatString = '#,0.00';
            else if (col.dataType === 'int64') colDef.formatString = '#,0';

            if (col.uniqueCount === col.totalCount && col.totalCount > 1) {
                colDef.annotations = [{ name: 'PBI_IsUnique', value: 'true' }];
            }

            return colDef;
        });
    }

    function buildMeasures(tableName, schema) {
        const measures = [];
        const numericTypes = new Set(['int64', 'double', 'decimal']);

        for (const col of schema.columns) {
            if (numericTypes.has(col.dataType)) {
                measures.push({
                    name: `${tableName} Total ${col.name}`,
                    expression: `SUM('${tableName}'[${col.name}])`,
                    formatString: '#,0.00'
                });
                if (measures.length === 1) {
                    measures.push({
                        name: `${tableName} Count of Records`,
                        expression: `COUNTROWS('${tableName}')`,
                        formatString: '#,0'
                    });
                }
            }
        }
        return measures.slice(0, 6);
    }

    function buildMQuery(tableName, originalSheetName, headerRowIndex) {
        const sheetRef = originalSheetName || tableName;
        const escapedSheetRef = escapeMString(sheetRef);
        const lines = [
            'let',
            '    Source = Excel.Workbook(File.Contents(ExcelFilePath), null, true),',
            `    Navigation = Source{[Item="${escapedSheetRef}",Kind="Sheet"]}[Data],`,
        ];

        // Keep the workbook query intentionally minimal. Power BI and the
        // browser parser can normalize header cells differently, so extra M
        // transforms tend to make generated templates brittle.
        // If the header row is not at row 0, skip the leading rows first
        if (headerRowIndex > 0) {
            lines.push(`    SkippedRows = Table.Skip(Navigation, ${headerRowIndex}),`);
            lines.push('    PromotedHeaders = Table.PromoteHeaders(SkippedRows, [PromoteAllScalars=true])');
        } else {
            lines.push('    PromotedHeaders = Table.PromoteHeaders(Navigation, [PromoteAllScalars=true])');
        }

        lines.push('in');
        lines.push('    PromotedHeaders');

        return lines;
    }

    function buildExpressions(excelPath) {
        const escapedPath = escapeMString(normalizeExcelPath(excelPath));
        return [{
            name: 'ExcelFilePath',
            kind: 'm',
            expression: [
                `"${escapedPath}" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`
            ],
            annotations: [
                { name: 'PBI_NavigationStepName', value: 'Navigation' },
                { name: 'PBI_ResultType', value: 'Text' }
            ]
        }];
    }

    function escapeMString(value) {
        return String(value).replace(/"/g, '""');
    }

    function getMTransformExpression(dataType) {
        const transforms = {
            string: 'each if _ = null then null else Text.From(_)',
            int64: 'each if _ = null then null else try Int64.From(_) otherwise null',
            double: 'each if _ = null then null else try Number.From(_) otherwise null',
            decimal: 'each if _ = null then null else try Number.From(_) otherwise null',
            boolean: 'each if _ = null then null else try Logical.From(_) otherwise null',
            dateTime: 'each if _ = null then null else try DateTime.From(_) otherwise null'
        };
        return transforms[dataType] || transforms.string;
    }

    function normalizeExcelPath(value) {
        let normalized = String(value || '').trim();
        if (normalized.length >= 2) {
            const quote = normalized[0];
            if ((quote === '"' || quote === "'") && normalized[normalized.length - 1] === quote) {
                normalized = normalized.slice(1, -1).trim();
            }
        }
        return normalized.replace(/\//g, '\\');
    }

    function sanitizeRelName(str) {
        return String(str).replace(/[^\w]/g, '_');
    }

    function buildRelationships(relationships) {
        return relationships.map((rel, i) => {
            const relDef = {
                name: `rel_${i}_${sanitizeRelName(rel.fromTable)}_${sanitizeRelName(rel.toTable)}`,
                fromTable: rel.fromTable,
                fromColumn: rel.fromColumn,
                toTable: rel.toTable,
                toColumn: rel.toColumn,
                crossFilteringBehavior: rel.crossFilteringBehavior || 'oneDirection'
            };

            const cardinality = rel.cardinality || 'manyToOne';
            if (cardinality === 'manyToMany') {
                relDef.fromCardinality = 'many';
                relDef.toCardinality = 'many';
            } else if (cardinality === 'oneToOne') {
                relDef.fromCardinality = 'one';
                relDef.toCardinality = 'one';
            }

            return relDef;
        });
    }

    function buildDateTable(schemas) {
        let hasDates = false;
        for (const schema of Object.values(schemas)) {
            if (schema.columns.some(c => c.dataType === 'dateTime')) {
                hasDates = true;
                break;
            }
        }
        if (!hasDates) return null;

        return {
            name: 'DateTable',
            columns: [
                { name: 'Date', dataType: 'dateTime', sourceColumn: 'Date', formatString: 'General Date', isKey: true },
                { name: 'Year', dataType: 'int64', sourceColumn: 'Year' },
                { name: 'Month', dataType: 'int64', sourceColumn: 'Month' },
                { name: 'MonthName', dataType: 'string', sourceColumn: 'MonthName', sortByColumn: 'Month' },
                { name: 'Quarter', dataType: 'int64', sourceColumn: 'Quarter' },
                { name: 'DayOfWeek', dataType: 'int64', sourceColumn: 'DayOfWeek' },
                { name: 'DayName', dataType: 'string', sourceColumn: 'DayName', sortByColumn: 'DayOfWeek' }
            ],
            partitions: [{
                name: 'DateTable-partition',
                mode: 'import',
                source: {
                    type: 'calculated',
                    expression: [
                        'ADDCOLUMNS(',
                        '    CALENDAR(DATE(2020, 1, 1), DATE(2030, 12, 31)),',
                        '    "Year", YEAR([Date]),',
                        '    "Month", MONTH([Date]),',
                        '    "MonthName", FORMAT([Date], "MMMM"),',
                        '    "Quarter", QUARTER([Date]),',
                        '    "DayOfWeek", WEEKDAY([Date]),',
                        '    "DayName", FORMAT([Date], "dddd")',
                        ')'
                    ]
                }
            }],
            annotations: [{ name: 'PBI_ResultType', value: 'Table' }]
        };
    }

    // --- Diagram Layout ---
    function buildDiagramLayout(tables) {
        const nodes = [];
        let x = 50, y = 50, col = 0;

        for (const tableName of Object.keys(tables)) {
            nodes.push({ name: tableName, nodeIndex: nodes.length, x, y, width: 200, height: 300 });
            x += 280;
            col++;
            if (col >= 4) { col = 0; x = 50; y += 380; }
        }

        return { version: '1.0', pages: [{ name: 'Main', nodes }] };
    }

    // --- Report Layout ---
    function buildReadmeText(tables, schemas, relationships, excelPath) {
        const tableNames = Object.keys(schemas);
        const totalRows = Object.values(schemas).reduce((s, t) => s + t.rowCount, 0);
        const totalCols = Object.values(schemas).reduce((s, t) => s + t.columns.length, 0);

        const lines = [
            '📋 POWER BI TEMPLATE — SETUP GUIDE',
            '',
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            '',
            '1️⃣  SET THE EXCEL FILE PATH',
            '─────────────────────────────────',
            'This template loads data from an Excel workbook.',
            'On first open, Power BI will prompt you to set the file path.',
            '',
            '   Current path parameter:',
            '   ' + excelPath,
            '',
            '   To change it later:',
            '   • Go to Home → Transform Data → Edit Parameters',
            '   • Update "ExcelFilePath" to the full Windows path of your .xlsx file',
            '   • Click Close & Apply',
            '',
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            '',
            '2️⃣  DATA TABLES (' + tableNames.length + ' tables, ' + totalRows.toLocaleString() + ' rows, ' + totalCols + ' columns)',
            '─────────────────────────────────',
        ];

        for (const [tableName, schema] of Object.entries(schemas)) {
            const colTypes = {};
            schema.columns.forEach(c => { colTypes[c.dataType] = (colTypes[c.dataType] || 0) + 1; });
            const typeSummary = Object.entries(colTypes).map(([t, n]) => n + ' ' + t).join(', ');
            lines.push('   📊 ' + tableName + '  —  ' + schema.rowCount + ' rows × ' + schema.columns.length + ' cols (' + typeSummary + ')');
            const colList = schema.columns.slice(0, 12).map(c => c.name + ' [' + c.dataType + ']');
            lines.push('      Columns: ' + colList.join(', ') + (schema.columns.length > 12 ? '  …+' + (schema.columns.length - 12) + ' more' : ''));
        }

        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push('3️⃣  RELATIONSHIPS (' + relationships.length + ' detected)');
        lines.push('─────────────────────────────────');

        if (relationships.length === 0) {
            lines.push('   No relationships were auto-detected.');
            lines.push('   You can add them manually in the Model view.');
        } else {
            for (const rel of relationships) {
                const card = { manyToOne: 'Many→One', oneToOne: 'One→One', manyToMany: 'Many→Many' }[rel.cardinality] || rel.cardinality;
                lines.push('   🔗 ' + rel.fromTable + '.' + rel.fromColumn + '  →  ' + rel.toTable + '.' + rel.toColumn + '  (' + card + ')');
            }
        }

        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push('4️⃣  NEXT STEPS');
        lines.push('─────────────────────────────────');
        lines.push('   • Click "Data Overview" tab to see your data tables');
        lines.push('   • Switch to Model view to review/edit relationships');
        lines.push('   • Add new report pages with your own visuals');
        lines.push('   • Create DAX measures for custom calculations');
        lines.push('   • Save as .pbix once data is loaded successfully');
        lines.push('');
        lines.push('Generated by Power BI Template Builder');

        return lines.join('\n');
    }

    function buildReportLayout(tables, schemas, relationships, excelPath) {
        const reportConfig = {
            version: '5.50',
            themeCollection: {
                baseTheme: { name: 'CY23SU08', version: '5.50', type: 2 }
            },
            activeSectionIndex: 0,
            defaultDrillFilterOtherVisuals: true,
            slowDataSourceSettings: { isCrossHighlightingDisabled: false, isSlicerSelectionsButtonEnabled: false, isFilterSelectionsButtonEnabled: false, isFieldWellButtonEnabled: false, isApplyAllButtonEnabled: false }
        };

        const visualContainers = [];
        let vx = 50, vy = 50, zOrder = 0;

        for (const [tableName, schema] of Object.entries(schemas)) {
            const projections = {};
            const prototypeQuery = {
                Version: 2,
                From: [{ Name: 't', Entity: tableName, Type: 0 }],
                Select: []
            };
            const cols = schema.columns.slice(0, 8);
            cols.forEach((col, ci) => {
                prototypeQuery.Select.push({
                    Column: { Expression: { SourceRef: { Source: 't' } }, Property: col.name },
                    Name: tableName + '.' + col.name
                });
                if (!projections.Values) projections.Values = [];
                projections.Values.push({ queryRef: tableName + '.' + col.name });
            });

            const vcConfig = {
                name: crypto.randomUUID ? crypto.randomUUID() : ('vc_' + zOrder + '_' + Date.now()),
                layouts: [{
                    id: 0,
                    position: { x: vx, y: vy, z: zOrder, width: 500, height: 300 }
                }],
                singleVisual: {
                    visualType: 'tableEx',
                    projections: projections,
                    prototypeQuery: prototypeQuery,
                    drillFilterOtherVisuals: true
                }
            };

            visualContainers.push({
                x: vx,
                y: vy,
                z: zOrder,
                width: 500,
                height: 300,
                config: JSON.stringify(vcConfig),
                filters: '[]',
                tabOrder: zOrder
            });

            zOrder++;
            vx += 550;
            if (vx > 1100) { vx = 50; vy += 350; }
        }

        const sectionConfig = {
            name: 'ReportSection',
            layouts: [{ id: 0, position: {} }],
            singleVisualGroup: null
        };

        // --- README page (first page) ---
        const readmeText = buildReadmeText(tables, schemas, relationships, excelPath);
        const readmeVcName = crypto.randomUUID ? crypto.randomUUID() : ('readme_' + Date.now());
        const readmeVcConfig = {
            name: readmeVcName,
            layouts: [{
                id: 0,
                position: { x: 30, y: 20, z: 0, width: 1220, height: 660 }
            }],
            singleVisual: {
                visualType: 'textbox',
                objects: {
                    general: [{
                        properties: {
                            paragraphs: [{
                                textRuns: [{
                                    value: readmeText,
                                    textStyle: {
                                        fontFamily: 'Segoe UI',
                                        fontSize: '10pt'
                                    }
                                }]
                            }]
                        }
                    }]
                }
            }
        };

        const readmeSectionConfig = {
            name: 'ReadmeSection',
            layouts: [{ id: 0, position: {} }],
            singleVisualGroup: null
        };

        const readmeSection = {
            name: 'ReadmeSection',
            displayName: 'README - Setup Guide',
            filters: '[]',
            ordinal: 0,
            visualContainers: [{
                x: 30,
                y: 20,
                z: 0,
                width: 1220,
                height: 660,
                config: JSON.stringify(readmeVcConfig),
                filters: '[]',
                tabOrder: 0
            }],
            config: JSON.stringify(readmeSectionConfig),
            width: 1280,
            height: 720
        };

        return {
            id: 0,
            reportId: crypto.randomUUID ? crypto.randomUUID() : ('report-' + Date.now()),
            sections: [
                readmeSection,
                {
                    name: 'ReportSection',
                    displayName: 'Data Overview',
                    filters: '[]',
                    ordinal: 1,
                    visualContainers: visualContainers,
                    config: JSON.stringify(sectionConfig),
                    width: 1280,
                    height: 720
                }
            ],
            config: JSON.stringify(reportConfig),
            layoutOptimization: 0
        };
    }

    // --- Metadata ---
    function buildMetadata() {
        return {
            Version: 5,
            AutoCreatedRelationships: [],
            FileDescription: '',
            CreatedFrom: 'Cloud',
            CreatedFromRelease: '2022.03'
        };
    }

    function buildSettings() {
        return {
            Version: 1,
            ReportSettings: {},
            QueriesSettings: {
                TypeDetectionEnabled: true,
                RelationshipImportEnabled: true,
                RunBackgroundAnalysis: true,
                Version: '2.81.5831.821'
            }
        };
    }

    return { generate };
})();
