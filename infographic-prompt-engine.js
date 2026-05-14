/* ===========================================
   infographic-prompt-engine.js
   Generates detailed infographic-style prompts
   that describe creative visual elements, icons,
   illustrations, spatial layouts, and color usage
   to convey data relationships without traditional
   charts or graphs.
   =========================================== */

const InfographicPromptEngine = (() => {
    'use strict';

    // --- Infographic Layout Templates ---
    const LAYOUT_TEMPLATES = {
        'timeline-path': {
            name: 'Timeline Path',
            description: 'A flowing path (winding road, river, or ribbon) that moves through the image with data points as stops or milestones along the journey',
            bestFor: ['trend', 'flow'],
            structure: 'Vertical or horizontal serpentine path with milestone nodes evenly spaced. Each node contains an icon and value. Connecting segments use gradient fills to show progression.'
        },
        'icon-grid': {
            name: 'Icon Array / Pictogram Grid',
            description: 'A structured grid of repeated icons where filled vs unfilled icons represent proportions and quantities',
            bestFor: ['composition', 'comparison'],
            structure: 'Rows and columns of identical icon shapes. Filled icons represent the count/proportion for each category. Each category uses a distinct color from the palette.'
        },
        'hub-spoke': {
            name: 'Hub & Spoke Diagram',
            description: 'A central focal element (circle, icon, or illustration) with radiating spokes connecting to surrounding data points or categories',
            bestFor: ['relationship', 'composition'],
            structure: 'Large central circle containing the main theme/title. Surrounding satellite circles connected by lines or arrows. Each satellite has an icon, label, and value.'
        },
        'comparison-split': {
            name: 'Split Comparison Panel',
            description: 'The image divided into two or more vertical/horizontal panels, each representing a category with mirrored visual elements for easy comparison',
            bestFor: ['comparison'],
            structure: 'Canvas split into equal panels with a dividing line or gradient boundary. Each panel uses its own accent color and contains matching element types (icons, numbers, progress indicators) for direct comparison.'
        },
        'isometric-scene': {
            name: 'Isometric Illustration Scene',
            description: 'A 3D isometric scene where buildings, objects, or landscape elements represent data values through their size, height, or quantity',
            bestFor: ['comparison', 'composition', 'geographic'],
            structure: 'Isometric grid with 3D objects scaled proportionally to data values. Objects sit on a shared ground plane. Labels float above or beside each element.'
        },
        'flow-process': {
            name: 'Process Flow Illustration',
            description: 'A sequence of illustrated steps connected by arrows, pipes, or conveyor belts showing transformation or progression of data through stages',
            bestFor: ['flow', 'trend'],
            structure: 'Left-to-right or top-to-bottom sequence of illustrated containers (machines, funnels, pipes). Connecting elements show flow direction. Each stage displays its value prominently.'
        },
        'proportional-shapes': {
            name: 'Proportional Shape Mosaic',
            description: 'Geometric shapes (circles, squares, or custom silhouettes) sized proportionally to their data values, arranged in an aesthetically balanced composition',
            bestFor: ['composition', 'comparison', 'distribution'],
            structure: 'Shapes packed together in a balanced arrangement. Each shape\'s area is proportional to its value. Color distinguishes categories. Labels placed inside or adjacent to shapes.'
        },
        'data-landscape': {
            name: 'Data Landscape / Cityscape',
            description: 'A creative landscape or skyline where natural/urban elements (mountains, buildings, trees) represent data values through their height or size',
            bestFor: ['comparison', 'trend'],
            structure: 'Horizontal scene with elements rising from a baseline. Height corresponds to value. Foreground labels identify each element. Background provides context (sky, gradient).'
        },
        'radial-burst': {
            name: 'Radial Burst / Sunburst',
            description: 'Concentric rings or rays emanating from a center point, with segment lengths, widths, or colors encoding data values',
            bestFor: ['composition', 'relationship'],
            structure: 'Central circle with radiating segments extending outward. Segment length or arc width represents value. Inner ring shows category labels, outer ring shows values.'
        },
        'journey-map': {
            name: 'Visual Journey / Story Map',
            description: 'An illustrated narrative path that tells the data story as a visual journey with scenes, characters, or landmarks at each data point',
            bestFor: ['trend', 'flow'],
            structure: 'Illustrated scene with a character or vehicle traveling along a path. Each stop on the path represents a data point with a callout card showing the value and context.'
        },
        'stacked-layers': {
            name: 'Stacked Layer Diagram',
            description: 'Horizontal or vertical layers stacked like geological strata or a layered cake, with each layer\'s thickness representing its value',
            bestFor: ['composition', 'distribution'],
            structure: 'Layers stacked vertically with proportional heights. Each layer has a distinct color and pattern. Labels on the left, values on the right. Total shown at top or bottom.'
        },
        'meter-dashboard': {
            name: 'Visual Dashboard with Meters',
            description: 'A collection of creative gauges, dials, progress rings, and indicator elements arranged in a dashboard layout',
            bestFor: ['comparison', 'distribution'],
            structure: 'Grid of visual indicators (semicircle gauges, circular progress rings, thermometer bars, battery-level indicators). Each has a large number, label, and color-coded status.'
        }
    };

    // --- Visual Element Types for Infographics ---
    const VISUAL_ELEMENTS = {
        icons: ['flat icons', 'line icons', 'filled icons', 'isometric icons', 'hand-drawn icons', 'emoji-style icons', 'silhouette icons'],
        connectors: ['flowing arrows', 'dotted paths', 'gradient ribbons', 'pipes/tubes', 'chain links', 'lightning bolts', 'curved lines'],
        containers: ['rounded rectangles', 'circles', 'speech bubbles', 'badges/shields', 'banners/ribbons', 'hexagons', 'irregular organic shapes'],
        backgrounds: ['gradient wash', 'geometric pattern', 'subtle texture', 'solid with sections', 'illustrated scene', 'dark with glowing elements'],
        typography: ['oversized numbers', 'handwritten annotations', 'bold sans-serif headers', 'thin body text', 'highlighted keywords', 'data callout boxes'],
        decorative: ['abstract shapes', 'confetti/particles', 'subtle grid lines', 'shadow/depth layers', 'glowing accents', 'texture overlays']
    };

    // --- Infographic Color Palettes ---
    const INFOGRAPHIC_PALETTES = {
        'bold-editorial': {
            name: 'Bold Editorial',
            primary: '#1a1a2e', accent1: '#e94560', accent2: '#0f3460', accent3: '#16213e',
            highlight: '#f5a623', background: '#ffffff',
            description: 'High-impact magazine-style with deep darks and punchy accent colors'
        },
        'fresh-modern': {
            name: 'Fresh Modern',
            primary: '#2d3436', accent1: '#00cec9', accent2: '#6c5ce7', accent3: '#fd79a8',
            highlight: '#ffeaa7', background: '#f8f9fa',
            description: 'Clean and contemporary with trendy gradients and bright accents'
        },
        'warm-professional': {
            name: 'Warm Professional',
            primary: '#2c3e50', accent1: '#e67e22', accent2: '#27ae60', accent3: '#2980b9',
            highlight: '#f39c12', background: '#fdfefe',
            description: 'Trustworthy business palette with warm, approachable tones'
        },
        'playful-illustrated': {
            name: 'Playful Illustrated',
            primary: '#2d3436', accent1: '#e17055', accent2: '#00b894', accent3: '#0984e3',
            highlight: '#fdcb6e', background: '#ffeef2',
            description: 'Friendly and engaging with soft backgrounds and bold illustration colors'
        },
        'dark-infographic': {
            name: 'Dark Infographic',
            primary: '#ffffff', accent1: '#00d2ff', accent2: '#7b2ff7', accent3: '#ff6b6b',
            highlight: '#feca57', background: '#0a0a23',
            description: 'Dark canvas with glowing neon accents for high visual drama'
        },
        'minimal-elegant': {
            name: 'Minimal Elegant',
            primary: '#1a1a1a', accent1: '#4a90d9', accent2: '#7b8794', accent3: '#c0392b',
            highlight: '#2ecc71', background: '#ffffff',
            description: 'Restrained palette relying on one or two accent colors with plenty of white space'
        },
        'nature-organic': {
            name: 'Nature / Organic',
            primary: '#2d4a22', accent1: '#6ab04c', accent2: '#f0932b', accent3: '#4a69bd',
            highlight: '#f6e58d', background: '#fafdf6',
            description: 'Earthy greens and natural tones for sustainability or environment topics'
        },
        'tech-futuristic': {
            name: 'Tech / Futuristic',
            primary: '#0d1117', accent1: '#58a6ff', accent2: '#bc8cff', accent3: '#39d353',
            highlight: '#f0883e', background: '#161b22',
            description: 'Developer/tech aesthetic with code-editor inspired dark tones and syntax colors'
        }
    };

    const INFOGRAPHIC_AUDIENCE_PALETTE_KEYS = {
        executive: 'warm-professional',
        technical: 'tech-futuristic',
        general: 'fresh-modern',
        academic: 'minimal-elegant',
        marketing: 'bold-editorial'
    };

    const INFOGRAPHIC_PURPOSE_PALETTE_OVERRIDES = {
        flow: 'playful-illustrated',
        trend: 'fresh-modern',
        composition: 'bold-editorial',
        relationship: 'dark-infographic'
    };

    const PURPOSE_NARRATIVES = {
        comparison: 'emphasizing differences and similarities between categories through relative visual sizing and positioning',
        trend: 'showing progression and change over time through a visual journey or path narrative',
        composition: 'revealing how parts contribute to a whole through proportional visual elements',
        distribution: 'displaying the spread and range of values through varied element sizes and density',
        relationship: 'illustrating connections and correlations between items through spatial proximity and connecting elements',
        geographic: 'mapping information to spatial positions using landmark and location metaphors',
        flow: 'demonstrating a process or sequence through connected illustrated stages'
    };

    const AUDIENCE_TONES = {
        executive: 'Professional and polished',
        marketing: 'Bold and eye-catching',
        technical: 'Clean and precise',
        academic: 'Formal and structured',
        general: 'Friendly and accessible'
    };

    const TYPOGRAPHY_GUIDE = {
        executive: 'Clean sans-serif (like Helvetica, Inter, or SF Pro). Title: bold 28-36pt. Body: regular 12-14pt.',
        technical: 'Monospace or geometric sans-serif (like Roboto Mono, IBM Plex). Title: medium 24-30pt. Body: regular 11-13pt.',
        general: 'Friendly rounded sans-serif (like Nunito, Poppins). Title: bold 30-40pt. Body: regular 14-16pt.',
        academic: 'Classic sans-serif (like Source Sans, Lato). Title: semibold 24-28pt. Body: regular 11-13pt.',
        marketing: 'Bold display font for title (like Montserrat, Raleway). Title: extra-bold 36-48pt. Body: medium 13-15pt.'
    };

    /**
     * Select the best infographic layout based on data characteristics and purpose.
     */
    function selectLayout(analysis, purpose) {
        const { rowCount, numericCount, categoricalCount, hasTimeSeries } = analysis;

        // Score each layout for the given purpose
        const scores = {};
        for (const [key, layout] of Object.entries(LAYOUT_TEMPLATES)) {
            let score = 0;
            if (layout.bestFor.includes(purpose)) score += 10;

            // Data shape bonuses
            if (hasTimeSeries && (key === 'timeline-path' || key === 'journey-map')) score += 5;
            if (rowCount <= 4 && key === 'hub-spoke') score += 3;
            if (rowCount <= 6 && key === 'comparison-split') score += 4;
            if (rowCount >= 5 && key === 'icon-grid') score += 3;
            if (rowCount >= 4 && rowCount <= 8 && key === 'data-landscape') score += 3;
            if (purpose === 'composition' && key === 'proportional-shapes') score += 4;
            if (purpose === 'flow' && key === 'flow-process') score += 6;
            if (numericCount >= 3 && key === 'meter-dashboard') score += 4;
            if (rowCount === 2 && key === 'comparison-split') score += 6;

            scores[key] = score;
        }

        // Return the highest-scoring layout
        const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        return LAYOUT_TEMPLATES[sorted[0][0]];
    }

    /**
     * Select the best infographic color palette based on audience and purpose.
     */
    function selectPalette(audience, purpose) {
        // Purpose takes priority if audience is general
        if (audience === 'general' && INFOGRAPHIC_PURPOSE_PALETTE_OVERRIDES[purpose]) {
            return INFOGRAPHIC_PALETTES[INFOGRAPHIC_PURPOSE_PALETTE_OVERRIDES[purpose]];
        }

        const key = INFOGRAPHIC_AUDIENCE_PALETTE_KEYS[audience] || 'fresh-modern';
        return INFOGRAPHIC_PALETTES[key];
    }

    /**
     * Determine icon theme based on the data categories/columns.
     */
    function selectIconStyle(analysis, audience) {
        if (audience === 'executive' || audience === 'academic') return 'flat icons';
        if (audience === 'marketing') return 'filled icons';
        if (audience === 'technical') return 'line icons';
        return 'flat icons';
    }

    /**
     * Generate spatial layout instructions for where elements go.
     */
    function generateSpatialLayout(layout, parsedData, analysis) {
        const { columns, rows } = parsedData;
        const itemCount = rows.length;

        let spatial = '';
        spatial += `**Canvas Layout:** Single-page vertical infographic (portrait orientation)\n`;
        spatial += `**Overall Structure:**\n`;
        spatial += `  - TOP (10%): Title banner with main headline and optional subtitle\n`;
        spatial += `  - MIDDLE (75%): Main visual area using "${layout.name}" layout\n`;
        spatial += `  - BOTTOM (15%): Summary callout, source citation, or key insight\n\n`;

        spatial += `**Main Visual Area Detail:**\n`;
        spatial += `  Layout: ${layout.structure}\n`;
        spatial += `  Number of data elements to represent: ${itemCount}\n`;
        spatial += `  Data columns available: ${columns.join(', ')}\n\n`;

        // Element placement
        spatial += `**Element Placement:**\n`;
        rows.forEach((row, idx) => {
            const label = row[0] || `Item ${idx + 1}`;
            const values = row.slice(1).map((v, i) => `${columns[i + 1]}=${v}`).join(', ');
            spatial += `  ${idx + 1}. "${label}" — display with values: ${values}\n`;
        });

        return spatial;
    }

    /**
     * Build the complete infographic prompt.
     */
    function buildInfographicPrompt(config) {
        const { parsedData, analysis, title, purpose, audience, notes, dimensions } = config;

        const layout = selectLayout(analysis, purpose);
        const palette = selectPalette(audience, purpose);
        const iconStyle = selectIconStyle(analysis, audience);
        const spatialLayout = generateSpatialLayout(layout, parsedData, analysis);

        const sections = [];

        // Role
        sections.push(`You are an expert infographic designer and visual storyteller. Create a detailed, visually striking infographic image that communicates data through creative illustrations, icons, and visual metaphors — NOT through traditional charts or graphs. The infographic should be immediately understandable and visually compelling.`);

        // Concept
        sections.push(buildConceptSection(layout, title, purpose, audience));

        // Data to represent
        sections.push(buildDataRepresentationSection(parsedData, analysis));

        // Visual Design Specification
        sections.push(buildVisualDesignSection(palette, iconStyle, layout, audience));

        // Spatial Layout
        sections.push(`## SPATIAL LAYOUT AND COMPOSITION\n${spatialLayout}`);

        // Element-by-element Description
        sections.push(buildElementDescriptionSection(parsedData, analysis, layout, palette, iconStyle));

        // Typography and Labeling
        sections.push(buildTypographySection(audience, palette));

        // Dimensions
        if (dimensions) {
            sections.push(`## DIMENSIONS\nOutput size: ${dimensions}`);
        }

        // Additional notes
        if (notes) {
            sections.push(`## ADDITIONAL REQUIREMENTS\n${notes}`);
        }

        // Output spec
        sections.push(buildInfographicOutputSection());

        const prompt = sections.join('\n\n');

        const metadata = {
            chartType: `Infographic (${layout.name})`,
            colorScheme: palette.name,
            dataRows: analysis.rowCount,
            dataColumns: analysis.colCount,
            targetTool: 'Image Generation',
            purpose,
            audience
        };

        return { prompt, metadata };
    }

    function buildConceptSection(layout, title, purpose, audience) {
        let section = `## INFOGRAPHIC CONCEPT\n`;
        section += `- **Title:** "${title || 'Data Infographic'}"\n`;
        section += `- **Visual Style:** ${layout.name} — ${layout.description}\n`;
        section += `- **Narrative Approach:** ${PURPOSE_NARRATIVES[purpose] || PURPOSE_NARRATIVES.comparison}\n`;
        section += `- **Tone:** ${AUDIENCE_TONES[audience] || AUDIENCE_TONES.general}\n`;
        section += `- **Key Principle:** Use visual metaphors, proportional illustrations, and creative imagery instead of traditional chart axes, gridlines, or plot areas`;

        return section;
    }

    function buildDataRepresentationSection(parsedData, analysis) {
        const { columns, rows } = parsedData;
        let section = `## DATA TO REPRESENT\n`;
        section += `Translate the following data into visual form:\n\n`;
        section += formatMarkdownTable(columns, rows);

        section += `\n**Visual Encoding Rules:**\n`;
        section += `- Numeric values should be represented through SIZE, HEIGHT, QUANTITY, or FILL LEVEL of visual elements\n`;
        section += `- Categories should be distinguished by COLOR, ICON TYPE, or SPATIAL GROUPING\n`;
        section += `- Do NOT use traditional axes, gridlines, or chart frames\n`;
        section += `- Every data value must be visible as a number label near its visual representation`;

        return section;
    }

    function buildVisualDesignSection(palette, iconStyle, layout, audience) {
        let section = `## VISUAL DESIGN SPECIFICATION\n`;
        section += `**Color Palette: ${palette.name}**\n`;
        section += `- ${palette.description}\n`;
        section += `- Primary text/elements: ${palette.primary}\n`;
        section += `- Accent color 1 (main highlight): ${palette.accent1}\n`;
        section += `- Accent color 2 (secondary): ${palette.accent2}\n`;
        section += `- Accent color 3 (tertiary): ${palette.accent3}\n`;
        section += `- Highlight/callout color: ${palette.highlight}\n`;
        section += `- Background: ${palette.background}\n\n`;

        section += `**Icon Style:** ${iconStyle}\n`;
        section += `- Use consistent icon weight and style throughout\n`;
        section += `- Icons should be simple, recognizable, and relate to the data category\n\n`;

        section += `**Visual Elements to Use:**\n`;
        section += `- Containers: ${VISUAL_ELEMENTS.containers.slice(0, 3).join(', ')}\n`;
        section += `- Connectors: ${VISUAL_ELEMENTS.connectors.slice(0, 3).join(', ')}\n`;
        section += `- Decorative: ${VISUAL_ELEMENTS.decorative.slice(0, 3).join(', ')}\n`;
        section += `- Background treatment: ${audience === 'executive' ? 'clean white with subtle sections' : audience === 'marketing' ? 'gradient wash with geometric accents' : 'subtle texture or solid with sections'}\n`;

        return section;
    }

    function buildElementDescriptionSection(parsedData, analysis, layout, palette, iconStyle) {
        const { columns, rows } = parsedData;
        const numericCols = columns.filter((_, i) => analysis.columnTypes[i] === 'numeric');
        const numericColumnIndices = numericCols.map(col => ({ name: col, index: columns.indexOf(col) }));
        const maxValues = {};

        numericColumnIndices.forEach(({ name, index }) => {
            const values = rows.map(row => parseFloat(row[index]) || 0);
            maxValues[name] = Math.max(...values);
        });

        let section = `## DETAILED ELEMENT DESCRIPTIONS\n`;
        section += `For each data item, create the following visual representation:\n\n`;

        const accentColors = [palette.accent1, palette.accent2, palette.accent3, palette.highlight];

        rows.forEach((row, idx) => {
            const label = row[0] || `Item ${idx + 1}`;
            const color = accentColors[idx % accentColors.length];
            section += `### Element ${idx + 1}: "${label}"\n`;
            section += `- **Color:** ${color}\n`;
            section += `- **Icon:** Choose a ${iconStyle.replace('icons', 'icon')} that represents "${label}"\n`;

            numericColumnIndices.forEach(({ name, index }) => {
                const value = parseFloat(row[index]) || 0;
                const max = maxValues[name];
                const percent = max > 0 ? Math.round((value / max) * 100) : 0;
                section += `- **${name}:** Display value "${row[index]}" — visual size/fill at ${percent}% of maximum\n`;
            });

            section += `- **Label:** Show "${label}" as text near this element with value numbers clearly visible\n\n`;
        });

        return section;
    }

    function buildTypographySection(audience, palette) {
        let section = `## TYPOGRAPHY AND LABELING\n`;

        section += `- **Font Guidance:** ${TYPOGRAPHY_GUIDE[audience] || TYPOGRAPHY_GUIDE.general}\n`;
        section += `- **Title:** Large, prominent, positioned at top center. Color: ${palette.primary}\n`;
        section += `- **Data Values:** Display as oversized bold numbers near their visual element. Color: ${palette.accent1}\n`;
        section += `- **Category Labels:** Clear, readable, never overlapping. Color: ${palette.primary}\n`;
        section += `- **Hierarchy:** Title > Data Values > Category Labels > Supporting text\n\n`;

        section += `**TEXT PLACEMENT RULES (CRITICAL — NO EXCEPTIONS):**\n`;
        section += `- Every text element MUST fit entirely within its allocated space — no clipping, no overflow\n`;
        section += `- Minimum spacing between any two text elements: 8px vertically, 12px horizontally\n`;
        section += `- Text must NEVER overlap with icons, shapes, connectors, or other text\n`;
        section += `- If text would collide with a visual element, move the text to an adjacent clear area and use a subtle leader line\n`;
        section += `- Labels must be horizontally or vertically aligned within their group — no staggered or diagonal baselines\n`;
        section += `- Numbers must be large enough to read at a glance (minimum 14pt equivalent)\n`;
        section += `- Long category names should be abbreviated or wrapped to a second line, never truncated mid-word\n`;
        section += `- Title occupies its own exclusive horizontal band — nothing else may share that vertical space\n`;
        section += `- Each data element's label and value must be grouped together with consistent offset from the visual element\n`;
        section += `- Verify: if you draw a bounding box around each text element, no two boxes may intersect`;

        return section;
    }

    function buildInfographicOutputSection() {
        let section = `## OUTPUT REQUIREMENTS\n`;
        section += `- Generate a single, complete infographic IMAGE\n`;
        section += `- The image must be self-contained and understandable without external context\n`;
        section += `- All data values must be visible as readable numbers within the design\n`;
        section += `- Visual hierarchy must guide the viewer's eye from title to key insights\n`;
        section += `- NO traditional charts (no bar charts, line graphs, pie charts, axes, or gridlines)\n`;
        section += `- Use creative visual metaphors, proportional illustrations, icons, and spatial relationships\n`;
        section += `- The design should look like a professionally designed infographic, not a data dashboard\n`;
        section += `- Maintain consistent style throughout — same icon weight, color application, and spacing rules`;
        return section;
    }

    function formatMarkdownTable(columns, rows) {
        const colWidths = columns.map((column, index) => {
            const maxDataWidth = Math.max(column.length, ...rows.map(row => String(row[index] || '').length));
            return Math.max(maxDataWidth, 4);
        });

        let output = '';
        output += '| ' + columns.map((column, index) => column.padEnd(colWidths[index])).join(' | ') + ' |\n';
        output += '| ' + colWidths.map(width => '-'.repeat(width)).join(' | ') + ' |\n';
        for (const row of rows) {
            output += '| ' + row.map((value, index) => String(value || '').padEnd(colWidths[index])).join(' | ') + ' |\n';
        }
        return output;
    }

    // Public API
    return {
        buildInfographicPrompt,
        selectLayout,
        selectPalette,
        LAYOUT_TEMPLATES,
        INFOGRAPHIC_PALETTES,
        VISUAL_ELEMENTS
    };

})();
