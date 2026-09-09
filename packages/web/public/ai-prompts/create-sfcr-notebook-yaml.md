# SFCR notebook YAML generation prompt

You are generating a single valid SFCR notebook YAML document for the sfcr browser app.

Before generating the notebook:

1. Read `../notebook-guide.md` for the notebook structure, cell types, naming conventions, and matrix rules.
2. Read `../sfcr-notebook.schema.json` for the machine-readable expanded JSON runtime constraints.
3. Start from `../notebook-examples/starter.example.notebook.yaml` for the minimum valid notebook shape.
4. Use `../notebook-examples/bmw.example.notebook.yaml` as the default reference for sectors and accounting bands.
5. Use `../notebook-examples/gl6-dis-rentier-v2.example.notebook.yaml` when the model splits households or needs distributional accounting.

Requirements:

- Return only one YAML document.
- Set `format` to `sfcr-notebook-yaml` and `formatVersion` to `1`.
- Set `metadata.version` to `1`.
- Include unique `id`, `title`, and an ordered `cells:` list.
- Use wrapped compact cell entries, where each item has exactly one cell-type key such as `markdown`, `matrix`, `equations`, `solver`, `externals`, `initial-values`, `run`, `chart`, `table`, `sequence`, `sankey`, or `diagram`.
- Do not use the older top-level shorthand sections such as `introCell`, `variables`, `equations`, `parameters`, `baselineRun`, `charts`, `tables`, or `cellOrder` for newly generated YAML.
- Keep cell ids stable and descriptive in kebab-case.
- Use compact array rows for matrices, equations, externals, and initial values when possible.
- Always quote equation and external descriptions inside compact row arrays.
- If you create matrix cells, include both `columns` and `sectors`, and make each row match the column count exactly.
- Include at least one baseline run for executable models.
- Prefer concise markdown explanations before scenarios.
- If the model has stocks with lagged terms (`varName'`, `lag(...)`, or `[-1]`), provide matching initial values unless the default initialization is clearly acceptable.

Recommended notebook order:

1. Overview / intro markdown cell
2. Balance sheet matrix if applicable
3. Transactions-flow matrix if applicable
4. Sequence cells derived from matrices or dependencies if useful
5. Equations
6. Solver
7. Externals
8. Initial values
9. Baseline run
10. Chart or table
11. Scenario markdown + scenario run + scenario chart/table

Compact row reminders:

- Matrix row: `[band, label, ...values]`
- Equation row: `[name, expression, "description", unit, type, role]`
- External row: `[name, value, "description", unit, type]`
- Initial value row: `[name, value]`
- Section comment row: `- "Section title"` (must be quoted; optional inline markdown `**bold**`, `` `code` ``; also works in externals and initial-values lists)
- Use object rows for non-constant external series that need `kind: series` and `valueText`.

Output rules:

- Return raw YAML only.
- Do not wrap the YAML in markdown fences.
- Do not add commentary before or after the YAML.
- Do not use YAML anchors, aliases, merge keys, or duplicate keys.
- Prefer patterns already used in the starter, BMW, and GL6 DIS rentier YAML examples.
