#!/usr/bin/env python3
"""
MIGRACAO FINAL SIGH -> SUPABASE PRODUCAO (rhqgwrarkotjzdcrkbgn)
Schema SIGH real descoberto:
  medicor: CD_MEDICOR, DS_NOME, DS_CRM, DS_ESPECIALIDADE, DS_TELEFONE1, DS_EMAIL
  convenios: CD_CONVENIO, DS_NOME, DS_RAZAO_SOCIAL, DS_REGISTRO_ANS, DS_CNPJ, ...
  servicos: CD_SERVICO, DS_NOME, VL_PARTICULAR
  fornecedores: CD_FORNECEDOR, DS_NOME, DS_ENDERECO, ...
  pacientes: CD_PACIENTE, DS_NOME, DS_CPF, DT_NASCIMENTO, DS_SEXO, DS_TELEFONE1, DS_EMAIL
  agenda: CD_AGENDA, CD_MEDICOR, CD_PACIENTE, DT_AGENDA, HR_AGENDA, DS_SITUACAO, DS_OBS
  xml: cd_xml, DS_DESCRICAO, DT_FATURA, DS_TIPOGUIA
  usuarios: CD_USUARIO, DS_NOME, DS_LOGIN, DS_EMAIL, LG_ADMIN, LG_MASTER, ...
"""
import os, sys, time, pymysql, hashlib, uuid
from datetime import datetime
from supabase import create_client
from dotenv import load_dotenv

load_dotenv(dotenv_path=".env.production")

SIGH_CONFIG = {
    "host": "6083041e1bde.sn.mynetname.net", "port": 47777,
    "user": "42533813000197", "password": "42533813000197@connect56MF",
    "database": "DataSIGH", "charset": "utf8", "connect_timeout": 30,
}
SUPABASE_URL = "https://rhqgwrarkotjzdcrkbgn.supabase.co"
SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJocWd3cmFya290anpkY3JrYmduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjMwMTIwOSwiZXhwIjoyMDk3ODc3MjA5fQ.3WhaTnlwP_4tKFhM57O7japgwvP_03v2C7zlQaWDfW8"
COMPANY_ID = "de0007c4-d688-4e89-aeb4-32f5ec96e558"

print(f"[INIT] Supabase: {SUPABASE_URL}")
sigh = pymysql.connect(**SIGH_CONFIG, cursorclass=pymysql.cursors.DictCursor)
supa = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

def query_sigh(sql, params=None):
    cur = sigh.cursor()
    cur.execute(sql, params or ())
    return cur.fetchall()

def describe_sigh(table):
    try:
        cur = sigh.cursor()
        cur.execute(f"DESCRIBE `{table}`")
        return [r['Field'] for r in cur.fetchall()]
    except Exception as e:
        return []

def discover_supabase_schema():
    import requests
    r = requests.get(f"{SUPABASE_URL}/rest/v1/", headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"})
    return {t: list(info.get("properties", {}).keys()) for t, info in r.json().get("definitions", {}).items()}

def push_supa(table, data, conflict_col=None, chunk=500):
    if not data: return 0
    total = 0
    err_count = 0
    for i in range(0, len(data), chunk):
        batch = data[i:i+chunk]
        try:
            if conflict_col:
                res = supa.table(table).upsert(batch, on_conflict=conflict_col).execute()
            else:
                res = supa.table(table).insert(batch).execute()
            total += len(res.data) if res.data else 0
        except Exception as e:
            err_count += 1
            if err_count <= 2:
                print(f"  ! {table} batch {i}: {str(e)[:250]}")
    return total

def hash_cpf(cpf):
    if not cpf: return None
    clean = ''.join(c for c in str(cpf) if c.isdigit())
    if len(clean) < 11: return None
    return hashlib.sha256(clean.encode()).hexdigest()

def safe_date(d):
    if not d: return None
    try:
        s = str(int(d))
        if len(s) == 8 and 19000000 < int(s) < 21000000:
            return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    except: pass
    return None

def safe_time(t, default="08:00:00"):
    if not t: return default
    try:
        s = str(int(t)).zfill(4)
        return f"{s[:2]}:{s[2:4]}:00"
    except: return default

def to_int(v):
    if v is None or v == "": return None
    try: return int(v)
    except: return None

def filter_cols(data, valid_cols):
    return [{k: v for k, v in row.items() if k in valid_cols} for row in data]

def pick_sigh_cols(table, wanted):
    """Retorna apenas colunas que existem no SIGH."""
    real = describe_sigh(table)
    real_upper = [c.upper() for c in real]
    return [c for c in wanted if c.upper() in real_upper]

print("\n[DISCOVERY] Schema Supabase...")
SB_SCHEMA = discover_supabase_schema()
print(f"  {len(SB_SCHEMA)} tabelas detectadas")


# ============================================================================
# Migrations - usando campos SIGH REAIS
# ============================================================================
def migrate_units():
    print("\n[1/15] units (SIGH 7)...")
    sel = pick_sigh_cols("unidades", ["CD_UNIDADE","DS_UNIDADE","DS_RAZAO_SOCIAL","DS_CNPJ","DS_ENDERECO","DS_CIDADE","DS_ESTADO","DS_CEP","DS_CNES","DS_EMAIL_MAPA"])
    rows = query_sigh(f"SELECT {','.join(sel)} FROM unidades")
    sb_cols = set(SB_SCHEMA.get("units", []))
    data = []
    for r in rows:
        rec = {
            "company_id": COMPANY_ID,
            "cd_codigo": str(r.get("CD_UNIDADE", ""))[:50],
            "ds_nome": (r.get("DS_UNIDADE") or r.get("DS_RAZAO_SOCIAL") or "")[:200],
            "lg_principal": True,
            "lg_ativo": True,
            "cd_origem_sigh": to_int(r.get("CD_UNIDADE")),
        }
        if "nr_cnpj" in sb_cols and r.get("DS_CNPJ"):
            rec["nr_cnpj"] = str(r["DS_CNPJ"]).replace(".","").replace("-","").replace("/","")[:14]
        if "tp_unidade" in sb_cols: rec["tp_unidade"] = "clinica"
        data.append(rec)
    return push_supa("units", filter_cols(data, sb_cols), "cd_origem_sigh")

def migrate_specialties():
    print("\n[2/15] specialties...")
    rows = query_sigh("SELECT DISTINCT DS_ESPECIALIDADE FROM medicor WHERE DS_ESPECIALIDADE IS NOT NULL AND DS_ESPECIALIDADE != ''")
    sb_cols = set(SB_SCHEMA.get("specialties", []))
    data = []
    seen = set()
    idx = 1
    for r in rows:
        name = (r["DS_ESPECIALIDADE"] or "").strip()[:100]
        if not name or name in seen: continue
        seen.add(name)
        data.append({
            "name": name,
            "code": f"ESP{idx:04d}",
            "lg_ativo": True,
            "cd_origem_sigh": idx,
        })
        idx += 1
    return push_supa("specialties", filter_cols(data, sb_cols), "cd_origem_sigh")

def migrate_professionals():
    print("\n[3/15] professionals (SIGH 144)...")
    sel = pick_sigh_cols("medicor", ["CD_MEDICOR","DS_NOME","DS_CRM","DS_ESPECIALIDADE","DS_TELEFONE1","DS_EMAIL"])
    rows = query_sigh(f"SELECT {','.join(sel)} FROM medicor")
    sb_cols = set(SB_SCHEMA.get("professionals", []))
    data = []
    for r in rows:
        rec = {
            "company_id": COMPANY_ID,
            "full_name": (r.get("DS_NOME") or "")[:200],
            "lg_ativo": True,
            "cd_origem_sigh": to_int(r.get("CD_MEDICOR")),
        }
        if r.get("DS_CRM"): rec["crm"] = str(r["DS_CRM"])[:20]
        if r.get("DS_ESPECIALIDADE"): rec["specialty"] = r["DS_ESPECIALIDADE"][:100]
        if r.get("DS_TELEFONE1"): rec["phone"] = str(r["DS_TELEFONE1"])[:20]
        if r.get("DS_EMAIL"): rec["email"] = r["DS_EMAIL"][:200]
        data.append(rec)
    return push_supa("professionals", filter_cols(data, sb_cols), "cd_origem_sigh")

def migrate_insurance_companies():
    print("\n[4/15] insurance_companies (SIGH 992)...")
    sel = pick_sigh_cols("convenios", ["CD_CONVENIO","DS_NOME","DS_RAZAO_SOCIAL","DS_CNPJ","DS_REGISTRO_ANS","DS_CONV_TELEFONE1","DS_CONV_ENDERECO","DS_CONV_CIDADE","DS_CONV_ESTADO","DS_CONV_CEP","LG_ATIVO","DS_CONV_BAIRRO","DS_CONV_CONTATO"])
    rows = query_sigh(f"SELECT {','.join(sel)} FROM convenios")
    sb_cols = set(SB_SCHEMA.get("insurance_companies", []))
    data = []
    for r in rows:
        rec = {
            "company_id": COMPANY_ID,
            "name": (r.get("DS_NOME") or r.get("DS_RAZAO_SOCIAL") or f"Convenio {r.get('CD_CONVENIO','')}")[:200],
            "lg_ativo": r.get("LG_ATIVO", 1) == 1,
            "cd_origem_sigh": to_int(r.get("CD_CONVENIO")),
        }
        if r.get("DS_RAZAO_SOCIAL"): rec["razao_social"] = r["DS_RAZAO_SOCIAL"][:200]
        if r.get("DS_CNPJ"): rec["cnpj"] = str(r["DS_CNPJ"]).replace(".","").replace("-","").replace("/","")[:14]
        if r.get("DS_REGISTRO_ANS"): rec["registro_ans"] = str(r["DS_REGISTRO_ANS"])[:20]
        if r.get("DS_CONV_ENDERECO"): rec["endereco"] = r["DS_CONV_ENDERECO"][:200]
        if r.get("DS_CONV_BAIRRO"): rec["bairro"] = r["DS_CONV_BAIRRO"][:100]
        if r.get("DS_CONV_CIDADE"): rec["cidade"] = r["DS_CONV_CIDADE"][:100]
        if r.get("DS_CONV_ESTADO"): rec["uf"] = str(r["DS_CONV_ESTADO"])[:2]
        if r.get("DS_CONV_CEP"): rec["cep"] = str(r["DS_CONV_CEP"]).replace("-","")[:10]
        if r.get("DS_CONV_TELEFONE1"): rec["telefone1"] = str(r["DS_CONV_TELEFONE1"])[:20]
        if r.get("DS_CONV_CONTATO"): rec["contato"] = r["DS_CONV_CONTATO"][:100]
        data.append(rec)
    return push_supa("insurance_companies", filter_cols(data, sb_cols), "cd_origem_sigh")

def migrate_insurance_plans():
    print("\n[5/15] insurance_plans (SIGH 395)...")
    sel = pick_sigh_cols("convenio_planos", ["CD_PLANO","CD_CONVENIO","DS_PLANO","DS_CODIGO"])
    rows = query_sigh(f"SELECT {','.join(sel)} FROM convenio_planos")
    res = supa.table("insurance_companies").select("id, cd_origem_sigh").execute()
    conv_map = {r["cd_origem_sigh"]: r["id"] for r in res.data if r.get("cd_origem_sigh") is not None}
    sb_cols = set(SB_SCHEMA.get("insurance_plans", []))
    data = []
    for r in rows:
        cd_conv = to_int(r.get("CD_CONVENIO"))
        cd_plano = to_int(r.get("CD_PLANO"))
        if cd_conv not in conv_map: continue
        rec = {
            "company_id": COMPANY_ID,
            "insurance_company_id": conv_map[cd_conv],
            "name": (r.get("DS_PLANO") or f"Plano {cd_plano or ''}")[:200],
            "lg_ativo": True,
            "cd_origem_sigh": f"{cd_conv}_{cd_plano}",
        }
        if r.get("DS_CODIGO"): rec["codigo"] = str(r["DS_CODIGO"])[:50]
        if r.get("DS_PLANO"): rec["ds_plano"] = r["DS_PLANO"][:200]
        if cd_plano: rec["cd_convenio"] = cd_plano
        data.append(rec)
    return push_supa("insurance_plans", filter_cols(data, sb_cols), "cd_origem_sigh")

def migrate_payment_sources():
    print("\n[6/15] payment_sources (SIGH 53)...")
    # type CHECK: SUS, PARTICULAR, CORTESIA, CONVENIO
    cols = describe_sigh("fonte_pagadora")
    sel = [c for c in ["CD_FONTE_PAGADORA","DS_FONTE_PAGADORA"] if c in cols]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM fonte_pagadora")
    sb_cols = set(SB_SCHEMA.get("payment_sources", []))
    data = []
    for r in rows:
        name = (r.get("DS_FONTE_PAGADORA") or "").strip()[:100]
        if not name: continue
        u = name.upper()
        if "SUS" in u: tp = "SUS"
        elif "PARTICULAR" in u: tp = "PARTICULAR"
        elif "CORTESIA" in u: tp = "CORTESIA"
        else: tp = "CONVENIO"
        data.append({
            "company_id": COMPANY_ID,
            "name": name,
            "type": tp,
            "lg_ativo": True,
            "cd_origem_sigh": to_int(r.get("CD_FONTE_PAGADORA")),
        })
    return push_supa("payment_sources", filter_cols(data, sb_cols), "cd_origem_sigh")

def migrate_services_catalog():
    print("\n[7/15] services_catalog (SIGH 4953)...")
    sel = pick_sigh_cols("servicos", ["CD_SERVICO","DS_NOME","VL_PARTICULAR","CD_AMB"])
    rows = query_sigh(f"SELECT {','.join(sel)} FROM servicos")
    sb_cols = set(SB_SCHEMA.get("services_catalog", []))
    data = []
    for r in rows:
        cd = to_int(r.get("CD_SERVICO"))
        rec = {
            "company_id": COMPANY_ID,
            "code": str(r.get("CD_AMB") or cd)[:50],
            "name": (r.get("DS_NOME") or "")[:200],
            "price": float(r.get("VL_PARTICULAR") or 0),
            "lg_ativo": True,
        }
        data.append(rec)
    return push_supa("services_catalog", filter_cols(data, sb_cols), None)

def migrate_fornecedores():
    print("\n[8/15] fornecedores (SIGH 143)...")
    sel = pick_sigh_cols("fornecedores", ["CD_FORNECEDOR","DS_NOME","DS_CGC","DS_TELEFONE1","DS_EMAIL","DS_ENDERECO","DS_CIDADE","DS_ESTADO","DS_CEP","DS_CONTATO","DS_OBSERVACAO"])
    rows = query_sigh(f"SELECT {','.join(sel)} FROM fornecedores")
    sb_cols = set(SB_SCHEMA.get("fornecedores", []))
    data = []
    for r in rows:
        rec = {
            "company_id": COMPANY_ID,
            "nm_razao_social": (r.get("DS_NOME") or "")[:200],
            "lg_ativo": True,
            "cd_origem_sigh": to_int(r.get("CD_FORNECEDOR")),
        }
        if r.get("DS_NOME"): rec["nm_fantasia"] = r["DS_NOME"][:200]
        if r.get("DS_CGC"): rec["cd_cnpj"] = str(r["DS_CGC"]).replace(".","").replace("-","").replace("/","")[:14]
        if r.get("DS_TELEFONE1"): rec["nr_telefone"] = str(r["DS_TELEFONE1"])[:20]
        if r.get("DS_EMAIL"): rec["ds_email"] = r["DS_EMAIL"][:200]
        if r.get("DS_ENDERECO"): rec["ds_endereco"] = r["DS_ENDERECO"][:200]
        if r.get("DS_CIDADE"): rec["ds_cidade"] = r["DS_CIDADE"][:100]
        if r.get("DS_ESTADO"): rec["ds_uf"] = str(r["DS_ESTADO"])[:2]
        if r.get("DS_CEP"): rec["cd_cep"] = str(r["DS_CEP"]).replace("-","")[:10]
        if r.get("DS_CONTATO"): rec["ds_contato"] = r["DS_CONTATO"][:200]
        if r.get("DS_OBSERVACAO"): rec["ds_observacoes"] = r["DS_OBSERVACAO"][:500]
        if "tp_fornecedor" in sb_cols: rec["tp_fornecedor"] = "medicamentos"
        data.append(rec)
    return push_supa("fornecedores", filter_cols(data, sb_cols), "cd_origem_sigh")

def migrate_professional_insurances():
    print("\n[9/15] professional_insurances (SIGH 48173)...")
    sel = pick_sigh_cols("convxmedi", ["CD_MEDICOR","CD_CONVENIO","LG_CLINICA","LG_CREDENCIADO"])
    rows = query_sigh(f"SELECT {','.join(sel)} FROM convxmedi")
    res_p = supa.table("professionals").select("id, cd_origem_sigh").execute()
    prof_map = {r["cd_origem_sigh"]: r["id"] for r in res_p.data if r.get("cd_origem_sigh") is not None}
    res_c = supa.table("insurance_companies").select("id, cd_origem_sigh").execute()
    conv_map = {r["cd_origem_sigh"]: r["id"] for r in res_c.data if r.get("cd_origem_sigh") is not None}
    sb_cols = set(SB_SCHEMA.get("professional_insurances", []))
    data = []
    for r in rows:
        cd_p, cd_c = to_int(r.get("CD_MEDICOR")), to_int(r.get("CD_CONVENIO"))
        if cd_p not in prof_map or cd_c not in conv_map: continue
        rec = {
            "company_id": COMPANY_ID,
            "professional_id": prof_map[cd_p],
            "insurance_company_id": conv_map[cd_c],
            "lg_clinica": r.get("LG_CLINICA", 0) == 1,
            "lg_credenciado": r.get("LG_CREDENCIADO", 0) == 1,
            "lg_ativo": True,
            "cd_origem_sigh": f"{cd_p}_{cd_c}",
            "cd_origem_sigh_combo": f"{cd_p}_{cd_c}",
            "cd_medico": cd_p,
            "cd_convenio": cd_c,
        }
        data.append(rec)
    return push_supa("professional_insurances", filter_cols(data, sb_cols), "cd_origem_sigh")

def migrate_patients():
    print("\n[10/15] patients (SIGH 50593)...")
    sel = pick_sigh_cols("pacientes", ["CD_PACIENTE","DS_NOME","DS_CPF","DT_NASCIMENTO","DS_SEXO","DS_TELEFONE1","DS_EMAIL"])
    rows = query_sigh(f"SELECT {','.join(sel)} FROM pacientes")
    sb_cols = set(SB_SCHEMA.get("patients", []))
    # sex CHECK: F, M, O - mapear SIGH -> F/M/O
    sex_map = {"M":"M","MASCULINO":"M","F":"F","FEMININO":"F","FEM":"F","O":"O","OUTRO":"O","OUTROS":"O"}
    data = []
    for r in rows:
        cpf_raw = str(r.get("DS_CPF") or "").replace(".","").replace("-","")[:11]
        cpf_h = hash_cpf(cpf_raw)
        dt_nasc = safe_date(r.get("DT_NASCIMENTO"))
        rec = {
            "company_id": COMPANY_ID,
            "full_name": (r.get("DS_NOME") or "")[:200],
            "lg_ativo": True,
            "cd_origem_sigh": to_int(r.get("CD_PACIENTE")),
        }
        if cpf_raw:
            rec["cpf"] = cpf_raw
            rec["nr_cpf"] = cpf_raw
            rec["cd_cpf"] = cpf_raw
        if cpf_h: rec["cpf_hash"] = cpf_h
        if dt_nasc:
            rec["birth_date"] = dt_nasc
            rec["dt_nascimento"] = dt_nasc
        if r.get("DS_SEXO"):
            sx = sex_map.get(str(r["DS_SEXO"]).strip().upper(), None)
            if sx:
                rec["sex"] = sx
                rec["cd_sexo"] = sx
        if r.get("DS_TELEFONE1"):
            ph = str(r["DS_TELEFONE1"])[:20]
            rec["phone"] = ph
            rec["nr_telefone"] = ph
        if r.get("DS_EMAIL"):
            em = r["DS_EMAIL"][:200]
            rec["email"] = em
            rec["ds_email"] = em
        data.append(rec)
    return push_supa("patients", filter_cols(data, sb_cols), "cd_origem_sigh", chunk=500)

def migrate_appointments():
    print("\n[11/15] appointments (SIGH 448676)...")
    sel = pick_sigh_cols("agenda", ["CD_AGENDA","CD_PACIENTE","CD_MEDICOR","DT_AGENDA","HR_AGENDA","DS_SITUACAO","DS_OBS"])
    rows = query_sigh(f"SELECT {','.join(sel)} FROM agenda")
    res_pat = supa.table("patients").select("id, cd_origem_sigh").execute()
    pat_map = {r["cd_origem_sigh"]: r["id"] for r in res_pat.data if r.get("cd_origem_sigh") is not None}
    res_prof = supa.table("professionals").select("id, cd_origem_sigh").execute()
    prof_map = {r["cd_origem_sigh"]: r["id"] for r in res_prof.data if r.get("cd_origem_sigh") is not None}
    sb_cols = set(SB_SCHEMA.get("appointments", []))
    status_map = {
        "MARCADO":"scheduled","CONFIRMADO":"scheduled","TRANSF":"scheduled","EXAMES":"scheduled",
        "ATENDIDO":"completed","BLOQUEADO":"blocked",
        "CANCELADO":"cancelled","EXCLUIDO":"cancelled",
        "ESPERANDO":"waiting","ESPERANDO2":"waiting","ENCAIXE":"waiting",
        "FALTOU":"no_show",
    }
    data = []
    skipped = 0
    for r in rows:
        cd_p, cd_m = to_int(r.get("CD_PACIENTE")), to_int(r.get("CD_MEDICOR"))
        if cd_p not in pat_map or cd_m not in prof_map:
            skipped += 1
            continue
        rec = {
            "company_id": COMPANY_ID,
            "patient_id": pat_map[cd_p],
            "professional_id": prof_map[cd_m],
            "appointment_date": safe_date(r.get("DT_AGENDA")) or "2000-01-01",
            "start_time": safe_time(r.get("HR_AGENDA")),
            "status": status_map.get((r.get("DS_SITUACAO") or "").upper(), "scheduled"),
            "cd_origem_sigh": to_int(r.get("CD_AGENDA")),
        }
        if r.get("DS_OBS"):
            obs = str(r["DS_OBS"])[:500]
            rec["notes"] = obs
            rec["ds_observacoes"] = obs
        if r.get("DS_SITUACAO"): rec["tp_status"] = str(r["DS_SITUACAO"])[:50]
        if cd_p: rec["cd_paciente"] = cd_p
        if cd_m: rec["cd_medico"] = cd_m
        data.append(rec)
    print(f"  skipped (FKs faltando): {skipped}")
    return push_supa("appointments", filter_cols(data, sb_cols), "cd_origem_sigh", chunk=1000)

def migrate_medical_records():
    print("\n[12/15] medical_records (anamnese)...")
    for table_sigh in ['anamnese','anamnese2','atendimentos']:
        cols = describe_sigh(table_sigh)
        if not cols: continue
        wanted = ["CD_ANAMNESE","CD_PACIENTE","CD_MEDICOR","DT_ANAMNESE","DS_QUEIXA","DS_HISTORIA","DS_EXAME","DS_HIPOTESE","DS_CONDUTA"]
        sel = [c for c in wanted if c in cols]
        if "CD_PACIENTE" not in sel: continue
        try:
            rows = query_sigh(f"SELECT {','.join(sel)} FROM {table_sigh} LIMIT 5000")
        except: continue
        if not rows: continue
        print(f"  Tabela {table_sigh}: {len(rows)} rows")
        res_pat = supa.table("patients").select("id, cd_origem_sigh").execute()
        pat_map = {r["cd_origem_sigh"]: r["id"] for r in res_pat.data if r.get("cd_origem_sigh") is not None}
        res_prof = supa.table("professionals").select("id, cd_origem_sigh").execute()
        prof_map = {r["cd_origem_sigh"]: r["id"] for r in res_prof.data if r.get("cd_origem_sigh") is not None}
        sb_cols = set(SB_SCHEMA.get("medical_records", []))
        data = []
        for r in rows:
            cd_p = to_int(r.get("CD_PACIENTE"))
            cd_m = to_int(r.get("CD_MEDICOR"))
            if cd_p not in pat_map: continue
            rec = {
                "company_id": COMPANY_ID,
                "patient_id": pat_map[cd_p],
                "lg_ativo": True,
            }
            if cd_m and cd_m in prof_map: rec["professional_id"] = prof_map[cd_m]
            if r.get("DS_QUEIXA"): rec["chief_complaint"] = r["DS_QUEIXA"][:1000]
            if r.get("DS_HISTORIA"): rec["history_present_illness"] = r["DS_HISTORIA"][:2000]
            if r.get("DS_EXAME"): rec["physical_examination"] = r["DS_EXAME"][:2000]
            if r.get("DS_HIPOTESE"): rec["diagnosis"] = r["DS_HIPOTESE"][:1000]
            if r.get("DS_CONDUTA"): rec["treatment_plan"] = r["DS_CONDUTA"][:2000]
            data.append(rec)
        data = filter_cols(data, sb_cols)
        if data:
            return push_supa("medical_records", data, None)
    return 0

def migrate_tiss_xml():
    print("\n[13/15] tiss_xml (SIGH 544)...")
    # status CHECK: PENDENTE, ENVIADO, PROCESSADO, GLOSADO, RECEBIDO, PAGO, CANCELADO, REJEITADO
    cols = describe_sigh("xml")
    sel = [c for c in ["cd_xml","DS_DESCRICAO","DT_FATURA","DS_TIPOGUIA"] if c in cols]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM `xml`")
    sb_cols = set(SB_SCHEMA.get("tiss_xml", []))
    data = []
    for r in rows:
        cd = to_int(r.get("cd_xml"))
        rec = {
            "company_id": COMPANY_ID,
            "ds_descricao": (r.get("DS_DESCRICAO") or f"TISS {cd or ''}")[:200],
            "status": "ENVIADO",
            "tp_status": "ENVIADO",
            "lg_ativo": True,
            "lg_deletado": False,
            "cd_origem_sigh": cd,
        }
        if r.get("DS_DESCRICAO"): rec["nr_protocolo"] = str(r["DS_DESCRICAO"])[:100]
        if r.get("DS_TIPOGUIA"): rec["ds_tipo_guia"] = str(r["DS_TIPOGUIA"])[:20]
        if r.get("DT_FATURA"):
            # DT_FATURA eh DATE no SIGH
            try: rec["dt_fatura"] = str(r["DT_FATURA"])
            except: pass
        data.append(rec)
    return push_supa("tiss_xml", filter_cols(data, sb_cols), "cd_origem_sigh")

def migrate_user_profiles():
    """Tabela 'users' nao existe -> inserir em 'user_profiles' (id UUID)."""
    print("\n[14/15] user_profiles (SIGH 108)...")
    cols = describe_sigh("usuarios")
    sel = [c for c in ["CD_USUARIO","DS_NOME","DS_LOGIN","DS_EMAIL","LG_MASTER","LG_ADMIN","CD_MEDICO_AG","LG_FINANCEIRO","LG_CALLCENTER"] if c in cols]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM usuarios")
    sb_cols = set(SB_SCHEMA.get("user_profiles", []))
    data = []
    for r in rows:
        email = r.get("DS_EMAIL") or f"user{r['CD_USUARIO']}@medilife.local"
        if email and any(local in email.split("@")[0].upper() for local in ["NAOTEM","NAO","NAOPOSSUI"]):
            email = f"user{r['CD_USUARIO']}@medilife.local"
        if r.get("LG_MASTER") == 1: role = "master"
        elif r.get("LG_ADMIN") == 1: role = "admin"
        elif (r.get("CD_MEDICO_AG") or 0) > 0: role = "doctor"
        else: role = "staff"
        rec = {
            "id": str(uuid.uuid4()),
            "company_id": COMPANY_ID,
            "full_name": (r.get("DS_NOME") or "")[:200],
            "email": email[:200],
            "role_name": role,
            "lg_ativo": True,
        }
        data.append(rec)
    return push_supa("user_profiles", filter_cols(data, sb_cols), None)

def validate_counts():
    print("\n" + "="*70)
    print("VALIDACAO FINAL")
    print("="*70)
    import requests
    expected = {
        "units": 7, "specialties": None, "professionals": 144,
        "insurance_companies": 992, "insurance_plans": 395, "payment_sources": 53,
        "services_catalog": 4953, "fornecedores": 143,
        "professional_insurances": 48173, "patients": 50593, "appointments": 448676,
        "tiss_xml": 544, "user_profiles": 108,
    }
    for tbl, exp in expected.items():
        try:
            r = requests.get(f"{SUPABASE_URL}/rest/v1/{tbl}?select=id",
                headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}", "Prefer": "count=exact"}, timeout=30)
            cr = r.headers.get("content-range", "n/a")
            actual = 0
            if "/" in cr:
                p = cr.split("/")[-1]
                if p.isdigit(): actual = int(p)
            status = "OK" if (exp is None or actual >= exp * 0.95) else "BAIXO"
            print(f"  {tbl:30} {actual:>10,}  (esperado: {exp:,})  {status}")
        except Exception as e:
            print(f"  {tbl:30} ERRO: {str(e)[:60]}")

def main():
    print("="*70)
    print(f"MIGRACAO FINAL SIGH -> SUPABASE PRODUCAO")
    print("="*70)
    start = time.time()
    counts = {}
    for name, fn in [
        ("units", migrate_units), ("specialties", migrate_specialties),
        ("professionals", migrate_professionals), ("insurance_companies", migrate_insurance_companies),
        ("insurance_plans", migrate_insurance_plans), ("payment_sources", migrate_payment_sources),
        ("services_catalog", migrate_services_catalog), ("fornecedores", migrate_fornecedores),
        ("professional_insurances", migrate_professional_insurances),
        ("patients", migrate_patients), ("appointments", migrate_appointments),
        ("medical_records", migrate_medical_records), ("tiss_xml", migrate_tiss_xml),
        ("user_profiles", migrate_user_profiles),
    ]:
        try:
            counts[name] = fn()
        except Exception as e:
            print(f"  ! {name}: {e}")
            counts[name] = 0
    elapsed = time.time() - start
    print("\n" + "="*70)
    print("MIGRACAO COMPLETA - RESUMO")
    print("="*70)
    total = 0
    for tbl, cnt in counts.items():
        print(f"  {tbl:30} {cnt:>10,}")
        if isinstance(cnt, int): total += cnt
    print(f"\n  Tempo: {elapsed:.1f}s")
    print(f"  Total: {total:,} registros")
    print("="*70)
    validate_counts()

if __name__ == "__main__":
    main()
