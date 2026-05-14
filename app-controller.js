/* ===========================================
   app-controller.js
   Main application controller. Wires up UI
   events, coordinates data analysis and
   prompt generation, manages display state.
   =========================================== */

(function () {
    'use strict';

    const HTML_ESCAPE_MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    // DOM References
    const formatSelect = document.getElementById('data-format-select');
    const dataInput = document.getElementById('data-text-input');
    const btnParse = document.getElementById('btn-parse-data');
    const previewContainer = document.getElementById('data-preview-container');
    const previewTable = document.getElementById('data-preview-table');
    const summaryText = document.getElementById('data-summary-text');

    const titleInput = document.getElementById('viz-title-input');
    const purposeSelect = document.getElementById('viz-purpose-select');
    const audienceSelect = document.getElementById('viz-audience-select');
    const notesInput = document.getElementById('viz-notes-input');

    const chartTypeOverride = document.getElementById('viz-type-override');
    const colorSchemeOverride = document.getElementById('color-scheme-override');
    const toolSelect = document.getElementById('output-tool-select');
    const dimensionsInput = document.getElementById('output-dimensions-input');

    const btnGenerate = document.getElementById('btn-generate-prompt');
    const outputSection = document.getElementById('section-prompt-output');
    const outputMeta = document.getElementById('output-meta-info');
    const promptOutput = document.getElementById('generated-prompt-output');
    const btnCopy = document.getElementById('btn-copy-prompt');

    // State
    let currentParsedData = null;
    let currentAnalysis = null;

    // --- Event Listeners ---

    btnParse.addEventListener('click', handleParseData);
    btnGenerate.addEventListener('click', handleGenerate);
    btnCopy.addEventListener('click', handleCopy);

    // --- Handlers ---

    function handleParseData() {
        const rawText = dataInput.value;
        const format = formatSelect.value;

        try {
            currentParsedData = DataAnalysisEngine.parseData(rawText, format);
            currentAnalysis = DataAnalysisEngine.analyzeData(currentParsedData);
            renderPreview();
            previewContainer.classList.remove('hidden');
        } catch (err) {
            alert('Data Parsing Error: ' + err.message);
            previewContainer.classList.add('hidden');
            currentParsedData = null;
            currentAnalysis = null;
        }
    }

    function handleGenerate() {
        if (!currentParsedData || !currentAnalysis) {
            alert('Please parse your data first (Step 1).');
            return;
        }

        const purpose = purposeSelect.value;
        const audience = audienceSelect.value;

        // Determine chart type
        let chartType;
        if (chartTypeOverride.value !== 'auto') {
            chartType = chartTypeOverride.value;
        } else {
            chartType = DataAnalysisEngine.recommendVisualizationType(currentAnalysis, purpose);
        }

        // Route to infographic engine if infographic is selected
        if (chartType === 'infographic') {
            const infographicConfig = {
                parsedData: currentParsedData,
                analysis: currentAnalysis,
                title: titleInput.value.trim(),
                purpose,
                audience,
                dimensions: dimensionsInput.value.trim(),
                notes: notesInput.value.trim()
            };

            const result = InfographicPromptEngine.buildInfographicPrompt(infographicConfig);
            displayGeneratedPrompt(result);
            return;
        }

        // Determine color scheme
        let colorScheme;
        if (colorSchemeOverride.value !== 'auto') {
            colorScheme = colorSchemeOverride.value;
        } else {
            colorScheme = DataAnalysisEngine.recommendColorScheme(currentAnalysis, purpose, audience);
        }

        const colorDetails = DataAnalysisEngine.getColorSchemeDetails(colorScheme);
        const chartDetails = DataAnalysisEngine.getChartTypeDetails(chartType);

        const config = {
            parsedData: currentParsedData,
            analysis: currentAnalysis,
            chartType,
            colorScheme,
            colorDetails,
            chartDetails,
            title: titleInput.value.trim(),
            purpose,
            audience,
            targetTool: toolSelect.value,
            dimensions: dimensionsInput.value.trim(),
            notes: notesInput.value.trim()
        };

        const result = PromptGenerationEngine.buildPrompt(config);
        displayGeneratedPrompt(result);
    }

    function handleCopy() {
        const text = promptOutput.textContent;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(showCopyConfirmation)
                .catch(copyPromptFallback);
            return;
        }

        copyPromptFallback();
    }

    // --- Renderers ---

    function renderPreview() {
        const { columns, rows } = currentParsedData;
        const maxPreviewRows = 8;
        const displayRows = rows.slice(0, maxPreviewRows);

        let html = '<table><thead><tr>';
        for (const col of columns) {
            html += `<th>${escapeHtml(col)}</th>`;
        }
        html += '</tr></thead><tbody>';

        for (const row of displayRows) {
            html += '<tr>';
            for (const val of row) {
                html += `<td>${escapeHtml(val)}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table>';

        if (rows.length > maxPreviewRows) {
            html += `<p style="font-size:0.8rem;color:#64748b;margin-top:0.5rem;">Showing ${maxPreviewRows} of ${rows.length} rows</p>`;
        }

        previewTable.innerHTML = html;

        // Summary
        const typeLabels = currentAnalysis.columns.map((col, i) => {
            const type = currentAnalysis.columnTypes[i];
            return `${col} (${type})`;
        });
        summaryText.textContent = `Detected columns: ${typeLabels.join(', ')}`;
    }

    function renderMetadata(metadata) {
        outputMeta.innerHTML = `
            <span><strong>Chart:</strong> ${escapeHtml(metadata.chartType)}</span>
            <span><strong>Colors:</strong> ${escapeHtml(metadata.colorScheme)}</span>
            <span><strong>Tool:</strong> ${escapeHtml(metadata.targetTool)}</span>
            <span><strong>Data:</strong> ${metadata.dataRows} rows × ${metadata.dataColumns} cols</span>
        `;
    }

    function displayGeneratedPrompt(result) {
        promptOutput.textContent = result.prompt;
        renderMetadata(result.metadata);
        outputSection.classList.remove('hidden');
        outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function showCopyConfirmation() {
        btnCopy.textContent = 'Copied!';
        setTimeout(() => { btnCopy.textContent = 'Copy'; }, 2000);
    }

    function copyPromptFallback() {
        const textarea = document.createElement('textarea');
        textarea.value = promptOutput.textContent;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showCopyConfirmation();
    }

    function escapeHtml(text) {
        return String(text || '').replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char]);
    }

})();
