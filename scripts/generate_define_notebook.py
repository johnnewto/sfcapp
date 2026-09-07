#!/usr/bin/env python3
"""Generate packages/web/src/notebook/templates/define.notebook.yaml from DEFINE 1.1 R.

Requires scripts/generated/define_1_1_r_dump.json (from generate_define_r_fixture.R).
Run from the repository root:

    python3 scripts/generate_define_notebook.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from define_table5_descriptions import format_equation_desc

ROOT = Path(__file__).resolve().parents[1]
R_PATH = ROOT / "references/define-1.1/R DEFINE 1.1-Aug2022 CODE.R"
DUMP_PATH = ROOT / "scripts/generated/define_1_1_r_dump.json"
YAML_PATH = ROOT / "packages/web/src/notebook/templates/define.notebook.yaml"

FUNCTIONS = {"min", "max", "exp", "log", "abs", "sqrt", "floor", "pow", "lag", "if"}
SKIP_LHS = {
    "random1",
    "random2",
    "tau_C_baseline",
    "tau_C_policy_Medium",
    "tau_C_policy_High",
    "EMIS_F_Y_SSP360",
    "tau_C_baseline_per",
    "tau_C_policy_Medium_per",
    "tau_C_policy_High_per",
}
SERIES_EXTERNALS = {
    "tau_C_baseline",
    "tau_C_policy_Medium",
    "tau_C_policy_High",
    "EMIS_F_Y_SSP360",
    "tau_C_baseline_per",
    "tau_C_policy_Medium_per",
    "tau_C_policy_High_per",
}
PERIOD1_ALIASES = {
    "omega": "omega_init",
    "mu": "mu_init",
    "rho": "rho_init",
    "epsilon": "epsilon_init",
    "POP": "POP_init",
    "E": "E_init",
    "EMIS_F": "EMIS_F_init",
    "ucr": "ucr_init",
    "delta": "delta_init",
}
FROZEN_INDEX = {
    ("con_change", 80): "con_change_end",
    ("tau_C", 4): "tau_C_4",
    ("EMIS_F", 3): "EMIS_F_3",
    ("gov_SUB", 3): "gov_SUB_3",
}

IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
# R uses _D / _DN for desired quantities; notebook names use ^D / ^DN so the D
# renders as a superscript (IC_PRI_D_S1 -> IC_PRI^D_S1). Do not touch BP_D,
# PORT_D, int_D, D_T, etc.
_DESIRED_R_NAME = re.compile(r"^(I_PRI|IC_PRI|IG_PRI|NLG|NLC)_(D(?:N)?)(?:_S([1-4]))?$")
_DESIRED_NB_NAME = re.compile(r"^(I_PRI|IC_PRI|IG_PRI|NLG|NLC)\^(D(?:N)?)(?:_S([1-4]))?$")


def to_notebook_name(name: str) -> str:
    match = _DESIRED_R_NAME.match(name)
    if not match:
        return name
    root, desired, sector = match.group(1), match.group(2), match.group(3)
    renamed = f"{root}^{desired}"
    return f"{renamed}_S{sector}" if sector else renamed


def to_r_name(name: str) -> str:
    match = _DESIRED_NB_NAME.match(name)
    if not match:
        return name
    root, desired, sector = match.group(1), match.group(2), match.group(3)
    renamed = f"{root}_{desired}"
    return f"{renamed}_S{sector}" if sector else renamed


def rename_idents_in_expr(expr: str) -> str:
    return IDENT.sub(lambda match: to_notebook_name(match.group(0)), expr)


def extract_dynamic_block(text: str) -> str:
    start = text.index("#3. MODEL EQUATIONS")
    body = text[start:]
    # First assignment in the else-branch after rnorm.
    marker = "MY[i]<- mu[i]*(Y[i]-CO_GOV[i]) #Eq. (1)"
    eq_at = body.index(marker)
    end_at = body.index("#####################################\n    #4. FILLING IN THE MONTE-CARLO", eq_at)
    return body[eq_at:end_at]


def split_statements(block: str) -> list[tuple[str, str]]:
    """Return (kind, text) where kind is 'comment' or 'stmt'."""
    items: list[tuple[str, str]] = []
    buf: list[str] = []

    def flush() -> None:
        raw = " ".join(line.strip() for line in buf if line.strip())
        buf.clear()
        if raw:
            items.append(("stmt", raw))

    for line in block.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            flush()
            comment = stripped.lstrip("#").strip()
            if comment:
                items.append(("comment", comment))
            continue
        buf.append(stripped)
        joined = " ".join(buf)
        if joined.count("{") == joined.count("}") and joined.count("(") >= joined.count(")"):
            # Keep reading if this is a bare if without assignment yet and next lines continue.
            if joined.startswith("if ") and "<-" not in joined and joined.count("{") == 0:
                continue
            flush()
    flush()
    return items


def translate_expr(expr: str) -> str:
    expr = expr.strip()
    expr = re.sub(r"iterations\s*>\s*10\s*(&&|&)\s*", "", expr)
    expr = expr.replace("&&", " andand ")
    expr = re.sub(r"(?<!&)&(?!&)", "&&", expr)
    expr = expr.replace(" andand ", "&&")

    for (name, index), alias in FROZEN_INDEX.items():
        expr = expr.replace(f"{name}[{index}]", alias)

    def period1(match: re.Match[str]) -> str:
        name = match.group(1)
        return PERIOD1_ALIASES.get(name, f"{name}_init")

    expr = re.sub(r"([A-Za-z_][A-Za-z0-9_]*)\[1\]", period1, expr)
    expr = re.sub(r"([A-Za-z_][A-Za-z0-9_]*)\[i-1\]", r"lag(\1)", expr)
    expr = re.sub(r"\bi\s*<\s*4\b", "t < 4", expr)
    expr = re.sub(r"\bi\s*>=\s*4\b", "t >= 4", expr)
    expr = re.sub(r"\bi\s*==\s*6\b", "t == 6", expr)
    expr = re.sub(r"([A-Za-z_][A-Za-z0-9_]*)\[i\]", r"\1", expr)
    expr = convert_powers(expr)
    expr = re.sub(r"\bif\s*\(", "if(", expr)
    expr = re.sub(r"\s+", " ", expr).strip()
    return expr


def convert_powers(expr: str) -> str:
    while "^" in expr:
        idx = expr.index("^")
        left, l0 = take_left_operand(expr, idx)
        right, r1 = take_right_operand(expr, idx + 1)
        expr = expr[:l0] + f"pow({left}, {right})" + expr[r1:]
    return expr


def take_left_operand(expr: str, caret: int) -> tuple[str, int]:
    i = caret - 1
    while i >= 0 and expr[i].isspace():
        i -= 1
    if i < 0:
        raise ValueError(f"missing left operand in {expr!r}")
    if expr[i] == ")":
        depth = 0
        j = i
        while j >= 0:
            if expr[j] == ")":
                depth += 1
            elif expr[j] == "(":
                depth -= 1
                if depth == 0:
                    break
            j -= 1
        start = j
        k = j - 1
        while k >= 0 and (expr[k].isalnum() or expr[k] == "_"):
            k -= 1
        if k + 1 < start and expr[k + 1].isalpha():
            start = k + 1
        return expr[start:i + 1].strip(), start
    end = i + 1
    while i >= 0 and (expr[i].isalnum() or expr[i] in "._"):
        i -= 1
    return expr[i + 1:end].strip(), i + 1


def take_right_operand(expr: str, start: int) -> tuple[str, int]:
    i = start
    while i < len(expr) and expr[i].isspace():
        i += 1
    if i >= len(expr):
        raise ValueError(f"missing right operand in {expr!r}")
    if expr[i] == "(":
        depth = 0
        j = i
        while j < len(expr):
            if expr[j] == "(":
                depth += 1
            elif expr[j] == ")":
                depth -= 1
                if depth == 0:
                    return expr[i:j + 1].strip(), j + 1
            j += 1
        raise ValueError(f"unbalanced paren in {expr!r}")
    if expr[i] in "+-" and i + 1 < len(expr) and (expr[i + 1].isdigit() or expr[i + 1] == "(" or expr[i + 1].isalpha()):
        sign = expr[i]
        inner, end = take_right_operand(expr, i + 1)
        return f"{sign}{inner}", end
    j = i
    if expr[j].isalpha() or expr[j] == "_":
        while j < len(expr) and (expr[j].isalnum() or expr[j] == "_"):
            j += 1
        if j < len(expr) and expr[j] == "(":
            depth = 0
            while j < len(expr):
                if expr[j] == "(":
                    depth += 1
                elif expr[j] == ")":
                    depth -= 1
                    if depth == 0:
                        j += 1
                        break
                j += 1
        return expr[i:j].strip(), j
    while j < len(expr) and (expr[j].isdigit() or expr[j] == "."):
        j += 1
    return expr[i:j].strip(), j


def parse_assignment(stmt: str) -> tuple[str, str, str] | None:
    """Return (name, expression, eq_comment) or None to skip."""
    eq_comment = ""
    if "#" in stmt:
        code, comment = stmt.split("#", 1)
        eq_match = re.search(r"Eq\.\s*\(?([^)]+)\)?", comment)
        if eq_match:
            eq_comment = eq_match.group(1).strip(" ()")
        stmt = code.strip()

    stmt = re.sub(r"\s+", " ", stmt).strip()
    if not stmt:
        return None

    # Pattern: NAME[i]<-if (cond) { NAME[i]<-A } else { NAME[i]<-B }
    m = re.match(
        r"^([A-Za-z_][A-Za-z0-9_]*)\[i\]\s*<-\s*if\s*\((.+)\)\s*\{\s*\1\[i\]\s*<-\s*(.+?)\s*\}\s*else\s*\{\s*\1\[i\]\s*<-\s*(.+?)\s*\}$",
        stmt,
    )
    if m:
        name, cond, true, false = m.group(1), m.group(2), m.group(3), m.group(4)
        expr = f"if({translate_expr(cond)}) {{ {translate_expr(true)} }} else {{ {translate_expr(false)} }}"
        return name, expr, eq_comment

    # Pattern: if (cond) { NAME[i]<-A } else { NAME[i]<-B }
    m = re.match(
        r"^if\s*\((.+)\)\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)\[i\]\s*<-\s*(.+?)\s*\}\s*else\s*\{\s*\2\[i\]\s*<-\s*(.+?)\s*\}$",
        stmt,
    )
    if m:
        cond, name, true, false = m.group(1), m.group(2), m.group(3), m.group(4)
        expr = f"if({translate_expr(cond)}) {{ {translate_expr(true)} }} else {{ {translate_expr(false)} }}"
        return name, expr, eq_comment

    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\[i\]\s*<-\s*(.+)$", stmt)
    if not m:
        return None
    name, rhs = m.group(1), m.group(2).strip()
    if name in SKIP_LHS:
        return None
    return name, translate_expr(rhs), eq_comment


def collect_idents(expr: str) -> set[str]:
    names = set()
    i = 0
    while i < len(expr):
        if expr[i].isalpha() or expr[i] == "_":
            j = i + 1
            while j < len(expr) and (expr[j].isalnum() or expr[j] in "_.^{}"):
                j += 1
            token = expr[i:j]
            if token not in FUNCTIONS and token not in {"else"}:
                names.add(token)
            i = j
        else:
            i += 1
    return names


def yaml_quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def fmt_num(value: float) -> str:
    if abs(value) >= 1e-4 or value == 0:
        text = f"{value:.12g}"
    else:
        text = f"{value:.12g}"
    if text.endswith("."):
        text += "0"
    return text


def series_text(values: list[float]) -> str:
    return ", ".join(fmt_num(float(v)) for v in values)


def build_equations(items: list[tuple[str, str]]) -> tuple[list[str], dict[str, str], set[str]]:
    rows: list[str] = []
    equations: dict[str, str] = {}
    comments_before: dict[str, str] = {}
    pending_comment = ""
    used_idents: set[str] = set()

    rows.append('        - "Time index"')
    rows.append(
        '        - [t, "lag(t) + 1", "calendar index; period 1 is 2021", year, aux, identity]'
    )
    equations["t"] = "lag(t) + 1"

    for kind, text in items:
        if kind == "comment":
            pending_comment = text
            continue
        parsed = parse_assignment(text)
        if parsed is None:
            pending_comment = ""
            continue
        name, expr, eq_comment = parsed
        name = to_notebook_name(name)
        expr = rename_idents_in_expr(expr)
        if name in equations:
            # R overwrites; keep the last assignment.
            equations[name] = expr
            # Replace previous row for this name.
            rows[:] = [row for row in rows if not row.startswith(f"        - [{name},")]
        else:
            equations[name] = expr
        if pending_comment:
            comments_before[name] = pending_comment
            rows.append(f'        - {yaml_quote(pending_comment)}')
            pending_comment = ""
        desc = format_equation_desc(name, eq_comment)
        rows.append(
            f"        - [{name}, {yaml_quote(expr)}, {yaml_quote(desc)}, \"\", aux, identity]"
        )
        used_idents |= collect_idents(expr)
        used_idents.add(name)

    used_idents.add("t")
    return rows, equations, used_idents


def load_dump() -> dict:
    if not DUMP_PATH.exists():
        raise SystemExit(f"Missing {DUMP_PATH}; run Rscript scripts/generate_define_r_fixture.R first")
    return json.loads(DUMP_PATH.read_text())


def pick_value(name: str, dump: dict) -> float | None:
    lookup = to_r_name(name)
    if lookup in dump["scalars"] and dump["scalars"][lookup] is not None:
        return float(dump["scalars"][lookup])
    if lookup in dump["period1"] and dump["period1"][lookup] is not None:
        return float(dump["period1"][lookup])
    return None


def main() -> None:
    dump = load_dump()
    block = extract_dynamic_block(R_PATH.read_text(encoding="utf-8", errors="replace"))
    items = split_statements(block)
    eq_rows, equations, used = build_equations(items)

    extra_externals = {
        "omega_init": dump["period1"]["omega"],
        "mu_init": dump["period1"]["mu"],
        "rho_init": dump["period1"]["rho"],
        "epsilon_init": dump["period1"]["epsilon"],
        "POP_init": dump["period1"]["POP"],
        "E_init": dump["period1"]["E"],
        "EMIS_F_init": dump["period1"]["EMIS_F"],
        "ucr_init": dump["period1"]["ucr"],
        "delta_init": dump["period1"]["delta"],
        "con_change_end": dump["period1"].get("con_change", 0) and 0.15 or 0.15,
        "tau_C_4": dump["checkpoints"]["5"].get("tau_C", dump["period1"]["tau_C"]),
        "EMIS_F_3": dump["period1"]["EMIS_F"],
        "gov_SUB_3": dump["period1"]["gov_SUB"],
        "random1": 0.0,
        "random2": 0.0,
        "random_dummy": dump["scalars"].get("random_dummy", 0),
        "damage_dummy": dump["scalars"].get("damage_dummy", 1),
        "stop_recycling_dummy": dump["scalars"].get("stop_recycling_dummy", 0),
        "subsidy_increase_dummy": dump["scalars"].get("subsidy_increase_dummy", 0),
        "subsidy_ratio": dump["scalars"].get("subsidy_ratio", 1),
        "tau_C_dummy_H": dump["scalars"].get("tau_C_dummy_H", 0),
        "tau_C_dummy_M": dump["scalars"].get("tau_C_dummy_M", 0),
        "dummy_con_change": dump["scalars"].get("dummy_con_change", 0),
        "beta_dummy_0": dump["scalars"].get("beta_dummy_0", 0),
        "beta_is_endogenous_different": dump["scalars"].get("beta_is_endogenous_different", 1),
        "lambda_is_optimal": dump["scalars"].get("lambda_is_optimal", 0),
        "cr_rationing_dummy": dump["scalars"].get("cr_rationing_dummy", 1),
        "ucr_dummy": dump["scalars"].get("ucr_dummy", 1),
        "stag_adjust": dump["scalars"].get("stag_adjust", 0.2),
        "w_G_initial": dump["scalars"].get("w_G_initial", 1),
        "w_C_S1_initial": dump["scalars"].get("w_C_S1_initial", 1),
        "w_C_S2_initial": dump["scalars"].get("w_C_S2_initial", 1),
        "w_C_S3_initial": dump["scalars"].get("w_C_S3_initial", 1),
        "w_C_S4_initial": dump["scalars"].get("w_C_S4_initial", 1),
        "w_G_2022": dump["scalars"].get("w_G_2022", 1),
        "w_C_S1_2022": dump["scalars"].get("w_C_S1_2022", 1),
        "w_C_S2_2022": dump["scalars"].get("w_C_S2_2022", 1),
        "w_C_S3_2022": dump["scalars"].get("w_C_S3_2022", 1),
        "w_C_S4_2022": dump["scalars"].get("w_C_S4_2022", 1),
    }
    # Prefer actual period-3/4 values when present as vectors in the dump's period1 only.
    extra_externals["con_change_end"] = 0.15
    extra_externals["tau_C_4"] = float(dump["series"]["tau_C_baseline"][3])
    extra_externals["EMIS_F_3"] = float(dump["period1"]["EMIS_F"])

    missing: list[str] = []
    external_names = sorted((used - set(equations) - FUNCTIONS) | set(extra_externals) | set(SERIES_EXTERNALS))
    # t is endogenous
    external_names = [n for n in external_names if n not in equations]

    ext_rows: list[str] = []
    for name in external_names:
        if name in SERIES_EXTERNALS:
            values = dump["series"][name]
            ext_rows.append(
                f"        - {{name: {name}, kind: series, desc: {yaml_quote(name)}, valueText: {yaml_quote(series_text(values))}}}"
            )
            continue
        value = extra_externals.get(name)
        if value is None:
            value = pick_value(name, dump)
        if value is None:
            missing.append(name)
            continue
        ext_rows.append(
            f"        - [{name}, {fmt_num(float(value))}, {yaml_quote(name)}, \"\", aux]"
        )

    init_names = sorted(set(equations) | {"t"})
    init_rows: list[str] = []
    for name in init_names:
        if name == "t":
            init_rows.append("        - [t, 1, Calendar year index for 2021.]")
            continue
        if name == "SEC_CBred":
            value = pick_value("SEC_CB", dump)
        else:
            value = pick_value(name, dump)
        if value is None:
            missing.append(f"init:{name}")
            continue
        init_rows.append(f"        - [{name}, {fmt_num(value)}, {yaml_quote('2021 ' + name)}]")

    gov_ig = float(dump["scalars"]["gov_IG"])

    def dpf_weight(dd: float) -> float:
        return 1.0 + min(float(dd), 1.0) * 0.25

    policy = {
        "gov_ig_green": 4 * gov_ig,
        "s_g_qe": 0.4,
        "w_g_gsf": 0.75,
        "phi_sufficiency": 0.25,
        "w_c_s1_dpf": dpf_weight(float(dump["scalars"]["dd_S1"])),
        "w_c_s2_dpf": dpf_weight(float(dump["scalars"]["dd_S2"])),
        "w_c_s3_dpf": dpf_weight(float(dump["scalars"]["dd_S3"])),
        "w_c_s4_dpf": dpf_weight(float(dump["scalars"]["dd_S4"])),
    }

    yaml_text = render_yaml(eq_rows, ext_rows, init_rows, policy)
    YAML_PATH.write_text(yaml_text, encoding="utf-8")
    print(f"Wrote {YAML_PATH}")
    print(f"equations={len(equations)} externals={len(ext_rows)} initials={len(init_rows)}")
    if missing:
        print("MISSING values:")
        for name in missing:
            print(" ", name)


def shock_variables_yaml(shocks: dict[str, float]) -> str:
    lines: list[str] = []
    for name, value in shocks.items():
        lines.append(f"              {name}:")
        lines.append("                kind: constant")
        lines.append(f"                value: {fmt_num(float(value))}")
    return "\n".join(lines)


def paper_scenario_yaml(
    *,
    n: int,
    title: str,
    source: str,
    more: str,
    shocks: dict[str, float],
    chart_title: str,
    chart_vars: list[str],
    chart_more: str,
    result_key: str,
) -> str:
    indent_more = "\n".join(("        " + line) if line else "        " for line in more.splitlines())
    indent_chart = "\n".join(("        " + line) if line else "        " for line in chart_more.splitlines())
    chart_var_yaml = "\n".join(f"        - {name}" for name in chart_vars)
    run_title = title[0].lower() + title[1:]
    return f"""  - markdown:
      id: scenario-{n}-note
      title: {title}
      source: {source}
      more: |
{indent_more}
  - run:
      id: scenario-{n}-run
      title: "Scenario {n}: {run_title}"
      mode: scenario
      scenario:
        shocks:
          - rangeInclusive:
              - 4
              - 80
            variables:
{shock_variables_yaml(shocks)}
            startPeriodInclusive: 4
            endPeriodInclusive: 80
      baselineRunCellId: baseline-run
      baselineStartPeriod: 1
      periods: 80
      resultKey: {result_key}
      sourceModelId: define
  - chart:
      id: scenario-{n}-chart
      title: {chart_title}
      variables:
{chart_var_yaml}
      axisMode: separate
      sourceRunCellId: scenario-{n}-run
      more: |
{indent_chart}
"""


def render_yaml(
    eq_rows: list[str],
    ext_rows: list[str],
    init_rows: list[str],
    policy: dict[str, float],
) -> str:
    eq_block = "\n".join(eq_rows)
    ext_block = "\n".join(ext_rows)
    init_block = "\n".join(init_rows)
    body = f"""format: sfcr-notebook-yaml
formatVersion: 1
id: define-notebook
title: DEFINE 1.1
metadata:
  version: 1
  template: define
  timeAxis:
    startYear: 2021
cells:
  - markdown:
      id: intro
      title: Overview
      source: This notebook ports DEFINE 1.1 (August 2022), the global ecological stock-flow consistent model of Dafermos and Nikolaidi. Period 1 is calendar year 2021; the baseline runs through 2100.
      more: |
        **DEFINE** (Dynamic Ecosystem-FINance-Economy) joins Godley-Lavoie stock-flow
        accounting with Georgescu-Roegen's flow-fund treatment of matter and energy.
        Version 1.1 adds dirty-sector loan weights, carbon taxes and green subsidies,
        green public investment, endogenous loan spreads, and a TCRE climate module
        in which warming is proportional to cumulative CO2.

        The executable equations come from
        `references/define-1.1/R DEFINE 1.1-Aug2022 CODE.R`
        ([DEFINE-model/VERSION_1.1_AUG2022](https://github.com/DEFINE-model/VERSION_1.1_AUG2022)),
        which produces the simulations in Dafermos Y. and Nikolaidi M. (2022),
        _Assessing climate policies: an ecological stock-flow consistent perspective_,
        European Journal of Economics and Economic Policies. The technical manual is
        [define-1.1-manual-aug-22.pdf](https://define-model.org/wp-content/uploads/2022/10/define-1.1-manual-aug-22.pdf).

        Period 1 is the 2021 data-consistent snapshot from R, not a Gauss-Seidel
        solve of the behavioural equations. From period 2 the notebook uses the same
        identities as the `else` branch of the R time loop. The redundant check is
        `SEC_CB = SEC_CBred` (manual Eq. 187 vs 188-red).

        The baseline follows an SSP3-6.0-like carbon-tax path with recycled revenues
        paid as green subsidies. Output growth slows as climate damages and resource
        constraints bind; temperature reaches about 3.2C in 2100 in the R calibration.

        Scenarios 1-9 are the deterministic policy experiments behind paper Figures
        1-3. Appendix B Monte Carlo paths (R scenarios 2-3) are omitted; set
        `random_dummy` and `damage_dummy` in the externals cell to explore those.
  - matrix:
      id: balance-sheet
      sourceRunCellId: baseline-run
      title: DEFINE 1.1 balance sheet
      description: Balance-sheet matrix for households, firms, banks, government and central banks.
      note: Validated against the DEFINE 1.1 R baseline (SEC_CB = SEC_CBred).
      columns: [Households, Firms, Banks, Government, Central banks, Sum]
      sectors: [Households, Firms, Banks, Government, Central banks, ""]
      accountingKind: balance-sheet
      rows:
        - [Capital, Conventional capital, "", +KC_PRI, "", +KC_GOV, "", +KC]
        - [Capital, Green capital, "", +KG_PRI, "", +KG_GOV, "", +KG]
        - [Capital, Durable consumption, +DC, "", "", "", "", +DC]
        - [Deposits, Deposits, +D, "", -D, "", "", "0"]
        - [Loans, Conventional loans, "", -LC, +LC, "", "", "0"]
        - [Loans, Green loans, "", -LG, +LG, "", "", "0"]
        - [Bonds, Conventional bonds, "+p_C_bar * b_CH", "-p_C_bar * b_C", "", "", "+p_C_bar * b_CCB", "0"]
        - [Bonds, Green bonds, "+p_G_bar * b_GH", "-p_G_bar * b_G", "", "", "+p_G_bar * b_GCB", "0"]
        - [Securities, Government securities, +SEC_H, "", +SEC_B, -SEC, +SEC_CB, "0"]
        - [HPM, High-powered money, "", "", +HPM, "", -HPM, "0"]
        - [Advances, Central-bank advances, "", "", -A, "", +A, "0"]
        - [Wealth, Net worth, -V_H, "-(K_PRI - L - p_C_bar * b_C - p_G_bar * b_G)", -CAP, "-(KC_GOV + KG_GOV - SEC)", -V_CB, "-(K + DC)"]
        - [Sum, Sum, "0", "0", "0", "0", "0", "0"]
      more: |
        Households hold deposits `D`, conventional and green bonds, government
        securities and durable consumption `DC`. Firms own private capital and issue
        loans and bonds. Banks hold loans, government securities and high-powered
        money against deposits, advances and own funds `CAP`. The government issues
        securities `SEC` and accumulates public capital. Central banks hold bonds,
        securities and advances, and issue high-powered money.

        Reading assets as positive and liabilities as negative, every financial row
        sums across sectors to zero. The capital and durables rows are the real
        assets that net worth has to match. The hidden equation
        `SEC_CB = SEC_CBred` is the redundant central-bank residual.
  - matrix:
      id: transaction-flow
      sourceRunCellId: baseline-run
      title: DEFINE 1.1 transactions-flow matrix
      description: Transactions-flow matrix with a split current/capital account for firms.
      note: Validated against the DEFINE 1.1 identities.
      columns: [Households, Firms curr., Firms cap., Banks, Government, Central banks, Sum]
      sectors: [Households, Firms, Firms, Banks, Government, Central banks, ""]
      accountingKind: transaction-flow
      rows:
        - [Consumption, Private consumption, -CO_PRI, +CO_PRI, "", "", "", "", "0"]
        - [Consumption, Government consumption, "", +CO_GOV, "", "", -CO_GOV, "", "0"]
        - [Investment, Private investment, "", +I_PRI, -I_PRI, "", "", "", "0"]
        - [Investment, Government investment, "", +I_GOV, "", "", -I_GOV, "", "0"]
        - [Wages, Wages, "+wage * N", "-wage * N", "", "", "", "", "0"]
        - [Profits, Distributed firm profits, +DP, -DP, "", "", "", "", "0"]
        - [Profits, Retained firm profits, "", -RP, +RP, "", "", "", "0"]
        - [Profits, Distributed bank profits, +BP_D, "", "", -BP_D, "", "", "0"]
        - [Profits, Undistributed bank profits, "", "", "", -BP_U, "", "", "0"]
        - [Interest, Deposit interest, "+int_D * lag(D)", "", "", "-int_D * lag(D)", "", "", "0"]
        - [Interest, Loan and coupon interest, "+coupon_C * lag(b_CH) + coupon_G * lag(b_GH) + int_S * lag(SEC_H)", "-Interest - coupon_C * lag(b_C) - coupon_G * lag(b_G)", "", "+int_G * lag(LG) + int_C_S1 * lag(LC_S1) + int_C_S2 * lag(LC_S2) + int_C_S3 * lag(LC_S3) + int_C_S4 * lag(LC_S4) + int_S * lag(SEC_B) - int_A * lag(A)", "-int_S * lag(SEC)", +CBP, "0"]
        - [Taxes, Taxes, -TAX_H, "-TAX_F - TAX_C", "", "", +TAX, "", "0"]
        - [Transfers, Green subsidies, "", +SUB, "", "", -SUB, "", "0"]
        - [Transfers, Bank bailouts, "", "", "", +BAILOUT, -BAILOUT, "", "0"]
        - [CB, Central-bank profits, "", "", "", "", +CBP, -CBP, "0"]
        - [Deposits, Change in deposits, "-d(D)", "", "", "+d(D)", "", "", "0"]
        - [Loans, Change in loans, "", "", "+d(L)", "-d(L)", "", "", "0"]
        - [HPM, Change in HPM, "", "", "", "-d(HPM)", "", "+d(HPM)", "0"]
        - [Advances, Change in advances, "", "", "", "+d(A)", "", "-d(A)", "0"]
        - [Securities, Change in government securities, "-d(SEC_H)", "", "", "-d(SEC_B)", "+d(SEC)", "-d(SEC_CB)", "0"]
        - [Sum, Sum, "0", "0", "0", "0", "0", "0", "0"]
      more: |
        Household disposable income is wages plus distributed firm and bank profits
        plus interest, minus taxes. What is not consumed and not placed in bonds or
        government securities is added to deposits.

        Firms sell consumption and investment goods, pay wages, interest, coupons
        and taxes, receive green subsidies, and finance capital accumulation with
        retained earnings, new loans and new bonds. Banks earn the loan-deposit
        spread and may receive bailouts. The government spends on consumption and
        investment, collects taxes including the carbon tax, and pays subsidies.
        Central-bank profits `CBP` are remitted to the government.
  - sequence:
      id: transaction-flow-sequence
      title: DEFINE 1.1 transaction flow sequence
      source:
        kind: matrix
        matrixCellId: transaction-flow
      description: Sequence view generated from the transactions-flow matrix at the selected simulation period.
  - markdown:
      id: ecology-note
      title: Ecosystem, climate and green capital
      source: Material intensity, recycling, energy intensity, the non-fossil share and sequestration all respond to the green-to-conventional capital mix. Fossil emissions `EMIS_F = omega * (1 - seq) * E_F` feed cumulative CO2 and temperature via TCRE.
      more: |
        Four physical processes are consolidated in production: extraction, energy
        conversion, recycling and final output. Material intensity `mu` and the
        recycling rate `rho` improve as green non-energy capital rises relative to
        conventional non-energy capital. Energy intensity `epsilon` falls and the
        non-fossil share `theta` rises with green energy capital. Sequestration
        `seq` tracks sequestration capital in mining/utilities and manufacturing.

        Temperature is `TEMP = TCRE * CO2_CUM / (1 - f_nc)`, so warming is
        approximately proportional to cumulative emissions (Matthews et al. 2021).
        Damages `D_T` then hit investment, consumption, depreciation, labour-force
        participation and productivities. Green public investment and cheaper green
        finance raise `K_G / K_C` and that is what pulls intensity down.
  - equations:
      id: equations
      title: DEFINE 1.1 model
      modelId: define
      collapsed: false
      rows:
{eq_block}
      more: |
        Equation labels use Table 5 of the DEFINE 1.1 manual (Dafermos and Nikolaidi,
        August 2022): the Table 5 description, then a short `eqN` tag for the numbered
        identity in section 2. Matter, energy, emissions and technology sit above
        the SFC block. Demand is private consumption and investment plus government
        spending, subject to Leontief supply ceilings on matter, energy, capital and
        labour. Desired investment is a logistic function of utilisation, the profit
        rate, unemployment and resource scarcity. Each of four sectors chooses a
        green investment share `beta_Si` from relative energy costs and borrowing
        costs. Banks ration loans and set spreads from capital adequacy and firms'
        debt-service ratio.

        `SEC_CB` is government securities held by central banks. `SEC_CBred` is the
        redundant residual implied by the central-bank budget constraint. The solver
        checks `SEC_CB = SEC_CBred`.
  - solver:
      id: solver
      title: Solver
      modelId: define
      collapsed: true
      method: gauss-seidel
      tolerance: "1e-8"
      maxIterations: 400
      defaultInitialValue: "0"
      hiddenLeftVariable: SEC_CB
      hiddenRightVariable: SEC_CBred
      hiddenTolerance: "1e-4"
      relativeHiddenTolerance: false
  - externals:
      id: externals-equations
      title: Externals
      modelId: define
      collapsed: true
      rows:
{ext_block}
      more: |
        Scalar parameters are the period-1 calibration from R after 15 Gauss-Seidel
        iterations of the 2021 snapshot. Carbon-tax paths are the SSP3 series in
        `_DEFINE_Carbontaxes.csv` (US$/tCO2, converted to US$ tn / GtCO2). Policy
        dummies (`tau_C_dummy_M`, `gov_IG`, `s_G`, `w_G_2022`) are the levers used
        in the scenarios below.
  - initial-values:
      id: initial-values-equations
      title: Initial values
      modelId: define
      collapsed: true
      rows:
{init_block}
      more: |
        Period 1 is the 2021 data-consistent snapshot from R. Putting those stocks
        and flows here means lags in period 2 are the calibrated 2021 values. World
        GDP starts at `Y = 96.10` trillion US dollars; temperature at `TEMP = 1.21` C;
        fossil emissions at `EMIS_F = 36.4` GtCO2.
  - run:
      id: baseline-run
      title: Baseline run
      description: DEFINE 1.1 baseline, 2021-2100, with hidden condition SEC_CB = SEC_CBred.
      mode: baseline
      periods: 80
      resultKey: define_baseline
      sourceModelId: define
  - chart:
      id: baseline-macro-chart
      title: Baseline output, growth and unemployment
      variables:
        - Y
        - g_Y
        - ur
        - u
        - r
      axisGroups:
        - [Y]
        - [g_Y, ur, u, r]
      axisSnapTolarance: 0.5
      sourceRunCellId: baseline-run
      more: |
        The R baseline is an SSP2/SSP3-6.0 mix. Growth starts near 5.8 percent in
        2021 and slows toward 2 percent as damages and resource constraints bind.
        Unemployment stays near 6-7 percent. Utilisation `u` and the profit rate `r`
        drift with the capital stock and climate damages.
  - chart:
      id: baseline-climate-chart
      title: Baseline temperature, emissions and green share
      variables:
        - TEMP
        - EMIS
        - EMIS_F
        - theta
        - seq
        - tau_C
      axisGroups:
        - [TEMP]
        - [EMIS, EMIS_F]
        - [theta, seq]
        - [tau_C]
      axisSnapTolarance: 0.5
      sourceRunCellId: baseline-run
      more: |
        Temperature `TEMP` tracks cumulative emissions. The non-fossil share `theta`
        rises only slowly on the baseline because green capital remains a small slice
        of the aggregate stock. The carbon tax `tau_C` follows the SSP3-6.0 path
        (about 2.4 US$/tCO2 in 2021, rising through the century) and is recycled as
        a green subsidy.
  - table:
      id: baseline-table
      title: Baseline variable summary
      variables:
        - Y
        - g_Y
        - TEMP
        - EMIS_F
        - theta
        - ur
        - SEC
        - L
        - K_PRI
        - IG_PRI
        - tau_C
        - CAR
        - def
      sourceRunCellId: baseline-run
      more: |
        Use the period selector to read 2021 (period 1) against 2050 (period 30) and
        2100 (period 80). `SEC_CB` should stay in line with `SEC_CBred` at every date.
  - markdown:
      id: scenario-1-note
      title: Green public investment
      source: This scenario quadruples the government green-investment ratio `gov_IG` from 2024, matching R scenario 6 on the 2021-2100 path.
      more: |
        The run starts from the 2021 baseline snapshot (`baselineStartPeriod: 1`) and
        raises `gov_IG` from period 4, which is calendar 2024. Public green capital
        then raises `KGE / KCE` and `theta`, which is the DEFINE story of green
        public investment.
  - run:
      id: scenario-1-run
      title: "Scenario 1: green public investment"
      mode: scenario
      scenario:
        shocks:
          - rangeInclusive:
              - 4
              - 80
            variables:
              gov_IG:
                kind: constant
                value: {fmt_num(policy["gov_ig_green"])}
            startPeriodInclusive: 4
            endPeriodInclusive: 80
      baselineRunCellId: baseline-run
      baselineStartPeriod: 1
      periods: 80
      resultKey: define_s1
      sourceModelId: define
  - chart:
      id: scenario-1-chart
      title: Scenario 1 green capital, intensity and temperature
      variables:
        - IG_GOV
        - theta
        - TEMP
        - EMIS_F
        - Y
        - g_Y
      axisMode: separate
      sourceRunCellId: scenario-1-run
      more: |
        Watch `IG_GOV` step up with the higher `gov_IG`. The non-fossil share `theta`
        then rises as public green capital accumulates. Emissions and temperature
        combine that intensity path with output.
  - markdown:
      id: scenario-2-note
      title: Medium carbon tax plus green subsidy
      source: This scenario turns on the medium SSP3 carbon-tax path (`tau_C_dummy_M = 1`) from 2024, matching R scenario 5. Revenues continue to be recycled as green subsidies.
      more: |
        From period 4, `tau_C` follows `tau_C_policy_Medium` instead of
        `tau_C_baseline`, which raises the relative cost of conventional energy
        (`tucn`) and pulls `beta_Si` up.
  - run:
      id: scenario-2-run
      title: "Scenario 2: medium carbon tax"
      mode: scenario
      scenario:
        shocks:
          - rangeInclusive:
              - 4
              - 80
            variables:
              tau_C_dummy_M:
                kind: constant
                value: 1
            startPeriodInclusive: 4
            endPeriodInclusive: 80
      baselineRunCellId: baseline-run
      baselineStartPeriod: 1
      periods: 80
      resultKey: define_s2
      sourceModelId: define
  - chart:
      id: scenario-2-chart
      title: Scenario 2 carbon tax, green share and emissions
      variables:
        - tau_C
        - theta
        - EMIS_F
        - TEMP
        - Y
        - SUB
      axisMode: separate
      sourceRunCellId: scenario-2-run
      more: |
        The medium tax path is several times the baseline SSP3-6.0 schedule. Subsidies
        `SUB` rise with tax revenues, which lowers `tucr` and supports green
        investment. Compare temperature and emissions with scenario 1, where the
        same engine decarbonises through public capital rather than through a tax.
  - markdown:
      id: scenario-3-note
      title: Green QE
      source: This scenario raises the central-bank share of green corporate bonds to `s_G = 0.4` from 2024, matching R scenario 9.
      more: |
        A higher `s_G` lifts central-bank demand for green bonds, which supports
        `p_G` and lowers the green yield. Firms then issue more green bonds and raise
        `beta`.
  - run:
      id: scenario-3-run
      title: "Scenario 3: green QE"
      mode: scenario
      scenario:
        shocks:
          - rangeInclusive:
              - 4
              - 80
            variables:
              s_G:
                kind: constant
                value: {fmt_num(policy["s_g_qe"])}
            startPeriodInclusive: 4
            endPeriodInclusive: 80
      baselineRunCellId: baseline-run
      baselineStartPeriod: 1
      periods: 80
      resultKey: define_s3
      sourceModelId: define
  - chart:
      id: scenario-3-chart
      title: Scenario 3 green bonds, yield and emissions
      variables:
        - B_GCB
        - yield_G
        - yield_C
        - theta
        - EMIS_F
        - Y
      axisMode: separate
      sourceRunCellId: scenario-3-run
      more: |
        Central-bank green bond holdings `B_GCB` jump with `s_G`. The green yield
        `yield_G` should fall relative to `yield_C`, which is the portfolio channel
        from green QE into firms' green investment share.
"""
    extra = "".join(
        [
            paper_scenario_yaml(
                n=4,
                title="Medium carbon tax without recycling",
                source="This scenario turns on the medium SSP3 carbon-tax path from 2024 and stops recycling revenues as green subsidies (`stop_recycling_dummy = 1`), matching R scenario 4 / paper Figure 1 CT.",
                more="Without recycling, `SUB` no longer tracks `tau_C * lag(EMIS_F)` after 2023. The tax still raises conventional energy costs, but green capital does not get the matching subsidy.",
                shocks={"tau_C_dummy_M": 1, "stop_recycling_dummy": 1},
                chart_title="Scenario 4 tax without recycling",
                chart_vars=["tau_C", "SUB", "gov_SUB", "theta", "EMIS_F", "TEMP"],
                chart_more="Compare `SUB` with scenario 2: here subsidies stay near the pre-2024 level while the tax keeps rising.",
                result_key="define_s4",
            ),
            paper_scenario_yaml(
                n=5,
                title="Dirty penalty factor",
                source="This scenario raises conventional-loan risk weights from 2024 (`w_C_Si_2022 = 1 + min(dd_Si, 1) * 0.25`), matching R scenario 7 / paper Figure 2 DPF.",
                more="Higher dirty-sector risk weights tighten conventional credit and raise conventional loan rates relative to green loans, which is DEFINE's bank-capital channel into the energy mix.",
                shocks={
                    "w_C_S1_2022": policy["w_c_s1_dpf"],
                    "w_C_S2_2022": policy["w_c_s2_dpf"],
                    "w_C_S3_2022": policy["w_c_s3_dpf"],
                    "w_C_S4_2022": policy["w_c_s4_dpf"],
                },
                chart_title="Scenario 5 dirty penalty factor",
                chart_vars=["w_C_S1", "CR_C_S1", "theta", "EMIS_F", "TEMP", "Y"],
                chart_more="Watch conventional credit rationing `CR_C_S1` and the non-fossil share `theta` after the risk-weight step.",
                result_key="define_s5",
            ),
            paper_scenario_yaml(
                n=6,
                title="Green supporting factor",
                source="This scenario cuts the green-loan risk weight to `w_G_2022 = 0.75` from 2024, matching R scenario 8 / paper Figure 2 GSF.",
                more="A lower green risk weight eases green credit and is the counterpart of the dirty penalty factor on the conventional book.",
                shocks={"w_G_2022": policy["w_g_gsf"]},
                chart_title="Scenario 6 green supporting factor",
                chart_vars=["w_G", "CR_G", "theta", "EMIS_F", "TEMP", "Y"],
                chart_more="Green credit rationing `CR_G` should ease relative to baseline as banks are asked to hold less capital against green loans.",
                result_key="define_s6",
            ),
            paper_scenario_yaml(
                n=7,
                title="Sufficiency",
                source="This scenario turns on the consumption-adjustment dummy and sets `phi = 0.25` from 2024, matching R scenario 10 / paper Figure 3 Sufficiency. On T=80 the R duration window covers the rest of the century.",
                more="`dummy_con_change` lets `con_change` rise toward `con_change_end`, and `phi` links hours to the unemployment gap. Together they slow consumption and labour demand.",
                shocks={"dummy_con_change": 1, "phi": policy["phi_sufficiency"]},
                chart_title="Scenario 7 sufficiency",
                chart_vars=["con_change", "CO_PRI", "Y", "EMIS_F", "TEMP", "ur"],
                chart_more="Output and emissions fall mainly because demand is lower, not because `theta` jumps.",
                result_key="define_s7",
            ),
            paper_scenario_yaml(
                n=8,
                title="Green fiscal and financial mix",
                source="This scenario combines green public investment, the medium carbon tax, green QE, DPF and GSF from 2024, matching R scenario 11 / paper Figure 3 Fiscal+Financial.",
                more="It is the joint climate-policy package without the sufficiency demand shock.",
                shocks={
                    "gov_IG": policy["gov_ig_green"],
                    "tau_C_dummy_M": 1,
                    "s_G": policy["s_g_qe"],
                    "w_G_2022": policy["w_g_gsf"],
                    "w_C_S1_2022": policy["w_c_s1_dpf"],
                    "w_C_S2_2022": policy["w_c_s2_dpf"],
                    "w_C_S3_2022": policy["w_c_s3_dpf"],
                    "w_C_S4_2022": policy["w_c_s4_dpf"],
                },
                chart_title="Scenario 8 fiscal and financial mix",
                chart_vars=["theta", "EMIS_F", "TEMP", "Y", "IG_GOV", "tau_C"],
                chart_more="Temperature and the fossil share should fall further than in any single instrument.",
                result_key="define_s8",
            ),
            paper_scenario_yaml(
                n=9,
                title="Sufficiency plus fiscal and financial mix",
                source="This scenario adds the sufficiency shock to the green fiscal-financial package from 2024, matching R scenario 12 / paper Figure 3 Sufficiency+Fiscal+Financial.",
                more="R applies the mix for the whole remaining horizon and the sufficiency dummy for `i` in 4..4+duration. With `duration = 77` that is the rest of the 2021-2100 run.",
                shocks={
                    "gov_IG": policy["gov_ig_green"],
                    "tau_C_dummy_M": 1,
                    "s_G": policy["s_g_qe"],
                    "w_G_2022": policy["w_g_gsf"],
                    "w_C_S1_2022": policy["w_c_s1_dpf"],
                    "w_C_S2_2022": policy["w_c_s2_dpf"],
                    "w_C_S3_2022": policy["w_c_s3_dpf"],
                    "w_C_S4_2022": policy["w_c_s4_dpf"],
                    "dummy_con_change": 1,
                    "phi": policy["phi_sufficiency"],
                },
                chart_title="Scenario 9 combined package",
                chart_vars=["theta", "EMIS_F", "TEMP", "Y", "CO_PRI", "g_Y"],
                chart_more="This is the strongest decarbonisation path in the August 2022 paper: lower demand plus every green-finance and fiscal lever.",
                result_key="define_s9",
            ),
        ]
    )
    return body + extra


if __name__ == "__main__":
    main()
