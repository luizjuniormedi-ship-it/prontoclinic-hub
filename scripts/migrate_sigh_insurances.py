"""
Migração CORRIGIDA das 4 tabelas que ficaram com 0 registros.

Tabelas alvo (em ordem de dependência):
  1. payment_sources          (sem dependências)
  2. insurance_companies      (sem dependências)
  3. insurance_plans          (depende de insurance_companies)
  4. professional_insurances  (depende de professionals + insurance_companies)

Correções aplicadas vs. migrate_sigh.py original:
  - Colunas SIGH corretas (DS_NOME, DS_FONTE_PAGADORA, NM_DIAS_PRAZO_PGTO etc.)
  - Tabela convenio_planos (não convenios_planos)
  - company_id hardcoded da empresa demo Supabase Cloud
  - Usa SUPABASE_ANON_KEY do .env.production (PostgREST com upsert)
  - Service Role bypass RLS quando precisa
  - Idempotente via cd_origem_sigh (ON CONFLICT)
"""
from __future__ import annotations
import json
import os
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
HOME_DIR = Path("C:/Users/Meu Computador")
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(ROOT_DIR))
sys.path.insert(0, str(HOME_DIR))
sys.path.insert(0, "C:\\Users\\Meu Computador")

from db_datasigh import query as sigh_query

# ----------------------------------------------------------------------------
# Carrega credenciais Supabase Cloud de .env.production
# ----------------------------------------------------------------------------
ENV_PATH = ROOT_DIR / ".env.production"
SUPABASE_URL: Optional[str] = None
SUPABASE_KEY: Optional[str] = None

if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("VITE_SUPABASE_URL="):
            SUPABASE_URL = line.split("=", 1)[1].strip()
        elif line.startswith("VITE_SUPABASE_ANON_KEY="):
            SUPABASE_KEY = line.split("=", 1)[1].strip()

# service_role key (bypass RLS)
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjZXltZ2RrdG1ob3Z6cmVlcnZoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjIzMzI2NywiZXhwIjoyMDk3ODA5MjY3fQ.Qb_D2g890PYKhBTPmbmlwoF6IoZOTwrOCkLk2FksYCA"

# company_id da empresa demo (única cadastrada)
COMPANY_ID = "00000000-0000-0000-0000-000000000001"

print(f"[INIT] Supabase URL: {SUPABASE_URL}")
print(f"[INIT] Anon key: {'SIM' if SUPABASE_KEY else 'NAO'}")
print(f"[INIT] Service key: {'SIM' if SUPABASE_SERVICE_KEY else 'NAO'}")
print(f"[INIT] Company ID: {COMPANY_ID}")
print()

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("[FATAL] credenciais Supabase ausentes")
    sys.exit(2)

from supabase import create_client
client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ============================================================================
# Helpers
# ============================================================================
DIGITS = re.compile(r"\D+")


def normalize_cnpj(v: Any) -> Optional[str]:
    if not v:
        return None
    s = DIGITS.sub("", str(v))
    return s.zfill(14) if len(s) >= 11 else None


def normalize_cep(v: Any) -> Optional[str]:
    if not v:
        return None
    s = DIGITS.sub("", str(v))
    return s.zfill(8) if s else None


def to_bool(v: Any) -> bool:
    return bool(v and int(v) != 0)


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def upsert_batch(table: str, rows: list, conflict: str = "cd_origem_sigh") -> int:
    """Upsert via PostgREST. Retorna total inseridos."""
    inserted = 0
    for batch in chunked(rows, 500):
        for attempt in range(1, 4):
            try:
                res = client.table(table).upsert(batch, on_conflict=conflict).execute()
                inserted += len(batch)
                print(f"  [OK] batch {len(batch)} gravados em {table}")
                break
            except Exception as e:
                msg = str(e)
                print(f"  [RETRY {attempt}/3] {table}: {msg[:200]}")
                if attempt == 3:
                    print(f"  [FAIL] amostra: {batch[0]}")
                    raise
                time.sleep(2 * attempt)
    return inserted


# ============================================================================
# 1) payment_sources  (53 esperados)
# ============================================================================
def migrate_payment_sources():
    print("=" * 70)
    print("[1/4] payment_sources  (53 esperados)")
    print("=" * 70)

    rows = sigh_query(
        "SELECT CD_FONTE_PAGADORA, DS_FONTE_PAGADORA, DS_ENDERECO, DS_BAIRRO, "
        "DS_CIDADE, DS_ESTADO, DS_CEP, DS_TEL1, DS_TEL2, DS_EMAIL, "
        "DS_RAZAO_SOCIAL, DS_CNPJ, DS_INSCRICAO_ESTADUAL, DS_INSCRICAO_MUNICIPAL, "
        "CD_AUX, LG_VALOR_AUTOMATICO, VL_IMPOSTO, VL_IMPOSTO2, VL_IMPOSTO3, "
        "LG_GERAR_CONTA_PACIENTE, NM_DIAS_PRAZO_PGTO, LG_ATUALIZAR_CONTA_RECEBER, "
        "LG_PERMITE_FATURA_PARCIAL, LG_EXCLUIR_FATURA_AUTOMATICA, "
        "DT_INICIO_CONTRATO, DT_FIM_CONTRATO, LG_ATIVO, NM_DIAS_CORTE "
        "FROM fonte_pagadora ORDER BY CD_FONTE_PAGADORA",
        limite=100,
    )
    print(f"  SIGH fonte_pagadora: {len(rows)}")

    out = []
    for r in rows:
        out.append({
            "company_id": COMPANY_ID,
            "cd_origem_sigh": r["CD_FONTE_PAGADORA"],
            "ds_nome": r["DS_FONTE_PAGADORA"],
            "tp_tipo": "convenio",  # SIGH não tem TP_FONTE_PAGADORA — todas são convênios
            "lg_ativo": to_bool(r["LG_ATIVO"]),
        })
    n = upsert_batch("payment_sources", out)
    print(f"  -> gravados em Supabase: {n}")
    return n


# ============================================================================
# 2) insurance_companies  (992 esperados)
# ============================================================================
def migrate_insurance_companies():
    print("=" * 70)
    print("[2/4] insurance_companies  (992 esperados)")
    print("=" * 70)

    rows = sigh_query(
        "SELECT CD_CONVENIO, DS_NOME, DS_LETRA, DS_CNPJ, DS_REGISTRO_ANS, "
        "DS_RAZAO_SOCIAL, DS_CONV_ENDERECO, DS_CONV_BAIRRO, DS_CONV_CIDADE, "
        "DS_CONV_ESTADO, DS_CONV_CEP, DS_CONV_CONTATO, DS_CONV_TELEFONE1, "
        "DS_CONV_TELEFONE2, DS_CONV_TELEFONE3, DS_TIPO, LG_ATIVO "
        "FROM convenios ORDER BY CD_CONVENIO",
        limite=2000,
    )
    print(f"  SIGH convenios: {len(rows)}")

    out = []
    for r in rows:
        out.append({
            "company_id": COMPANY_ID,
            "cd_origem_sigh": r["CD_CONVENIO"],
            "ds_nome": r["DS_NOME"],
            "ds_letra": r["DS_LETRA"],
            "ds_cnpj": r["DS_CNPJ"],
            "ds_registro_ans": r["DS_REGISTRO_ANS"],
            "ds_razao_social": r["DS_RAZAO_SOCIAL"],
            "ds_endereco": r["DS_CONV_ENDERECO"],
            "ds_bairro": r["DS_CONV_BAIRRO"],
            "ds_cidade": r["DS_CONV_CIDADE"],
            "ds_estado": r["DS_CONV_ESTADO"],
            "ds_cep": r["DS_CONV_CEP"],
            "ds_contato": r["DS_CONV_CONTATO"],
            "ds_telefone1": r["DS_CONV_TELEFONE1"],
            "ds_telefone2": r["DS_CONV_TELEFONE2"],
            "ds_telefone3": r["DS_CONV_TELEFONE3"],
            "tp_tipo": r["DS_TIPO"],
            "lg_ativo": to_bool(r["LG_ATIVO"]),
        })
    n = upsert_batch("insurance_companies", out)
    print(f"  -> gravados em Supabase: {n}")
    return n


# ============================================================================
# 3) insurance_plans  (395 esperados)
# ============================================================================
def migrate_insurance_plans():
    print("=" * 70)
    print("[3/4] insurance_plans  (395 esperados)")
    print("=" * 70)

    # Buscar mapa {CD_CONVENIO → id_supabase}
    res = client.table("insurance_companies").select("id, cd_origem_sigh").execute()
    conv_map = {r["cd_origem_sigh"]: r["id"] for r in res.data if r.get("cd_origem_sigh") is not None}
    print(f"  Mapa de convênios carregado: {len(conv_map)} entradas")

    rows = sigh_query(
        "SELECT CD_PLANO, CD_CONVENIO, DS_PLANO, DS_CODIGO "
        "FROM convenio_planos ORDER BY CD_PLANO",
        limite=500,
    )
    print(f"  SIGH convenio_planos: {len(rows)}")

    out = []
    skipped = 0
    for r in rows:
        cid = conv_map.get(r["CD_CONVENIO"])
        if cid is None:
            skipped += 1
            continue
        out.append({
            "company_id": COMPANY_ID,
            "cd_origem_sigh": r["CD_PLANO"],
            "insurance_company_id": cid,
            "ds_plano": r["DS_PLANO"],
            "ds_codigo": r["DS_CODIGO"],
            "lg_ativo": True,
        })
    if skipped:
        print(f"  [WARN] {skipped} planos sem convênio mapeado")
    n = upsert_batch("insurance_plans", out)
    print(f"  -> gravados em Supabase: {n}")
    return n


# ============================================================================
# 4) professional_insurances  (48172 esperados)
# ============================================================================
def migrate_professional_insurances():
    print("=" * 70)
    print("[4/4] professional_insurances  (48172 esperados)")
    print("=" * 70)

    # Mapa profissionais: CD_MEDICOR → id
    res = client.table("professionals").select("id, cd_origem_sigh").execute()
    prof_map = {r["cd_origem_sigh"]: r["id"] for r in res.data if r.get("cd_origem_sigh") is not None}
    print(f"  Mapa de profissionais carregado: {len(prof_map)} entradas")

    # Mapa convênios
    res = client.table("insurance_companies").select("id, cd_origem_sigh").execute()
    conv_map = {r["cd_origem_sigh"]: r["id"] for r in res.data if r.get("cd_origem_sigh") is not None}
    print(f"  Mapa de convênios carregado: {len(conv_map)} entradas")

    rows = sigh_query(
        "SELECT CD_MEDICOR, CD_CONVENIO, DS_OBS, LG_CLINICA, LG_CREDENCIADO "
        "FROM convxmedi ORDER BY CD_MEDICOR, CD_CONVENIO",
        limite=60000,
    )
    print(f"  SIGH convxmedi: {len(rows)}")

    out = []
    skipped_p = skipped_c = 0
    for r in rows:
        pid = prof_map.get(r["CD_MEDICOR"])
        cid = conv_map.get(r["CD_CONVENIO"])
        if pid is None:
            skipped_p += 1
            continue
        if cid is None:
            skipped_c += 1
            continue
        out.append({
            "company_id": COMPANY_ID,
            "professional_id": pid,
            "insurance_company_id": cid,
            "ds_observacao": r["DS_OBS"],
            "lg_clinica": to_bool(r["LG_CLINICA"]),
            "lg_credenciado": to_bool(r["LG_CREDENCIADO"]),
            # cd_origem_sigh é integer; codifica (medicor*100000 + convenio) para unicidade
            "cd_origem_sigh": int(r["CD_MEDICOR"]) * 100000 + int(r["CD_CONVENIO"]),
        })
    if skipped_p:
        print(f"  [WARN] {skipped_p} registros sem profissional mapeado")
    if skipped_c:
        print(f"  [WARN] {skipped_c} registros sem convênio mapeado")
    n = upsert_batch("professional_insurances", out, conflict="company_id,cd_origem_sigh")
    print(f"  -> gravados em Supabase: {n}")
    return n


# ============================================================================
# Main
# ============================================================================
def main():
    start = datetime.now()
    print(f"Início: {start}\n")
    results = {}
    for label, fn in [
        ("payment_sources", migrate_payment_sources),
        ("insurance_companies", migrate_insurance_companies),
        ("insurance_plans", migrate_insurance_plans),
        ("professional_insurances", migrate_professional_insurances),
    ]:
        try:
            results[label] = fn()
        except Exception as e:
            print(f"[FAIL] {label}: {e}")
            results[label] = 0
    dur = datetime.now() - start
    print("\n" + "=" * 70)
    print("RELATÓRIO FINAL")
    print("=" * 70)
    for k, v in results.items():
        print(f"  {k:30s}  {v:>6} registros")
    print(f"  Duração: {dur}")


if __name__ == "__main__":
    main()