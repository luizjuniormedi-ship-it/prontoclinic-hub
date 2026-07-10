#!/usr/bin/env python3
"""
MIGRACAO COMPLETA SIGH -> SUPABASE PRODUCAO (versao robusta)
Auto-detecta schema do Supabase
"""

import os, sys, time, pymysql, hashlib, secrets, string, csv
from datetime import datetime
from supabase import create_client
from dotenv import load_dotenv

load_dotenv(dotenv_path=".env.production")

SIGH_CONFIG = {
    "host": os.environ["SIGH_HOST"], "port": int(os.getenv("SIGH_PORT", "3306")),
    "user": os.environ["SIGH_USER"], "password": os.environ["SIGH_PASSWORD"],
    "database": os.getenv("SIGH_DATABASE", "DataSIGH"), "charset": "utf8", "connect_timeout": 30,
}

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL", "https://rhqgwrarkotjzdcrkbgn.supabase.co")
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SERVICE_ROLE_KEY:
    print("ERRO: SUPABASE_SERVICE_ROLE_KEY nao configurado")
    sys.exit(1)

print(f"[INIT] Supabase: {SUPABASE_URL}")
print(f"[INIT] SIGH: {SIGH_CONFIG['host']}:{SIGH_CONFIG['port']}")

sigh = pymysql.connect(**SIGH_CONFIG, cursorclass=pymysql.cursors.DictCursor)
supa = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)


def query_sigh(sql, params=None):
    cur = sigh.cursor()
    cur.execute(sql, params or ())
    return cur.fetchall()


def push_supa(table, data, conflict_col="cd_origem_sigh"):
    if not data:
        return 0
    try:
        res = supa.table(table).upsert(data, on_conflict=conflict_col).execute()
        return len(res.data) if res.data else 0
    except Exception as e:
        msg = str(e)[:200]
        if "duplicate" in msg.lower():
            return 0
        print(f"  ! {table}: {msg}")
        return 0


def hash_cpf(cpf):
    if not cpf: return None
    clean = ''.join(c for c in str(cpf) if c.isdigit())
    if len(clean) < 11: return None
    return hashlib.sha256(clean.encode()).hexdigest()


# ============================================================
# SIGH -> Supabase mappings
# ============================================================
# Tabela SIGH.unidades tem apenas:
# CD_UNIDADE, DS_UNIDADE, DS_RAZAO_SOCIAL, DS_CNPJ, DS_ENDERECO,
# DS_CIDADE, DS_ESTADO, DS_CEP, DS_CNES, DS_COD_OPERADORA, DS_EMAIL_MAPA,
# LG_SITE, DS_SIGLA
# Sem NR_TELEFONE!

# Descobrir schema real da tabela medicor
print("\n[DISCOVERY] Schema medicor SIGH:")
for r in query_sigh("DESCRIBE medicor"):
    print(f"  {r['Field']} : {r['Type']}")
print("\n[DISCOVERY] Schema pacientes SIGH:")
for r in query_sigh("DESCRIBE pacientes")[:15]:
    print(f"  {r['Field']} : {r['Type']}")
print("\n[DISCOVERY] Schema agenda SIGH:")
for r in query_sigh("DESCRIBE agenda")[:15]:
    print(f"  {r['Field']} : {r['Type']}")


def migrate_units():
    print("\n[1/15] units...")
    rows = query_sigh("SELECT CD_UNIDADE, DS_UNIDADE, DS_ENDERECO, DS_CNPJ, DS_CNES, DS_CIDADE, DS_ESTADO, DS_CEP FROM unidades")
    data = []
    for r in rows:
        data.append({
            "id": r['CD_UNIDADE'],  # usar CD_UNIDADE como id
            "name": r['DS_UNIDADE'][:100],
            "code": f"U{r['CD_UNIDADE']:03d}",
            "address": (r.get('DS_ENDERECO') or '')[:200] or None,
            "cnpj": (r.get('DS_CNPJ') or '')[:14] or None,
            "city": (r.get('DS_CIDADE') or '')[:100] or None,
            "state": (r.get('DS_ESTADO') or '')[:2] or None,
            "zip_code": (r.get('DS_CEP') or '')[:10] or None,
            "lg_ativo": True,
        })
    return push_supa("units", data, "id")


def migrate_specialties():
    print("\n[2/15] specialties...")
    rows = query_sigh("SELECT DISTINCT DS_ESPECIALIDADE FROM medicor WHERE DS_ESPECIALIDADE IS NOT NULL AND DS_ESPECIALIDADE != ''")
    data = []
    seen = set()
    for r in rows:
        name = r['DS_ESPECIALIDADE'].strip()[:100]
        if name and name not in seen:
            seen.add(name)
            data.append({
                "name": name,
                "code": f"ESP{len(data)+1:03d}",
                "lg_ativo": True,
            })
    return push_supa("specialties", data, "name")


def migrate_professionals():
    print("\n[3/15] professionals...")
    # Descobrir schema real
    cols = [r['Field'] for r in query_sigh("DESCRIBE medicor")]
    select_cols = []
    for c in ['CD_MEDICO', 'DS_NOME', 'NR_CRM', 'DS_ESPECIALIDADE', 'DS_TELEFONE', 'DS_EMAIL']:
        if c in cols:
            select_cols.append(c)
    rows = query_sigh(f"SELECT {','.join(select_cols)} FROM medicor")
    data = []
    for r in rows:
        data.append({
            "id": r.get('CD_MEDICO'),
            "full_name": r.get('DS_NOME', '')[:200],
            "crm": str(r.get('NR_CRM') or '')[:20] or None,
            "specialty": (r.get('DS_ESPECIALIDADE') or '')[:100] or None,
            "phone": (r.get('DS_TELEFONE') or '')[:20] or None,
            "email": (r.get('DS_EMAIL') or '')[:200] or None,
            "lg_ativo": True,
        })
    return push_supa("professionals", data, "id")


def migrate_insurance_companies():
    print("\n[4/15] insurance_companies...")
    cols = [r['Field'] for r in query_sigh("DESCRIBE convenios")]
    sel = []
    for c in ['CD_CONVENIO', 'DS_RAZAO_SOCIAL', 'DS_NOME_FANTASIA', 'NR_CNPJ', 'NR_REGISTRO_ANS', 'DS_TELEFONE1', 'DS_ENDERECO', 'DS_CIDADE', 'DS_ESTADO', 'DS_CEP', 'LG_ATIVO']:
        if c in cols:
            sel.append(c)
    rows = query_sigh(f"SELECT {','.join(sel)} FROM convenios")
    data = []
    for r in rows:
        data.append({
            "id": r.get('CD_CONVENIO'),
            "name": (r.get('DS_NOME_FANTASIA') or r.get('DS_RAZAO_SOCIAL') or f"Convenio {r.get('CD_CONVENIO', '')}")[:200],
            "code": r.get('NR_REGISTRO_ANS') or None,
            "type": "convenio",
            "cnpj": (r.get('NR_CNPJ') or '')[:14] or None,
            "phone": (r.get('DS_TELEFONE1') or '')[:20] or None,
            "address": (r.get('DS_ENDERECO') or '')[:200] or None,
            "city": (r.get('DS_CIDADE') or '')[:100] or None,
            "state": (r.get('DS_ESTADO') or '')[:2] or None,
            "zip_code": (r.get('DS_CEP') or '')[:10] or None,
            "lg_ativo": r.get('LG_ATIVO', 1) == 1,
        })
    return push_supa("insurance_companies", data, "id")


def migrate_insurance_plans():
    print("\n[5/15] insurance_plans...")
    cols = [r['Field'] for r in query_sigh("DESCRIBE convenio_planos")]
    sel = [c for c in ['CD_PLANO', 'CD_CONVENIO', 'DS_PLANO', 'DS_CODIGO_PLANO', 'VL_PLANO'] if c in cols]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM convenio_planos")
    res = supa.table("insurance_companies").select("id").execute()
    conv_ids = {r['id'] for r in res.data}
    data = []
    for r in rows:
        if r.get('CD_CONVENIO') not in conv_ids:
            continue
        data.append({
            "id": r.get('CD_PLANO'),
            "insurance_company_id": r.get('CD_CONVENIO'),
            "name": (r.get('DS_PLANO') or f"Plano {r.get('CD_PLANO', '')}")[:200],
            "code": (r.get('DS_CODIGO_PLANO') or '')[:50] or None,
            "monthly_price": float(r['VL_PLANO']) if r.get('VL_PLANO') else None,
            "lg_ativo": True,
        })
    return push_supa("insurance_plans", data, "id")


def migrate_payment_sources():
    print("\n[6/15] payment_sources...")
    cols = [r['Field'] for r in query_sigh("DESCRIBE fonte_pagadora")]
    sel = [c for c in ['CD_FONTE_PAGADORA', 'DS_FONTE_PAGADORA', 'LG_ATIVO'] if c in cols]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM fonte_pagadora")
    data = []
    for r in rows:
        name = r.get('DS_FONTE_PAGADORA', '')[:100]
        if not name:
            continue
        tp = "sus" if "SUS" in name.upper() else "particular" if "PARTICULAR" in name.upper() else "convenio"
        data.append({
            "id": r.get('CD_FONTE_PAGADORA'),
            "name": name,
            "type": tp,
            "lg_ativo": r.get('LG_ATIVO', 1) == 1,
        })
    return push_supa("payment_sources", data, "id")


def migrate_services_catalog():
    print("\n[7/15] services_catalog (4952)...")
    cols = [r['Field'] for r in query_sigh("DESCRIBE servicos")]
    sel = [c for c in ['CD_SERVICO', 'DS_SERVICO', 'VL_SERVICO', 'DS_CODIGO'] if c in cols]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM servicos")
    data = []
    for r in rows:
        data.append({
            "id": r.get('CD_SERVICO'),
            "code": (r.get('DS_CODIGO') or '')[:50] or None,
            "name": (r.get('DS_SERVICO') or '')[:200],
            "price": float(r.get('VL_SERVICO') or 0),
            "lg_ativo": True,
        })
    total = 0
    for i in range(0, len(data), 500):
        total += push_supa("services_catalog", data[i:i+500], "id")
    return total


def migrate_fornecedores():
    print("\n[8/15] fornecedores (143)...")
    cols = [r['Field'] for r in query_sigh("DESCRIBE fornecedores")]
    sel = [c for c in ['CD_FORNECEDOR', 'DS_RAZAO_SOCIAL', 'DS_NOME_FANTASIA', 'NR_CNPJ', 'DS_TELEFONE', 'DS_EMAIL', 'DS_ENDERECO'] if c in cols]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM fornecedores")
    data = []
    for r in rows:
        data.append({
            "id": r.get('CD_FORNECEDOR'),
            "name": (r.get('DS_NOME_FANTASIA') or r.get('DS_RAZAO_SOCIAL') or '')[:200],
            "cnpj": (r.get('NR_CNPJ') or '')[:14] or None,
            "phone": (r.get('DS_TELEFONE') or '')[:20] or None,
            "email": (r.get('DS_EMAIL') or '')[:200] or None,
            "address": (r.get('DS_ENDERECO') or '')[:200] or None,
            "lg_ativo": True,
        })
    return push_supa("fornecedores", data, "id")


def migrate_professional_insurances():
    print("\n[9/15] professional_insurances (48172)...")
    cols = [r['Field'] for r in query_sigh("DESCRIBE convxmedi")]
    sel = [c for c in ['CD_MEDICO', 'CD_CONVENIO', 'LG_CLINICA', 'LG_CREDENCIADO', 'DS_OBS'] if c in cols]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM convxmedi")
    res_p = supa.table("professionals").select("id").execute()
    prof_ids = {r['id'] for r in res_p.data}
    res_c = supa.table("insurance_companies").select("id").execute()
    conv_ids = {r['id'] for r in res_c.data}
    data = []
    for r in rows:
        if r.get('CD_MEDICO') not in prof_ids or r.get('CD_CONVENIO') not in conv_ids:
            continue
        data.append({
            "professional_id": r.get('CD_MEDICO'),
            "insurance_company_id": r.get('CD_CONVENIO'),
            "lg_clinica": r.get('LG_CLINICA', 0) == 1,
            "lg_credenciado": r.get('LG_CREDENCIADO', 0) == 1,
            "lg_ativo": True,
        })
    total = 0
    for i in range(0, len(data), 500):
        total += push_supa("professional_insurances", data[i:i+500], "professional_id,insurance_company_id")
    return total


def migrate_patients():
    print("\n[10/15] patients (50593)...")
    cols = [r['Field'] for r in query_sigh("DESCRIBE pacientes")]
    sel = [c for c in ['CD_PACIENTE', 'DS_NOME', 'DS_CPF', 'DT_NASCIMENTO', 'DS_SEXO', 'DS_TELEFONE1', 'DS_EMAIL', 'DS_ENDERECO', 'DS_BAIRRO', 'DS_CIDADE', 'DS_ESTADO', 'DS_CEP', 'LG_ATIVO'] if c in cols]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM pacientes")
    data = []
    for r in rows:
        cpf_raw = (r.get('DS_CPF') or '').replace('.', '').replace('-', '')[:11]
        cpf_h = hash_cpf(cpf_raw) if cpf_raw else None
        dt_nasc = None
        if r.get('DT_NASCIMENTO') and r['DT_NASCIMENTO'] > 0:
            try:
                s = str(r['DT_NASCIMENTO'])
                if len(s) == 8:
                    dt_nasc = f"{s[:4]}-{s[4:6]}-{s[6:8]}"
            except: pass
        data.append({
            "id": r.get('CD_PACIENTE'),
            "company_id": "6ca68729-bd31-4bc3-9d30-477bf5302de9",  # POLICLINICA MEDILIFE
            "full_name": (r.get('DS_NOME') or '')[:200],
            "cpf": cpf_raw or None,
            "cpf_hash": cpf_h,
            "birth_date": dt_nasc,
            "sex": (r.get('DS_SEXO') or '')[:1] or None,
            "phone": (r.get('DS_TELEFONE1') or '')[:20] or None,
            "email": (r.get('DS_EMAIL') or '')[:200] or None,
            "lg_ativo": r.get('LG_ATIVO', 1) == 1,
        })
    total = 0
    for i in range(0, len(data), 500):
        total += push_supa("patients", data[i:i+500], "id")
        if i % 10000 == 0: print(f"  ... {i}/{len(data)}")
    return total


def migrate_appointments():
    print("\n[11/15] appointments (448676)...")
    cols = [r['Field'] for r in query_sigh("DESCRIBE agenda")]
    sel = [c for c in ['CD_AGENDA', 'CD_PACIENTE', 'CD_MEDICO', 'DT_AGENDA', 'HR_AGENDA', 'DS_SITUACAO'] if c in cols]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM agenda")
    res_pat = supa.table("patients").select("id").execute()
    pat_ids = {r['id'] for r in res_pat.data}
    res_prof = supa.table("professionals").select("id").execute()
    prof_ids = {r['id'] for r in res_prof.data}
    status_map = {
        "MARCADO": "scheduled", "CONFIRMADO": "scheduled", "TRANSF": "scheduled", "EXAMES": "scheduled",
        "ATENDIDO": "completed", "BLOQUEADO": "blocked",
        "CANCELADO": "cancelled", "EXCLUIDO": "cancelled",
        "ESPERANDO": "waiting", "ESPERANDO2": "waiting", "ENCAIXE": "waiting",
        "FALTOU": "no_show",
    }
    data = []
    for r in rows:
        if r.get('CD_PACIENTE') not in pat_ids or r.get('CD_MEDICO') not in prof_ids:
            continue
        dt = "2000-01-01"
        if r.get('DT_AGENDA') and 20000000 < r['DT_AGENDA'] < 40000000:
            try:
                s = str(r['DT_AGENDA'])
                if len(s) == 8:
                    dt = f"{s[:4]}-{s[4:6]}-{s[6:8]}"
            except: pass
        hr = "08:00:00"
        if r.get('HR_AGENDA'):
            try:
                hr_s = str(int(r['HR_AGENDA'])).zfill(4)
                hr = f"{hr_s[:2]}:{hr_s[2:4]}:00"
            except: pass
        data.append({
            "id": r.get('CD_AGENDA'),
            "patient_id": r.get('CD_PACIENTE'),
            "professional_id": r.get('CD_MEDICO'),
            "appointment_date": dt,
            "start_time": hr,
            "status": status_map.get((r.get('DS_SITUACAO') or '').upper(), "scheduled"),
            "lg_ativo": True,
        })
    total = 0
    for i in range(0, len(data), 1000):
        total += push_supa("appointments", data[i:i+1000], "id")
        if i % 20000 == 0: print(f"  ... {i}/{len(data)}")
    return total


def migrate_medical_records():
    print("\n[12/15] medical_records (1419)...")
    # Tentar anamnese2 primeiro, depois evolucao
    for table_sigh in ['anamnese2', 'evolucao']:
        try:
            cols = [r['Field'] for r in query_sigh(f"DESCRIBE {table_sigh}")]
            if not cols: continue
            sel = [c for c in ['CD_ANAMNESE', 'CD_PACIENTE', 'CD_MEDICO', 'DT_ANAMNESE', 'DS_QUEIXA', 'DS_HISTORIA', 'DS_EXAME', 'DS_HIPOTESE', 'DS_CONDUTA'] if c in cols]
            if 'CD_PACIENTE' not in sel: continue
            rows = query_sigh(f"SELECT {','.join(sel)} FROM {table_sigh} WHERE CD_PACIENTE > 0 LIMIT 2000")
            if not rows: continue
            res_pat = supa.table("patients").select("id").execute()
            pat_ids = {r['id'] for r in res_pat.data}
            res_prof = supa.table("professionals").select("id").execute()
            prof_ids = {r['id'] for r in res_prof.data}
            data = []
            for r in rows:
                if r.get('CD_PACIENTE') not in pat_ids or r.get('CD_MEDICO', 0) not in prof_ids:
                    continue
                dt = "2000-01-01"
                if r.get('DT_ANAMNESE') and 20000000 < r['DT_ANAMNESE'] < 40000000:
                    try:
                        s = str(r['DT_ANAMNESE'])
                        if len(s) == 8: dt = f"{s[:4]}-{s[4:6]}-{s[6:8]}"
                    except: pass
                data.append({
                    "id": r.get('CD_ANAMNESE'),
                    "patient_id": r.get('CD_PACIENTE'),
                    "professional_id": r.get('CD_MEDICO'),
                    "dt_atendimento": dt,
                    "ds_queixa_principal": (r.get('DS_QUEIXA') or '')[:1000] or None,
                    "ds_historia_doenca": (r.get('DS_HISTORIA') or '')[:2000] or None,
                    "ds_exame_fisico": (r.get('DS_EXAME') or '')[:2000] or None,
                    "ds_hipotese_diagnostica": (r.get('DS_HIPOTESE') or '')[:1000] or None,
                    "ds_conduta": (r.get('DS_CONDUTA') or '')[:2000] or None,
                    "lg_ativo": True,
                })
            if data:
                return push_supa("medical_records", data, "id")
        except Exception as e:
            print(f"  ! {table_sigh}: {e}")
    return 0


def migrate_tiss_xml():
    print("\n[13/15] tiss_xml (544)...")
    cols = [r['Field'] for r in query_sigh("DESCRIBE `xml`")]
    sel = [c for c in ['cd_xml', 'DS_DESCRICAO', 'DS_TIPOGUIA', 'DT_FATURA', 'LG_ATIVO'] if c.lower() in [col.lower() for col in cols]]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM `xml`")
    data = []
    for r in rows:
        data.append({
            "id": r.get('cd_xml'),
            "nr_protocolo": (r.get('DS_DESCRICAO') or f"PROT-{r.get('cd_xml','')}")[:100],
            "tp_status": 'enviado',
            "lg_ativo": r.get('LG_ATIVO', 1) == 1,
        })
    return push_supa("tiss_xml", data, "id")


def migrate_pre_cadastro():
    print("\n[14/15] pre_cadastro (se houver)...")
    try:
        rows = query_sigh("SELECT * FROM pre_cadastro WHERE LG_ATIVO=1")
        if not rows: return 0
        cols = [r['Field'] for r in rows[0].keys()]
        sel = [c for c in ['CD_PACASTRO', 'NM_PACIENTE', 'NR_CPF', 'DS_EMAIL', 'NR_TELEFONE', 'DT_NASCIMENTO', 'DS_OBS'] if c in cols]
        data = []
        for r in rows:
            data.append({
                "id": r.get('CD_PACASTRO'),
                "full_name": (r.get('NM_PACIENTE') or '')[:200],
                "cpf": (r.get('NR_CPF') or '')[:11] or None,
                "email": (r.get('DS_EMAIL') or '')[:200] or None,
                "phone": (r.get('NR_TELEFONE') or '')[:20] or None,
                "lg_ativo": True,
            })
        return push_supa("pre_cadastro", data, "id")
    except:
        return 0


def migrate_users():
    print("\n[15/15] users (108)...")
    cols = [r['Field'] for r in query_sigh("DESCRIBE usuarios")]
    sel = [c for c in ['CD_USUARIO', 'DS_NOME', 'DS_LOGIN', 'DS_EMAIL', 'LG_MASTER', 'LG_ADMIN', 'LG_MEDICO_AG', 'LG_FINANCEIRO', 'LG_CALLCENTER'] if c in cols]
    rows = query_sigh(f"SELECT {','.join(sel)} FROM usuarios")
    users_data = []
    for r in rows:
        email = r.get('DS_EMAIL') or f"user{r['CD_USUARIO']}@medilife.local"
        if email and any(local in email.split('@')[0].upper() for local in ['NAOTEM', 'NAO', 'NAOPOSSUI']):
            email = f"user{r['CD_USUARIO']}@medilife.local"
        # Role
        if r.get('LG_MASTER') == 1: role = "master"
        elif r.get('LG_ADMIN') == 1: role = "admin"
        elif r.get('LG_MEDICO_AG', 0) > 0: role = "doctor"
        else: role = "staff"
        users_data.append({
            "id": r['CD_USUARIO'],
            "full_name": r['DS_NOME'][:200],
            "login": r.get('DS_LOGIN', ''),
            "email": email[:200],
            "role_name": role,
            "lg_ativo": True,
        })
    # Cria na tabela users (sem auth - porque prod não tem tabela auth)
    if users_data:
        try:
            return push_supa("users", users_data, "id")
        except Exception as e:
            print(f"  ! users table: {e}")
    return 0


def main():
    print("="*70)
    print("MIGRACAO COMPLETA SIGH -> SUPABASE PRODUCAO")
    print(f"Alvo: {SUPABASE_URL}")
    print("="*70)
    start = time.time()
    counts = {}
    counts['units'] = migrate_units()
    counts['specialties'] = migrate_specialties()
    counts['professionals'] = migrate_professionals()
    counts['insurance_companies'] = migrate_insurance_companies()
    counts['insurance_plans'] = migrate_insurance_plans()
    counts['payment_sources'] = migrate_payment_sources()
    counts['services_catalog'] = migrate_services_catalog()
    counts['fornecedores'] = migrate_fornecedores()
    counts['professional_insurances'] = migrate_professional_insurances()
    counts['patients'] = migrate_patients()
    counts['appointments'] = migrate_appointments()
    counts['medical_records'] = migrate_medical_records()
    counts['tiss_xml'] = migrate_tiss_xml()
    counts['pre_cadastro'] = migrate_pre_cadastro()
    counts['users'] = migrate_users()
    elapsed = time.time() - start
    print("\n" + "="*70)
    print("MIGRACAO COMPLETA - RESUMO")
    print("="*70)
    total = 0
    for tbl, cnt in counts.items():
        print(f"  {tbl:30} {cnt:>10,}")
        if isinstance(cnt, int): total += cnt
    print(f"\n  Tempo: {elapsed:.1f}s ({elapsed/60:.1f} min)")
    print(f"  Total: {total:,} registros")
    print("="*70)


if __name__ == "__main__":
    main()

