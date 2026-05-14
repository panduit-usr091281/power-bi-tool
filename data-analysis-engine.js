/* ===========================================
   data-analysis-engine.js
   Parses input data and determines the best
   visualization type, color scheme, and layout
   based on data characteristics.
   =========================================== */

const DataAnalysisEngine = (() => {
    'use strict';

    const TEMPORAL_PATTERNS = [
        /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/,
        /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/,
        /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
        /^(q[1-4])\s*\d{4}$/i,
        /^\d{4}$/,
        /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
        /^(week|wk)\s*\d+/i
    ];

    const AUDIENCE_COLOR_DEFAULTS = {
        executive: 'corporate-blue',
        technical: 'high-contrast',
        general: 'vibrant',
        academic: 'monochrome',
        marketing: 'warm-sunset'
    };

    const COLOR_SCHEME_DETAILS = {
        'corporate-blue': {
            name: 'Corporate Blue',
            colors: ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#1d4ed8'],
            description: 'Professional blue palette suitable for business presentations'
        },
        'warm-sunset': {
            name: 'Warm Sunset',
            colors: ['#dc2626', '#ea580c', '#f59e0b', '#fbbf24', '#fcd34d', '#b91c1c'],
            description: 'Warm reds, oranges, and yellows for energetic visuals'
        },
        'cool-ocean': {
            name: 'Cool Ocean',
            colors: ['#0891b2', '#06b6d4', '#22d3ee', '#67e8f9', '#164e63', '#155e75'],
            description: 'Calming teals and cyans for trend and flow visualizations'
        },
        'earth-tones': {
            name: 'Earth Tones',
            colors: ['#78350f', '#a16207', '#65a30d', '#047857', '#1e3a5f', '#92400e'],
            description: 'Natural browns, greens, and deep blues'
        },
        'high-contrast': {
            name: 'High Contrast',
            colors: ['#000000', '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c'],
            description: 'Maximum distinction between data series for clarity'
        },
        'monochrome': {
            name: 'Monochrome',
            colors: ['#111827', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#f3f4f6'],
            description: 'Grayscale palette for print-friendly academic visuals'
        },
        'pastel': {
            name: 'Pastel',
            colors: ['#fecaca', '#bbf7d0', '#bfdbfe', '#e9d5ff', '#fef08a', '#fecdd3'],
            description: 'Soft muted colors for composition and part-of-whole charts'
        },
        'vibrant': {
            name: 'Vibrant / Bold',
            colors: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'],
            description: 'Bold saturated colors for maximum visual impact'
        },
        'dark-mode': {
            name: 'Dark Mode Optimized',
            colors: ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb923c'],
            description: 'Bright colors designed to pop against dark backgrounds'
        },
        'accessible': {
            name: 'Colorblind Accessible',
            colors: ['#0077BB', '#33BBEE', '#009988', '#EE7733', '#CC3311', '#EE3377'],
            description: 'Palette designed for deuteranopia/protanopia accessibility'
        }
    };

    const CHART_TYPE_DETAILS = {
        'bar': { name: 'Bar Chart', axes: 'x=categories, y=values', best_for: 'comparing discrete categories' },
        'line': { name: 'Line Chart', axes: 'x=time/sequence, y=values', best_for: 'showing trends over time' },
        'pie': { name: 'Pie Chart', axes: 'slices=categories, size=proportions', best_for: 'showing parts of a whole (≤6 categories)' },
        'donut': { name: 'Donut Chart', axes: 'slices=categories, size=proportions', best_for: 'parts of a whole with center annotation space' },
        'scatter': { name: 'Scatter Plot', axes: 'x=variable1, y=variable2', best_for: 'showing correlation between two variables' },
        'area': { name: 'Area Chart', axes: 'x=time/sequence, y=values (filled)', best_for: 'showing volume trends over time' },
        'heatmap': { name: 'Heatmap', axes: 'x=category1, y=category2, color=intensity', best_for: 'showing patterns in matrix data' },
        'treemap': { name: 'Treemap', axes: 'rectangles=categories, size=values', best_for: 'hierarchical composition with many categories' },
        'radar': { name: 'Radar / Spider Chart', axes: 'spokes=metrics, distance=values', best_for: 'comparing multiple metrics across entities' },
        'funnel': { name: 'Funnel Chart', axes: 'stages=categories, width=values', best_for: 'showing progressive reduction through stages' },
        'waterfall': { name: 'Waterfall Chart', axes: 'x=steps, y=cumulative change', best_for: 'showing incremental positive/negative changes' },
        'histogram': { name: 'Histogram', axes: 'x=bins, y=frequency', best_for: 'showing distribution of a single variable' },
        'box': { name: 'Box Plot', axes: 'x=categories, y=distribution stats', best_for: 'comparing distributions across groups' },
        'bubble': { name: 'Bubble Chart', axes: 'x=var1, y=var2, size=var3', best_for: 'showing three-variable relationships' },
        'stacked-bar': { name: 'Stacked Bar Chart', axes: 'x=categories, y=stacked values', best_for: 'comparing totals and composition simultaneously' },
        'grouped-bar': { name: 'Grouped Bar Chart', axes: 'x=categories, y=grouped values', best_for: 'comparing subcategories across groups' },
        'choropleth': { name: 'Choropleth Map', axes: 'regions=areas, color=values', best_for: 'showing geographic distribution' }
    };

    /**
     * Parse raw text input into structured data based on the specified format.
     * Returns { columns: string[], rows: any[][], rawObjects: object[] }
     */
    function parseData(rawText, format) {
        rawText = rawText.trim();
        if (!rawText) throw new Error('No data provided.');

        switch (format) {
            case 'csv': return parseDelimited(rawText, ',');
            case 'tsv': return parseDelimited(rawText, '\t');
            case 'json': return parseJSON(rawText);
            case 'manual': return parseManual(rawText);
            default: throw new Error(`Unknown format: ${format}`);
        }
    }

    function parseDelimited(text, delimiter) {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) throw new Error('Data must have a header row and at least one data row.');

        const columns = lines[0].split(delimiter).map(c => c.trim());
        const rows = [];
        const rawObjects = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(delimiter).map(v => v.trim());
            rows.push(values);
            rawObjects.push(buildRowObject(columns, values));
        }

        return { columns, rows, rawObjects };
    }

    function parseJSON(text) {
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error('Invalid JSON. Ensure data is a valid JSON array of objects.');
        }
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('JSON must be a non-empty array of objects.');
        }
        const columns = Object.keys(data[0]);
        const rows = data.map(obj => columns.map(col => obj[col] !== undefined ? String(obj[col]) : ''));
        return { columns, rows, rawObjects: data };
    }

    function parseManual(text) {
        // Format: key: value (one per line) OR key, value (one per line)
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        const columns = ['Category', 'Value'];
        const rows = [];
        const rawObjects = [];

        for (const line of lines) {
            const entry = parseManualEntry(line);
            if (!entry) continue;

            rows.push([entry.category, entry.value]);
            rawObjects.push({ Category: entry.category, Value: entry.value });
        }

        if (rows.length === 0) throw new Error('Could not parse manual data. Use "Label: Value" or "Label, Value" per line.');
        return { columns, rows, rawObjects };
    }

    /**
     * Analyze parsed data to determine column types, statistics, and characteristics.
     */
    function analyzeData(parsedData) {
        const { columns, rows } = parsedData;
        const columnTypes = columns.map((_, idx) => detectColumnType(extractColumnValues(rows, idx)));
        const numericColumns = columns.filter((_, i) => columnTypes[i] === 'numeric');
        const categoricalColumns = columns.filter((_, i) => columnTypes[i] === 'categorical');
        const temporalColumns = columns.filter((_, i) => columnTypes[i] === 'temporal');

        const rowCount = rows.length;
        const colCount = columns.length;
        const uniqueCounts = columns.map((_, idx) => new Set(extractColumnValues(rows, idx)).size);

        return {
            columns,
            columnTypes,
            numericColumns,
            categoricalColumns,
            temporalColumns,
            rowCount,
            colCount,
            uniqueCounts,
            hasTimeSeries: temporalColumns.length > 0,
            numericCount: numericColumns.length,
            categoricalCount: categoricalColumns.length
        };
    }

    function detectColumnType(values) {
        const nonEmpty = values.filter(v => v !== '' && v !== null && v !== undefined);
        if (nonEmpty.length === 0) return 'categorical';

        // Check numeric
        const numericCount = nonEmpty.filter(isNumericValue).length;
        if (numericCount / nonEmpty.length > 0.8) return 'numeric';

        // Check temporal
        const temporalCount = nonEmpty.filter(isTemporalValue).length;
        if (temporalCount / nonEmpty.length > 0.6) return 'temporal';

        return 'categorical';
    }

    /**
     * Recommend the best visualization type based on data analysis and user purpose.
     */
    function recommendVisualizationType(analysis, purpose) {
        const { hasTimeSeries, numericCount, rowCount } = analysis;

        // Purpose-based primary selection
        const recommendations = {
            trend: hasTimeSeries ? 'line' : (numericCount >= 2 ? 'line' : 'bar'),
            comparison: rowCount <= 8 ? 'bar' : (rowCount <= 20 ? 'bar' : 'grouped-bar'),
            composition: rowCount <= 6 ? 'pie' : (rowCount <= 12 ? 'donut' : 'treemap'),
            distribution: numericCount >= 1 ? 'histogram' : 'bar',
            relationship: numericCount >= 2 ? 'scatter' : 'heatmap',
            geographic: 'choropleth',
            flow: 'funnel'
        };

        let recommended = recommendations[purpose] || 'bar';

        // Refinements
        if (purpose === 'comparison' && numericCount >= 3) {
            recommended = 'radar';
        }
        if (purpose === 'trend' && numericCount >= 2 && hasTimeSeries) {
            recommended = 'area';
        }
        if (purpose === 'composition' && rowCount > 12) {
            recommended = 'treemap';
        }

        return recommended;
    }

    /**
     * Recommend a color scheme based on data type, purpose, and audience.
     */
    function recommendColorScheme(analysis, purpose, audience) {
        // Purpose-based overrides
        if (purpose === 'comparison' && analysis.rowCount > 5) return 'vibrant';
        if (purpose === 'trend') return 'cool-ocean';
        if (purpose === 'composition') return 'pastel';
        if (purpose === 'distribution') return 'earth-tones';
        if (purpose === 'relationship') return 'high-contrast';

        return AUDIENCE_COLOR_DEFAULTS[audience] || 'corporate-blue';
    }

    /**
     * Get color scheme details (actual hex values and description).
     */
    function getColorSchemeDetails(schemeName) {
        return COLOR_SCHEME_DETAILS[schemeName] || COLOR_SCHEME_DETAILS['corporate-blue'];
    }

    /**
     * Get chart type details for prompt construction.
     */
    function getChartTypeDetails(chartType) {
        return CHART_TYPE_DETAILS[chartType] || CHART_TYPE_DETAILS['bar'];
    }

    function buildRowObject(columns, values) {
        const obj = {};
        columns.forEach((column, index) => {
            obj[column] = values[index] || '';
        });
        return obj;
    }

    function parseManualEntry(line) {
        let parts;

        if (line.includes(':')) {
            parts = line.split(':').map(segment => segment.trim());
        } else if (line.includes(',')) {
            parts = line.split(',').map(segment => segment.trim());
        } else {
            return null;
        }

        if (parts.length < 2) return null;
        return {
            category: parts[0],
            value: parts.slice(1).join(' ').trim()
        };
    }

    function extractColumnValues(rows, columnIndex) {
        return rows.map(row => row[columnIndex]);
    }

    function isNumericValue(value) {
        return !isNaN(parseFloat(value)) && isFinite(value);
    }

    function isTemporalValue(value) {
        return TEMPORAL_PATTERNS.some(pattern => pattern.test(String(value).trim()));
    }

    // Public API
    return {
        parseData,
        analyzeData,
        recommendVisualizationType,
        recommendColorScheme,
        getColorSchemeDetails,
        getChartTypeDetails
    };

})();
