"""
Script de migração SIGH (MySQL 5.1) → ProntoClinic Hub (Supabase/PostgreSQL).

Uso:
  python scripts/migrate_sigh.py [--dry-run] [--entity=patients] [--batch-size=100]
  python scripts/migrate_sigh.py --entity=patients --offset=0 --limit=500
  python scripts/migrate_sigh.py --full   # roda todos os módulos em ordem

Pré-requisitos:
  - .env configurado com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
  - Migrations SQL aplicadas no Supabase
  - Helper db_datasigh.py acessível no PYTHONPATH (mesma pasta deste script
    ou instalado via pip install -e .)

LGPD:
  - Pacientes com DT_OBITO != 0 são anonimizados (nome vira
    "PACIENTE ANONIMIZADO", CPF/endereço/telefone/email zerados)
  - Senhas plain-text do SIGH NÃO são migradas — gera token de primeiro
    acesso via public.create_password_reset()
  - Cada acesso a dados sensíveis é logado em audit_log

Idempotência:
  - Cada migrate_*() checa se já foi executado (cd_origem_sigh único) antes
  - Checkpoint salvo em .migration_state.json — pode retomar de onde parou
  - Reexecutar é seguro: UPDATE quando já existe, INSERT quando não

Logging:
  - stdout: progresso em tempo real
  - logs/migration_<timestamp>.log: log estruturado completo
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import random
import re
import string
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import date, datetime, time as dt_time, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

# ----------------------------------------------------------------------------
# Caminhos e imports opcionais (supabase / db_datasigh)
# ----------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
LOG_DIR = ROOT_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
STATE_FILE = SCRIPT_DIR / ".migration_state.json"

# Helper SIGH (mesmo nível de pasta ou PYTHONPATH)
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(ROOT_DIR))
try:
    from db_datasigh import conectar as _sigh_connect, query as _sigh_query
except ImportError as e:
    print(f"[FATAL] db_datasigh.py não encontrado: {e}", file=sys.stderr)
    sys.exit(2)

# Supabase client (opcional — só carrega se for usar)
try:
    from supabase import Client, create_client
    _SUPABASE_AVAILABLE = True
except ImportError:
    _SUPABASE_AVAILABLE = False


# ============================================================================
# Configuração
# ============================================================================
@dataclass
class MigrationConfig:
    supabase_url: str = os.environ.get("SUPABASE_URL", "")
    supabase_service_key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    dry_run: bool = False
    entity: Optional[str] = None          # se definido, roda só esse módulo
    batch_size: int = 100
    offset: int = 0
    limit: Optional[int] = None           # limite total (None = tudo)
    full: bool = False                    # roda todos os módulos em ordem
    checkpoint: bool = True               # gravar .migration_state.json
    max_retries: int = 3
    retry_delay: float = 2.0
    consent_date: str = ""                # DD/MM/YYYY do consentimento LGPD
    # controle de quais fontes/convênios importar
    top_n_insurance: int = 30             # top N por volume
    all_insurance: bool = False           # se True, importa todos 992


# ============================================================================
# Logger estruturado
# ============================================================================
def setup_logger(name: str = "migrate_sigh") -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # console
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    logger.addHandler(ch)
    # arquivo
    fh = logging.FileHandler(
        LOG_DIR / f"migration_{datetime.now():%Y%m%d_%H%M%S}.log",
        encoding="utf-8",
    )
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    return logger


log = setup_logger()


# ============================================================================
# Métricas por módulo
# ============================================================================
@dataclass
class MigrationStats:
    entity: str
    total_source: int = 0
    processed: int = 0
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0
    anonymized: int = 0
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_samples: list[str] = field(default_factory=list)

    def duration(self) -> timedelta:
        if self.started_at and self.finished_at:
            return self.finished_at - self.started_at
        return timedelta(0)

    def report(self) -> str:
        return (
            f"[{self.entity}] source={self.total_source} "
            f"inserted={self.inserted} updated={self.updated} "
            f"skipped={self.skipped} errors={self.errors} "
            f"anonymized={self.anonymized} dur={self.duration()}"
        )


# ============================================================================
# Checkpoint / Resume
# ============================================================================
def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            log.warning("Checkpoint corrompido — ignorando")
    return {}


def save_state(state: dict) -> None:
    if not state.get("_checkpoint_enabled", True):
        return
    STATE_FILE.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")


def mark_done(state: dict, entity: str, offset: int) -> None:
    state.setdefault(entity, {})["last_offset"] = offset
    state[entity]["finished_at"] = datetime.now().isoformat()
    save_state(state)


# ============================================================================
# Normalizações (LGPD-safe)
# ============================================================================
DIGITS_RE = re.compile(r"\D+")


def normalize_cpf(cpf: Any) -> str:
    """Só dígitos, zfill(11). Retorna '' se vazio/inválido."""
    if cpf is None:
        return ""
    s = DIGITS_RE.sub("", str(cpf))
    return s.zfill(11) if s else ""


def normalize_cnpj(cnpj: Any) -> str:
    if cnpj is None:
        return ""
    s = DIGITS_RE.sub("", str(cnpj))
    return s.zfill(14) if s else ""


def normalize_phone(phone: Any) -> str:
    if phone is None:
        return ""
    return DIGITS_RE.sub("", str(phone))


def hash_cpf(cpf: str) -> str:
    """SHA-256 do CPF normalizado (hex). Usado para busca sem expor o original."""
    norm = normalize_cpf(cpf)
    if not norm:
        return ""
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def int_to_date(value: Any) -> Optional[str]:
    """int YYYYMMDD ou 'YYYYMMDD' → 'YYYY-MM-DD'. Retorna None se inválido."""
    if value is None or value == 0 or value == "" or value == "0":
        return None
    try:
        s = str(int(value)).zfill(8)
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    except (ValueError, TypeError):
        return None


def int_to_time(value: Any) -> Optional[str]:
    """int HHMM ou 'HHMM' → 'HH:MM:SS'."""
    if value is None or value == 0 or value == "" or value == "0":
        return None
    try:
        s = str(int(value)).zfill(4)
        h, m = int(s[0:2]), int(s[2:4])
        if not (0 <= h <= 23 and 0 <= m <= 59):
            return None
        return f"{h:02d}:{m:02d}:00"
    except (ValueError, TypeError):
        return None


def mask_pii(value: Any, kind: str = "cpf") -> str:
    """Mascarar PII para logs (exibe só início/fim)."""
    if value is None or value == "":
        return ""
    s = str(value)
    if kind == "cpf" and len(s) >= 4:
        return f"***.***.{s[-2:]}"
    if kind == "email" and "@" in s:
        local, _, domain = s.partition("@")
        return f"{local[0]}***@{domain}"
    if len(s) <= 4:
        return "***"
    return f"{s[:2]}***{s[-2:]}"


def anonymize_patient(row: dict) -> dict:
    """Substitui campos sensíveis por valores nulos/anonimizados.

    Aplica-se a pacientes com DT_OBITO != 0 ou LG_ANONIMIZADO = 1.
    """
    return {
        **row,
        "nome": "PACIENTE ANONIMIZADO",
        "cpf": None,
        "cpf_hash": None,
        "rg": None,
        "endereco": None,
        "bairro": None,
        "cidade": None,
        "uf": None,
        "cep": None,
        "telefone1": None,
        "telefone2": None,
        "email": None,
        "nome_mae": None,
        "nome_pai": None,
        "observacao": None,
        "lg_anonimizado": True,
    }


# ============================================================================
# Conexões
# ============================================================================
def connect_sigh():
    """Abre conexão MySQL latin1 (servidor SIGH)."""
    return _sigh_connect()


def connect_supabase(cfg: MigrationConfig) -> Optional["Client"]:
    if not _SUPABASE_AVAILABLE:
        log.error("supabase-py não instalado. pip install supabase")
        return None
    if not cfg.supabase_url or not cfg.supabase_service_key:
        log.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados")
        return None
    return create_client(cfg.supabase_url, cfg.supabase_service_key)


# ============================================================================
# Helper genérico: SELECT paginado no SIGH
# ============================================================================
def fetch_sigh_batches(
    base_sql: str,
    params: tuple,
    batch_size: int,
    offset_start: int = 0,
    limit_total: Optional[int] = None,
) -> Iterable[list[dict]]:
    """Generator de batches de linhas do SIGH (LIMIT n OFFSET m)."""
    offset = offset_start
    fetched = 0
    while True:
        if limit_total is not None and fetched >= limit_total:
            break
        remaining = (limit_total - fetched) if limit_total else batch_size
        this_batch = min(batch_size, remaining)
        sql = f"{base_sql} LIMIT {this_batch} OFFSET {offset}"
        rows = _sigh_query(sql, params)
        if not rows:
            break
        yield rows
        fetched += len(rows)
        offset += len(rows)
        if len(rows) < this_batch:
            break


# ============================================================================
# Helper: INSERT/UPSERT com retry no Supabase
# ============================================================================
def supabase_insert(
    client,
    table: str,
    rows: list[dict],
    cfg: MigrationConfig,
    stats: MigrationStats,
    on_conflict: Optional[str] = None,
) -> None:
    """Insere bloco de linhas com retry. on_conflict = colunas para upsert."""
    if cfg.dry_run or not rows:
        stats.inserted += len(rows)
        return
    last_err: Optional[Exception] = None
    for attempt in range(1, cfg.max_retries + 1):
        try:
            if on_conflict:
                res = client.table(table).upsert(rows, on_conflict=on_conflict).execute()
            else:
                res = client.table(table).insert(rows).execute()
            stats.inserted += len(rows)
            return
        except Exception as e:
            last_err = e
            log.warning(f"[{stats.entity}] tentativa {attempt}/{cfg.max_retries} falhou: {e}")
            if attempt < cfg.max_retries:
                time.sleep(cfg.retry_delay * attempt)
    stats.errors += len(rows)
    sample = str(last_err)[:200] if last_err else "?"
    stats.error_samples.append(sample)
    log.error(f"[{stats.entity}] falhou após {cfg.max_retries} tentativas: {sample}")


# ============================================================================
# MÓDULO 1: Empresa
# ============================================================================
def migrate_companies(client, cfg: MigrationConfig, state: dict) -> MigrationStats:
    stats = MigrationStats(entity="companies")
    stats.started_at = datetime.now()
    log.info("[1/11] Empresas: criando empresa 'Migrado SIGH'")
    row = {
        "name": "Migrado SIGH",
        "cnpj": "00000000000000",
        "lg_ativo": True,
        "_migration_source": "SIGH",
        "_migration_consent_date": cfg.consent_date,
    }
    try:
        if not cfg.dry_run and client:
            res = client.table("companies").insert(row).execute()
            company_id = res.data[0]["id"] if res.data else None
            state["companies"] = {"_company_id": company_id}
            save_state(state)
            log.info(f"  → empresa criada: id={company_id}")
        stats.inserted = 1
    except Exception as e:
        # Se já existir (UNIQUE cnpj) — busca o id
        log.warning(f"  empresa já existe? tentando localizar: {e}")
        try:
            res = client.table("companies").select("id").eq("cnpj", "00000000000000").execute()
            if res.data:
                state["companies"] = {"_company_id": res.data[0]["id"]}
                save_state(state)
                stats.inserted = 1
        except Exception as e2:
            stats.errors = 1
            stats.error_samples.append(str(e2)[:200])
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# MÓDULO 2: Fontes Pagadoras (53)
# ============================================================================
def migrate_payment_sources(client, cfg: MigrationConfig, state: dict) -> MigrationStats:
    stats = MigrationStats(entity="payment_sources")
    stats.started_at = datetime.now()
    log.info("[2/11] Fontes Pagadoras: 53 registros esperados")
    company_id = (state.get("companies") or {}).get("_company_id")
    if not company_id and not cfg.dry_run:
        log.error("company_id não encontrado — rode migrate_companies primeiro")
        stats.errors = 1
        return stats
    rows_raw = _sigh_query(
        "SELECT CD_FONTE_PAGADORA, NM_FONTE_PAGADORA, TP_FONTE_PAGADORA, "
        "CNPJ, RAZAO_SOCIAL, IE, IM, CD_CAT_CONTA, CD_CENTRO_CUSTO, "
        "CD_CONTA_CORRENTE, DIAS_PRAZO_PGTO, DIAS_CORTE, DT_INICIO_CONTRATO, "
        "DT_FIM_CONTRATO, VL_IMPOSTO, VL_IMPOSTO2, VL_IMPOSTO3, "
        "LG_ATIVO, LG_VALOR_AUTOMATICO, LG_GERAR_CONTA_PACIENTE, "
        "LG_ATUALIZAR_CONTA_RECEBER, LG_PERMITE_FATURA_PARCIAL, "
        "LG_EXCLUIR_FATURA_AUTOMATICA, LG_PADRAO_GERATISS "
        "FROM fonte_pagadora ORDER BY CD_FONTE_PAGADORA",
        limite=200,
    )
    stats.total_source = len(rows_raw)
    log.info(f"  fontes encontradas no SIGH: {stats.total_source}")
    type_map = {"P": "PARTICULAR", "S": "SUS", "C": "CORTESIA", "V": "CONVENIO"}
    batch: list[dict] = []
    for r in rows_raw:
        tp = type_map.get((r.get("TP_FONTE_PAGADORA") or "").upper(), "PARTICULAR")
        batch.append({
            "company_id": company_id,
            "name": r.get("NM_FONTE_PAGADORA"),
            "type": tp,
            "cnpj": normalize_cnpj(r.get("CNPJ")),
            "razao_social": r.get("RAZAO_SOCIAL"),
            "inscricao_estadual": r.get("IE"),
            "inscricao_municipal": r.get("IM"),
            "cd_cat_conta": r.get("CD_CAT_CONTA"),
            "cd_centro_custo": r.get("CD_CENTRO_CUSTO"),
            "cd_conta_corrente": r.get("CD_CONTA_CORRENTE"),
            "dias_prazo_pgto": r.get("DIAS_PRAZO_PGTO") or 30,
            "dias_corte": r.get("DIAS_CORTE") or 0,
            "dt_inicio_contrato": int_to_date(r.get("DT_INICIO_CONTRATO")),
            "dt_fim_contrato": int_to_date(r.get("DT_FIM_CONTRATO")),
            "vl_imposto": r.get("VL_IMPOSTO") or 0,
            "vl_imposto2": r.get("VL_IMPOSTO2") or 0,
            "vl_imposto3": r.get("VL_IMPOSTO3") or 0,
            "lg_ativo": bool(r.get("LG_ATIVO", 1)),
            "lg_valor_automatico": bool(r.get("LG_VALOR_AUTOMATICO", 0)),
            "lg_gerar_conta_paciente": bool(r.get("LG_GERAR_CONTA_PACIENTE", 0)),
            "lg_atualizar_conta_receber": bool(r.get("LG_ATUALIZAR_CONTA_RECEBER", 0)),
            "lg_permite_fatura_parcial": bool(r.get("LG_PERMITE_FATURA_PARCIAL", 0)),
            "lg_excluir_fatura_automatica": bool(r.get("LG_EXCLUIR_FATURA_AUTOMATICA", 0)),
            "lg_padrao_geratiss": bool(r.get("LG_PADRAO_GERATISS", 0)),
            "cd_origem_sigh": r.get("CD_FONTE_PAGADORA"),
        })
        if len(batch) >= cfg.batch_size:
            supabase_insert(client, "payment_sources", batch, cfg, stats,
                            on_conflict="cd_origem_sigh,company_id")
            batch = []
    if batch:
        supabase_insert(client, "payment_sources", batch, cfg, stats,
                        on_conflict="cd_origem_sigh,company_id")
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# MÓDULO 3: Convênios (top 30 ou todos 992)
# ============================================================================
def migrate_insurance_companies(client, cfg: MigrationConfig, state: dict) -> MigrationStats:
    stats = MigrationStats(entity="insurance_companies")
    stats.started_at = datetime.now()
    label = f"todos ({cfg.all_insurance})" if cfg.all_insurance else f"top {cfg.top_n_insurance}"
    log.info(f"[3/11] Convênios: importando {label}")
    company_id = (state.get("companies") or {}).get("_company_id")
    if cfg.all_insurance:
        sql = (
            "SELECT CD_CONVENIO, NM_CONVENIO, REGISTRO_ANS, CNPJ, RAZAO_SOCIAL, "
            "ENDERECO, BAIRRO, CIDADE, UF, CEP, CONTATO, TELEFONE1, TELEFONE2, "
            "TELEFONE3, LOGIN_PRESTADOR, SENHA_PRESTADOR, CODIGO_PRESTADOR, "
            "PERCENTUAL_DESCONTO, DIAS_VALIDADE_SENHA, TABELA_MAT, TABELA_MED, "
            "TABELA_TAXA, TABELA_SERVICO, TABELA_GASES, TABELA_DIARIA, "
            "COD_AUXILIAR1, COD_AUXILIAR2, COD_AUXILIAR3, COD_AUXILIAR4, "
            "COD_ANESTESISTA, TAM_MATRICULA, TAM_AUTORIZACAO, TAM_GUIA, "
            "LG_ATIVO, LG_GUIA_OBRIGATORIA, LG_CID_OBRIGATORIO, "
            "LG_MATRIC_OBRIGATORIO, LG_AUTORIZAC_OBRIGATORIO, "
            "LG_VALIDADE_MATRICULA, LG_GUIA_AUTOMATICO, LG_GUIA_AUTO_LANCAMENTO, "
            "LG_TIPO_ATEND_AUTOMATICO, LG_VAL_MATRICULA, LG_VAL_AUTORIZACAO, "
            "LG_VERIFICAR_ASSOCIACAO, LG_AVISAR_MATRICULA, LG_ATUALIZAR_MATRICULA, "
            "OBSERVACAO "
            "FROM convenios WHERE LG_ATIVO = 1 ORDER BY CD_CONVENIO"
        )
    else:
        # Top N por volume de agendamentos (heurística: COUNT(DT_AGENDA))
        sql = (
            "SELECT c.CD_CONVENIO, c.NM_CONVENIO, c.REGISTRO_ANS, c.CNPJ, "
            "c.RAZAO_SOCIAL, c.ENDERECO, c.BAIRRO, c.CIDADE, c.UF, c.CEP, "
            "c.CONTATO, c.TELEFONE1, c.TELEFONE2, c.TELEFONE3, "
            "c.LOGIN_PRESTADOR, c.SENHA_PRESTADOR, c.CODIGO_PRESTADOR, "
            "c.PERCENTUAL_DESCONTO, c.DIAS_VALIDADE_SENHA, c.TABELA_MAT, "
            "c.TABELA_MED, c.TABELA_TAXA, c.TABELA_SERVICO, c.TABELA_GASES, "
            "c.TABELA_DIARIA, c.COD_AUXILIAR1, c.COD_AUXILIAR2, c.COD_AUXILIAR3, "
            "c.COD_AUXILIAR4, c.COD_ANESTESISTA, c.TAM_MATRICULA, "
            "c.TAM_AUTORIZACAO, c.TAM_GUIA, c.LG_ATIVO, c.LG_GUIA_OBRIGATORIA, "
            "c.LG_CID_OBRIGATORIO, c.LG_MATRIC_OBRIGATORIO, c.LG_AUTORIZAC_OBRIGATORIO, "
            "c.LG_VALIDADE_MATRICULA, c.LG_GUIA_AUTOMATICO, c.LG_GUIA_AUTO_LANCAMENTO, "
            "c.LG_TIPO_ATEND_AUTOMATICO, c.LG_VAL_MATRICULA, c.LG_VAL_AUTORIZACAO, "
            "c.LG_VERIFICAR_ASSOCIACAO, c.LG_AVISAR_MATRICULA, c.LG_ATUALIZAR_MATRICULA, "
            "c.OBSERVACAO, COALESCE(cnt.qtd, 0) AS qtd "
            "FROM convenios c "
            "LEFT JOIN ("
            "  SELECT CD_CONVENIO, COUNT(*) AS qtd FROM agenda "
            "  WHERE DT_AGENDA >= 20240101 GROUP BY CD_CONVENIO"
            ") cnt ON cnt.CD_CONVENIO = c.CD_CONVENIO "
            "WHERE c.LG_ATIVO = 1 "
            f"ORDER BY cnt.qtd DESC, c.CD_CONVENIO LIMIT {cfg.top_n_insurance}"
        )
    rows = _sigh_query(sql, limite=2000)
    stats.total_source = len(rows)
    log.info(f"  convênios a migrar: {stats.total_source}")
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
            "senha_prestador": r.get("SENHA_PRESTADOR"),
            "codigo_prestador": str(r.get("CODIGO_PRESTADOR") or "1"),
            "percentual_desconto": r.get("PERCENTUAL_DESCONTO") or 0,
            "dias_validade_senha": r.get("DIAS_VALIDADE_SENHA") or 0,
            "tabela_mat": r.get("TABELA_MAT"),
            "tabela_med": r.get("TABELA_MED"),
            "tabela_taxa": r.get("TABELA_TAXA"),
            "tabela_servico": r.get("TABELA_SERVICO"),
            "tabela_gases": r.get("TABELA_GASES"),
            "tabela_diaria": r.get("TABELA_DIARIA"),
            "cod_auxiliar1": r.get("COD_AUXILIAR1"),
            "cod_auxiliar2": r.get("COD_AUXILIAR2"),
            "cod_auxiliar3": r.get("COD_AUXILIAR3"),
            "cod_auxiliar4": r.get("COD_AUXILIAR4"),
            "cod_anestesista": r.get("COD_ANESTESISTA"),
            "tam_matricula": r.get("TAM_MATRICULA"),
            "tam_autorizacao": r.get("TAM_AUTORIZACAO"),
            "tam_guia": r.get("TAM_GUIA"),
            "lg_ativo": bool(r.get("LG_ATIVO", 1)),
            "lg_guia_obrigatoria": bool(r.get("LG_GUIA_OBRIGATORIA", 1)),
            "lg_cid_obrigatorio": bool(r.get("LG_CID_OBRIGATORIO", 1)),
            "lg_matric_obrigatorio": bool(r.get("LG_MATRIC_OBRIGATORIO", 0)),
            "lg_autorizac_obrigatorio": bool(r.get("LG_AUTORIZAC_OBRIGATORIO", 0)),
            "lg_validade_matricula": bool(r.get("LG_VALIDADE_MATRICULA", 0)),
            "lg_guia_automatico": bool(r.get("LG_GUIA_AUTOMATICO", 0)),
            "lg_guia_auto_lancamento": bool(r.get("LG_GUIA_AUTO_LANCAMENTO", 0)),
            "lg_tipo_atend_automatico": bool(r.get("LG_TIPO_ATEND_AUTOMATICO", 0)),
            "lg_val_matricula": bool(r.get("LG_VAL_MATRICULA", 0)),
            "lg_val_autorizacao": bool(r.get("LG_VAL_AUTORIZACAO", 0)),
            "lg_verificar_associacao": bool(r.get("LG_VERIFICAR_ASSOCIACAO", 0)),
            "lg_avisar_matricula": bool(r.get("LG_AVISAR_MATRICULA", 0)),
            "lg_atualizar_matricula": bool(r.get("LG_ATUALIZAR_MATRICULA", 0)),
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
# MÓDULO 4: Planos (395)
# ============================================================================
def migrate_insurance_plans(client, cfg: MigrationConfig, state: dict) -> MigrationStats:
    stats = MigrationStats(entity="insurance_plans")
    stats.started_at = datetime.now()
    log.info("[4/11] Planos: 395 registros esperados")
    company_id = (state.get("companies") or {}).get("_company_id")
    rows = _sigh_query(
        "SELECT CD_PLANO, CD_CONVENIO, NM_PLANO, TP_PLANO, VL_TITULAR, "
        "VL_DEPENDENTE, PERCENTUAL, LG_ATIVO "
        "FROM convenios_planos ORDER BY CD_PLANO",
        limite=500,
    )
    stats.total_source = len(rows)
    # mapear cd_convenio (SIGH) → id (Supabase)
    conv_map = _load_origem_map(client, "insurance_companies", "cd_origem_sigh") \
        if client else {}
    batch: list[dict] = []
    for r in rows:
        batch.append({
            "company_id": company_id,
            "insurance_company_id": conv_map.get(r.get("CD_CONVENIO")),
            "name": r.get("NM_PLANO"),
            "tp_plano": r.get("TP_PLANO"),
            "vl_titular": r.get("VL_TITULAR") or 0,
            "vl_dependente": r.get("VL_DEPENDENTE") or 0,
            "percentual": r.get("PERCENTUAL") or 0,
            "lg_ativo": bool(r.get("LG_ATIVO", 1)),
            "cd_origem_sigh": r.get("CD_PLANO"),
        })
        if len(batch) >= cfg.batch_size:
            supabase_insert(client, "insurance_plans", batch, cfg, stats,
                            on_conflict="cd_origem_sigh,company_id")
            batch = []
    if batch:
        supabase_insert(client, "insurance_plans", batch, cfg, stats,
                        on_conflict="cd_origem_sigh,company_id")
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


def _load_origem_map(client, table: str, origem_col: str) -> dict:
    """Carrega {cd_origem_sigh: id} para tradução de FKs."""
    if not client:
        return {}
    try:
        res = client.table(table).select(f"id,{origem_col}").execute()
        return {r[origem_col]: r["id"] for r in res.data if r.get(origem_col) is not None}
    except Exception as e:
        log.warning(f"  falha ao carregar mapa {origem_col} de {table}: {e}")
        return {}


# ============================================================================
# MÓDULO 5: Usuários (108 com reset de senha)
# ============================================================================
def migrate_users(client, cfg: MigrationConfig, state: dict) -> MigrationStats:
    stats = MigrationStats(entity="users")
    stats.started_at = datetime.now()
    log.info("[5/11] Usuários: 108 com reset de senha (LGPD)")
    if not client and not cfg.dry_run:
        log.error("supabase client necessário para criar auth.users")
        return stats
    rows = _sigh_query(
        "SELECT CD_USUARIO, NM_USUARIO, LOGIN, EMAIL, CD_GRUPO, LG_ATIVO, "
        "DT_CADASTRO FROM usuarios ORDER BY CD_USUARIO",
        limite=200,
    )
    stats.total_source = len(rows)
    tokens_gerados: list[dict] = []
    for r in rows:
        email = (r.get("EMAIL") or "").strip().lower()
        if not email or "@" not in email:
            # gera email sintético para que o login funcione
            email = f"usuario{r.get('CD_USUARIO')}@migrado.prontoclinic.local"
        try:
            if cfg.dry_run:
                stats.inserted += 1
                continue
            # Cria usuário no auth.users via Admin API
            res = client.auth.admin.create_user({
                "email": email,
                "email_confirm": True,
                "user_metadata": {
                    "migration_source": "SIGH",
                    "cd_origem_sigh": r.get("CD_USUARIO"),
                    "nome": r.get("NM_USUARIO"),
                    "consent_date": cfg.consent_date,
                },
            })
            user_id = res.user.id if hasattr(res, "user") else None
            if not user_id:
                stats.errors += 1
                continue
            # Cria profile (vincula à company)
            company_id = (state.get("companies") or {}).get("_company_id")
            client.table("user_profiles").insert({
                "id": user_id,
                "company_id": company_id,
                "full_name": r.get("NM_USUARIO"),
                "role_name": _map_role(r.get("CD_GRUPO")),
                "active": bool(r.get("LG_ATIVO", 1)),
                "cd_origem_sigh": r.get("CD_USUARIO"),
            }).execute()
            # Gera token de primeiro acesso (não envia e-mail — apenas registra)
            token_res = client.rpc("create_password_reset", {
                "p_user_id": user_id,
                "p_ttl_hours": 72,
            }).execute()
            if token_res.data:
                tokens_gerados.append({
                    "user_id": user_id,
                    "email": email,
                    "token": token_res.data,
                    "nome": r.get("NM_USUARIO"),
                })
            stats.inserted += 1
        except Exception as e:
            stats.errors += 1
            stats.error_samples.append(f"{r.get('LOGIN')}: {str(e)[:120]}")
            log.warning(f"  usuário {r.get('LOGIN')} falhou: {e}")
    # Salva tokens em CSV para envio posterior
    if tokens_gerados:
        out = LOG_DIR / f"password_resets_{datetime.now():%Y%m%d_%H%M%S}.csv"
        with out.open("w", encoding="utf-8", newline="") as f:
            f.write("user_id,email,nome,token\n")
            for t in tokens_gerados:
                f.write(f"{t['user_id']},{t['email']},{t['nome']},{t['token']}\n")
        log.info(f"  → {len(tokens_gerados)} tokens salvos em {out.name}")
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


def _map_role(cd_grupo: Optional[int]) -> str:
    """Mapeia CD_GRUPO SIGH → role_name Supabase."""
    mapping = {
        1: "admin",          # Administrador
        2: "doctor",         # Médico
        3: "reception",      # Recepção
        4: "nurse",          # Enfermagem
        5: "financial",      # Financeiro
        6: "viewer",         # Consulta
    }
    return mapping.get(cd_grupo or 0, "viewer")


# ============================================================================
# MÓDULO 6: Profissionais (144 medicor)
# ============================================================================
def migrate_professionals(client, cfg: MigrationConfig, state: dict) -> MigrationStats:
    stats = MigrationStats(entity="professionals")
    stats.started_at = datetime.now()
    log.info("[6/11] Profissionais: 144 da tabela medicor")
    company_id = (state.get("companies") or {}).get("_company_id")
    rows = _sigh_query(
        "SELECT CD_MEDICO, NM_MEDICO, CPF, CRM, UF_CRM, ESPECIALIDADE, "
        "DT_NASCIMENTO, TELEFONE, EMAIL, LG_ATIVO "
        "FROM medicor WHERE LG_ATIVO = 1 ORDER BY CD_MEDICO",
        limite=200,
    )
    stats.total_source = len(rows)
    batch: list[dict] = []
    for r in rows:
        batch.append({
            "company_id": company_id,
            "name": r.get("NM_MEDICO"),
            "cpf_hash": hash_cpf(r.get("CPF") or ""),
            "crm": r.get("CRM"),
            "uf_crm": r.get("UF_CRM"),
            "specialty": r.get("ESPECIALIDADE"),
            "birth_date": int_to_date(r.get("DT_NASCIMENTO")),
            "phone": normalize_phone(r.get("TELEFONE")),
            "email": r.get("EMAIL"),
            "active": bool(r.get("LG_ATIVO", 1)),
            "cd_origem_sigh": r.get("CD_MEDICO"),
        })
        if len(batch) >= cfg.batch_size:
            supabase_insert(client, "professionals", batch, cfg, stats,
                            on_conflict="cd_origem_sigh,company_id")
            batch = []
    if batch:
        supabase_insert(client, "professionals", batch, cfg, stats,
                        on_conflict="cd_origem_sigh,company_id")
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# MÓDULO 7: Serviços (4.953)
# ============================================================================
def migrate_services(client, cfg: MigrationConfig, state: dict) -> MigrationStats:
    stats = MigrationStats(entity="services_catalog")
    stats.started_at = datetime.now()
    log.info("[7/11] Serviços: 4.953 esperados")
    company_id = (state.get("companies") or {}).get("_company_id")
    offset = cfg.offset
    total = 0
    # contar antes (heurística — subquery leve)
    cnt = _sigh_query("SELECT COUNT(*) AS n FROM servicos WHERE LG_ATIVO = 1", limite=1)
    stats.total_source = cnt[0]["n"] if cnt else 0
    log.info(f"  total no SIGH: {stats.total_source}")
    for batch_rows in fetch_sigh_batches(
        base_sql=(
            "SELECT CD_SERVICO, NM_SERVICO, CODIGO_AMB, CODIGO_CBHPM, "
            "VL_PARTICULAR, TP_SERVICO, CD_GRUPO_SERVICO, LG_ATIVO "
            "FROM servicos WHERE LG_ATIVO = 1 ORDER BY CD_SERVICO"
        ),
        params=(),
        batch_size=cfg.batch_size,
        offset_start=offset,
        limit_total=cfg.limit,
    ):
        batch: list[dict] = []
        for r in batch_rows:
            batch.append({
                "company_id": company_id,
                "name": r.get("NM_SERVICO"),
                "code_amb": r.get("CODIGO_AMB"),
                "code_cbhpm": r.get("CODIGO_CBHPM"),
                "price": r.get("VL_PARTICULAR") or 0,
                "service_type": r.get("TP_SERVICO"),
                "group_id": r.get("CD_GRUPO_SERVICO"),
                "active": bool(r.get("LG_ATIVO", 1)),
                "cd_origem_sigh": r.get("CD_SERVICO"),
            })
            total += 1
        supabase_insert(client, "services_catalog", batch, cfg, stats,
                        on_conflict="cd_origem_sigh,company_id")
        stats.processed += len(batch_rows)
        if stats.processed % 1000 == 0 or stats.processed == stats.total_source:
            pct = (stats.processed / stats.total_source * 100) if stats.total_source else 0
            log.info(f"  Serviços: {stats.processed}/{stats.total_source} ({pct:.1f}%)")
    mark_done(state, "services_catalog", offset + total)
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# MÓDULO 8: Pacientes (50.593 com anonimização)
# ============================================================================
def migrate_patients(client, cfg: MigrationConfig, state: dict) -> MigrationStats:
    stats = MigrationStats(entity="patients")
    stats.started_at = datetime.now()
    log.info("[8/11] Pacientes: 50.593 (com anonimização LGPD)")
    company_id = (state.get("companies") or {}).get("_company_id")
    cnt = _sigh_query(
        "SELECT COUNT(*) AS n FROM pacientes WHERE LG_ATIVO = 1", limite=1
    )
    stats.total_source = cnt[0]["n"] if cnt else 0
    log.info(f"  total no SIGH: {stats.total_source}")
    offset = cfg.offset
    for batch_rows in fetch_sigh_batches(
        base_sql=(
            "SELECT CD_PACIENTE, NM_PACIENTE, CPF, RG, DT_NASCIMENTO, SEXO, "
            "ESTADO_CIVIL, NOME_MAE, NOME_PAI, ENDERECO, NUMERO, COMPLEMENTO, "
            "BAIRRO, CIDADE, UF, CEP, TELEFONE1, TELEFONE2, EMAIL, DT_OBITO, "
            "LG_ANONIMIZADO, LG_ATIVO, OBSERVACAO "
            "FROM pacientes WHERE LG_ATIVO = 1 ORDER BY CD_PACIENTE"
        ),
        params=(),
        batch_size=cfg.batch_size,
        offset_start=offset,
        limit_total=cfg.limit,
    ):
        batch: list[dict] = []
        for r in batch_rows:
            row = {
                "company_id": company_id,
                "name": r.get("NM_PACIENTE"),
                "cpf": normalize_cpf(r.get("CPF")),
                "cpf_hash": hash_cpf(r.get("CPF") or ""),
                "rg": r.get("RG"),
                "birth_date": int_to_date(r.get("DT_NASCIMENTO")),
                "gender": r.get("SEXO"),
                "marital_status": r.get("ESTADO_CIVIL"),
                "mother_name": r.get("NOME_MAE"),
                "father_name": r.get("NOME_PAI"),
                "address": r.get("ENDERECO"),
                "address_number": r.get("NUMERO"),
                "address_complement": r.get("COMPLEMENTO"),
                "neighborhood": r.get("BAIRRO"),
                "city": r.get("CIDADE"),
                "state": r.get("UF"),
                "zip_code": r.get("CEP"),
                "phone1": normalize_phone(r.get("TELEFONE1")),
                "phone2": normalize_phone(r.get("TELEFONE2")),
                "email": r.get("EMAIL"),
                "deceased_date": int_to_date(r.get("DT_OBITO")),
                "lg_anonimizado": bool(r.get("LG_ANONIMIZADO", 0)),
                "active": bool(r.get("LG_ATIVO", 1)),
                "notes": r.get("OBSERVACAO"),
                "cd_origem_sigh": r.get("CD_PACIENTE"),
            }
            # Anonimização: DT_OBITO != 0 ou LG_ANONIMIZADO = 1
            if (r.get("DT_OBITO") and r.get("DT_OBITO") != 0) or r.get("LG_ANONIMIZADO"):
                row = anonymize_patient(row)
                stats.anonymized += 1
            batch.append(row)
        supabase_insert(client, "patients", batch, cfg, stats,
                        on_conflict="cpf_hash,company_id")
        stats.processed += len(batch_rows)
        if stats.processed % 5000 == 0 or stats.processed == stats.total_source:
            pct = (stats.processed / stats.total_source * 100) if stats.total_source else 0
            log.info(f"  Pacientes: {stats.processed}/{stats.total_source} "
                     f"({pct:.1f}%) anonimizados={stats.anonymized}")
    mark_done(state, "patients", offset + stats.processed)
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# MÓDULO 9: Agendamentos (apenas futuros)
# ============================================================================
def migrate_appointments(client, cfg: MigrationConfig, state: dict) -> MigrationStats:
    stats = MigrationStats(entity="appointments")
    stats.started_at = datetime.now()
    hoje = date.today()
    hoje_int = int(hoje.strftime("%Y%m%d"))
    log.info(f"[9/11] Agendamentos: apenas futuros (>= {hoje.isoformat()})")
    company_id = (state.get("companies") or {}).get("_company_id")
    cnt = _sigh_query(
        "SELECT COUNT(*) AS n FROM agenda WHERE DT_AGENDA >= %s", (hoje_int,), limite=1
    )
    stats.total_source = cnt[0]["n"] if cnt else 0
    log.info(f"  total de agendamentos futuros: {stats.total_source}")
    # mapas de FK
    prof_map = _load_origem_map(client, "professionals", "cd_origem_sigh") if client else {}
    pat_map = _load_origem_map(client, "patients", "cd_origem_sigh") if client else {}
    conv_map = _load_origem_map(client, "insurance_companies", "cd_origem_sigh") if client else {}
    offset = cfg.offset
    for batch_rows in fetch_sigh_batches(
        base_sql=(
            "SELECT CD_AGENDA, CD_PACIENTE, CD_MEDICO, CD_CONVENIO, "
            "CD_SERVICO, DT_AGENDA, HR_AGENDA, HR_ATENDIMENTO, "
            "LG_CONFIRMADO, LG_ATENDIDO, LG_FALTOU, OBSERVACAO "
            "FROM agenda WHERE DT_AGENDA >= " + str(hoje_int) +
            " ORDER BY CD_AGENDA"
        ),
        params=(),
        batch_size=cfg.batch_size,
        offset_start=offset,
        limit_total=cfg.limit,
    ):
        batch: list[dict] = []
        for r in batch_rows:
            batch.append({
                "company_id": company_id,
                "patient_id": pat_map.get(r.get("CD_PACIENTE")),
                "professional_id": prof_map.get(r.get("CD_MEDICO")),
                "insurance_company_id": conv_map.get(r.get("CD_CONVENIO")),
                "service_id": r.get("CD_SERVICO"),
                "appointment_date": int_to_date(r.get("DT_AGENDA")),
                "appointment_time": int_to_time(r.get("HR_AGENDA")),
                "attendance_time": int_to_time(r.get("HR_ATENDIMENTO")),
                "confirmed": bool(r.get("LG_CONFIRMADO", 0)),
                "attended": bool(r.get("LG_ATENDIDO", 0)),
                "missed": bool(r.get("LG_FALTOU", 0)),
                "notes": r.get("OBSERVACAO"),
                "cd_origem_sigh": r.get("CD_AGENDA"),
            })
        supabase_insert(client, "appointments", batch, cfg, stats,
                        on_conflict="cd_origem_sigh,company_id")
        stats.processed += len(batch_rows)
        if stats.processed % 5000 == 0 or stats.processed == stats.total_source:
            pct = (stats.processed / stats.total_source * 100) if stats.total_source else 0
            log.info(f"  Agendamentos: {stats.processed}/{stats.total_source} ({pct:.1f}%)")
    mark_done(state, "appointments", offset + stats.processed)
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# MÓDULO 10: Prontuários (1.524)
# ============================================================================
def migrate_medical_records(client, cfg: MigrationConfig, state: dict) -> MigrationStats:
    stats = MigrationStats(entity="medical_records")
    stats.started_at = datetime.now()
    log.info("[10/11] Prontuários: 1.524")
    company_id = (state.get("companies") or {}).get("_company_id")
    pat_map = _load_origem_map(client, "patients", "cd_origem_sigh") if client else {}
    prof_map = _load_origem_map(client, "professionals", "cd_origem_sigh") if client else {}
    offset = cfg.offset
    for batch_rows in fetch_sigh_batches(
        base_sql=(
            "SELECT CD_PRONTUARIO, CD_PACIENTE, CD_MEDICO, DT_ATENDIMENTO, "
            "ANAMNESE, EXAME_FISICO, HIPOTESE_DIAGNOSTICA, CONDUTA, CID "
            "FROM prontuario ORDER BY CD_PRONTUARIO"
        ),
        params=(),
        batch_size=cfg.batch_size,
        offset_start=offset,
        limit_total=cfg.limit,
    ):
        batch: list[dict] = []
        for r in batch_rows:
            batch.append({
                "company_id": company_id,
                "patient_id": pat_map.get(r.get("CD_PACIENTE")),
                "professional_id": prof_map.get(r.get("CD_MEDICO")),
                "attendance_date": int_to_date(r.get("DT_ATENDIMENTO")),
                "anamnesis": r.get("ANAMNESE"),
                "physical_exam": r.get("EXAME_FISICO"),
                "hypothesis": r.get("HIPOTESE_DIAGNOSTICA"),
                "conduct": r.get("CONDUTA"),
                "cid_code": r.get("CID"),
                "cd_origem_sigh": r.get("CD_PRONTUARIO"),
            })
        supabase_insert(client, "medical_records", batch, cfg, stats,
                        on_conflict="cd_origem_sigh,company_id")
        stats.processed += len(batch_rows)
        if stats.processed % 500 == 0:
            log.info(f"  Prontuários: {stats.processed}")
    mark_done(state, "medical_records", offset + stats.processed)
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# MÓDULO 11: Audit Logs (apenas LG_INSERIDO_API ou críticos)
# ============================================================================
def migrate_audit_logs(client, cfg: MigrationConfig, state: dict) -> MigrationStats:
    stats = MigrationStats(entity="audit_logs")
    stats.started_at = datetime.now()
    log.info("[11/11] Audit Logs: críticos (LG_INSERIDO_API = 1)")
    company_id = (state.get("companies") or {}).get("_company_id")
    offset = cfg.offset
    for batch_rows in fetch_sigh_batches(
        base_sql=(
            "SELECT CD_LOG, CD_USUARIO, TP_ACAO, TP_OBJETO, CD_OBJETO, "
            "DT_ACAO, IP_ORIGEM, DETALHES "
            "FROM log_acesso WHERE LG_INSERIDO_API = 1 "
            "ORDER BY CD_LOG DESC"
        ),
        params=(),
        batch_size=cfg.batch_size,
        offset_start=offset,
        limit_total=cfg.limit,
    ):
        batch: list[dict] = []
        for r in batch_rows:
            batch.append({
                "company_id": company_id,
                "action_type": r.get("TP_ACAO"),
                "resource_type": r.get("TP_OBJETO"),
                "resource_id": r.get("CD_OBJETO"),
                "user_cd_sigh": r.get("CD_USUARIO"),
                "action_at": int_to_date(r.get("DT_ACAO")) or datetime.now().isoformat(),
                "ip_address": r.get("IP_ORIGEM"),
                "details": r.get("DETALHES"),
                "source": "SIGH_migration",
            })
        supabase_insert(client, "audit_logs", batch, cfg, stats)
        stats.processed += len(batch_rows)
        if stats.processed % 2000 == 0:
            log.info(f"  AuditLogs: {stats.processed}")
    mark_done(state, "audit_logs", offset + stats.processed)
    stats.finished_at = datetime.now()
    log.info(f"  {stats.report()}")
    return stats


# ============================================================================
# Validação: contagens SIGH vs Supabase
# ============================================================================
def validate_totals(client, cfg: MigrationConfig) -> dict:
    """Compara contagens e retorna dict {tabela: (sigh, supabase)}."""
    log.info("=" * 60)
    log.info("VALIDAÇÃO: contagens SIGH vs Supabase")
    log.info("=" * 60)
    pairs = [
        ("fonte_pagadora", "payment_sources", "CD_FONTE_PAGADORA", "id"),
        ("convenios", "insurance_companies", "CD_CONVENIO", "id"),
        ("convenios_planos", "insurance_plans", "CD_PLANO", "id"),
        ("usuarios", "user_profiles", "CD_USUARIO", "cd_origem_sigh"),
        ("medicor", "professionals", "CD_MEDICO", "cd_origem_sigh"),
        ("servicos", "services_catalog", "CD_SERVICO", "cd_origem_sigh"),
        ("pacientes", "patients", "CD_PACIENTE", "cd_origem_sigh"),
        ("agenda", "appointments", "CD_AGENDA", "cd_origem_sigh"),
    ]
    report: dict = {}
    for sigh_t, sb_t, col_sigh, col_sb in pairs:
        try:
            s = _sigh_query(f"SELECT COUNT(*) AS n FROM {sigh_t}", limite=1)
            n_sigh = s[0]["n"] if s else 0
            if client and not cfg.dry_run:
                r = client.table(sb_t).select("id", count="exact").execute()
                n_sb = r.count or 0
            else:
                n_sb = "?"
            ok = "OK" if (n_sb == "?" or abs((n_sb or 0) - n_sigh) < 50) else "DIFF"
            log.info(f"  {sigh_t:25s} = {n_sigh:>6}  |  {sb_t:25s} = {n_sb}  [{ok}]")
            report[sigh_t] = {"sigh": n_sigh, "supabase": n_sb, "ok": ok}
        except Exception as e:
            log.warning(f"  {sigh_t}: erro {e}")
            report[sigh_t] = {"error": str(e)[:100]}
    return report


# ============================================================================
# Orquestrador
# ============================================================================
PIPELINE: list[tuple[str, Callable]] = [
    ("companies", lambda c, cfg, st: migrate_companies(c, cfg, st)),
    ("payment_sources", lambda c, cfg, st: migrate_payment_sources(c, cfg, st)),
    ("insurance_companies", lambda c, cfg, st: migrate_insurance_companies(c, cfg, st)),
    ("insurance_plans", lambda c, cfg, st: migrate_insurance_plans(c, cfg, st)),
    ("users", lambda c, cfg, st: migrate_users(c, cfg, st)),
    ("professionals", lambda c, cfg, st: migrate_professionals(c, cfg, st)),
    ("services", lambda c, cfg, st: migrate_services(c, cfg, st)),
    ("patients", lambda c, cfg, st: migrate_patients(c, cfg, st)),
    ("appointments", lambda c, cfg, st: migrate_appointments(c, cfg, st)),
    ("medical_records", lambda c, cfg, st: migrate_medical_records(c, cfg, st)),
    ("audit_logs", lambda c, cfg, st: migrate_audit_logs(c, cfg, st)),
]


def run_pipeline(client, cfg: MigrationConfig, state: dict) -> list[MigrationStats]:
    results: list[MigrationStats] = []
    target = cfg.entity
    for name, fn in PIPELINE:
        if target and target != name:
            continue
        log.info("=" * 60)
        log.info(f"Iniciando: {name}")
        log.info("=" * 60)
        try:
            stats = fn(client, cfg, state)
            results.append(stats)
        except Exception as e:
            log.error(f"Falha catastrófica em {name}: {e}")
            log.error(traceback.format_exc())
            results.append(MigrationStats(entity=name, errors=1,
                                          error_samples=[str(e)[:200]]))
    return results


# ============================================================================
# CLI
# ============================================================================
def parse_args() -> MigrationConfig:
    p = argparse.ArgumentParser(
        description="Migração SIGH → ProntoClinic Hub",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--dry-run", action="store_true",
                   help="Não grava no Supabase (apenas simula)")
    p.add_argument("--entity", type=str, default=None,
                   help="Roda só um módulo (ex: patients, services)")
    p.add_argument("--batch-size", type=int, default=100)
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--limit", type=int, default=None,
                   help="Limite total de registros (para teste)")
    p.add_argument("--full", action="store_true",
                   help="Roda todos os módulos em ordem")
    p.add_argument("--all-insurance", action="store_true",
                   help="Importa TODOS os 992 convênios (não só top 30)")
    p.add_argument("--top-n-insurance", type=int, default=30)
    p.add_argument("--consent-date", type=str, default="22/06/2026",
                   help="Data do consentimento LGPD (DD/MM/YYYY)")
    args = p.parse_args()
    return MigrationConfig(
        dry_run=args.dry_run,
        entity=args.entity,
        batch_size=args.batch_size,
        offset=args.offset,
        limit=args.limit,
        full=args.full,
        all_insurance=args.all_insurance,
        top_n_insurance=args.top_n_insurance,
        consent_date=args.consent_date,
    )


def main() -> int:
    cfg = parse_args()
    log.info("=" * 70)
    log.info("MIGRAÇÃO SIGH → ProntoClinic Hub")
    log.info(f"  dry-run       = {cfg.dry_run}")
    log.info(f"  entity        = {cfg.entity}")
    log.info(f"  batch-size    = {cfg.batch_size}")
    log.info(f"  offset        = {cfg.offset}")
    log.info(f"  limit         = {cfg.limit}")
    log.info(f"  full          = {cfg.full}")
    log.info(f"  consent_date  = {cfg.consent_date}")
    log.info("=" * 70)
    state = load_state()
    client = connect_supabase(cfg)
    if not client and not cfg.dry_run:
        log.error("Sem cliente Supabase e sem --dry-run. Abortando.")
        return 1
    started = datetime.now()
    results = run_pipeline(client, cfg, state)
    finished = datetime.now()
    # relatório final
    log.info("")
    log.info("=" * 70)
    log.info("RELATÓRIO FINAL")
    log.info("=" * 70)
    total_ins = total_err = total_anon = 0
    for s in results:
        log.info(f"  {s.report()}")
        total_ins += s.inserted + s.updated
        total_err += s.errors
        total_anon += s.anonymized
    log.info(f"  TOTAL inseridos/atualizados: {total_ins}")
    log.info(f"  TOTAL erros:                {total_err}")
    log.info(f"  TOTAL anonimizados:         {total_anon}")
    log.info(f"  Duração total:              {finished - started}")
    # validação
    try:
        report = validate_totals(client, cfg)
        out = LOG_DIR / f"validation_{datetime.now():%Y%m%d_%H%M%S}.json"
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        log.info(f"  validação salva em {out.name}")
    except Exception as e:
        log.warning(f"  validação falhou: {e}")
    return 0 if total_err == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
