/* ===========================================
   powerbi-excel-parser.js
   Parses Excel files in the browser using SheetJS.
   Returns structured table data with schemas.
   =========================================== */

const ExcelParser = (() => {
    'use strict';

    const NULL_LIKE_TEXT = new Set(['', 'null', 'none', 'n/a', 'na', 'nan', '-', 'tbd', 'tba', 'asap']);

    /**
     * Parse an Excel file (ArrayBuffer) into structured tables.
     * @param {ArrayBuffer} buffer - Raw file contents
     * @param {string} fileName - Original file name
     * @returns {{ tables: Object, schemas: Object, fileName: string }}
     */
    function parseExcelFile(buffer, fileName) {
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

        const tables = {};
        const schemas = {};

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet || !sheet['!ref']) continue;

            // Get raw 2D array to detect where the actual data table starts
            const rawAoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
            if (rawAoa.length === 0) continue;

            // Find the data region: header row AND starting column
            const region = detectDataRegion(rawAoa);
            if (!region) continue; // No usable table found

            const { headerRow, startCol, endCol } = region;

            const dataRows = collectRegionRows(rawAoa, headerRow, startCol, endCol);
            if (dataRows.length === 0) continue;

            const columns = buildColumnNames(rawAoa[headerRow].slice(startCol, endCol + 1));
            const keptIndices = findPopulatedColumnIndices(dataRows, columns.length);
            if (keptIndices.length === 0) continue;

            const finalColumns = deduplicateColumnNames(keptIndices.map(i => columns[i]));
            const cleanRows = buildRowObjects(dataRows, keptIndices, finalColumns);

            const safeName = sanitizeTableName(sheetName);
            tables[safeName] = {
                rows: cleanRows,
                columns: finalColumns,
                sheetName: sheetName,
                headerRowIndex: headerRow
            };

            schemas[safeName] = analyzeTable(safeName, cleanRows, finalColumns);
        }

        return { tables, schemas, fileName };
    }

    /**
     * Detect the data region in a raw 2D array (row AND column start/end).
     * Finds the best row that looks like a header, then determines which
     * columns contain the actual table (trimming leading/trailing empty cols).
     */
    function detectDataRegion(rawAoa) {
        const maxScanRows = Math.min(rawAoa.length, 40);
        const maxCols = rawAoa.reduce((max, row) => Math.max(max, (row || []).length), 0);
        if (maxCols === 0) return null;

        let bestRow = -1;
        let bestScore = 0;
        let bestStartCol = 0;
        let bestEndCol = 0;

        for (let r = 0; r < maxScanRows; r++) {
            const row = rawAoa[r];
            if (!row) continue;

            const bounds = findRowBounds(row);
            if (!bounds) continue;

            const { firstCol, lastCol, nonEmpty } = bounds;
            const stringCount = countHeaderLikeCells(row, firstCol, lastCol);

            if (nonEmpty < 2 || firstCol < 0) continue;

            const stringRatio = stringCount / nonEmpty;
            if (stringRatio < 0.4) continue; // Headers should be mostly text

            // Check that the next few rows have data in the same column range
            let dataRowsBelow = 0;
            for (let nr = r + 1; nr < Math.min(r + 6, rawAoa.length); nr++) {
                const nextRow = rawAoa[nr];
                if (!nextRow) continue;
                const nextNonEmpty = countNonEmptyCells(nextRow.slice(firstCol, lastCol + 1));
                if (nextNonEmpty >= 2) dataRowsBelow++;
            }
            if (dataRowsBelow < 1) continue;

            // Skip title rows (1-2 cells with long text)
            const avgLen = averageCellTextLength(row, firstCol, lastCol, nonEmpty);
            if (nonEmpty <= 2 && avgLen > 30) continue;

            // Score: more non-empty header cells + more data rows below = better
            const score = nonEmpty * stringRatio * (nonEmpty >= 3 ? 2 : 1) * (1 + dataRowsBelow * 0.2);
            if (score > bestScore) {
                bestScore = score;
                bestRow = r;
                bestStartCol = firstCol;
                bestEndCol = lastCol;
            }
        }

        if (bestRow < 0) {
            // Fallback: use row 0, full width
            return { headerRow: 0, startCol: 0, endCol: maxCols - 1 };
        }

        return { headerRow: bestRow, startCol: bestStartCol, endCol: bestEndCol };
    }

    function collectRegionRows(rawAoa, headerRow, startCol, endCol) {
        const rows = [];
        for (let rowIndex = headerRow + 1; rowIndex < rawAoa.length; rowIndex++) {
            const row = rawAoa[rowIndex];
            if (!row) continue;

            const slice = row.slice(startCol, endCol + 1);
            if (countNonEmptyCells(slice) === 0) continue;
            rows.push(slice);
        }
        return rows;
    }

    function buildColumnNames(headerCells) {
        let unnamedCounter = 0;
        return headerCells.map(cell => sanitizeColumnName(cell, ++unnamedCounter));
    }

    function findPopulatedColumnIndices(rows, columnCount) {
        const kept = [];

        for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
            const hasData = rows.some(row => !isBlankCell(row[columnIndex]));
            if (hasData) kept.push(columnIndex);
        }

        return kept;
    }

    function deduplicateColumnNames(columnNames) {
        const seen = {};

        return columnNames.map(name => {
            if (name in seen) {
                seen[name]++;
                return name + '_' + seen[name];
            }

            seen[name] = 0;
            return name;
        });
    }

    function buildRowObjects(rows, keptIndices, columnNames) {
        return rows.map(row => {
            const record = {};
            keptIndices.forEach((sourceIndex, outputIndex) => {
                const value = row[sourceIndex];
                record[columnNames[outputIndex]] = value == null ? '' : value;
            });
            return record;
        });
    }

    function findRowBounds(row) {
        let firstCol = -1;
        let lastCol = -1;
        let nonEmpty = 0;

        for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
            if (isBlankCell(row[columnIndex])) continue;

            nonEmpty++;
            if (firstCol < 0) firstCol = columnIndex;
            lastCol = columnIndex;
        }

        if (firstCol < 0) return null;
        return { firstCol, lastCol, nonEmpty };
    }

    function countHeaderLikeCells(row, startCol, endCol) {
        let count = 0;

        for (let columnIndex = startCol; columnIndex <= endCol; columnIndex++) {
            const cell = row[columnIndex];
            if (typeof cell !== 'string') continue;

            const trimmed = cell.trim();
            if (trimmed.length === 0 || trimmed.length >= 80) continue;
            if (!isNaN(Number(trimmed.replace(/,/g, '')))) continue;

            count++;
        }

        return count;
    }

    function countNonEmptyCells(cells) {
        let count = 0;
        for (const cell of cells) {
            if (!isBlankCell(cell)) count++;
        }
        return count;
    }

    function averageCellTextLength(row, startCol, endCol, nonEmptyCount) {
        let totalLength = 0;

        for (let columnIndex = startCol; columnIndex <= endCol; columnIndex++) {
            const cell = row[columnIndex];
            if (isBlankCell(cell)) continue;
            totalLength += String(cell).length;
        }

        return totalLength / Math.max(nonEmptyCount, 1);
    }

    function isBlankCell(value) {
        return value === null || value === '' || value === undefined;
    }

    /**
     * Analyze a table and return its schema.
     */
    function analyzeTable(name, rows, columns) {
        const colInfos = columns.map(col => {
            const values = rows.map(r => r[col]);
            const nonNull = values.filter(v => v !== '' && v !== null && v !== undefined);
            const uniqueVals = new Set(nonNull.map(v => String(v)));

            return {
                name: col,
                dataType: inferType(nonNull),
                sourceColumn: col,
                nullable: nonNull.length < values.length,
                uniqueCount: uniqueVals.size,
                totalCount: rows.length,
                sampleValues: nonNull.slice(0, 5).map(String)
            };
        });

        return {
            name: name,
            columns: colInfos,
            rowCount: rows.length
        };
    }

    /**
     * Infer Power BI data type from an array of values.
     */
    function inferType(values) {
        if (values.length === 0) return 'string';

        // Use a larger, spread-out sample for better coverage of dirty data
        let sample;
        if (values.length <= 100) {
            sample = values;
        } else {
            const head = values.slice(0, 40);
            const tail = values.slice(-40);
            const mid = values.filter((_, i) => i % Math.ceil(values.length / 20) === 0).slice(0, 20);
            sample = [...new Set([...head, ...tail, ...mid])];
        }

        // Filter null-like text before classification
        const clean = sample.filter(val => {
            if (val instanceof Date) return true;
            return !NULL_LIKE_TEXT.has(String(val).trim().toLowerCase());
        });
        if (clean.length === 0) return 'string';

        let dateCount = 0, intCount = 0, floatCount = 0, boolCount = 0;

        for (const val of clean) {
            if (val instanceof Date) {
                dateCount++;
                continue;
            }
            const s = String(val).trim();
            if (s === 'true' || s === 'false') {
                boolCount++;
            } else if (/^\-?\d+$/.test(s)) {
                intCount++;
            } else if (/^\-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(s) || /^\-?\d+\.\d+$/.test(s)) {
                floatCount++;
            } else if (isDateString(s)) {
                dateCount++;
            }
        }

        const threshold = clean.length * 0.8;
        if (dateCount >= threshold) return 'dateTime';
        if (boolCount >= threshold) return 'boolean';
        if (intCount >= threshold) return 'int64';
        if ((intCount + floatCount) >= threshold) return 'double';
        return 'string';
    }

    // Stricter date detection: requires separator + a 4-digit year to avoid
    // false positives from values like "100-200" or plain numbers.
    const DATE_PATTERN = /(?:^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$)|(?:^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})|(?:^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$)/;
    function isDateString(s) {
        if (s.length < 6 || s.length > 30) return false;
        if (!DATE_PATTERN.test(s)) return false;
        const d = new Date(s);
        return !isNaN(d.getTime());
    }

    function sanitizeTableName(name) {
        let safe = String(name).trim().replace(/[^\w\s\-]/g, '').trim() || 'Table';
        // Remove leading dashes/spaces that cause Power BI errors
        safe = safe.replace(/^[\-\s]+/, '');
        return safe || 'Table';
    }

    function sanitizeColumnName(name, sequentialIndex) {
        name = String(name).trim();
        if (!name || name.startsWith('__EMPTY')) {
            return 'Column_' + (sequentialIndex || 1);
        }
        return name;
    }

    return { parseExcelFile };
})();
