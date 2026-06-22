"""
validate-sigh-mapping.py
Valida SIGH (origem da migração) e mapeamento de campos.

Pré-requisitos:
  - db_datasigh.py disponível em C:\\Users\\Meu Computador\\
  - Acesso ao MySQL 5.1 em 6083041e1bde.sn.mynetname.net:47777

Uso:
  python scripts/validate-sigh-mapping.py
  python scripts/validate-sigh-mapping.py --json
"""
import sys
import os
import json
import argparse
from datetime import datetime
from typing import Any, Dict, List

# Adicionar path do helper
sys.path.insert(0, r"C:\Users\Meu Computador")

try:
    from db_datasigh import query
except ImportError as e:
    print(f"ERRO: db_datasigh.py não encontrado. {e}", file=sys.stderr)
    print("       Esperado em: C:\\Users\\Meu Computador\\db_datasigh.py", file=sys.stderr)
    sys.exit(2)


# Cores
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


def safe_get(rows: List[Dict], key: str, default: Any = 0) -> Any:
    """Extrai valor de uma chave do primeiro row."""
    if rows and key in rows[0]:
        val = rows[0][key]
        return val if val is not None else default
    return default


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Saída em JSON")
    args = parser.parse_args()

    results: Dict[str, Any] = {
        "timestamp": datetime.now().isoformat(),
        "source": "SIGH MySQL 5.1 (6083041e1bde.sn.mynetname.net:47777)",
        "database": "DataSIGH",
    }
    warnings: List[str] = []

    try:
        if not args.json:
            log(f"Conectando em SIGH ({results['source']})...")

        # =========================================================================
        # Tabelas e contagens
        # =========================================================================
        header("Contagens de registros (SIGH)")

        counts = {}

        queries = [
            ("pacientes_total", "SELECT COUNT(*) AS n FROM pacientes", "Total de pacientes"),
            ("profissionais_total", "SELECT COUNT(*) AS n FROM medicor", "Profissionais (medicor)"),
            ("convenios_ativos", "SELECT COUNT(*) AS n FROM convenios WHERE LG_ATIVO = 1", "Convênios ativos"),
            ("agendamentos_total", "SELECT COUNT(*) AS n FROM agenda", "Agendamentos (total)"),
            ("agendamentos_futuros", "SELECT COUNT(*) AS n FROM agenda WHERE DT_AGENDA >= CURDATE()", "Agendamentos futuros"),
            ("laudos_total", "SELECT COUNT(*) AS n FROM laudos", "Laudos (total)"),
            ("laudos_recentes", "SELECT COUNT(*) AS n FROM laudos WHERE DT_LAUDO >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)", "Laudos (último ano)"),
            ("usuarios_total", "SELECT COUNT(*) AS n FROM usuarios WHERE LG_ATIVO = 1", "Usuários ativos"),
        ]

        for key, sql, label in queries:
            try:
                rows = query(sql)
                val = safe_get(rows, "n")
                counts[key] = int(val) if val else 0
                if not args.json:
                    print(f"  {label:35}: {counts[key]:>10,}")
            except Exception as e:
                counts[key] = -1
                warn(f"  {label}: ERRO -> {e}")
                warnings.append(f"Falha ao contar {key}: {e}")

        results["counts"] = counts

        # =========================================================================
        # Validação de qualidade dos dados
        # =========================================================================
        header("Qualidade dos dados de pacientes")

        try:
            rows = query("""
                SELECT
                    COUNT(*) AS total,
                    SUM(IF(DS_CPF IS NULL OR DS_CPF = '', 1, 0)) AS sem_cpf,
                    SUM(IF(DS_EMAIL IS NULL OR DS_EMAIL = '', 1, 0)) AS sem_email,
                    SUM(IF(DT_OBITO IS NOT NULL AND DT_OBITO != 0, 1, 0)) AS obituario,
                    SUM(IF(CD_PESSOA IS NULL, 1, 0)) AS sem_codigo,
                    SUM(IF(DS_NOME IS NULL OR DS_NOME = '', 1, 0)) AS sem_nome
                FROM pacientes
            """)
            quality = rows[0] if rows else {}
            results["patient_quality"] = {k: int(v or 0) for k, v in quality.items()}

            if not args.json:
                total = int(quality.get("total", 0))
                for k, v in quality.items():
                    if k == "total":
                        continue
                    pct = (int(v) / total * 100) if total > 0 else 0
                    print(f"  {k:15}: {int(v):>8,} ({pct:5.2f}%)")
                    if pct > 50 and k in ("sem_cpf", "sem_nome"):
                        warnings.append(f"Alta taxa de {k}: {pct:.1f}%")
        except Exception as e:
            warn(f"Validação de qualidade falhou: {e}")
            warnings.append(f"Validação de qualidade: {e}")

        # =========================================================================
        # Mapeamento de campos - SIGH -> ProntoClinic
        # =========================================================================
        header("Mapeamento de campos SIGH -> ProntoClinic")

        # Tabela: pacientes (SIGH) -> patients (ProntoClinic)
        field_map = [
            # (SIGH, ProntoClinic, tipo, observacao)
            ("CD_PESSOA", "legacy_id", "INTEGER", "ID original no SIGH"),
            ("DS_NOME", "full_name", "VARCHAR", "Nome completo"),
            ("DS_CPF", "cpf", "VARCHAR(11)", "CPF sem pontuação"),
            ("DS_RG", "rg", "VARCHAR(20)", "RG"),
            ("DT_NASCIMENTO", "birth_date", "DATE", "Data nascimento"),
            ("DS_EMAIL", "email", "VARCHAR", "Email"),
            ("DS_TELEFONE", "phone", "VARCHAR(15)", "Telefone"),
            ("DS_CELULAR", "mobile", "VARCHAR(15)", "Celular"),
            ("DS_ENDERECO", "address_street", "VARCHAR", "Logradouro"),
            ("DS_NUMERO", "address_number", "VARCHAR(20)", "Número"),
            ("DS_BAIRRO", "address_neighborhood", "VARCHAR", "Bairro"),
            ("DS_CIDADE", "address_city", "VARCHAR", "Cidade"),
            ("DS_UF", "address_state", "CHAR(2)", "UF"),
            ("DS_CEP", "address_zipcode", "VARCHAR(8)", "CEP"),
        ]

        # Verificar quais colunas existem em SIGH
        try:
            cols = query("""
                SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = 'DataSIGH' AND TABLE_NAME = 'pacientes'
            """)
            existing_cols = {r["COLUMN_NAME"].upper(): r for r in cols}
            results["sigh_pacientes_columns"] = len(existing_cols)
        except Exception as e:
            existing_cols = {}
            warn(f"Não foi possível ler colunas de pacientes: {e}")

        if not args.json:
            print(f"  Colunas em SIGH.pacientes: {len(existing_cols)}")
            print()
            for sigh_field, target, tipo, obs in field_map:
                exists = "OK" if sigh_field in existing_cols else "FALTA"
                color = C.G if exists == "OK" else C.R
                print(f"  [{color}{exists}{C.N}] {sigh_field:18} -> {target:25} ({tipo})  {obs}")

        missing_mappings = [m[0] for m in field_map if m[0] not in existing_cols]
        if missing_mappings:
            warnings.append(f"Colunas SIGH não encontradas: {', '.join(missing_mappings)}")

        # =========================================================================
        # Validação de agendamentos
        # =========================================================================
        header("Amostra de agendamentos (últimos 5)")

        try:
            samples = query("""
                SELECT
                    a.CD_AGENDA, a.DT_AGENDA, a.HR_AGENDA,
                    a.CD_PESSOA, a.CD_PROFISSIONAL, a.SN_CONFIRMADO
                FROM agenda a
                ORDER BY a.DT_AGENDA DESC
                LIMIT 5
            """)
            results["agenda_samples"] = samples
            if not args.json:
                for s in samples:
                    print(f"  CD_AGENDA={s.get('CD_AGENDA')} | {s.get('DT_AGENDA')} {s.get('HR_AGENDA')} | "
                          f"Pac={s.get('CD_PESSOA')} Prof={s.get('CD_PROFISSIONAL')} | Conf={s.get('SN_CONFIRMADO')}")
        except Exception as e:
            warn(f"Não foi possível ler amostras: {e}")

        # =========================================================================
        # Relatório final
        # =========================================================================
        header("Veredicto")

        results["warnings"] = warnings

        if args.json:
            print(json.dumps(results, indent=2, default=str))

        # Veredito
        critical_errors = []
        if counts.get("pacientes_total", 0) <= 0:
            critical_errors.append("Não foi possível contar pacientes")
        if missing_mappings and len(missing_mappings) > 3:
            critical_errors.append(f"Muitas colunas faltando: {len(missing_mappings)}")

        if not args.json:
            if critical_errors:
                err("FALHA: " + "; ".join(critical_errors))
                return 1
            else:
                log(f"{C.G}SIGH validado! Pronto para migração.{C.N}")
                if warnings:
                    print()
                    warn("Avisos:")
                    for w in warnings:
                        print(f"  - {w}")
                return 0

        return 1 if critical_errors else 0

    except Exception as e:
        err(f"Erro geral: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
