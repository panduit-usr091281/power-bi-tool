/* ===========================================
   powerbi-app-controller.js
   Main controller for the Power BI Generator
   browser UI. Handles file upload, previews,
   relationship editing, and .pbit generation.
   =========================================== */

(function () {
    'use strict';

    // --- DOM References ---
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileInfo = document.getElementById('file-info');
    const fileNameDisplay = document.getElementById('file-name-display');
    const btnRemoveFile = document.getElementById('btn-remove-file');

    const sectionPreview = document.getElementById('section-table-preview');
    const tablesSummary = document.getElementById('tables-summary');
    const tablesPreviewContainer = document.getElementById('tables-preview-container');

    const sectionRelationships = document.getElementById('section-relationships');
    const relationshipsContainer = document.getElementById('relationships-container');
    const btnAddRelationship = document.getElementById('btn-add-relationship');
    const addRelForm = document.getElementById('add-rel-form');
    const relFromTable = document.getElementById('rel-from-table');
    const relFromCol = document.getElementById('rel-from-col');
    const relToTable = document.getElementById('rel-to-table');
    const relToCol = document.getElementById('rel-to-col');
    const relCardinality = document.getElementById('rel-cardinality');
    const btnConfirmAddRel = document.getElementById('btn-confirm-add-rel');
    const btnCancelAddRel = document.getElementById('btn-cancel-add-rel');

    const sectionOptions = document.getElementById('section-options');
    const optExcelPath = document.getElementById('opt-excel-path');
    const optGenerateMeasures = document.getElementById('opt-generate-measures');
    const optGenerateDateTable = document.getElementById('opt-generate-date-table');

    const sectionGenerate = document.getElementById('section-generate');
    const btnGenerate = document.getElementById('btn-generate-pbit');

    const sectionOutput = document.getElementById('section-output');
    const outputSummary = document.getElementById('output-summary');
    const outputSchemaJson = document.getElementById('output-schema-json');
    const btnCopySchema = document.getElementById('btn-copy-schema');

    // --- State ---
    let parsedData = null;   // { tables, schemas, fileName }
    let relationships = [];  // Array of relationship objects

    // --- File Upload ---

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) handleFile(file);
    });

    btnRemoveFile.addEventListener('click', resetAll);

    function handleFile(file) {
        if (!file.name.match(/\.xlsx?$/i)) {
            alert('Please upload an .xlsx or .xls file.');
            return;
        }

        fileNameDisplay.textContent = file.name;
        fileInfo.classList.remove('hidden');
        dropZone.classList.add('hidden');

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                parsedData = ExcelParser.parseExcelFile(e.target.result, file.name);
                relationships = RelationshipDetector.detect(parsedData.tables, parsedData.schemas);
                renderAll();
            } catch (err) {
                alert('Error parsing Excel file: ' + err.message);
                resetAll();
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function resetAll() {
        parsedData = null;
        relationships = [];
        fileInput.value = '';
        fileInfo.classList.add('hidden');
        dropZone.classList.remove('hidden');
        sectionPreview.classList.add('hidden');
        sectionRelationships.classList.add('hidden');
        sectionOptions.classList.add('hidden');
        sectionGenerate.classList.add('hidden');
        sectionOutput.classList.add('hidden');
    }

    // --- Rendering ---

    function renderAll() {
        renderTablePreview();
        renderRelationships();
        showSections();
    }

    function showSections() {
        sectionPreview.classList.remove('hidden');
        sectionRelationships.classList.remove('hidden');
        sectionOptions.classList.remove('hidden');
        sectionGenerate.classList.remove('hidden');
        sectionOutput.classList.add('hidden');
    }

    function renderTablePreview() {
        const tableNames = Object.keys(parsedData.schemas);
        const totalRows = Object.values(parsedData.schemas).reduce((s, t) => s + t.rowCount, 0);
        const totalCols = Object.values(parsedData.schemas).reduce((s, t) => s + t.columns.length, 0);

        tablesSummary.innerHTML = `
            <div class="summary-badges">
                <span class="badge">${tableNames.length} Table${tableNames.length !== 1 ? 's' : ''}</span>
                <span class="badge">${totalRows.toLocaleString()} Total Rows</span>
                <span class="badge">${totalCols} Columns</span>
            </div>`;

        let html = '';
        for (const [tableName, schema] of Object.entries(parsedData.schemas)) {
            const table = parsedData.tables[tableName];
            html += `
                <div class="table-card">
                    <div class="table-card-header">
                        <h3>${escapeHtml(tableName)}</h3>
                        <span class="badge badge-sm">${schema.rowCount} rows × ${schema.columns.length} cols</span>
                    </div>
                    <div class="table-card-columns">
                        ${schema.columns.map(col => `
                            <div class="col-tag">
                                <span class="col-name">${escapeHtml(col.name)}</span>
                                <span class="col-type type-${col.dataType}">${col.dataType}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="table-card-preview">
                        ${renderPreviewTable(table, schema)}
                    </div>
                </div>`;
        }
        tablesPreviewContainer.innerHTML = html;
    }

    function renderPreviewTable(table, schema) {
        const maxRows = 5;
        const maxCols = 8;
        const cols = schema.columns.slice(0, maxCols);
        const rows = table.rows.slice(0, maxRows);

        let html = '<table><thead><tr>';
        for (const col of cols) {
            html += `<th>${escapeHtml(col.name)}</th>`;
        }
        if (schema.columns.length > maxCols) html += `<th>…+${schema.columns.length - maxCols}</th>`;
        html += '</tr></thead><tbody>';

        for (const row of rows) {
            html += '<tr>';
            for (const col of cols) {
                const val = row[col.name];
                const display = val instanceof Date ? val.toLocaleDateString() : String(val ?? '');
                html += `<td>${escapeHtml(display)}</td>`;
            }
            if (schema.columns.length > maxCols) html += '<td>…</td>';
            html += '</tr>';
        }

        if (table.rows.length > maxRows) {
            html += `<tr><td colspan="${cols.length + (schema.columns.length > maxCols ? 1 : 0)}" class="more-rows">… ${table.rows.length - maxRows} more rows</td></tr>`;
        }

        html += '</tbody></table>';
        return html;
    }

    function renderRelationships() {
        if (relationships.length === 0) {
            relationshipsContainer.innerHTML = '<p class="no-rels">No relationships detected. You can add them manually below.</p>';
            return;
        }

        let html = '<div class="rel-list">';
        relationships.forEach((rel, i) => {
            const cardinalityLabel = {
                manyToOne: 'Many → One',
                oneToOne: 'One → One',
                manyToMany: 'Many → Many'
            }[rel.cardinality] || rel.cardinality;

            const confidence = Math.round((rel.confidence || 0) * 100);

            html += `
                <div class="rel-card">
                    <div class="rel-visual">
                        <span class="rel-table">${escapeHtml(rel.fromTable)}</span>
                        <span class="rel-dot">.${escapeHtml(rel.fromColumn)}</span>
                        <span class="rel-arrow">→</span>
                        <span class="rel-table">${escapeHtml(rel.toTable)}</span>
                        <span class="rel-dot">.${escapeHtml(rel.toColumn)}</span>
                    </div>
                    <div class="rel-meta">
                        <span class="badge badge-sm">${cardinalityLabel}</span>
                        <span class="badge badge-sm badge-confidence">${confidence}%</span>
                        <button class="btn-icon btn-remove-rel" data-index="${i}" title="Remove relationship">✕</button>
                    </div>
                </div>`;
        });
        html += '</div>';
        relationshipsContainer.innerHTML = html;

        // Bind remove buttons
        relationshipsContainer.querySelectorAll('.btn-remove-rel').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index, 10);
                relationships.splice(idx, 1);
                renderRelationships();
            });
        });
    }

    // --- Add Relationship ---

    btnAddRelationship.addEventListener('click', () => {
        addRelForm.classList.remove('hidden');
        populateTableSelects();
    });

    btnCancelAddRel.addEventListener('click', () => {
        addRelForm.classList.add('hidden');
    });

    relFromTable.addEventListener('change', () => populateColumnSelect(relFromTable.value, relFromCol));
    relToTable.addEventListener('change', () => populateColumnSelect(relToTable.value, relToCol));

    btnConfirmAddRel.addEventListener('click', () => {
        const rel = {
            fromTable: relFromTable.value,
            fromColumn: relFromCol.value,
            toTable: relToTable.value,
            toColumn: relToCol.value,
            cardinality: relCardinality.value,
            crossFilteringBehavior: relCardinality.value === 'oneToOne' ? 'bothDirections' : 'oneDirection',
            confidence: 1.0
        };

        if (!rel.fromTable || !rel.fromColumn || !rel.toTable || !rel.toColumn) {
            alert('Please fill in all relationship fields.');
            return;
        }

        relationships.push(rel);
        renderRelationships();
        addRelForm.classList.add('hidden');
    });

    function populateTableSelects() {
        const tables = Object.keys(parsedData.schemas);
        [relFromTable, relToTable].forEach(select => {
            select.innerHTML = tables.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
        });
        if (tables.length > 1) relToTable.selectedIndex = 1;
        populateColumnSelect(relFromTable.value, relFromCol);
        populateColumnSelect(relToTable.value, relToCol);
    }

    function populateColumnSelect(tableName, selectEl) {
        if (!tableName || !parsedData.schemas[tableName]) return;
        const cols = parsedData.schemas[tableName].columns;
        selectEl.innerHTML = cols.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${c.dataType})</option>`).join('');
    }

    // --- Generate .pbit ---

    btnGenerate.addEventListener('click', handleGenerate);

    async function handleGenerate() {
        if (!parsedData) {
            alert('Please upload an Excel file first.');
            return;
        }

        const excelFilePath = normalizeExcelFilePath(optExcelPath.value);
        if (!excelFilePath) {
            alert('Enter the real Windows path to the Excel workbook before generating the .pbit. Browser uploads do not provide that path automatically.');
            optExcelPath.focus();
            return;
        }

        optExcelPath.value = excelFilePath;

        btnGenerate.disabled = true;
        btnGenerate.textContent = 'Generating…';

        try {
            const options = {
                excelFilePath,
                generateMeasures: optGenerateMeasures.checked,
                generateDateTable: optGenerateDateTable.checked,
                fileName: parsedData.fileName
            };

            const result = await PbitGenerator.generate(
                parsedData.tables, parsedData.schemas, relationships, options
            );

            // Trigger download
            const outputName = parsedData.fileName.replace(/\.xlsx?$/i, '') + '.pbit';
            saveAs(result.blob, outputName);

            // Show output section
            outputSummary.innerHTML = `
                <span>Tables: <strong>${result.stats.tableCount}</strong></span>
                <span>Relationships: <strong>${result.stats.relationshipCount}</strong></span>
                <span>Total Rows: <strong>${result.stats.totalRows.toLocaleString()}</strong></span>
                <span>Columns: <strong>${result.stats.totalColumns}</strong></span>
                <span>File Size: <strong>${formatBytes(result.stats.fileSize)}</strong></span>`;

            outputSchemaJson.textContent = result.modelJson;
            sectionOutput.classList.remove('hidden');
            sectionOutput.scrollIntoView({ behavior: 'smooth', block: 'start' });

        } catch (err) {
            alert('Generation error: ' + err.message);
        } finally {
            btnGenerate.disabled = false;
            btnGenerate.textContent = 'Generate & Download .pbit';
        }
    }

    // --- Copy Schema ---

    btnCopySchema.addEventListener('click', () => {
        const text = outputSchemaJson.textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(showCopyConfirmation)
                .catch(copySchemaFallback);
            return;
        }

        copySchemaFallback();
    });

    function showCopyConfirmation() {
        btnCopySchema.textContent = 'Copied!';
        setTimeout(() => { btnCopySchema.textContent = 'Copy Schema'; }, 2000);
    }

    function copySchemaFallback() {
        const ta = document.createElement('textarea');
        ta.value = outputSchemaJson.textContent;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showCopyConfirmation();
    }

    // --- Utilities ---

    const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, c => HTML_ESCAPE_MAP[c]);
    }

    function normalizeExcelFilePath(value) {
        let normalized = String(value || '').trim();
        if (normalized.length >= 2) {
            const quote = normalized[0];
            if ((quote === '"' || quote === "'") && normalized[normalized.length - 1] === quote) {
                normalized = normalized.slice(1, -1).trim();
            }
        }
        return normalized.replace(/\//g, '\\');
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

})();
