#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/validate-migrations-v2.py

Validador v2 das migrations SQL do ProntoClinic Hub.
Focado em 2 issues P0 historicamente detectadas:

  1. CREATE FUNCTION com DEFAULT no meio dos parametros
     (PostgreSQL rejeita: "syntax error at or near DEFAULT")
  2. CREATE OR REPLACE em funcao cuja assinatura RETURNS difere da
     versao ja criada (PostgreSQL nao troca a "shape" da funcao via
     CREATE OR REPLACE; e necessario DROP + CREATE)

Diferencas em relacao ao validate-migrations.py:
  - Heuristica para defaults no meio (regex com split por virgula, respeitando
    niveis de parenteses).
  - Detecta funcoes redefinidas dentro de uma unica migration (suspeita).
  - Detecta CREATE OR REPLACE "orfao" (funcao nao criada nesta migration).
  - Detecta RETURNS TABLE inconsistente entre migrations.

Uso:
    python scripts/validate-migrations-v2.py
    python scripts/validate-migrations-v2.py --root .
    python scripts/validate-migrations-v2.py --json

Exit codes:
    0  = OK (sem errors)
    1  = encontrou errors
    2  = erro de execucao (dependencias, etc.)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable

try:
    import sqlparse
except ImportError:
    print("ERRO: sqlparse nao instalado. Rode: pip install sqlparse", file=sys.stderr)
    sys.exit(2)


# =============================================================================
# Regex
# =============================================================================

# Captura: CREATE [OR REPLACE] FUNCTION <name>(<params>)
# params pode conter virgulas dentro de tipos compostos; por isso
# usamos uma abordagem que respeita profundidade de parenteses via parser
# de caracteres. Aqui usamos uma versao "boa o suficiente" que lida com
# casos reais (sem aspas escapadas, sem comentarios inline complexos).
RE_FUNC_HEADER = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"
    r"(?:(?P<schema>[a-zA-Z_][a-zA-Z0-9_]*)\.)?(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)"
    r"\s*\((?P<params>.*?)\)\s*",
    re.IGNORECASE | re.DOTALL,
)

RE_RETURNS_TABLE = re.compile(
    r"RETURNS\s+TABLE\s*\((?P<cols>[^)]*)\)",
    re.IGNORECASE | re.DOTALL,
)


# =============================================================================
# Helpers
# =============================================================================

def split_function_params(params_text: str) -> list[str]:
    """Divide parametros por virgula respeitando parenteses aninhados."""
    out: list[str] = []
    depth = 0
    cur: list[str] = []
    in_single = False
    in_double = False
    i = 0
    while i < len(params_text):
        c = params_text[i]
        if c == "'" and not in_double:
            in_single = not in_single
            cur.append(c)
        elif c == '"' and not in_single:
            in_double = not in_double
            cur.append(c)
        elif not in_single and not in_double:
            if c == "(":
                depth += 1
                cur.append(c)
            elif c == ")":
                depth -= 1
                cur.append(c)
            elif c == "," and depth == 0:
                out.append("".join(cur).strip())
                cur = []
            else:
                cur.append(c)
        else:
            cur.append(c)
        i += 1
    if cur:
        out.append("".join(cur).strip())
    return [p for p in out if p]


def has_default(param: str) -> bool:
    """Detecta se um parametro tem DEFAULT (case-insensitive, ignora DEFAULT dentro de strings)."""
    upper = param.upper()
    # Remove strings simples para nao pegar DEFAULT em texto
    cleaned = re.sub(r"'[^']*'", "''", upper)
    # Tambem remove comentarios inline -- ate fim da linha
    cleaned = re.sub(r"--.*$", "", cleaned)
    return bool(re.search(r"\bDEFAULT\b", cleaned))


def check_defaults_in_middle(func_name: str, params: list[str]) -> list[str]:
    """Retorna lista de warnings para parametros sem DEFAULT precedidos por parametro com DEFAULT."""
    warnings = []
    seen_default = False
    for i, p in enumerate(params):
        if has_default(p):
            seen_default = True
        elif seen_default:
            # Parametro sem DEFAULT apos um parametro com DEFAULT
            short = p[:60].replace("\n", " ")
            warnings.append(
                f"{func_name}: parametro obrigatorio apos DEFAULT "
                f"(pos {i+1}/{len(params)}): '{short}...'"
            )
    return warnings


def extract_returns_table_columns(func_block: str) -> tuple[str, ...]:
    """Extrai a lista de colunas apos RETURNS TABLE(...) de um bloco de CREATE FUNCTION."""
    m = RE_RETURNS_TABLE.search(func_block)
    if not m:
        return ()
    cols_raw = m.group("cols")
    cols = []
    for c in cols_raw.split(","):
        c = c.strip()
        if not c:
            continue
        # formato esperado: "<name> <TYPE>"; pegar o primeiro token
        name = c.split()[0].strip('"')
        cols.append(name)
    return tuple(cols)


def extract_function_block(sql: str, start_idx: int) -> str:
    """Extrai o bloco de uma funcao a partir do indice do header ate o $$ de fechamento."""
    # Pega o AS $$ ... $$ LANGUAGE
    m = re.search(r"AS\s+\$\$(.*?)\$\$\s*LANGUAGE", sql[start_idx:], re.IGNORECASE | re.DOTALL)
    if not m:
        return sql[start_idx:start_idx + 1000]
    return sql[start_idx : start_idx + m.end()]


def find_all_functions(sql: str) -> list[dict]:
    """Encontra todas as declaracoes de funcao no SQL."""
    results = []
    for m in RE_FUNC_HEADER.finditer(sql):
        name = (
            f"{m.group('schema')}.{m.group('name')}"
            if m.group("schema")
            else m.group("name")
        )
        params_text = m.group("params")
        params = split_function_params(params_text)
        block = extract_function_block(sql, m.start())
        returns_cols = extract_returns_table_columns(block)
        results.append({
            "name": name,
            "params": params,
            "returns_table_cols": returns_cols,
            "block": block,
            "is_replace": "OR REPLACE" in m.group(0).upper(),
        })
    return results


# =============================================================================
# Validacao principal
# =============================================================================

def validate_migration(path: Path) -> dict:
    """Valida uma unica migration."""
    sql = path.read_text(encoding="utf-8")
    funcs = find_all_functions(sql)

    errors: list[str] = []
    warnings: list[str] = []

    # 1. Defaults no meio
    for f in funcs:
        warns = check_defaults_in_middle(f["name"], f["params"])
        warnings.extend(warns)

    # 2. CREATE OR REPLACE sem CREATE correspondente nesta migration
    creates = {f["name"] for f in funcs if not f["is_replace"]}
    replaces = [f for f in funcs if f["is_replace"]]
    for r in replaces:
        if r["name"] not in creates:
            # OK se a funcao foi definida em migration anterior. Apenas INFO.
            warnings.append(
                f"{r['name']}: CREATE OR REPLACE sem CREATE nesta migration "
                f"(assume que ja existe em migration anterior)"
            )

    # 3. CREATE OR REPLACE suspeito: foi redefinido dentro desta MESMA migration
    by_name: dict[str, list[dict]] = defaultdict(list)
    for f in funcs:
        by_name[f["name"]].append(f)

    for name, lst in by_name.items():
        if len(lst) > 1:
            warnings.append(
                f"{name}: funcao declarada {len(lst)} vezes nesta migration "
                f"(ultima vence, mas sugere duplicacao)"
            )

    return {
        "file": path.name,
        "errors": errors,
        "warnings": warnings,
        "functions": [
            {
                "name": f["name"],
                "params_count": len(f["params"]),
                "returns_table_cols": list(f["returns_table_cols"]),
                "is_replace": f["is_replace"],
            }
            for f in funcs
        ],
    }


# =============================================================================
# Validacao cruzada entre migrations
# =============================================================================

def cross_validate(
    all_funcs_by_migration: dict[str, list[dict]],
    migration_sql: dict[str, str] | None = None,
) -> list[str]:
    """Detecta inconsistencias de assinatura RETURNS TABLE entre migrations.

    Ignora casos em que a migration que redefine a funcao tem
    DROP FUNCTION IF EXISTS <name> antes do CREATE — esse e o pattern correto
    para trocar a shape.
    """
    issues = []
    # nome -> [(migration, returns_table_cols)]
    history: dict[str, list[tuple[str, tuple[str, ...]]]] = defaultdict(list)
    for mig, funcs in all_funcs_by_migration.items():
        for f in funcs:
            if f["returns_table_cols"]:
                history[f["name"]].append((mig, f["returns_table_cols"]))

    for name, occurrences in history.items():
        if len(occurrences) < 2:
            continue
        first_mig, first_cols = occurrences[0]
        last_mig, last_cols = occurrences[-1]
        if first_cols == last_cols:
            continue

        # Verificar se a migration last_mig tem DROP FUNCTION IF EXISTS antes do CREATE
        if migration_sql:
            sql = migration_sql.get(last_mig, "")
            # Procura DROP FUNCTION IF EXISTS <schema.name>(...) ou <name>(...)
            short = name.split(".")[-1] if "." in name else name
            drop_patterns = [
                rf"DROP\s+FUNCTION\s+IF\s+EXISTS\s+(?:public\.)?{re.escape(short)}\s*\(",
                rf"DROP\s+FUNCTION\s+(?:public\.)?{re.escape(short)}\s+IF\s+EXISTS",
                rf"DROP\s+FUNCTION\s+(?:public\.)?{re.escape(short)}\s*\(",
            ]
            has_drop = any(re.search(p, sql, re.IGNORECASE) for p in drop_patterns)
            if has_drop:
                # OK: a migration fez DROP antes do CREATE — shape nova e intencional
                continue

        issues.append(
            f"{name}: RETURNS TABLE em {first_mig} = {list(first_cols)}, "
            f"mas em {last_mig} = {list(last_cols)}. "
            f"CREATE OR REPLACE nao troca shape — usar DROP FUNCTION IF EXISTS antes do CREATE."
        )
    return issues


# =============================================================================
# CLI
# =============================================================================

def find_migrations(root: Path) -> Iterable[Path]:
    mig_dir = root / "supabase" / "migrations"
    if not mig_dir.exists():
        return []
    return sorted(mig_dir.glob("*.sql"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Validador v2 de migrations SQL")
    parser.add_argument("--root", type=Path, default=Path("."), help="Raiz do projeto")
    parser.add_argument("--json", action="store_true", help="Saida em JSON")
    args = parser.parse_args()

    paths = list(find_migrations(args.root))
    if not paths:
        print("Nenhuma migration encontrada em supabase/migrations/", file=sys.stderr)
        return 2

    all_funcs_by_migration: dict[str, list[dict]] = {}
    migration_sql: dict[str, str] = {}
    results = []

    for p in paths:
        r = validate_migration(p)
        results.append(r)
        all_funcs_by_migration[p.name] = r["functions"]
        migration_sql[p.name] = p.read_text(encoding="utf-8")

    cross = cross_validate(all_funcs_by_migration, migration_sql)

    total_errors = 0
    total_warnings = 0

    if args.json:
        out = {
            "migrations": results,
            "cross_migration_issues": cross,
            "summary": {
                "files": len(results),
                "errors": total_errors,
                "warnings": total_warnings,
                "cross_issues": len(cross),
            },
        }
        print(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        for r in results:
            if r["errors"] or r["warnings"]:
                print(f"\n=== {r['file']} ===")
                for e in r["errors"]:
                    print(f"  [ERROR] {e}")
                for w in r["warnings"]:
                    print(f"  [WARN]  {w}")
                total_errors += len(r["errors"])
                total_warnings += len(r["warnings"])

        if cross:
            print(f"\n=== CROSS-MIGRATION ISSUES ===")
            for c in cross:
                print(f"  [ERROR] {c}")
            total_errors += len(cross)

        print(f"\n--- RESUMO ---")
        print(f"Arquivos:           {len(results)}")
        print(f"Funcoes analisadas: {sum(len(r['functions']) for r in results)}")
        print(f"Errors locais:      {sum(len(r['errors']) for r in results)}")
        print(f"Warnings locais:    {sum(len(r['warnings']) for r in results)}")
        print(f"Errors cross-mig:   {len(cross)}")
        print(f"TOTAL ERRORS:       {total_errors}")
        print(f"TOTAL WARNINGS:     {total_warnings}")

    return 1 if total_errors > 0 else 0


if __name__ == "__main__":
    sys.exit(main())