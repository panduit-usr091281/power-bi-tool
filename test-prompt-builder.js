/* ===========================================
   test-prompt-builder.js
   Automated tests for the Data Visualization
   Prompt Builder engines (data analysis and
   prompt generation).
   Loaded by test-runner.html in the browser.
   =========================================== */

let passed = 0;
let failed = 0;
const testLog = [];

function assert(condition, testName) {
    if (condition) {
        testLog.push({ status: 'PASS', name: testName });
        passed++;
    } else {
        testLog.push({ status: 'FAIL', name: testName });
        failed++;
    }
}

function assertThrows(fn, testName) {
    try {
        fn();
        testLog.push({ status: 'FAIL', name: testName + ' (no error thrown)' });
        failed++;
    } catch (e) {
        testLog.push({ status: 'PASS', name: testName });
        passed++;
    }
}

// ============================================
// TEST SUITE: Data Parsing
// ============================================

// CSV Parsing
(function testCSVParsing() {
    const csv = `Month,Sales,Expenses
Jan,45000,32000
Feb,52000,34000
Mar,48000,31000`;

    const result = DataAnalysisEngine.parseData(csv, 'csv');
    assert(result.columns.length === 3, 'CSV: correct column count');
    assert(result.columns[0] === 'Month', 'CSV: first column name');
    assert(result.columns[2] === 'Expenses', 'CSV: last column name');
    assert(result.rows.length === 3, 'CSV: correct row count');
    assert(result.rows[0][1] === '45000', 'CSV: correct cell value');
    assert(result.rawObjects[1].Month === 'Feb', 'CSV: rawObjects correct');
})();

// TSV Parsing
(function testTSVParsing() {
    const tsv = `Product\tQ1\tQ2\nWidget A\t100\t150\nWidget B\t200\t250`;
    const result = DataAnalysisEngine.parseData(tsv, 'tsv');
    assert(result.columns.length === 3, 'TSV: correct column count');
    assert(result.rows.length === 2, 'TSV: correct row count');
    assert(result.rows[0][0] === 'Widget A', 'TSV: correct cell value');
})();

// JSON Parsing
(function testJSONParsing() {
    const json = `[{"name":"Alice","score":95},{"name":"Bob","score":82},{"name":"Carol","score":91}]`;
    const result = DataAnalysisEngine.parseData(json, 'json');
    assert(result.columns.length === 2, 'JSON: correct column count');
    assert(result.columns[0] === 'name', 'JSON: correct column name');
    assert(result.rows.length === 3, 'JSON: correct row count');
    assert(result.rows[2][0] === 'Carol', 'JSON: correct cell value');
})();

// Manual Parsing (colon-separated)
(function testManualColonParsing() {
    const manual = `Apples: 42\nBananas: 27\nCherries: 15`;
    const result = DataAnalysisEngine.parseData(manual, 'manual');
    assert(result.columns[0] === 'Category', 'Manual(colon): column names');
    assert(result.rows.length === 3, 'Manual(colon): correct row count');
    assert(result.rows[0][0] === 'Apples', 'Manual(colon): correct key');
    assert(result.rows[0][1] === '42', 'Manual(colon): correct value');
})();

// Manual Parsing (comma-separated)
(function testManualCommaParsing() {
    const manual = `Red, 10\nBlue, 20\nGreen, 30`;
    const result = DataAnalysisEngine.parseData(manual, 'manual');
    assert(result.rows.length === 3, 'Manual(comma): correct row count');
    assert(result.rows[1][0] === 'Blue', 'Manual(comma): correct key');
})();

// Error handling
(function testParseErrors() {
    assertThrows(() => DataAnalysisEngine.parseData('', 'csv'), 'Error: empty input');
    assertThrows(() => DataAnalysisEngine.parseData('Header Only', 'csv'), 'Error: CSV with no data rows');
    assertThrows(() => DataAnalysisEngine.parseData('{bad json', 'json'), 'Error: invalid JSON');
    assertThrows(() => DataAnalysisEngine.parseData('[]', 'json'), 'Error: empty JSON array');
})();

// ============================================
// TEST SUITE: Data Analysis
// ============================================

(function testColumnTypeDetection() {
    const csv = `Date,Category,Value,Percentage
2024-01-15,Electronics,1500,25.5
2024-02-20,Clothing,890,14.8
2024-03-10,Food,2200,36.7
2024-04-05,Electronics,1100,18.3`;

    const parsed = DataAnalysisEngine.parseData(csv, 'csv');
    const analysis = DataAnalysisEngine.analyzeData(parsed);

    assert(analysis.columnTypes[0] === 'temporal', 'Analysis: detects temporal column');
    assert(analysis.columnTypes[1] === 'categorical', 'Analysis: detects categorical column');
    assert(analysis.columnTypes[2] === 'numeric', 'Analysis: detects numeric column (integer)');
    assert(analysis.columnTypes[3] === 'numeric', 'Analysis: detects numeric column (decimal)');
    assert(analysis.hasTimeSeries === true, 'Analysis: hasTimeSeries flag');
    assert(analysis.numericCount === 2, 'Analysis: numeric column count');
    assert(analysis.categoricalCount === 1, 'Analysis: categorical column count');
    assert(analysis.rowCount === 4, 'Analysis: row count');
    assert(analysis.colCount === 4, 'Analysis: column count');
})();

(function testMonthDetection() {
    const csv = `Month,Revenue\nJan,5000\nFeb,6000\nMar,5500`;
    const parsed = DataAnalysisEngine.parseData(csv, 'csv');
    const analysis = DataAnalysisEngine.analyzeData(parsed);
    assert(analysis.columnTypes[0] === 'temporal', 'Analysis: detects month abbreviations as temporal');
})();

// ============================================
// TEST SUITE: Visualization Recommendation
// ============================================

(function testTrendRecommendation() {
    const csv = `Month,Sales\nJan,100\nFeb,120\nMar,115`;
    const parsed = DataAnalysisEngine.parseData(csv, 'csv');
    const analysis = DataAnalysisEngine.analyzeData(parsed);
    const rec = DataAnalysisEngine.recommendVisualizationType(analysis, 'trend');
    assert(rec === 'line', 'Recommend: line chart for time-series trend');
})();

(function testComparisonRecommendation() {
    const csv = `Product,Sales\nA,500\nB,700\nC,300`;
    const parsed = DataAnalysisEngine.parseData(csv, 'csv');
    const analysis = DataAnalysisEngine.analyzeData(parsed);
    const rec = DataAnalysisEngine.recommendVisualizationType(analysis, 'comparison');
    assert(rec === 'bar', 'Recommend: bar chart for small category comparison');
})();

(function testCompositionRecommendation() {
    const csv = `Segment,Share\nA,40\nB,30\nC,20\nD,10`;
    const parsed = DataAnalysisEngine.parseData(csv, 'csv');
    const analysis = DataAnalysisEngine.analyzeData(parsed);
    const rec = DataAnalysisEngine.recommendVisualizationType(analysis, 'composition');
    assert(rec === 'pie', 'Recommend: pie chart for small composition (≤6)');
})();

(function testLargeCompositionRecommendation() {
    let csv = 'Category,Value\n';
    for (let i = 1; i <= 15; i++) csv += `Cat${i},${i * 10}\n`;
    const parsed = DataAnalysisEngine.parseData(csv.trim(), 'csv');
    const analysis = DataAnalysisEngine.analyzeData(parsed);
    const rec = DataAnalysisEngine.recommendVisualizationType(analysis, 'composition');
    assert(rec === 'treemap', 'Recommend: treemap for large composition (>12)');
})();

(function testRelationshipRecommendation() {
    const csv = `X,Y\n1,2\n3,5\n4,7\n6,9`;
    const parsed = DataAnalysisEngine.parseData(csv, 'csv');
    const analysis = DataAnalysisEngine.analyzeData(parsed);
    const rec = DataAnalysisEngine.recommendVisualizationType(analysis, 'relationship');
    assert(rec === 'scatter', 'Recommend: scatter for numeric relationship');
})();

// ============================================
// TEST SUITE: Color Scheme Recommendation
// ============================================

(function testColorSchemeDefaults() {
    const csv = `Item,Count\nA,10\nB,20`;
    const parsed = DataAnalysisEngine.parseData(csv, 'csv');
    const analysis = DataAnalysisEngine.analyzeData(parsed);

    const exec = DataAnalysisEngine.recommendColorScheme(analysis, 'comparison', 'executive');
    assert(exec === 'corporate-blue', 'Color: falls back to audience default for small comparison data');

    const trend = DataAnalysisEngine.recommendColorScheme(analysis, 'trend', 'technical');
    assert(trend === 'cool-ocean', 'Color: cool-ocean for trends');

    const comp = DataAnalysisEngine.recommendColorScheme(analysis, 'composition', 'general');
    assert(comp === 'pastel', 'Color: pastel for composition');
})();

(function testColorSchemeDetails() {
    const details = DataAnalysisEngine.getColorSchemeDetails('corporate-blue');
    assert(details.name === 'Corporate Blue', 'ColorDetails: correct name');
    assert(details.colors.length === 6, 'ColorDetails: has 6 colors');
    assert(details.colors[0].startsWith('#'), 'ColorDetails: colors are hex');
    assert(details.description.length > 0, 'ColorDetails: has description');
})();

(function testChartTypeDetails() {
    const details = DataAnalysisEngine.getChartTypeDetails('scatter');
    assert(details.name === 'Scatter Plot', 'ChartDetails: correct name');
    assert(details.axes.includes('variable'), 'ChartDetails: has axes info');
    assert(details.best_for.includes('correlation'), 'ChartDetails: has best_for');
})();

// ============================================
// TEST SUITE: Prompt Generation
// ============================================

(function testFullPromptGeneration() {
    const csv = `Quarter,Revenue,Profit
Q1 2025,150000,45000
Q2 2025,180000,54000
Q3 2025,165000,49500
Q4 2025,210000,63000`;

    const parsed = DataAnalysisEngine.parseData(csv, 'csv');
    const analysis = DataAnalysisEngine.analyzeData(parsed);
    const chartType = 'line';
    const colorScheme = 'corporate-blue';
    const colorDetails = DataAnalysisEngine.getColorSchemeDetails(colorScheme);
    const chartDetails = DataAnalysisEngine.getChartTypeDetails(chartType);

    const config = {
        parsedData: parsed,
        analysis,
        chartType,
        colorScheme,
        colorDetails,
        chartDetails,
        title: 'FY2025 Revenue & Profit Trends',
        purpose: 'trend',
        audience: 'executive',
        targetTool: 'matplotlib',
        dimensions: '1200x800',
        notes: 'Highlight Q4 as the best quarter'
    };

    const result = PromptGenerationEngine.buildPrompt(config);

    assert(typeof result.prompt === 'string', 'Prompt: returns string');
    assert(result.prompt.length > 500, 'Prompt: substantial length');
    assert(result.prompt.includes('Line Chart'), 'Prompt: includes chart type');
    assert(result.prompt.includes('FY2025 Revenue & Profit Trends'), 'Prompt: includes title');
    assert(result.prompt.includes('Corporate Blue'), 'Prompt: includes color scheme');
    assert(result.prompt.includes('#1e40af'), 'Prompt: includes hex colors');
    assert(result.prompt.includes('Q1 2025'), 'Prompt: includes data values');
    assert(result.prompt.includes('150000'), 'Prompt: includes numeric data');
    assert(result.prompt.includes('matplotlib'), 'Prompt: includes tool instructions');
    assert(result.prompt.includes('1200x800'), 'Prompt: includes dimensions');
    assert(result.prompt.includes('Highlight Q4'), 'Prompt: includes user notes');
    assert(result.prompt.includes('Executive'), 'Prompt: includes audience context');
    assert(result.prompt.includes('runnable code'), 'Prompt: includes output requirements');

    // Metadata
    assert(result.metadata.chartType === 'Line Chart', 'Metadata: chart type');
    assert(result.metadata.colorScheme === 'Corporate Blue', 'Metadata: color scheme');
    assert(result.metadata.dataRows === 4, 'Metadata: row count');
    assert(result.metadata.dataColumns === 3, 'Metadata: column count');
    assert(result.metadata.targetTool === 'matplotlib', 'Metadata: target tool');
})();

(function testImageOnlyPrompt() {
    const csv = `Category,Value\nA,30\nB,50\nC,20`;
    const parsed = DataAnalysisEngine.parseData(csv, 'csv');
    const analysis = DataAnalysisEngine.analyzeData(parsed);

    const config = {
        parsedData: parsed,
        analysis,
        chartType: 'pie',
        colorScheme: 'pastel',
        colorDetails: DataAnalysisEngine.getColorSchemeDetails('pastel'),
        chartDetails: DataAnalysisEngine.getChartTypeDetails('pie'),
        title: 'Market Share',
        purpose: 'composition',
        audience: 'general',
        targetTool: 'image-only',
        dimensions: '',
        notes: ''
    };

    const result = PromptGenerationEngine.buildPrompt(config);
    assert(result.prompt.includes('Generate the visualization as a high-quality image'), 'ImageOnly: correct output instruction');
    assert(!result.prompt.includes('runnable code'), 'ImageOnly: no code instruction');
    assert(result.prompt.includes('designer'), 'ImageOnly: designer role');
})();

(function testNoToolSection() {
    const csv = `X,Y\n1,10\n2,20`;
    const parsed = DataAnalysisEngine.parseData(csv, 'csv');
    const analysis = DataAnalysisEngine.analyzeData(parsed);

    const config = {
        parsedData: parsed,
        analysis,
        chartType: 'bar',
        colorScheme: 'vibrant',
        colorDetails: DataAnalysisEngine.getColorSchemeDetails('vibrant'),
        chartDetails: DataAnalysisEngine.getChartTypeDetails('bar'),
        title: 'Test',
        purpose: 'comparison',
        audience: 'general',
        targetTool: 'any',
        dimensions: '',
        notes: ''
    };

    const result = PromptGenerationEngine.buildPrompt(config);
    assert(!result.prompt.includes('IMPLEMENTATION'), 'AnyTool: no tool-specific section');
})();

// ============================================
// RESULTS - Render to page
// ============================================
function renderTestResults() {
    const container = document.getElementById('test-results-output');
    let html = '';

    const sections = ['DATA PARSING', 'DATA ANALYSIS', 'VISUALIZATION RECOMMENDATION', 'COLOR SCHEME', 'PROMPT GENERATION'];
    let sectionIdx = 0;

    for (const entry of testLog) {
        const color = entry.status === 'PASS' ? '#16a34a' : '#dc2626';
        const icon = entry.status === 'PASS' ? '✓' : '✗';
        html += `<div style="color:${color};font-family:monospace;margin:2px 0;"><span>${icon}</span> ${entry.status}: ${entry.name}</div>`;
    }

    html += `<hr style="margin:1rem 0;">`;
    html += `<div style="font-size:1.2rem;font-weight:bold;">`;
    html += `Total: ${passed + failed} | `;
    html += `<span style="color:#16a34a;">Passed: ${passed}</span> | `;
    html += `<span style="color:#dc2626;">Failed: ${failed}</span>`;
    html += `</div>`;
    html += failed === 0
        ? `<div style="color:#16a34a;font-size:1.4rem;font-weight:bold;margin-top:0.5rem;">ALL TESTS PASSED</div>`
        : `<div style="color:#dc2626;font-size:1.4rem;font-weight:bold;margin-top:0.5rem;">SOME TESTS FAILED</div>`;

    container.innerHTML = html;
}

renderTestResults();
