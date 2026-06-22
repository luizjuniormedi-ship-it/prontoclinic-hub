"""
validate-against-supabase.py - Valida schema real no Supabase via psycopg2

Conecta diretamente no PostgreSQL do Supabase usando a connection string
e valida: tabelas, RLS, funções, triggers, foreign keys.

Uso:
  python scripts/validate-against-supabase.py --url "postgresql://postgres:..."
  python scripts/validate-against-supabase.py --env SUPABASE_DB_URL

Pré-requisitos:
  pip install psycopg2-binary
"""
import os
import sys
import argparse
from datetime import datetime
from typing import Any, Dict, List

try:
    import psycopg2
    from psycopg2 import sql
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("ERRO: psycopg2 não instalado. Rode: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(2)


# Cores ANSI
class C:
    R = "\033[0;31m"
    G = "\033[0;32m"
    Y = "\033[1;33m"
    B = "\033[0;34m"
    N = "\033[0m"


def log(msg: str) -> None:
    print(f"{C.G}[{datetime.now().strftime('%H:%M:%S')}]{C.N} {msg}")


def warn(msg: str) -> None:
    print(f"{C.Y}[WARN]{C.N} {msg}")


def err(msg: str) -> None:
    print(f"{C.R}[ERROR]{C.N} {msg}")


def header(msg: str) -> None:
    print(f"\n{C.B}{'='*60}{C.N}")
    print(f"{C.B}  {msg}{C.N}")
    print(f"{C.B}{'='*60}{C.N}")


def safe_count(cur, query: str) -> int:
    """Executa um COUNT e retorna int. Retorna -1 se erro."""
    try:
        cur.execute(query)
        result = cur.fetchone()
        if result:
            val = list(result.values())[0] if isinstance(result, dict) else result[0]
            return int(val) if val is not None else 0
        return 0
    except Exception as e:
        warn(f"Query falhou: {query[:80]}... -> {e}")
        return -1


def fetch_dict(cur, query: str) -> List[Dict[str, Any]]:
    """Executa query e retorna lista de dicts."""
    try:
        cur.execute(query)
        if cur.description:
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
        return []
    except Exception as e:
        warn(f"Query falhou: {query[:80]}... -> {e}")
        return []


def main() -> int:
    parser = argparse.ArgumentParser(description="Valida schema real do Supabase")
    parser.add_argument("--url", help="PostgreSQL connection string (postgresql://...)")
    parser.add_argument("--env", action="store_true", help="Usar variável SUPABASE_DB_URL do ambiente")
    parser.add_argument("--json", action="store_true", help="Saída em JSON")
    parser.add_argument("--strict", action="store_true", help="Exit 1 se houver warning")
    args = parser.parse_args()

    db_url = None
    if args.url:
        db_url = args.url
    elif args.env or os.environ.get("SUPABASE_DB_URL"):
        db_url = os.environ.get("SUPABASE_DB_URL")
    elif os.environ.get("DATABASE_URL"):
        db_url = os.environ.get("DATABASE_URL")

    if not db_url:
        err("DATABASE_URL não fornecido. Use --url ou defina SUPABASE_DB_URL")
        return 2

    if not args.json:
        log(f"Conectando em: {db_url[:30]}...")

    conn = None
    warnings: List[str] = []
    results: Dict[str, Any] = {}

    try:
        conn = psycopg2.connect(db_url, connect_timeout=10)
        conn.autocommit = True
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Versão
            cur.execute("SELECT version() AS v, NOW() AS ts")
            row = cur.fetchone()
            if not args.json:
                header("Conexão")
                log(f"Versão: {row['v'][:60]}")
                log(f"Horário: {row['ts']}")

            # Métricas
            header("Métricas do Schema")
            metrics = {
                "tables": safe_count(cur, "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = 'public'"),
                "views": safe_count(cur, "SELECT COUNT(*) AS n FROM information_schema.views WHERE table_schema = 'public'"),
                "routines": safe_count(cur, "SELECT COUNT(*) AS n FROM information_schema.routines WHERE routine_schema = 'public'"),
                "triggers": safe_count(cur, "SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = 'public'"),
                "indexes": safe_count(cur, "SELECT COUNT(*) AS n FROM pg_indexes WHERE schemaname = 'public'"),
                "policies": safe_count(cur, "SELECT COUNT(*) AS n FROM pg_policies WHERE schemaname = 'public'"),
                "rls_enabled": safe_count(cur, """
                    SELECT COUNT(*) AS n FROM pg_tables t
                    JOIN pg_class c ON c.relname = t.tablename
                    WHERE t.schemaname = 'public' AND c.relrowsecurity = true
                """),
                "foreign_keys": safe_count(cur, """
                    SELECT COUNT(*) AS n FROM information_schema.table_constraints
                    WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY'
                """),
                "unique_constraints": safe_count(cur, """
                    SELECT COUNT(*) AS n FROM information_schema.table_constraints
                    WHERE constraint_schema = 'public' AND constraint_type = 'UNIQUE'
                """),
                "check_constraints": safe_count(cur, """
                    SELECT COUNT(*) AS n FROM information_schema.check_constraints
                    WHERE constraint_schema = 'public'
                """),
            }
            results["metrics"] = metrics

            if not args.json:
                for k, v in metrics.items():
                    status = f"{C.G}OK{C.N}" if v >= 0 else f"{C.R}FAIL{C.N}"
                    print(f"  {k:20}: {v:6}  {status}")

            # Tabelas esperadas
            header("Tabelas Esperadas (14 módulos do sistema)")
            expected_tables = {
                # Auth/User management
                "user_profiles", "companies", "roles", "permissions",
                # Pacientes e profissionais
                "patients", "professionals", "professional_specialties",
                # Agendamentos
                "appointments", "appointment_types", "appointment_statuses",
                # Prontuário
                "medical_records", "medical_record_attachments",
                "prescriptions", "exams", "exam_results",
                # Convênios e financeiro
                "insurance_companies", "insurance_plans", "professional_insurances",
                "price_tables", "payment_sources", "billings", "payments",
                # LGPD
                "lgpd_consents", "lgpd_data_requests", "data_subject_requests",
                # Auditoria
                "audit_logs", "audit_log_retention",
                # Notificações
                "notifications", "notification_templates", "notification_preferences",
                # DICOM
                "dicom_exams", "dicom_equipment", "dicom_worklist", "dicom_exam_images",
                # TISS
                "tiss_batches", "tiss_guides", "tiss_procedures",
                # Pre-cadastro
                "pre_cadastros", "pre_cadastro_history", "pre_cadastro_documents",
                # Segurança
                "password_resets", "security_events", "rate_limit_log",
            }

            existing = fetch_dict(cur, """
                SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
            """)
            existing_names = {r["tablename"] for r in existing}
            results["existing_tables"] = sorted(existing_names)
            results["expected_tables"] = sorted(expected_tables)
            results["missing_tables"] = sorted(expected_tables - existing_names)
            results["extra_tables"] = sorted(existing_names - expected_tables)

            if not args.json:
                log(f"Tabelas existentes: {len(existing_names)}")
                log(f"Esperadas: {len(expected_tables)}")
                if results["missing_tables"]:
                    warn(f"Faltando: {', '.join(results['missing_tables'])}")
                else:
                    log(f"{C.G}Todas as tabelas esperadas existem!{C.N}")
                if results["extra_tables"]:
                    log(f"Extras (não estavam na lista): {', '.join(results['extra_tables'])}")

            # Funções RPC esperadas
            header("Funções RPC Esperadas")
            expected_functions = {
                "purge_expired_audit_logs", "purge_expired_notifications",
                "audit_trigger", "set_updated_at", "update_updated_at_column",
                "hash_password", "verify_password",
                "create_pre_cadastro", "approve_pre_cadastro", "reject_pre_cadastro",
                "send_notification", "process_notification_queue",
            }

            funcs = fetch_dict(cur, """
                SELECT routine_name FROM information_schema.routines
                WHERE routine_schema = 'public' ORDER BY routine_name
            """)
            func_names = {f["routine_name"] for f in funcs}
            missing_funcs = expected_functions - func_names
            results["existing_functions"] = sorted(func_names)
            results["missing_functions"] = sorted(missing_funcs)

            if not args.json:
                log(f"Funções existentes: {len(func_names)}")
                if missing_funcs:
                    warn(f"Funções esperadas faltando: {', '.join(missing_funcs)}")
                else:
                    log(f"{C.G}Todas as funções esperadas existem!{C.N}")

            # Extensões
            header("Extensões PostgreSQL")
            extensions = fetch_dict(cur, "SELECT extname, extversion FROM pg_extension ORDER BY extname")
            results["extensions"] = extensions
            if not args.json:
                for e in extensions:
                    print(f"  {e['extname']:25} v{e['extversion']}")

            # RLS check
            header("Row Level Security (RLS)")
            rls = fetch_dict(cur, """
                SELECT tablename, rowsecurity AS rls_enabled
                FROM pg_tables t
                JOIN pg_class c ON c.relname = t.tablename
                WHERE t.schemaname = 'public'
                ORDER BY tablename
            """)
            results["rls_status"] = rls
            if not args.json:
                rls_count = sum(1 for r in rls if r["rls_enabled"])
                no_rls = [r["tablename"] for r in rls if not r["rls_enabled"]]
                log(f"Tabelas com RLS: {rls_count}/{len(rls)}")
                if no_rls:
                    warnings.append(f"{len(no_rls)} tabela(s) SEM RLS: {', '.join(no_rls[:5])}")
                    warn(f"Tabelas SEM RLS: {', '.join(no_rls[:10])}")
                else:
                    log(f"{C.G}100% das tabelas com RLS habilitado!{C.N}")

            # Health check
            header("Health Check")
            cur.execute("""
                SELECT
                    (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active') AS active_connections,
                    (SELECT pg_database_size(current_database())) AS db_size_bytes,
                    (SELECT setting FROM pg_settings WHERE name = 'server_version') AS pg_version
            """)
            health = cur.fetchone()
            results["health"] = dict(health) if health else {}
            if not args.json:
                log(f"Conexões ativas: {health['active_connections']}")
                log(f"Tamanho do banco: {int(health['db_size_bytes']) / 1024 / 1024:.2f} MB")
                log(f"PostgreSQL: {health['pg_version']}")

    except psycopg2.OperationalError as e:
        err(f"Falha de conexão: {e}")
        return 3
    except Exception as e:
        err(f"Erro inesperado: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        if conn:
            conn.close()

    # Output
    if args.json:
        import json
        print(json.dumps(results, indent=2, default=str))

    # Veredicto
    header("Veredicto")
    critical = []
    if metrics.get("tables", 0) < 30:
        critical.append(f"Poucas tabelas: {metrics.get('tables')} (esperado >= 30)")
    if results.get("missing_tables"):
        critical.append(f"Tabelas faltando: {len(results['missing_tables'])}")
    if metrics.get("rls_enabled", 0) < metrics.get("tables", 1):
        warnings.append(f"RLS não está em 100% das tabelas")

    if not args.json:
        if critical:
            err("FALHA CRÍTICA: " + "; ".join(critical))
            return 1
        elif warnings and args.strict:
            warn("Avisos: " + "; ".join(warnings))
            return 1
        else:
            log(f"{C.G}Schema validado com sucesso!{C.N}")
            if warnings:
                warn("Avisos: " + "; ".join(warnings))
            return 0

    return 1 if critical else 0


if __name__ == "__main__":
    sys.exit(main())
