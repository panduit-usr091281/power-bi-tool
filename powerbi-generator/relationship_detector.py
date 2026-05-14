"""
relationship_detector.py
=========================
Detects relationships (foreign keys) between tables by analyzing:
1. Column name matching (e.g., Orders.CustomerID -> Customers.CustomerID)
2. ID/Key pattern detection (e.g., Orders.CustomerID -> Customers.ID)
3. Data overlap analysis (ensuring values actually match between tables)
4. Cardinality detection (one-to-many, many-to-one, one-to-one)
"""

import re


class RelationshipDetector:
    """Detects relationships between tables based on column names and data."""

    # Common ID suffixes that suggest foreign key relationships
    ID_SUFFIXES = ['id', 'key', 'code', 'num', 'number', 'no', 'ref']

    # Common primary key patterns
    PK_PATTERNS = [
        r'^id$',
        r'^pk$',
        r'^key$',
        r'_id$',
        r'_key$',
        r'_pk$',
    ]

    def __init__(self, tables, table_schemas):
        """
        Args:
            tables: dict of {table_name: DataFrame}
            table_schemas: dict of {table_name: schema_dict}
        """
        self.tables = tables
        self.schemas = table_schemas
        self.relationships = []

    def detect(self):
        """Run all detection strategies and return deduplicated relationships."""
        self.relationships = []

        self._broadcast_columns = self._build_broadcast_columns()

        # Strategy 1: Exact column name matching across tables
        self._detect_by_name_match()

        # Strategy 2: FK pattern matching (e.g., TableName + ID suffix)
        self._detect_by_fk_pattern()

        # Validate relationships with data overlap
        validated = self._validate_relationships(self.relationships)

        # Deduplicate and rank
        final = self._deduplicate(validated)

        return final

    def _build_broadcast_columns(self):
        """Return repeated measurement columns that should not become relationships."""
        col_table_count = {}
        for schema in self.schemas.values():
            for col in schema['columns']:
                key = col['name'].lower()
                col_table_count[key] = col_table_count.get(key, 0) + 1
        return {key for key, count in col_table_count.items() if count > 3}

    def _detect_by_name_match(self):
        """Find columns with identical names across different tables."""
        table_names = list(self.tables.keys())

        for i, table_a in enumerate(table_names):
            for table_b in table_names[i + 1:]:
                cols_a = {c['name'].lower(): c for c in self.schemas[table_a]['columns']}
                cols_b = {c['name'].lower(): c for c in self.schemas[table_b]['columns']}

                # Find common column names, excluding broadcast columns
                common = (set(cols_a.keys()) & set(cols_b.keys())) - self._broadcast_columns

                for col_name in common:
                    col_a = cols_a[col_name]
                    col_b = cols_b[col_name]

                    # Only consider compatible types
                    if not self._types_compatible(col_a['dataType'], col_b['dataType']):
                        continue

                    # Determine direction based on uniqueness
                    rel = self._determine_direction(
                        table_a, col_a['name'], col_a,
                        table_b, col_b['name'], col_b
                    )
                    if rel:
                        self.relationships.append(rel)

    def _detect_by_fk_pattern(self):
        """Detect FK patterns like Orders.CustomerID -> Customers.ID."""
        table_names = list(self.tables.keys())
        table_name_lower = {t.lower(): t for t in table_names}

        for table_name in table_names:
            for col_info in self.schemas[table_name]['columns']:
                col_name = col_info['name']
                col_lower = col_name.lower()

                # Check if column looks like a foreign key
                for suffix in self.ID_SUFFIXES:
                    pattern = rf'^(.+?)[\s_]?{suffix}$'
                    match = re.match(pattern, col_lower, re.IGNORECASE)
                    if match:
                        referenced_table_hint = match.group(1).lower()

                        # Try to find a matching table
                        for candidate_name_lower, candidate_name in table_name_lower.items():
                            if candidate_name == table_name:
                                continue

                            # Check if the prefix matches the table name
                            # e.g., "customer" matches "Customers" table
                            if (self._fuzzy_table_match(referenced_table_hint, candidate_name_lower)):
                                # Find the PK column in the candidate table
                                pk_col = self._find_pk_column(candidate_name)
                                if pk_col:
                                    rel = {
                                        'fromTable': table_name,
                                        'fromColumn': col_name,
                                        'toTable': candidate_name,
                                        'toColumn': pk_col,
                                        'cardinality': 'manyToOne',
                                        'crossFilteringBehavior': 'oneDirection',
                                        'confidence': 0.7
                                    }
                                    self.relationships.append(rel)
                        break  # Only match first suffix pattern

    def _fuzzy_table_match(self, hint, table_name_lower):
        """Check if a FK prefix fuzzy-matches a table name."""
        # Direct match
        if hint == table_name_lower:
            return True
        # Singular/plural match
        if hint + 's' == table_name_lower or hint + 'es' == table_name_lower:
            return True
        if table_name_lower + 's' == hint or table_name_lower + 'es' == hint:
            return True
        # Remove trailing 's' from table name
        if table_name_lower.rstrip('s') == hint:
            return True
        # Underscore/space variants
        if hint.replace('_', '') == table_name_lower.replace('_', ''):
            return True
        return False

    def _find_pk_column(self, table_name):
        """Find the most likely primary key column in a table."""
        schema = self.schemas[table_name]
        table_lower = table_name.lower().rstrip('s')

        # Priority 1: Column named "ID" or "{TableName}ID"
        for col in schema['columns']:
            col_lower = col['name'].lower()
            if col_lower == 'id' or col_lower == f'{table_lower}id' or col_lower == f'{table_lower}_id':
                if col['uniqueCount'] == col['totalCount']:
                    return col['name']

        # Priority 2: Any column matching PK patterns with unique values
        for col in schema['columns']:
            col_lower = col['name'].lower()
            for pattern in self.PK_PATTERNS:
                if re.search(pattern, col_lower):
                    if col['uniqueCount'] == col['totalCount']:
                        return col['name']

        # Priority 3: First column with all unique values that looks like an ID
        for col in schema['columns']:
            if col['uniqueCount'] == col['totalCount']:
                col_lower = col['name'].lower()
                if any(s in col_lower for s in self.ID_SUFFIXES):
                    return col['name']

        # Priority 4: First column with all unique values
        for col in schema['columns']:
            if col['uniqueCount'] == col['totalCount'] and col['totalCount'] > 1:
                return col['name']

        return None

    def _determine_direction(self, table_a, col_a_name, col_a_info,
                             table_b, col_b_name, col_b_info):
        """Determine the relationship direction based on uniqueness."""
        a_unique = col_a_info['uniqueCount'] == col_a_info['totalCount']
        b_unique = col_b_info['uniqueCount'] == col_b_info['totalCount']

        if a_unique and not b_unique:
            # A is the "one" side, B is the "many" side
            return {
                'fromTable': table_b,
                'fromColumn': col_b_name,
                'toTable': table_a,
                'toColumn': col_a_name,
                'cardinality': 'manyToOne',
                'crossFilteringBehavior': 'oneDirection',
                'confidence': 0.8
            }
        elif b_unique and not a_unique:
            # B is the "one" side, A is the "many" side
            return {
                'fromTable': table_a,
                'fromColumn': col_a_name,
                'toTable': table_b,
                'toColumn': col_b_name,
                'cardinality': 'manyToOne',
                'crossFilteringBehavior': 'oneDirection',
                'confidence': 0.8
            }
        elif a_unique and b_unique:
            # One-to-one relationship
            return {
                'fromTable': table_a,
                'fromColumn': col_a_name,
                'toTable': table_b,
                'toColumn': col_b_name,
                'cardinality': 'oneToOne',
                'crossFilteringBehavior': 'bothDirections',
                'confidence': 0.6
            }
        else:
            # Many-to-many — less common, lower confidence
            return {
                'fromTable': table_a,
                'fromColumn': col_a_name,
                'toTable': table_b,
                'toColumn': col_b_name,
                'cardinality': 'manyToMany',
                'crossFilteringBehavior': 'oneDirection',
                'confidence': 0.3
            }

    def _validate_relationships(self, relationships):
        """Validate relationships by checking actual data overlap."""
        validated = []
        # Cache value sets per table+column to avoid redundant scans
        value_set_cache = {}

        def get_value_set(table_name, col_name):
            cache_key = (table_name, col_name)
            if cache_key in value_set_cache:
                return value_set_cache[cache_key]
            if table_name not in self.tables or col_name not in self.tables[table_name].columns:
                value_set_cache[cache_key] = None
                return None
            values = set(self.tables[table_name][col_name].dropna().astype(str))
            value_set_cache[cache_key] = values
            return values

        for rel in relationships:
            from_values = get_value_set(rel['fromTable'], rel['fromColumn'])
            to_values = get_value_set(rel['toTable'], rel['toColumn'])

            if not from_values or not to_values:
                continue

            # Reject relationships where the "to" side (the "one" side) has blank values
            # Power BI does not allow blanks on the one-side of a many-to-one relationship
            if rel.get('cardinality') in ('manyToOne', 'oneToOne'):
                if self._column_has_blank_values(rel['toTable'], rel['toColumn']):
                    continue

            # Iterate over the smaller set for faster overlap computation
            smaller, larger = (from_values, to_values) if len(from_values) <= len(to_values) else (to_values, from_values)
            overlap_count = sum(1 for v in smaller if v in larger)
            overlap_ratio = overlap_count / min(len(from_values), len(to_values))

            if overlap_ratio >= 0.3:
                rel['overlapRatio'] = overlap_ratio
                rel['confidence'] = min(1.0, rel['confidence'] + overlap_ratio * 0.2)
                validated.append(rel)

        return validated

    def _column_has_blank_values(self, table_name, column_name):
        table = self.tables.get(table_name)
        if table is None or column_name not in table.columns:
            return False

        series = table[column_name]
        return bool(series.isna().any() or (series.astype(str).str.strip() == '').any())

    def _deduplicate(self, relationships):
        """Keep the best relationships without creating ambiguous multi-path graphs."""
        seen = {}

        for rel in relationships:
            key = tuple(sorted([rel['fromTable'], rel['toTable']]))
            current = seen.get(key)
            candidate_score = self._score_relationship(rel)
            current_score = self._score_relationship(current) if current else None

            if current is None or candidate_score > current_score:
                seen[key] = rel

        ranked = sorted(seen.values(), key=self._score_relationship, reverse=True)
        return self._prune_to_forest(ranked)

    def _score_relationship(self, rel):
        return (
            rel.get('confidence', 0),
            rel.get('overlapRatio', 0),
            int(not self._is_placeholder_column(rel['fromColumn'])),
            int(not self._is_placeholder_column(rel['toColumn'])),
            rel['fromTable'],
            rel['fromColumn'],
            rel['toTable'],
            rel['toColumn'],
        )

    def _is_placeholder_column(self, column_name):
        return bool(re.match(r'^Column_\d+$', str(column_name)))

    def _prune_to_forest(self, relationships):
        parents = {table_name: table_name for table_name in self.tables.keys()}
        ranks = {table_name: 0 for table_name in self.tables.keys()}
        selected = []

        for rel in relationships:
            from_root = self._find_root(parents, rel['fromTable'])
            to_root = self._find_root(parents, rel['toTable'])
            if from_root == to_root:
                continue

            selected.append(rel)
            self._union(parents, ranks, from_root, to_root)

        return selected

    def _find_root(self, parents, node):
        if parents[node] != node:
            parents[node] = self._find_root(parents, parents[node])
        return parents[node]

    def _union(self, parents, ranks, left, right):
        left_root = self._find_root(parents, left)
        right_root = self._find_root(parents, right)
        if left_root == right_root:
            return

        if ranks[left_root] < ranks[right_root]:
            parents[left_root] = right_root
        elif ranks[left_root] > ranks[right_root]:
            parents[right_root] = left_root
        else:
            parents[right_root] = left_root
            ranks[left_root] += 1

    def _types_compatible(self, type_a, type_b):
        """Check if two Power BI types are compatible for relationships."""
        if type_a == type_b:
            return True

        # Numeric types are compatible with each other
        numeric = {'int64', 'double', 'decimal'}
        if type_a in numeric and type_b in numeric:
            return True

        # String can match with anything (loose matching)
        if type_a == 'string' or type_b == 'string':
            return True

        return False
