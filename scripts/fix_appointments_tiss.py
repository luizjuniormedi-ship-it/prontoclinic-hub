#!/usr/bin/env python3
"""Fix appointments e tiss_xml que falharam."""
import os, sys, time, pymysql
from supabase import create_client
from dotenv import load_dotenv

load_dotenv(dotenv_path=".env.production")

SIGH_CONFIG = {
    "host": "6083041e1bde.sn.mynetname.net", "port": 47777,
    "user": "42533813000197", "password": "42533813000197@connect56MF",
    "database": "DataSIGH", "charset": "utf8", "connect_timeout": 30,
}
URL = "https://rhqgwrarkotjzdcrkbgn.supabase.co"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJocWd3cmFya290anpkY3JrYmduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjMwMTIwOSwiZXhwIjoyMDk3ODc3MjA5fQ.3WhaTnlwP_4tKFhM57O7japgwvP_03v2C7zlQaWDfW8"
COMPANY_ID = "de0007c4-d688-4e89-aeb4-32f5ec96e558"

sigh = pymysql.connect(**SIGH_CONFIG, cursorclass=pymysql.cursors.DictCursor)
supa = create_client(URL, KEY)

def query_sigh(sql):
    cur = sigh.cursor()
    cur.execute(sql)
    return cur.fetchall()

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
        n = int(t)
        if n < 0 or n > 2400: return default
        s = str(n).zfill(4)
        h, m = int(s[:2]), int(s[2:4])
        if h > 23 or m > 59: return default
        return f"{h:02d}:{m:02d}:00"
    except: return default

def to_int(v):
    if v is None or v == "": return None
    try: return int(v)
    except: return None

def push(table, data, conflict=None, chunk=1000):
    if not data: return 0
    total = 0
    err = 0
    for i in range(0, len(data), chunk):
        try:
            if conflict:
                r = supa.table(table).upsert(data[i:i+chunk], on_conflict=conflict).execute()
            else:
                r = supa.table(table).insert(data[i:i+chunk]).execute()
            total += len(r.data) if r.data else 0
        except Exception as e:
            err += 1
            if err <= 1: print(f"  ! {table}: {str(e)[:200]}")
    return total

# ============================================================================
# APPOINTMENTS
# ============================================================================
# Primeiro: inserir profissionais faltantes (medicos com agenda mas sem CD_MEDICOR em medicor)
print("[FIX] Profissionais faltantes de agenda...")
import uuid as _uuid
cur_medicor = supa.table("professionals").select("id, cd_origem_sigh").execute()
existing_profs = {r["cd_origem_sigh"]: r["id"] for r in cur_medicor.data if r.get("cd_origem_sigh") is not None}
# Buscar medicos unicos em agenda
agenda_medics = query_sigh("SELECT DISTINCT CD_MEDICOR FROM agenda WHERE CD_MEDICOR > 0")
new_profs = []
for r in agenda_medics:
    cd = to_int(r.get("CD_MEDICOR"))
    if cd and cd not in existing_profs:
        new_profs.append({
            "company_id": COMPANY_ID,
            "full_name": f"Medico #{cd}",
            "lg_ativo": True,
            "cd_origem_sigh": cd,
        })
if new_profs:
    print(f"  Inserindo {len(new_profs)} profissionais faltantes...")
    push("professionals", new_profs, "cd_origem_sigh")
# Refazer o map
res_prof = supa.table("professionals").select("id, cd_origem_sigh").execute()
prof_map = {r["cd_origem_sigh"]: r["id"] for r in res_prof.data if r.get("cd_origem_sigh") is not None}
print(f"  Total profissionais agora: {len(prof_map)}")

# ============================================================================
# APPOINTMENTS
# ============================================================================
print("[FIX] Appointments...")
# Paginacao completa de patients
pat_map = {}
off = 0
while True:
    res = supa.table("patients").select("id, cd_origem_sigh").range(off, off+999).execute()
    if not res.data: break
    for r in res.data:
        if r.get("cd_origem_sigh") is not None:
            pat_map[r["cd_origem_sigh"]] = r["id"]
    if len(res.data) < 1000: break
    off += 1000
print(f"  patients map: {len(pat_map)}")
res_prof = supa.table("professionals").select("id, cd_origem_sigh").execute()
prof_map = {r["cd_origem_sigh"]: r["id"] for r in res_prof.data if r.get("cd_origem_sigh") is not None}
print(f"  professionals map: {len(prof_map)}")

rows = query_sigh("SELECT CD_AGENDA, CD_PACIENTE, CD_MEDICOR, DT_AGENDA, HR_AGENDA, DS_SITUACAO, DS_OBS FROM agenda")
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
print(f"  Total: {len(data)}, skipped: {skipped}")
total = push("appointments", data, "cd_origem_sigh")
print(f"  Inseridos: {total}")

# ============================================================================
# TISS_XML - tipo_guia check: CONSULTA, SP/SADT, INTERNACAO, HONORARIO, ODONTOLOGIA, AUXILIAR
# ============================================================================
print("\n[FIX] TISS XML...")
tipo_map = {
    "CONSULTA":"CONSULTA", "SP/SADT":"SP/SADT", "SADT":"SP/SADT",
    "INTERNACAO":"INTERNACAO", "HONORARIO":"HONORARIO",
    "ODONTOLOGIA":"ODONTOLOGIA", "AUXILIAR":"AUXILIAR",
}
rows = query_sigh("SELECT cd_xml, DS_DESCRICAO, DT_FATURA, DS_TIPOGUIA FROM `xml`")
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
    tg = r.get("DS_TIPOGUIA")
    if tg:
        tg_norm = tipo_map.get(str(tg).strip().upper())
        if tg_norm: rec["ds_tipo_guia"] = tg_norm
    if r.get("DT_FATURA"):
        try: rec["dt_fatura"] = str(r["DT_FATURA"])
        except: pass
    data.append(rec)
print(f"  Total: {len(data)}")
total = push("tiss_xml", data, "cd_origem_sigh")
print(f"  Inseridos: {total}")

# ============================================================================
# USER_PROFILES - inserir 108 (ja deletamos os 216)
# ============================================================================
print("\n[FIX] User profiles...")
import uuid
rows = query_sigh("SELECT CD_USUARIO, DS_NOME, DS_LOGIN, DS_EMAIL, LG_MASTER, LG_ADMIN, CD_MEDICO_AG, LG_FINANCEIRO, LG_CALLCENTER FROM usuarios")
data = []
for r in rows:
    email = r.get("DS_EMAIL") or f"user{r['CD_USUARIO']}@medilife.local"
    if email and any(local in email.split("@")[0].upper() for local in ["NAOTEM","NAO","NAOPOSSUI"]):
        email = f"user{r['CD_USUARIO']}@medilife.local"
    if r.get("LG_MASTER") == 1: role = "master"
    elif r.get("LG_ADMIN") == 1: role = "admin"
    elif (r.get("CD_MEDICO_AG") or 0) > 0: role = "doctor"
    else: role = "staff"
    data.append({
        "id": str(uuid.uuid4()),
        "company_id": COMPANY_ID,
        "full_name": (r.get("DS_NOME") or "")[:200],
        "email": email[:200],
        "role_name": role,
        "lg_ativo": True,
    })
print(f"  Total: {len(data)}")
total = push("user_profiles", data, None)
print(f"  Inseridos: {total}")
