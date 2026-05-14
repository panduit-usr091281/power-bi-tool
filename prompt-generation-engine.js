/* ===========================================
   prompt-generation-engine.js
   Constructs detailed, structured prompts for
   LLMs to generate data visualizations based
   on analyzed data and user preferences.
   =========================================== */

const PromptGenerationEngine = (() => {
    'use strict';

    // Keep prompt fragments centralized so future prompt tuning stays localized.
    const PURPOSE_LABELS = {
        comparison: 'Compare values across categories',
        trend: 'Show trends over time',
        composition: 'Show parts of a whole',
        distribution: 'Show data distribution',
        relationship: 'Show relationships between variables',
        geographic: 'Display geographic/spatial data',
        flow: 'Show process or flow'
    };

    const AUDIENCE_LABELS = {
        executive: 'Executive / C-Suite (clean, minimal, insight-focused)',
        technical: 'Technical Team (detailed, precise, data-dense)',
        general: 'General / Public (accessible, clear, engaging)',
        academic: 'Academic / Research (formal, annotated, publication-ready)',
        marketing: 'Marketing / Sales (visually compelling, story-driven)'
    };

    const AUDIENCE_DESIGN_GUIDANCE = {
        executive: '- Keep visual clean and uncluttered\n- Use large, readable fonts\n- Highlight key takeaways with annotations\n- Limit to essential data points',
        technical: '- Include gridlines and axis labels\n- Show precise values\n- Use data-dense layout\n- Include legend with full detail',
        general: '- Use clear, jargon-free labels\n- Make the visualization self-explanatory\n- Use adequate spacing and size\n- Include a brief descriptive subtitle',
        academic: '- Include axis labels with units\n- Add source attribution space\n- Use publication-standard fonts (serif for labels)\n- Include error bars or confidence intervals if applicable',
        marketing: '- Make it visually striking and memorable\n- Use bold colors and clear hierarchy\n- Include a compelling title/headline\n- Optimize for presentation slides'
    };

    const TOOL_INSTRUCTIONS = {
        'matplotlib': `## IMPLEMENTATION (Python - Matplotlib)\n- Use matplotlib.pyplot with a clean, modern style (plt.style.use('seaborn-v0_8') or similar)\n- Set figure size with plt.figure(figsize=(width, height))\n- Use tight_layout() for proper spacing\n- Export as high-DPI PNG: plt.savefig('output.png', dpi=150, bbox_inches='tight')\n- Include all necessary imports at the top`,
        'seaborn': `## IMPLEMENTATION (Python - Seaborn)\n- Import seaborn as sns and use sns.set_theme() for consistent styling\n- Use appropriate seaborn plot functions (barplot, lineplot, scatterplot, etc.)\n- Customize the palette parameter with the specified colors\n- Include plt.tight_layout() and plt.savefig() for output`,
        'plotly': `## IMPLEMENTATION (Python - Plotly)\n- Use plotly.express for standard charts or plotly.graph_objects for custom layouts\n- Set the template to 'plotly_white' or 'plotly_dark' as appropriate\n- Include hover data with formatted tooltips\n- Export with fig.write_image('output.png') and fig.write_html('output.html')`,
        'chartjs': `## IMPLEMENTATION (JavaScript - Chart.js)\n- Provide complete HTML with a <canvas> element and Chart.js CDN link\n- Use Chart.js v4+ syntax with new Chart(ctx, config)\n- Configure responsive: true and maintainAspectRatio: true\n- Include the data object and options object fully specified`,
        'd3': `## IMPLEMENTATION (JavaScript - D3.js)\n- Use D3.js v7 syntax\n- Create an SVG element with proper viewBox for responsiveness\n- Include scales, axes, and transitions\n- Provide complete standalone HTML that can be opened in a browser`,
        'vega': `## IMPLEMENTATION (Vega-Lite)\n- Provide a complete Vega-Lite JSON specification\n- Use $schema: "https://vega.github.io/schema/vega-lite/v5.json"\n- Include proper encoding channels, mark types, and config`,
        'excel': `## IMPLEMENTATION (Excel)\n- Provide step-by-step instructions for creating this chart in Excel\n- Specify exact chart type selection from Insert > Charts\n- Include formatting steps for colors, fonts, and layout\n- Mention any formulas needed for data preparation`,
        'tableau': `## IMPLEMENTATION (Tableau)\n- Provide step-by-step Tableau Desktop instructions\n- Specify which fields go on Rows, Columns, Color, Size marks\n- Include formatting and color customization steps\n- Mention any calculated fields needed`,
        'powerbi': `## IMPLEMENTATION (Power BI)\n- Provide step-by-step Power BI Desktop instructions\n- Specify the visual type to insert from the Visualizations pane\n- Detail which fields to drag to each well (Axis, Values, Legend)\n- Include formatting steps under Format pane`
    };

    /**
     * Build the full visualization prompt from all gathered inputs.
     * @param {object} config - Complete configuration object
     * @returns {object} - { prompt: string, metadata: object }
     */
    function buildPrompt(config) {
        const {
            parsedData,
            analysis,
            chartType,
            colorScheme,
            colorDetails,
            chartDetails,
            title,
            purpose,
            audience,
            targetTool,
            dimensions,
            notes
        } = config;

        const sections = [];

        // Section 1: Role and Task
        sections.push(buildRoleSection(targetTool));

        // Section 2: Visualization Specification
        sections.push(buildSpecificationSection(chartType, chartDetails, title, purpose, audience));

        // Section 3: Data
        sections.push(buildDataSection(parsedData, analysis));

        // Section 4: Visual Design
        sections.push(buildDesignSection(colorScheme, colorDetails, dimensions, audience));

        // Section 5: Layout and Formatting
        sections.push(buildLayoutSection(chartType, analysis, audience));

        // Section 6: Tool-Specific Instructions
        if (targetTool !== 'any' && targetTool !== 'image-only') {
            sections.push(buildToolSection(targetTool));
        }

        // Section 7: Additional Requirements
        if (notes) {
            sections.push(buildNotesSection(notes));
        }

        // Section 8: Output Requirements
        sections.push(buildOutputSection(targetTool));

        const prompt = sections.join('\n\n');

        const metadata = {
            chartType: chartDetails.name,
            colorScheme: colorDetails.name,
            dataRows: analysis.rowCount,
            dataColumns: analysis.colCount,
            targetTool: targetTool === 'any' ? 'LLM Choice' : targetTool,
            purpose,
            audience
        };

        return { prompt, metadata };
    }

    function buildRoleSection(targetTool) {
        if (targetTool === 'image-only') {
            return `You are an expert data visualization designer. Create a professional, publication-quality data visualization image based on the specifications below. Generate the image directly — do not provide code.`;
        }
        return `You are an expert data visualization developer. Create a complete, production-ready data visualization based on the specifications below. Provide clean, well-commented code that generates the exact chart described.`;
    }

    function buildSpecificationSection(chartType, chartDetails, title, purpose, audience) {
        let section = `## VISUALIZATION SPECIFICATION\n`;
        section += `- **Chart Type:** ${chartDetails.name}\n`;
        section += `- **Title:** "${title || 'Data Visualization'}"\n`;
        section += `- **Purpose:** ${PURPOSE_LABELS[purpose] || purpose}\n`;
        section += `- **Target Audience:** ${AUDIENCE_LABELS[audience] || audience}\n`;
        section += `- **Axes/Structure:** ${chartDetails.axes}\n`;
        section += `- **Best Used For:** ${chartDetails.best_for}`;

        return section;
    }

    function buildDataSection(parsedData, analysis) {
        const { columns, rows } = parsedData;

        let section = `## DATA\n`;
        section += `Use the following dataset exactly as provided:\n\n`;
        section += formatMarkdownTable(columns, rows);

        section += `\n**Data Summary:** ${analysis.rowCount} rows, ${analysis.colCount} columns`;
        section += `\n- Numeric columns: ${analysis.numericColumns.join(', ') || 'none'}`;
        section += `\n- Categorical columns: ${analysis.categoricalColumns.join(', ') || 'none'}`;
        if (analysis.temporalColumns.length > 0) {
            section += `\n- Temporal columns: ${analysis.temporalColumns.join(', ')}`;
        }

        return section;
    }

    function buildDesignSection(colorScheme, colorDetails, dimensions, audience) {
        let section = `## VISUAL DESIGN\n`;
        section += `- **Color Palette:** ${colorDetails.name}\n`;
        section += `  - Description: ${colorDetails.description}\n`;
        section += `  - Primary Colors: ${colorDetails.colors.join(', ')}\n`;
        section += `  - Use these exact hex values for consistency\n`;

        if (dimensions) {
            section += `- **Dimensions:** ${dimensions}\n`;
        }

        section += AUDIENCE_DESIGN_GUIDANCE[audience] || '';

        return section;
    }

    function buildLayoutSection(chartType, analysis, audience) {
        let section = `## LAYOUT AND FORMATTING REQUIREMENTS\n`;

        // Common requirements
        section += `- Include a clear, prominent title at the top\n`;
        section += `- Add appropriate axis labels with readable font sizes\n`;
        section += `- Include a legend if there are multiple data series\n`;
        section += `- Ensure adequate padding/margins around the chart\n`;
        section += `- Use anti-aliased rendering for smooth lines and curves\n`;

        // Text positioning rules (anti-collision)
        section += `\n**TEXT POSITIONING RULES (CRITICAL):**\n`;
        section += `- All text labels must fit entirely within their containing element or allocated space\n`;
        section += `- No text may overlap, collide with, or be clipped by other text, lines, or shapes\n`;
        section += `- Maintain a minimum padding of 4px between any text element and its nearest neighbor\n`;
        section += `- If a label does not fit inside its element, place it outside with a connector line\n`;
        section += `- Use text truncation with ellipsis (...) rather than allowing overflow\n`;
        section += `- Axis labels must not extend beyond the chart area boundaries\n`;
        section += `- Legend entries must be vertically aligned with consistent spacing (minimum 6px gap)\n`;
        section += `- Data labels on small elements should use leader lines pointing to an unoccupied area\n`;
        section += `- Rotate long axis labels 30-45° only if they would otherwise overlap; prefer shorter text\n`;
        section += `- Title, subtitle, and annotations must each occupy their own dedicated vertical space\n`;

        // Chart-type specific
        if (['bar', 'grouped-bar', 'stacked-bar'].includes(chartType)) {
            section += `- Sort bars by value (descending) unless order is meaningful (time-based)\n`;
            section += `- Add value labels on or above each bar\n`;
            section += `- Use horizontal bars if category labels are long\n`;
        } else if (chartType === 'line' || chartType === 'area') {
            section += `- Use data point markers at each value\n`;
            section += `- Include subtle gridlines for reference\n`;
            section += `- Start y-axis at zero unless there is a compelling reason not to\n`;
        } else if (['pie', 'donut'].includes(chartType)) {
            section += `- Include percentage labels on each slice\n`;
            section += `- Order slices from largest to smallest (clockwise from top)\n`;
            section += `- Pull out / highlight the largest or most important slice if relevant\n`;
        } else if (chartType === 'scatter') {
            section += `- Add a trend line if correlation is visible\n`;
            section += `- Label outlier points if present\n`;
            section += `- Use semi-transparent markers to show density\n`;
        }

        return section;
    }

    function buildToolSection(targetTool) {
        return TOOL_INSTRUCTIONS[targetTool] || '';
    }

    function formatMarkdownTable(columns, rows) {
        const colWidths = columns.map((col, idx) => {
            const maxDataWidth = Math.max(...rows.map(row => String(row[idx] || '').length));
            return Math.max(col.length, maxDataWidth, 4);
        });

        let output = '';
        output += '| ' + columns.map((column, index) => column.padEnd(colWidths[index])).join(' | ') + ' |\n';
        output += '| ' + colWidths.map(width => '-'.repeat(width)).join(' | ') + ' |\n';

        for (const row of rows) {
            output += '| ' + row.map((value, index) => String(value || '').padEnd(colWidths[index])).join(' | ') + ' |\n';
        }

        return output;
    }

    function buildNotesSection(notes) {
        return `## ADDITIONAL REQUIREMENTS\n${notes}`;
    }

    function buildOutputSection(targetTool) {
        let section = `## OUTPUT REQUIREMENTS\n`;

        if (targetTool === 'image-only') {
            section += `- Generate the visualization as a high-quality image\n`;
            section += `- The image should be immediately usable in a presentation or report\n`;
            section += `- Include all labels, legends, and annotations within the image\n`;
            section += `- Use a clean white or light background unless otherwise specified\n`;
            section += `- All text must fit within the image boundaries with no clipping or overflow`;
        } else if (['excel', 'tableau', 'powerbi'].includes(targetTool)) {
            section += `- Provide clear, numbered step-by-step instructions\n`;
            section += `- Include the raw data in a format ready to paste\n`;
            section += `- Specify all formatting changes needed to match the design spec`;
        } else {
            section += `- Provide complete, runnable code — no placeholders or pseudocode\n`;
            section += `- Include all imports/dependencies at the top\n`;
            section += `- The code should produce the visualization when run without modification\n`;
            section += `- Add brief comments explaining key sections\n`;
            section += `- Include the data directly in the code (do not read from external files)\n`;
            section += `- Ensure all text labels are fully contained within the figure area — use tight_layout(), constrained_layout, or equivalent to prevent clipping\n`;
            section += `- Verify no labels, tick marks, or legend entries extend beyond the plot boundaries`;
        }

        return section;
    }

    // Public API
    return {
        buildPrompt
    };

})();
