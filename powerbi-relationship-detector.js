/* ===========================================
   powerbi-relationship-detector.js
   Detects relationships (foreign keys) between
   tables by analyzing column names, FK patterns,
   and data overlap.
   =========================================== */

const RelationshipDetector = (() => {
    'use strict';

    const ID_SUFFIXES = ['id', 'key', 'code', 'num', 'number', 'no', 'ref'];

    const PK_PATTERNS = [
        /^id$/i, /^pk$/i, /^key$/i, /_id$/i, /_key$/i, /_pk$/i
    ];

    /**
     * Detect relationships between tables.
     * @param {Object} tables - { tableName: { rows, columns } }
     * @param {Object} schemas - { tableName: { columns: [...] } }
     * @returns {Array} relationships
     */
    function detect(tables, schemas) {
        let relationships = [];

        const broadcastColumns = buildBroadcastColumnSet(schemas);

        detectByNameMatch(tables, schemas, relationships, broadcastColumns);
        detectByFKPattern(tables, schemas, relationships);

        relationships = validateRelationships(relationships, tables);
        relationships = deduplicate(relationships);

        return relationships;
    }

    function buildBroadcastColumnSet(schemas) {
        const colTableCount = {};

        for (const schema of Object.values(schemas)) {
            for (const col of schema.columns) {
                const key = col.name.toLowerCase();
                colTableCount[key] = (colTableCount[key] || 0) + 1;
            }
        }

        return new Set(
            Object.entries(colTableCount)
                .filter(([, count]) => count > 3)
                .map(([columnName]) => columnName)
        );
    }

    function detectByNameMatch(tables, schemas, relationships, broadcastColumns) {
        const tableNames = Object.keys(tables);

        for (let i = 0; i < tableNames.length; i++) {
            for (let j = i + 1; j < tableNames.length; j++) {
                const tableA = tableNames[i];
                const tableB = tableNames[j];

                const colsA = {};
                schemas[tableA].columns.forEach(c => { colsA[c.name.toLowerCase()] = c; });
                const colsB = {};
                schemas[tableB].columns.forEach(c => { colsB[c.name.toLowerCase()] = c; });

                // Find common column names, excluding broadcast columns
                const commonKeys = Object.keys(colsA).filter(k => k in colsB && !broadcastColumns.has(k));

                for (const colName of commonKeys) {
                    const colA = colsA[colName];
                    const colB = colsB[colName];

                    if (!typesCompatible(colA.dataType, colB.dataType)) continue;

                    const rel = determineDirection(tableA, colA.name, colA, tableB, colB.name, colB);
                    if (rel) relationships.push(rel);
                }
            }
        }
    }

    function detectByFKPattern(tables, schemas, relationships) {
        const tableNames = Object.keys(tables);
        const tableNameLower = {};
        tableNames.forEach(t => { tableNameLower[t.toLowerCase()] = t; });

        for (const tableName of tableNames) {
            for (const colInfo of schemas[tableName].columns) {
                const colLower = colInfo.name.toLowerCase();

                for (const suffix of ID_SUFFIXES) {
                    const pattern = new RegExp(`^(.+?)[\\s_]?${suffix}$`, 'i');
                    const match = colLower.match(pattern);
                    if (!match) continue;

                    const hint = match[1].toLowerCase();

                    for (const [candLower, candName] of Object.entries(tableNameLower)) {
                        if (candName === tableName) continue;
                        if (!fuzzyTableMatch(hint, candLower)) continue;

                        const pkCol = findPKColumn(candName, schemas);
                        if (pkCol) {
                            relationships.push({
                                fromTable: tableName,
                                fromColumn: colInfo.name,
                                toTable: candName,
                                toColumn: pkCol,
                                cardinality: 'manyToOne',
                                crossFilteringBehavior: 'oneDirection',
                                confidence: 0.7
                            });
                        }
                    }
                    break; // Only first suffix match
                }
            }
        }
    }

    function fuzzyTableMatch(hint, tableLower) {
        if (hint === tableLower) return true;
        if (hint + 's' === tableLower || hint + 'es' === tableLower) return true;
        if (tableLower + 's' === hint || tableLower + 'es' === hint) return true;
        if (tableLower.replace(/s$/, '') === hint) return true;
        if (hint.replace(/_/g, '') === tableLower.replace(/_/g, '')) return true;
        return false;
    }

    function findPKColumn(tableName, schemas) {
        const schema = schemas[tableName];
        const tableLower = tableName.toLowerCase().replace(/s$/, '');

        // Priority 1: Column named "ID" or "{TableName}ID"
        for (const col of schema.columns) {
            const cl = col.name.toLowerCase();
            if (cl === 'id' || cl === tableLower + 'id' || cl === tableLower + '_id') {
                if (col.uniqueCount === col.totalCount) return col.name;
            }
        }

        // Priority 2: PK pattern with unique values
        for (const col of schema.columns) {
            const cl = col.name.toLowerCase();
            for (const pat of PK_PATTERNS) {
                if (pat.test(cl) && col.uniqueCount === col.totalCount) return col.name;
            }
        }

        // Priority 3: Unique column with ID-like name
        for (const col of schema.columns) {
            if (col.uniqueCount === col.totalCount) {
                const cl = col.name.toLowerCase();
                if (ID_SUFFIXES.some(s => cl.includes(s))) return col.name;
            }
        }

        // Priority 4: Any unique column
        for (const col of schema.columns) {
            if (col.uniqueCount === col.totalCount && col.totalCount > 1) return col.name;
        }

        return null;
    }

    function determineDirection(tableA, colAName, colAInfo, tableB, colBName, colBInfo) {
        const aUnique = colAInfo.uniqueCount === colAInfo.totalCount;
        const bUnique = colBInfo.uniqueCount === colBInfo.totalCount;

        if (aUnique && !bUnique) {
            return {
                fromTable: tableB, fromColumn: colBName,
                toTable: tableA, toColumn: colAName,
                cardinality: 'manyToOne', crossFilteringBehavior: 'oneDirection', confidence: 0.8
            };
        } else if (bUnique && !aUnique) {
            return {
                fromTable: tableA, fromColumn: colAName,
                toTable: tableB, toColumn: colBName,
                cardinality: 'manyToOne', crossFilteringBehavior: 'oneDirection', confidence: 0.8
            };
        } else if (aUnique && bUnique) {
            return {
                fromTable: tableA, fromColumn: colAName,
                toTable: tableB, toColumn: colBName,
                cardinality: 'oneToOne', crossFilteringBehavior: 'bothDirections', confidence: 0.6
            };
        } else {
            return {
                fromTable: tableA, fromColumn: colAName,
                toTable: tableB, toColumn: colBName,
                cardinality: 'manyToMany', crossFilteringBehavior: 'oneDirection', confidence: 0.3
            };
        }
    }

    function validateRelationships(relationships, tables) {
        const validated = [];
        // Cache value sets per table+column to avoid redundant scans
        const valueSetCache = {};

        function getValueSet(tableName, colName) {
            const cacheKey = tableName + '\0' + colName;
            if (cacheKey in valueSetCache) return valueSetCache[cacheKey];
            const table = tables[tableName];
            if (!table) return (valueSetCache[cacheKey] = null);
            if (!table.columns.includes(colName)) return (valueSetCache[cacheKey] = null);
            const vals = new Set();
            for (const r of table.rows) {
                const v = r[colName];
                if (v !== '' && v !== null && v !== undefined) vals.add(String(v));
            }
            return (valueSetCache[cacheKey] = vals);
        }

        for (const rel of relationships) {
            const fromVals = getValueSet(rel.fromTable, rel.fromColumn);
            const toVals = getValueSet(rel.toTable, rel.toColumn);
            if (!fromVals || !toVals || fromVals.size === 0 || toVals.size === 0) continue;

            // Reject relationships where the "to" side (the "one" side) has blank values
            // Power BI does not allow blanks on the one-side of a many-to-one relationship
            if (rel.cardinality === 'manyToOne' || rel.cardinality === 'oneToOne') {
                const toTable = tables[rel.toTable];
                if (toTable && tableHasBlankValue(toTable, rel.toColumn)) continue;
            }

            // Iterate over the smaller set for faster overlap computation
            const [smaller, larger] = fromVals.size <= toVals.size ? [fromVals, toVals] : [toVals, fromVals];
            let overlapCount = 0;
            for (const v of smaller) {
                if (larger.has(v)) overlapCount++;
            }

            const overlapRatio = overlapCount / Math.min(fromVals.size, toVals.size);
            if (overlapRatio >= 0.3) {
                rel.overlapRatio = overlapRatio;
                rel.confidence = Math.min(1.0, rel.confidence + overlapRatio * 0.2);
                validated.push(rel);
            }
        }

        return validated;
    }

    function tableHasBlankValue(table, columnName) {
        return table.rows.some(row => {
            const value = row[columnName];
            return value === '' || value === null || value === undefined;
        });
    }

    function deduplicate(relationships) {
        const seen = {};

        for (const rel of relationships) {
            const pair = [rel.fromTable, rel.toTable].sort().join('|');
            const current = seen[pair];
            const candidateScore = scoreRelationship(rel);
            const currentScore = current ? scoreRelationship(current) : null;

            if (!current || compareScores(candidateScore, currentScore) > 0) {
                seen[pair] = rel;
            }
        }

        const ranked = Object.values(seen).sort((a, b) => compareScores(scoreRelationship(b), scoreRelationship(a)));
        return pruneToForest(ranked);
    }

    function scoreRelationship(rel) {
        return [
            rel.confidence || 0,
            rel.overlapRatio || 0,
            Number(!isPlaceholderColumn(rel.fromColumn)),
            Number(!isPlaceholderColumn(rel.toColumn)),
            rel.fromTable,
            rel.fromColumn,
            rel.toTable,
            rel.toColumn
        ];
    }

    function isPlaceholderColumn(columnName) {
        return /^Column_\d+$/.test(String(columnName));
    }

    function pruneToForest(relationships) {
        const parents = {};
        const ranks = {};
        const selected = [];

        for (const rel of relationships) {
            for (const tableName of [rel.fromTable, rel.toTable]) {
                if (!(tableName in parents)) {
                    parents[tableName] = tableName;
                    ranks[tableName] = 0;
                }
            }

            const fromRoot = findRoot(parents, rel.fromTable);
            const toRoot = findRoot(parents, rel.toTable);
            if (fromRoot === toRoot) continue;

            selected.push(rel);
            union(parents, ranks, fromRoot, toRoot);
        }

        return selected;
    }

    function findRoot(parents, node) {
        if (parents[node] !== node) {
            parents[node] = findRoot(parents, parents[node]);
        }
        return parents[node];
    }

    function union(parents, ranks, left, right) {
        const leftRoot = findRoot(parents, left);
        const rightRoot = findRoot(parents, right);
        if (leftRoot === rightRoot) return;

        if (ranks[leftRoot] < ranks[rightRoot]) {
            parents[leftRoot] = rightRoot;
        } else if (ranks[leftRoot] > ranks[rightRoot]) {
            parents[rightRoot] = leftRoot;
        } else {
            parents[rightRoot] = leftRoot;
            ranks[leftRoot] += 1;
        }
    }

    function compareScores(a, b) {
        if (!b) return 1;
        for (let i = 0; i < a.length; i++) {
            if (a[i] > b[i]) return 1;
            if (a[i] < b[i]) return -1;
        }
        return 0;
    }

    function typesCompatible(typeA, typeB) {
        if (typeA === typeB) return true;
        const numeric = new Set(['int64', 'double', 'decimal']);
        if (numeric.has(typeA) && numeric.has(typeB)) return true;
        if (typeA === 'string' || typeB === 'string') return true;
        return false;
    }

    return { detect };
})();
