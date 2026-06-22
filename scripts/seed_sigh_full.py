"""
Carga COMPLETA opcional do SIGH — para quem quer migrar TUDO.

Inclui:
- 962 convênios (em vez de top 30)
- 48.173 credenciamentos (medicor_convenios)
- 3.673 regras de preço (99pgm_medicor)
- 4.838 procedimentos SIGTAP (sigtap_procedimentos)
- 10 categorias CBHPM (categorias_cbhpm)
- 144 profissionais com credenciamentos
- Logs adicionais

Uso:
  python scripts/seed_sigh_full.py [--batch-size=200] [--dry-run]

ATENÇÃO:
  - Volume ~4x maior que migrate_sigh.py padrão
  - Duração estimada: 8-16 horas
  - Requer ao menos 8 GB de RAM no cliente
  - Rode em janela de manutenção
"""
from __future__ import annotations

import sys
import time
import logging
from datetime import datetime, date
from pathlib import Path
from typing import Optional

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(ROOT_DIR))

try:
    from db_datasigh import query as _sigh_query
    from migrate_sigh import (
        MigrationConfig, MigrationStats, connect_supabase,
        normalize_cnpj, normalize_cpf, normalize_phone, int_to_date,
        hash_cpf, mask_pii, supabase_insert, fetch_sigh_batches,
        load_state, save_state, _load_origem_map, _map_role,
        setup_logger, validate_totals,
    )
except ImportError as e:
    print(f"[FATAL] dependência ausente: {e}", file=sys.stderr)
    sys.exit(2)

log = setup_logger("seed_sigh_full")


# ============================================================================
# 1. TODOS os 962 convênios
# ============================================================================
def seed_all_insurance_companies(client, cfg: MigrationConfig) -> MigrationStats:
    stats = MigrationStats(entity="all_insurance_companies")
    stats.started_at = datetime.now()
    log.info("[FULL-1] Importando TODOS os 962 convênios")
    state = load_state()
    company_id = (state.get("companies") or {}).get("_company_id")
    rows = _sigh_query(
        "SELECT CD_CONVENIO, NM_CONVENIO, REGISTRO_ANS, CNPJ, RAZAO_SOCIAL, "
        "ENDERECO, BAIRRO, CIDADE, UF, CEP, CONTATO, TELEFONE1, TELEFONE2, "
        "TELEFONE3, LOGIN_PRESTADOR, CODIGO_PRESTADOR, PERCENTUAL_DESCONTO, "
        "TABELA_MAT, TABELA_MED, LG_ATIVO, LG_GUIA_OBRIGATORIA, "
        "LG_CID_OBRIGATORIO, OBSERVACAO "
        "FROM convenios WHERE LG_ATIVO = 1 ORDER BY CD_CONVENIO",
        limite=2000,
    )
    stats.total_source = len(rows)
    log.info(f"  {stats.total_source} convênios")
    batch: list[dict] = []
    for r in rows:
        batch.append({
            "company_id": company_id,
            "name": r.get("NM_CONVENIO"),
            "registro_ans": r.get("REGISTRO_ANS"),
            "cnpj": normalize_cnpj(r.get("CNPJ")),
            "razao_social": r.get("RAZAO_SOCIAL"),
            "endereco": r.get("ENDERECO"),
            "bairro": r.get("BAIRRO"),
            "cidade": r.get("CIDADE"),
            "uf": r.get("UF"),
            "cep": r.get("CEP"),
            "contato": r.get("CONTATO"),
            "telefone1": r.get("TELEFONE1"),
            "telefone2": r.get("TELEFONE2"),
            "telefone3": r.get("TELEFONE3"),
            "login_prestador": r.get("LOGIN_PRESTADOR"),
            "codigo_prestador": str(r.get("CODIGO_PRESTADOR") or "1"),
            "percentual_desconto": r.get("PERCENTUAL_DESCONTO") or 0,
            "tabela_mat": r.get("TABELA_MAT"),
            "tabela_med": r.get("TABELA_MED"),
            "lg_ativo": True,
            "lg_guia_obrigatoria": bool(r.get("LG_GUIA_OBRIGATORIA", 1)),
            "lg_cid_obrigatorio": bool(r.get("LG_CID_OBRIGATORIO", 1)),
            "observacao": r.get("OBSERVACAO"),
            "cd_origem_sigh": r.get("CD_CONVENIO"),
        })
        if len(batch) >= cfg.batch_size:
            supabase_insert(client, "insurance_companies", batch, cfg, stats,
                            on_conflict="cd_origem_sigh,company_id")
            batch = []
    if batch:
        supabase_insert(client, "insurance_companies", batch, cfg, stats,
                        on_conflict="cd_origem_sigh,company_id")
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# 2. Credenciamentos profissional x convênio (48.173)
# ============================================================================
def seed_professional_accreditations(client, cfg: MigrationConfig) -> MigrationStats:
    stats = MigrationStats(entity="professional_accreditations")
    stats.started_at = datetime.now()
    log.info("[FULL-2] Credenciamentos profissional x convênio (48k)")
    state = load_state()
    company_id = (state.get("companies") or {}).get("_company_id")
    prof_map = _load_origem_map(client, "professionals", "cd_origem_sigh") if client else {}
    conv_map = _load_origem_map(client, "insurance_companies", "cd_origem_sigh") if client else {}
    cnt = _sigh_query("SELECT COUNT(*) AS n FROM medicor_convenios WHERE LG_ATIVO = 1", limite=1)
    stats.total_source = cnt[0]["n"] if cnt else 0
    log.info(f"  total: {stats.total_source}")
    for batch_rows in fetch_sigh_batches(
        base_sql=(
            "SELECT CD_MEDICO, CD_CONVENIO, CD_PLANO, NR_CONTRATO, "
            "DT_INICIO, DT_FIM, VL_CONSULTA, LG_ATIVO "
            "FROM medicor_convenios WHERE LG_ATIVO = 1 ORDER BY CD_MEDICO"
        ),
        params=(),
        batch_size=cfg.batch_size,
        offset_start=cfg.offset,
        limit_total=cfg.limit,
    ):
        batch: list[dict] = []
        for r in batch_rows:
            prof_id = prof_map.get(r.get("CD_MEDICO"))
            conv_id = conv_map.get(r.get("CD_CONVENIO"))
            if not prof_id or not conv_id:
                stats.skipped += 1
                continue
            batch.append({
                "company_id": company_id,
                "professional_id": prof_id,
                "insurance_company_id": conv_id,
                "contract_number": r.get("NR_CONTRATO"),
                "dt_inicio": int_to_date(r.get("DT_INICIO")),
                "dt_fim": int_to_date(r.get("DT_FIM")),
                "vl_consulta": r.get("VL_CONSULTA") or 0,
                "active": bool(r.get("LG_ATIVO", 1)),
            })
        supabase_insert(client, "professional_accreditations", batch, cfg, stats)
        stats.processed += len(batch_rows)
        if stats.processed % 5000 == 0:
            log.info(f"  Credenciamentos: {stats.processed}/{stats.total_source}")
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# 3. Regras de preço (3.673)
# ============================================================================
def seed_price_rules(client, cfg: MigrationConfig) -> MigrationStats:
    stats = MigrationStats(entity="price_tables_full")
    stats.started_at = datetime.now()
    log.info("[FULL-3] Regras de preço 99pgm_medicor (3.673)")
    state = load_state()
    company_id = (state.get("companies") or {}).get("_company_id")
    plan_map = _load_origem_map(client, "insurance_plans", "cd_origem_sigh") if client else {}
    cnt = _sigh_query("SELECT COUNT(*) AS n FROM 99pgm_medicor", limite=1)
    stats.total_source = cnt[0]["n"] if cnt else 0
    log.info(f"  total: {stats.total_source}")
    for batch_rows in fetch_sigh_batches(
        base_sql=(
            "SELECT SOMA, CD_SERVICO, CD_CONVENIO, CD_PLANO, "
            "VL_PARTICULAR, VL_CONVENIO, VL_MATERIAL, VL_MEDICAMENTO, "
            "VL_TAXA, VL_DIARIA, VL_GASES, TP_CALCULO, PERCENTUAL, "
            "DT_INICIO, DT_FIM "
            "FROM `99pgm_medicor` ORDER BY SOMA"
        ),
        params=(),
        batch_size=cfg.batch_size,
        offset_start=cfg.offset,
        limit_total=cfg.limit,
    ):
        batch: list[dict] = []
        for r in batch_rows:
            batch.append({
                "company_id": company_id,
                "service_id": r.get("CD_SERVICO"),
                "insurance_plan_id": plan_map.get(r.get("CD_PLANO")),
                "dt_inicio": int_to_date(r.get("DT_INICIO")) or date.today().isoformat(),
                "dt_fim": int_to_date(r.get("DT_FIM")),
                "vl_particular": r.get("VL_PARTICULAR") or 0,
                "vl_convenio": r.get("VL_CONVENIO") or 0,
                "vl_material": r.get("VL_MATERIAL") or 0,
                "vl_medicamento": r.get("VL_MEDICAMENTO") or 0,
                "vl_taxa": r.get("VL_TAXA") or 0,
                "vl_diaria": r.get("VL_DIARIA") or 0,
                "vl_gases": r.get("VL_GASES") or 0,
                "tp_calculo": (r.get("TP_CALCULO") or "FIXO"),
                "percentual_acrescimo": r.get("PERCENTUAL") or 0,
                "cd_origem_sigh": r.get("SOMA"),
                "active": True,
            })
        supabase_insert(client, "price_tables", batch, cfg, stats,
                        on_conflict="cd_origem_sigh,company_id")
        stats.processed += len(batch_rows)
        if stats.processed % 1000 == 0:
            log.info(f"  Regras: {stats.processed}/{stats.total_source}")
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# 4. Procedimentos SIGTAP (4.838)
# ============================================================================
def seed_sigtap_procedures(client, cfg: MigrationConfig) -> MigrationStats:
    stats = MigrationStats(entity="sigtap_procedures")
    stats.started_at = datetime.now()
    log.info("[FULL-4] Procedimentos SIGTAP (4.838)")
    company_id = (load_state().get("companies") or {}).get("_company_id")
    rows = _sigh_query(
        "SELECT CO_PROCEDIMENTO, NO_PROCEDIMENTO, DT_COMPETENCIA, VL_SA, "
        "VL_SH, VL_SP, TP_COMPLEXIDADE FROM sigtap_procedimentos "
        "ORDER BY CO_PROCEDIMENTO",
        limite=5000,
    )
    stats.total_source = len(rows)
    log.info(f"  total: {stats.total_source}")
    batch: list[dict] = []
    for r in rows:
        batch.append({
            "company_id": company_id,
            "code": r.get("CO_PROCEDIMENTO"),
            "name": r.get("NO_PROCEDIMENTO"),
            "competence_date": r.get("DT_COMPETENCIA"),
            "vl_sa": r.get("VL_SA") or 0,
            "vl_sh": r.get("VL_SH") or 0,
            "vl_sp": r.get("VL_SP") or 0,
            "complexity": r.get("TP_COMPLEXIDADE"),
        })
        if len(batch) >= cfg.batch_size:
            supabase_insert(client, "sigtap_procedures", batch, cfg, stats,
                            on_conflict="code,company_id")
            batch = []
    if batch:
        supabase_insert(client, "sigtap_procedures", batch, cfg, stats,
                        on_conflict="code,company_id")
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# 5. Categorias CBHPM (10 oficiais)
# ============================================================================
def seed_cbhpm_categories(client, cfg: MigrationConfig) -> MigrationStats:
    stats = MigrationStats(entity="cbhpm_categories")
    stats.started_at = datetime.now()
    log.info("[FULL-5] Categorias CBHPM (10 oficiais)")
    company_id = (load_state().get("companies") or {}).get("_company_id")
    rows = _sigh_query(
        "SELECT CD_CATEGORIA, CODIGO, NM_CATEGORIA, TP_CATEGORIA "
        "FROM categorias_cbhpm ORDER BY CODIGO",
        limite=50,
    )
    stats.total_source = len(rows)
    batch: list[dict] = []
    for r in rows:
        batch.append({
            "company_id": company_id,
            "code": r.get("CODIGO"),
            "name": r.get("NM_CATEGORIA"),
            "type": r.get("TP_CATEGORIA"),
            "cd_origem_sigh": r.get("CD_CATEGORIA"),
        })
    supabase_insert(client, "cbhpm_categories", batch, cfg, stats,
                    on_conflict="cd_origem_sigh,company_id")
    stats.inserted = len(batch)
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# 6. Laudos (7.733)
# ============================================================================
def seed_laudos(client, cfg: MigrationConfig) -> MigrationStats:
    stats = MigrationStats(entity="laudos")
    stats.started_at = datetime.now()
    log.info("[FULL-6] Laudos (7.733)")
    company_id = (load_state().get("companies") or {}).get("_company_id")
    pat_map = _load_origem_map(client, "patients", "cd_origem_sigh") if client else {}
    prof_map = _load_origem_map(client, "professionals", "cd_origem_sigh") if client else {}
    cnt = _sigh_query("SELECT COUNT(*) AS n FROM laudos WHERE LG_ATIVO = 1", limite=1)
    stats.total_source = cnt[0]["n"] if cnt else 0
    for batch_rows in fetch_sigh_batches(
        base_sql=(
            "SELECT CD_LAUDO, CD_PACIENTE, CD_MEDICO, DT_LAUDO, "
            "CONTEUDO, TP_LAUDO, LG_LIBERADO "
            "FROM laudos WHERE LG_ATIVO = 1 ORDER BY CD_LAUDO"
        ),
        params=(),
        batch_size=cfg.batch_size,
        offset_start=cfg.offset,
        limit_total=cfg.limit,
    ):
        batch: list[dict] = []
        for r in batch_rows:
            batch.append({
                "company_id": company_id,
                "patient_id": pat_map.get(r.get("CD_PACIENTE")),
                "professional_id": prof_map.get(r.get("CD_MEDICO")),
                "report_date": int_to_date(r.get("DT_LAUDO")),
                "content": r.get("CONTEUDO"),
                "report_type": r.get("TP_LAUDO"),
                "released": bool(r.get("LG_LIBERADO", 0)),
                "cd_origem_sigh": r.get("CD_LAUDO"),
            })
        supabase_insert(client, "laudos", batch, cfg, stats,
                        on_conflict="cd_origem_sigh,company_id")
        stats.processed += len(batch_rows)
        if stats.processed % 1000 == 0:
            log.info(f"  Laudos: {stats.processed}/{stats.total_source}")
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# MAIN
# ============================================================================
PIPELINE_FULL: list[tuple[str, callable]] = [
    ("all_insurance_companies", seed_all_insurance_companies),
    ("professional_accreditations", seed_professional_accreditations),
    ("price_tables_full", seed_price_rules),
    ("sigtap_procedures", seed_sigtap_procedures),
    ("cbhpm_categories", seed_cbhpm_categories),
    ("laudos", seed_laudos),
]


def main() -> int:
    import argparse
    p = argparse.ArgumentParser(description="Carga completa SIGH")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--batch-size", type=int, default=200)
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--limit", type=int, default=None)
    args = p.parse_args()

    cfg = MigrationConfig(
        dry_run=args.dry_run,
        batch_size=args.batch_size,
        offset=args.offset,
        limit=args.limit,
        consent_date=datetime.now().strftime("%d/%m/%Y"),
    )
    log.info("=" * 70)
    log.info("CARGA COMPLETA SIGH (seed_sigh_full)")
    log.info(f"  batch-size = {cfg.batch_size}")
    log.info("=" * 70)
    client = connect_supabase(cfg)
    if not client and not cfg.dry_run:
        log.error("Sem cliente Supabase. Abortando.")
        return 1
    started = datetime.now()
    results: list[MigrationStats] = []
    for name, fn in PIPELINE_FULL:
        log.info("-" * 60)
        log.info(f"Iniciando: {name}")
        try:
            results.append(fn(client, cfg))
        except Exception as e:
            log.exception(f"Falha em {name}: {e}")
            results.append(MigrationStats(entity=name, errors=1,
                                          error_samples=[str(e)[:200]]))
    finished = datetime.now()
    log.info("=" * 70)
    log.info("RELATÓRIO")
    log.info("=" * 70)
    for s in results:
        log.info(f"  {s.report()}")
    log.info(f"  Duração total: {finished - started}")
    try:
        validate_totals(client, cfg)
    except Exception as e:
        log.warning(f"Validação falhou: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
