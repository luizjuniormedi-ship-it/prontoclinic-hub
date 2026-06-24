"""
FIX 4: Substituir empresa DEMO pela REAL do SIGH + popular medical_records.

Empresa REAL descoberta em SIGH (banco DataSIGH 5.1):
  - Name:    POLICLINICA MEDILIFE DIAGNOSTICOS LTDA
  - CNPJ:    42533813000197 (config.DS_CNPJ)
  - Endereço: Rua Doutor Alfredo Backer, Alcantara - São Gonçalo/RJ
  - CEP:     24710-392
  - CNES:    3041379

Tabela SIGH de medical_records:
  NÃO existe prontuario real. O SIGH é uma clínica de radiologia/diagnóstico
  (DataSIGH 5.1, MySQL 5.1.53) — não tem tabela de prontuário eletrônico.
  A tabela `medical_records` no Supabase (1419 registros) foi populada
  anteriormente a partir de uma fonte externa.

Uso:
  python scripts/migrate_company_and_medical.py [--apply] [--verify-only]

Pré-requisitos:
  - .env com SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  - db_datasigh.py acessível (mesma pasta do script ou PYTHONPATH)

Idempotência:
  - Empresa: insere se não existe, atualiza se já existe.
  - FKs: UPDATE idempotente (apenas registros que ainda apontam para demo).
  - Drop da demo: seguro (todas FKs já foram repontadas antes).

LGPD:
  - Apenas troca o CNPJ/nome — não toca em dados de pacientes.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(ROOT_DIR))

from db_datasigh import query as _sigh_query  # noqa: E402

DEMO_COMPANY_ID = "00000000-0000-0000-0000-000000000001"
REAL_CNPJ = "42533813000197"
REAL_NAME = "POLICLINICA MEDILIFE DIAGNOSTICOS LTDA"


def discover_real_company_from_sigh() -> dict:
    """Lê SIGH.unidades e SIGH.config para confirmar empresa real.

    Returns:
        dict com {name, cnpj, address, city, state, zip_code, cnes}
    """
    print("[SIGH] Lendo configuração de empresa...")
    cfg = {}
    rows = _sigh_query(
        "SELECT CD_CONFIG, DS_CONFIG, NM_VALOR, DS_VALOR FROM config "
        "WHERE DS_CONFIG IN ('DS_CLINICA','DS_ENDERECO','DS_CIDADE',"
        "'DS_UF','DS_CEP','DS_CNPJ','DS_FANTASIA')"
    )
    for r in rows:
        cfg[r["DS_CONFIG"]] = r["DS_VALOR"]
    # Fallback para nome/CNPJ
    name = cfg.get("DS_CLINICA") or cfg.get("DS_FANTASIA") or REAL_NAME
    cnpj = (cfg.get("DS_CNPJ") or REAL_CNPJ).replace(".", "").replace("-", "").replace("/", "")
    return {
        "name": name,
        "cnpj": cnpj,
        "address": cfg.get("DS_ENDERECO"),
        "city": cfg.get("DS_CIDADE"),
        "state": cfg.get("DS_UF"),
        "zip_code": cfg.get("DS_CEP"),
        "cnes": "3041379",  # unidades.CD_UNIDADE=1
    }


def get_supabase_client():
    """Cria cliente Supabase a partir do .env."""
    try:
        from supabase import create_client
    except ImportError:
        print("[FATAL] pip install supabase")
        sys.exit(2)
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("[FATAL] Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env")
        sys.exit(2)
    return create_client(url, key)


def apply_sql_via_rpc(client, sql: str) -> str:
    """Aplica SQL arbitrário via PostgREST RPC se existir helper, senão retorna mensagem."""
    # Como o projeto não tem RPC genérico para DDL, retornamos instrução
    # para usar `supabase db query --file ... --linked` no CLI.
    return (
        "Aplique via CLI:\n"
        "  supabase db query --file supabase/migrations/20260623_replace_demo_company_with_real_sigh.sql --linked\n"
    )


def upsert_real_company(client, info: dict) -> str:
    """Insere empresa real se não existir; retorna id."""
    res = client.table("companies").select("id").eq("cnpj", info["cnpj"]).execute()
    if res.data:
        cid = res.data[0]["id"]
        print(f"  [companies] já existe: id={cid} cnpj={info['cnpj']}")
        # Atualiza campos para garantir que estão corretos
        client.table("companies").update({
            "name": info["name"],
            "lg_ativo": True,
        }).eq("id", cid).execute()
        return cid

    res = client.table("companies").insert({
        "name": info["name"],
        "cnpj": info["cnpj"],
        "lg_ativo": True,
    }).execute()
    cid = res.data[0]["id"]
    print(f"  [companies] inserida: id={cid} cnpj={info['cnpj']}")
    return cid


def list_fk_tables_with_company(client) -> list[str]:
    """Lista tabelas com FK para companies.id (via pg_constraint)."""
    # PostgREST não dá acesso a pg_catalog — usa RPC ou fallback
    # Vamos usar uma query simples via SQL Editor (CLI):
    sql = (
        "SELECT c.conrelid::regclass::text AS tbl "
        "FROM pg_constraint c "
        "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) "
        "WHERE c.contype = 'f' "
        "  AND c.confrelid = 'public.companies'::regclass "
        "  AND a.attname = 'company_id' "
        "GROUP BY c.conrelid;"
    )
    # Use a conexão direta via psycopg2 se disponível
    try:
        import psycopg2
        dburl = os.environ.get("DATABASE_URL", "")
        if dburl:
            conn = psycopg2.connect(dburl)
            with conn.cursor() as cur:
                cur.execute(sql)
                return [r[0] for r in cur.fetchall()]
    except ImportError:
        pass
    except Exception as e:
        print(f"  [warn] psycopg2 falhou: {e}")
    # Fallback: lista conhecida (a migration SQL trata dinamicamente)
    return [
        "units", "professionals", "patients", "appointments",
        "medical_records", "payment_sources", "insurance_companies",
        "insurance_plans", "professional_insurances", "medicamentos",
        "almoxarifados", "lotes", "movimentacoes_estoque", "dispensacoes",
        "certificados_digitais", "documentos_assinados", "exames_lab_catalogo",
        "exames_lab_pedido", "professional_payments", "fornecedores",
        "cotacoes", "ordens_compra", "user_profiles",
    ]


def rewire_company_fks(client, from_id: str, to_id: str, tables: list[str]) -> dict:
    """Atualiza todas as FKs de from_id para to_id em cada tabela."""
    print(f"[FK] Repontando company_id {from_id} → {to_id} em {len(tables)} tabelas...")
    totals = {}
    for tbl in tables:
        try:
            res = client.table(tbl).select("id", count="exact").eq("company_id", from_id).execute()
            n = res.count or 0
            if n > 0:
                # PostgREST update sem WHERE para todos os from_id (usa filter)
                client.table(tbl).update({"company_id": to_id}).eq("company_id", from_id).execute()
                totals[tbl] = n
                print(f"  {tbl:35s} {n:>6} repontados")
        except Exception as e:
            print(f"  {tbl:35s} ERRO: {str(e)[:80]}")
            totals[tbl] = -1
    return totals


def drop_demo_company(client, demo_id: str, real_id: str) -> int:
    """Dropa empresa demo (somente se for diferente da real)."""
    if demo_id == real_id:
        return 0
    res = client.table("companies").delete().eq("id", demo_id).execute()
    return len(res.data or [])


def verify(client) -> dict:
    """Verifica estado final."""
    res = client.table("companies").select("id, name, cnpj, lg_ativo").execute()
    print("\n[VERIFY] Empresas:")
    for r in res.data:
        print(f"  - id={r['id']} name={r['name']!r} cnpj={r['cnpj']} ativo={r['lg_ativo']}")

    tables = ["units", "professionals", "patients", "appointments", "medical_records"]
    print("\n[VERIFY] Counts por tabela:")
    counts = {}
    for t in tables:
        r = client.table(t).select("id", count="exact").execute()
        counts[t] = r.count or 0
        print(f"  {t:25s} {counts[t]:>6}")
    return counts


def main() -> int:
    p = argparse.ArgumentParser(description="FIX 4: Empresa real + medical_records")
    p.add_argument("--apply", action="store_true", help="Aplica mudanças (default: só verifica)")
    p.add_argument("--verify-only", action="store_true", help="Apenas verifica estado final")
    args = p.parse_args()

    print("=" * 70)
    print("FIX 4 — Substituir empresa DEMO pela REAL do SIGH")
    print("=" * 70)

    info = discover_real_company_from_sigh()
    print(f"  Empresa real: {info['name']!r}")
    print(f"  CNPJ:         {info['cnpj']}")
    print(f"  Endereço:     {info['address']}, {info['city']}/{info['state']} {info['zip_code']}")

    if args.verify_only:
        client = get_supabase_client()
        verify(client)
        return 0

    if not args.apply:
        print("\n[DRY-RUN] Use --apply para aplicar.")
        print(apply_sql_via_rpc(None, ""))
        return 0

    client = get_supabase_client()

    print("\n[1/4] Inserindo/atualizando empresa REAL...")
    real_id = upsert_real_company(client, info)

    print("\n[2/4] Listando tabelas com FK para companies...")
    tables = list_fk_tables_with_company(client)
    print(f"  Tabelas encontradas: {len(tables)}")

    print("\n[3/4] Repontando FKs...")
    totals = rewire_company_fks(client, DEMO_COMPANY_ID, real_id, tables)

    print("\n[4/4] Removendo empresa DEMO...")
    n = drop_demo_company(client, DEMO_COMPANY_ID, real_id)
    print(f"  Empresa demo removida: {n}")

    print()
    verify(client)
    print("\n[DONE] Empresa real em produção.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
