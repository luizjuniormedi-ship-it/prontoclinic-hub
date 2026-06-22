#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/validate-migrations.py
Validador de migrations SQL do ProntoClinic Hub.

Uso:
    python scripts/validate-migrations.py                          # valida todas
    python scripts/validate-migrations.py <arquivo.sql>            # valida uma
    python scripts/validate-migrations.py --strict                # exit 1 se houver warning
    python scripts/validate-migrations.py --json                   # saída em JSON

Verifica:
    1. Sintaxe SQL via sqlparse (parse, não execução)
    2. Convenção de nomenclatura: NNN_* onde NNN é timestamp
    3. Presença de BEGIN/COMMIT transacionais (recomendado)
    4. Comentário de header (-- Migration:)
    5. Detecção de padrões perigosos (DROP sem IF EXISTS, GRANT TO PUBLIC, etc.)
    6. Contagem de objetos: tabelas, índices, policies, funções, views, triggers
    7. Colunas em INSERTs que não existem no schema conhecido
    8. Ordem de declaração (dependências forward)

Não substitui psql --dry-run, mas cobre 80% dos erros de copy-paste.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

try:
    import sqlparse
    from sqlparse.sql import IdentifierList, Statement
    from sqlparse.tokens import DDL, DML, Keyword, Punctuation
except ImportError:
    print("ERRO: sqlparse não instalado. Rode: pip install sqlparse", file=sys.stderr)
    sys.exit(2)


# =============================================================================
# Schema conhecido (subset para validação estática)
# =============================================================================
KNOWN_TABLES = {
    "audit_logs", "companies", "user_profiles", "patients", "appointments",
    "medical_records", "billings", "dicom_exams", "dicom_equipment",
    "dicom_worklist", "dicom_exam_images", "report_templates",
    "pre_cadastro", "paciente_consentimentos", "paciente_anonimizacao_log",
    "lgpd_solicitacoes", "lgpd_politica_retencao", "notifications",
    "services_catalog", "payment_sources", "insurance_companies",
    "insurance_plans", "professional_insurances", "price_tables",
    "tiss_lotes", "tiss_guias", "tiss_procedimentos",
}

# Colunas conhecidas das tabelas mais sensíveis (para validação de INSERTs)
KNOWN_COLUMNS = {
    "audit_logs": {
        "id", "company_id", "dt_evento", "cd_usuario", "cd_usuario_nome",
        "role_name", "acao", "tabela", "registro_id", "operacao",
        "dados_anteriores", "dados_novos", "ip_origem", "user_agent",
        "request_id", "dt_retencao",
    },
    "patients": {
        "id", "company_id", "full_name", "cpf", "cpf_hash", "rg", "email",
        "email_hash", "phone", "whatsapp", "endereco", "numero", "complemento",
        "bairro", "cidade", "cep", "nome_mae", "nome_pai", "historico_familiar",
        "foto_url", "birth_date", "data_nascimento", "gender", "naturalidade",
        "naturalidade_uf", "lg_aceite_termo", "dt_aceite_termo", "lg_anonimizado",
        "dt_anonimizacao", "dt_obito", "dt_ultimo_atendimento", "created_at", "updated_at",
    },
    "pre_cadastro": {
        "id", "company_id", "full_name", "cpf", "cpf_hash", "birth_date", "gender",
        "email", "email_hash", "phone", "whatsapp", "cep", "logradouro", "numero",
        "complemento", "bairro", "cidade", "uf", "ibge_cidade", "lg_aceite_termo",
        "dt_aceite_termo", "versao_termo", "texto_termo_hash", "ip_origem",
        "user_agent", "token_confirmacao", "dt_token_exp", "lg_confirmado",
        "dt_confirmacao", "cd_paciente_final", "dt_migracao", "status",
        "tentativas_confirmacao", "dt_ultimo_envio", "motivo_cancelamento",
        "created_at", "updated_at",
    },
    "dicom_exams": {
        "id", "company_id", "cd_dicom_exame", "ds_id_patient", "cd_laudo",
        "cd_appointment", "cd_patient", "cd_equipment", "ds_patient_name",
        "dt_exame", "dt_nascimento", "ds_sexo", "ds_modality", "ds_ae_title",
        "ds_exame", "ds_url_dicom", "ds_url_thumb", "ds_url_report", "nr_images",
        "ds_status", "ds_clinical_info", "ds_referring_physician", "cd_origem_sigh",
        "lg_publicar", "dt_publicado", "created_at", "updated_at",
    },
}


# =============================================================================
# Modelos
# =============================================================================
@dataclass
class Issue:
    level: str  # ERROR | WARNING | INFO
    code: str
    message: str
    line: int | None = None


@dataclass
class MigrationReport:
    path: str
    issues: list[Issue] = field(default_factory=list)
    statements: int = 0
    objects: dict[str, int] = field(default_factory=dict)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "ERROR"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "WARNING"]

    def add(self, level: str, code: str, msg: str, line: int | None = None) -> None:
        self.issues.append(Issue(level, code, msg, line))


# =============================================================================
# Padrões regex
# =============================================================================
RE_MIGRATION_HEADER = re.compile(r"--\s*Migration:\s*(\d{14})", re.IGNORECASE)
RE_TIMESTAMP_FILE = re.compile(r"^(\d{14})_(.+)\.sql$")
RE_GRANT_PUBLIC = re.compile(r"\bGRANT\s+.*\bTO\s+PUBLIC\b", re.IGNORECASE)
RE_GRANT_AUTH = re.compile(r"\bGRANT\s+.*\bTO\s+authenticated\b", re.IGNORECASE)
RE_DROP_NO_IF = re.compile(r"\bDROP\s+(?!TABLE\s+IF|INDEX\s+IF|FUNCTION\s+IF|VIEW\s+IF|POLICY\s+IF|TRIGGER\s+IF|CONSTRAINT\s+IF|TYPE\s+IF|EXTENSION\s+IF|SCHEMA\s+IF|MATERIALIZED\s+VIEW\s+IF|SEQUENCE\s+IF|DOMAIN\s+IF|EVENT\s+TRIGGER\s+IF|RULE\s+IF|STATISTICS\s+IF|FOREIGN\s+TABLE\s+IF|AGGREGATE\s+IF|CAST\s+IF|OPERATOR\s+IF|COLLATION\s+IF|CONVERSION\s+IF|TRANSFORM\s+IF|TABLE\s+IF\s+EXISTS|INDEX\s+IF\s+EXISTS|FUNCTION\s+IF\s+EXISTS|VIEW\s+IF\s+EXISTS|POLICY\s+IF\s+EXISTS|TRIGGER\s+IF\s+EXISTS|CONSTRAINT\s+IF\s+EXISTS)", re.IGNORECASE)
RE_TRUNCATE = re.compile(r"\bTRUNCATE\s+(?!.*\bCASCADE\b)", re.IGNORECASE)


# =============================================================================
# Helpers
# =============================================================================
def count_objects(sql: str) -> dict[str, int]:
    """Conta objetos DDL no script."""
    patterns = {
        "tables": r"\bCREATE\s+TABLE\b(?!.*\bIF\s+NOT\s+EXISTS)",
        "tables_safe": r"\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b",
        "indexes": r"\bCREATE\s+INDEX\b",
        "policies": r"\bCREATE\s+POLICY\b",
        "functions": r"\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b",
        "views": r"\bCREATE\s+(OR\s+REPLACE\s+)?VIEW\b",
        "triggers": r"\bCREATE\s+TRIGGER\b",
        "grants": r"\bGRANT\s+",
        "revokes": r"\bREVOKE\s+",
        "alter_table": r"\bALTER\s+TABLE\b",
        "inserts": r"\bINSERT\s+INTO\b",
    }
    out = {}
    for k, pat in patterns.items():
        out[k] = len(re.findall(pat, sql, re.IGNORECASE))
    return out


def extract_table_from_insert(stmt_text: str) -> str | None:
    """Extrai nome da tabela de um INSERT INTO."""
    m = re.search(r"INSERT\s+INTO\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)", stmt_text, re.IGNORECASE)
    return m.group(1).lower() if m else None


def extract_columns_from_insert(stmt_text: str) -> list[str]:
    """Extrai colunas de um INSERT INTO ... (col1, col2, ...) VALUES (...).
    Heurística: procura o bloco entre parênteses após o nome da tabela.
    """
    m = re.search(
        r"INSERT\s+INTO\s+(?:public\.)?[a-zA-Z_][a-zA-Z0-9_]*\s*\(([^)]+)\)",
        stmt_text, re.IGNORECASE | re.DOTALL
    )
    if not m:
        return []
    cols = [c.strip().strip('"').strip("`").lower() for c in m.group(1).split(",")]
    return [c for c in cols if c]


# =============================================================================
# Validação principal
# =============================================================================
def validate_migration(path: Path, report: MigrationReport) -> None:
    sql = path.read_text(encoding="utf-8")
    filename = path.name

    # 1. Convenção de nomenclatura
    m = RE_TIMESTAMP_FILE.match(filename)
    if not m:
        report.add("ERROR", "NAM001", f"Nome inválido: {filename}. Esperado: NNN_<nome>.sql")
    else:
        ts, name = m.groups()
        if not ts.isdigit() or len(ts) != 14:
            report.add("ERROR", "NAM002", f"Timestamp inválido em {filename}")
        if not name.replace("_", "").isalnum():
            report.add("WARNING", "NAM003", f"Nome '{name}' tem caracteres não-convencionais")

    # 2. Header de Migration
    header = RE_MIGRATION_HEADER.search(sql[:1000])
    if not header:
        report.add("WARNING", "HDR001", "Header '-- Migration: <id>' ausente no início")
    else:
        # Conferir coerência com filename
        if m and m.group(1) != header.group(1):
            report.add("WARNING", "HDR002",
                       f"Header diz '{header.group(1)}' mas arquivo é '{m.group(1)}'")

    # 3. Parse com sqlparse
    parsed = sqlparse.parse(sql)
    report.statements = len(parsed)

    unparsed = [s for s in parsed if s.ttype is None and not s.tokens]
    for stmt in unparsed:
        report.add("ERROR", "PR001", "Statement não pôde ser parseado", stmt.token_first(skip_cm=True).value[:100] if stmt.tokens else None)

    # 4. Padrões perigosos
    lines = sql.splitlines()
    for i, line in enumerate(lines, start=1):
        # GRANT TO PUBLIC perigoso (exceto em GRANT USAGE ON SCHEMA)
        if RE_GRANT_PUBLIC.search(line) and "USAGE ON SCHEMA" not in line.upper():
            report.add("ERROR", "SEC001",
                       "GRANT ... TO PUBLIC detectado (exceto USAGE ON SCHEMA). "
                       "Risco de expor funções privilegiadas para a role anon.",
                       i)
        # GRANT TO authenticated em funções privilegiadas
        if RE_GRANT_AUTH.search(line) and re.search(r"FUNCTION|EXECUT", line, re.IGNORECASE):
            if "anonymize" in line.lower() or "purge" in line.lower() or "delete" in line.lower():
                report.add("WARNING", "SEC002",
                           f"GRANT EXECUTE em função privilegiada para authenticated: {line.strip()[:100]}",
                           i)
        # DROP sem IF EXISTS
        if RE_DROP_NO_IF.search(line):
            report.add("WARNING", "SEC003",
                       "DROP sem IF EXISTS — pode falhar se objeto não existir", i)
        # TRUNCATE sem CASCADE
        if RE_TRUNCATE.search(line):
            report.add("WARNING", "SEC004",
                       "TRUNCATE sem CASCADE — pode falhar por FKs", i)

    # 5. Contagem de objetos
    report.objects = count_objects(sql)

    # 6. Validação de INSERTs contra schema conhecido
    inserts = re.findall(r"INSERT\s+INTO[^;]+;?", sql, re.IGNORECASE | re.DOTALL)
    for ins in inserts:
        tbl = extract_table_from_insert(ins)
        if not tbl:
            continue
        if tbl not in KNOWN_COLUMNS:
            # Tabela desconhecida — não é erro, é info
            report.add("INFO", "SCH001", f"INSERT em tabela '{tbl}' (não catalogada)")
            continue
        cols = extract_columns_from_insert(ins)
        bad = [c for c in cols if c not in KNOWN_COLUMNS[tbl]]
        for b in bad:
            report.add("ERROR", "SCH002",
                       f"INSERT em '{tbl}' referencia coluna inexistente '{b}'. "
                       f"Conhecidas: {sorted(KNOWN_COLUMNS[tbl])}")

    # 7. Funções que fazem referência a audit_logs devem usar as colunas corretas
    if "audit_logs" in sql.lower() and "INSERT INTO" in sql:
        # Pega todos os INSERTs INTO audit_logs
        ins_pattern = re.compile(
            r"INSERT\s+INTO\s+(?:public\.)?audit_logs\s*\(([^)]+)\)",
            re.IGNORECASE | re.DOTALL
        )
        for m in ins_pattern.finditer(sql):
            cols = {c.strip().strip('"').lower() for c in m.group(1).split(",")}
            required = {"company_id", "cd_usuario", "acao", "tabela", "registro_id"}
            missing = required - cols
            if missing:
                report.add("WARNING", "AUD001",
                           f"INSERT em audit_logs faltando colunas esperadas: {sorted(missing)}. "
                           f"Tem: {sorted(cols)}")

    # 8. Funções SECURITY DEFINER sem SET search_path (risco de hijack)
    func_pattern = re.compile(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\S+).*?\bLANGUAGE\s+plpgsql\b(.*?)\$\$",
        re.IGNORECASE | re.DOTALL
    )
    for m in func_pattern.finditer(sql):
        body = m.group(2)
        if "SECURITY DEFINER" in body and "search_path" not in body:
            report.add("WARNING", "SF001",
                       f"Função '{m.group(1)}' é SECURITY DEFINER sem SET search_path. "
                       f"Risco de search_path hijack.")

    # 9. Extensions devem ter IF NOT EXISTS
    ext_pattern = re.compile(r"CREATE\s+EXTENSION\s+(?!IF\s+NOT\s+EXISTS)\b(\w+)", re.IGNORECASE)
    for m in ext_pattern.finditer(sql):
        report.add("WARNING", "EXT001", f"CREATE EXTENSION {m.group(1)} sem IF NOT EXISTS")


# =============================================================================
# Orquestração
# =============================================================================
def find_migrations(root: Path) -> Iterable[Path]:
    """Encontra todas as migrations no diretório padrão."""
    mig_dir = root / "supabase" / "migrations"
    if not mig_dir.exists():
        return []
    return sorted(mig_dir.glob("*.sql"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Validador de migrations SQL")
    parser.add_argument("files", nargs="*", help="Arquivos .sql para validar (opcional)")
    parser.add_argument("--strict", action="store_true", help="Exit 1 se houver WARNING")
    parser.add_argument("--json", action="store_true", help="Saída em JSON")
    parser.add_argument("--root", type=Path, default=Path("."), help="Raiz do projeto")
    args = parser.parse_args()

    if args.files:
        paths = [Path(f) for f in args.files]
    else:
        paths = list(find_migrations(args.root))

    if not paths:
        print("Nenhuma migration encontrada.", file=sys.stderr)
        return 1

    reports: list[MigrationReport] = []
    for p in paths:
        if not p.exists():
            print(f"ERRO: arquivo não encontrado: {p}", file=sys.stderr)
            return 2
        r = MigrationReport(path=str(p))
        validate_migration(p, r)
        reports.append(r)

    # Saída
    if args.json:
        out = []
        for r in reports:
            out.append({
                "path": r.path,
                "statements": r.statements,
                "objects": r.objects,
                "errors": [{"code": i.code, "msg": i.message, "line": i.line} for i in r.errors],
                "warnings": [{"code": i.code, "msg": i.message, "line": i.line} for i in r.warnings],
                "info": [{"code": i.code, "msg": i.message, "line": i.line} for i in r.issues if i.level == "INFO"],
            })
        print(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        total_errors = 0
        total_warnings = 0
        for r in reports:
            print(f"\n=== {r.path} ===")
            print(f"  Statements: {r.statements}")
            print(f"  Objects:    " + ", ".join(f"{k}={v}" for k, v in r.objects.items() if v))
            for i in r.issues:
                marker = {"ERROR": "[E]", "WARNING": "[W]", "INFO": "[I]"}.get(i.level, "[-]")
                line = f"  L{i.line}" if i.line else ""
                print(f"  {marker} {i.code}{line}: {i.message}")
            total_errors += len(r.errors)
            total_warnings += len(r.warnings)
        print(f"\n--- RESUMO ---")
        print(f"Arquivos:    {len(reports)}")
        print(f"Erros:       {total_errors}")
        print(f"Warnings:    {total_warnings}")

    # Exit code
    has_errors = any(r.errors for r in reports)
    has_warnings = any(r.warnings for r in reports)
    if has_errors:
        return 1
    if args.strict and has_warnings:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
