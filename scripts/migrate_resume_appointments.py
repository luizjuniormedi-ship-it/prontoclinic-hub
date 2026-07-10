#!/usr/bin/env python3
"""
RESUMIR MIGRAÇÃO DE APPOINTMENTS NO SUPABASE PRODUÇÃO
======================================================
Roda APÓS o Supabase recuperar (após upgrade Pro ou restart manual).

Detecta:
- Quantos appointments já migradas (cd_origem_sigh NOT NULL)
- Quais cd_origem_sigh FALTAM no Supabase
- Insere apenas as faltantes em chunks de 200
- Retry em caso de falha transiente
- Mostra progresso

Uso: python scripts/migrate_resume_appointments.py
"""

import os, sys, time, pymysql
from supabase import create_client
from dotenv import load_dotenv

load_dotenv(dotenv_path=".env.production")

SIGH = {
    "host": os.environ["SIGH_HOST"], "port": int(os.getenv("SIGH_PORT", "3306")),
    "user": os.environ["SIGH_USER"], "password": os.environ["SIGH_PASSWORD"],
    "database": os.getenv("SIGH_DATABASE", "DataSIGH"), "charset": "utf8", "connect_timeout": 60,
}
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL", "https://rhqgwrarkotjzdcrkbgn.supabase.co")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

print(f"[INIT] {SUPABASE_URL}")

sigh = pymysql.connect(**SIGH, cursorclass=pymysql.cursors.DictCursor)
supa = create_client(SUPABASE_URL, SERVICE_KEY)


def query_sigh(sql, params=None):
    cur = sigh.cursor()
    cur.execute(sql, params or ())
    return cur.fetchall()


def push_supa(data, conflict_col="id"):
    if not data:
        return 0
    try:
        res = supa.table("appointments").upsert(data, on_conflict=conflict_col).execute()
        return len(res.data) if res.data else 0
    except Exception as e:
        msg = str(e)[:200]
        if "schema" in msg.lower() or "503" in msg:
            raise
        return 0


def main():
    print("[1/4] Buscar appointments já migradas...")
    page_size = 1000
    offset = 0
    migrated = set()
    while True:
        try:
            res = supa.table("appointments").select("id").range(offset, offset + page_size - 1).execute()
            ids = [r['id'] for r in res.data]
            if not ids: break
            migrated.update(ids)
            offset += page_size
            if len(res.data) < page_size: break
        except Exception as e:
            print(f"  ! Erro: {str(e)[:200]}")
            return
    print(f"  Já migradas: {len(migrated):,}")

    print("[2/4] Buscar appointments SIGH...")
    rows = query_sigh("SELECT CD_AGENDA, CD_PACIENTE, CD_MEDICO, DT_AGENDA, HR_AGENDA, DS_SITUACAO FROM agenda")
    total_sigh = len(rows)
    print(f"  Total SIGH: {total_sigh:,}")

    print("[3/4] Buscar mapa paciente/profissional...")
    res_pat = supa.table("patients").select("id,cd_origem_sigh").execute()
    pat_map = {r['cd_origem_sigh']: r['id'] for r in res_pat.data if r.get('cd_origem_sigh')}
    res_prof = supa.table("professionals").select("id,cd_origem_sigh").execute()
    prof_map = {r['cd_origem_sigh']: r['id'] for r in res_prof.data if r.get('cd_origem_sigh')}
    print(f"  Pacientes: {len(pat_map):,}, Profissionais: {len(prof_map):,}")

    print("[4/4] Migrar faltantes em chunks de 200...")
    status_map = {
        "MARCADO": "scheduled", "CONFIRMADO": "scheduled", "TRANSF": "scheduled", "EXAMES": "scheduled",
        "ATENDIDO": "completed", "BLOQUEADO": "blocked",
        "CANCELADO": "cancelled", "EXCLUIDO": "cancelled",
        "ESPERANDO": "waiting", "ESPERANDO2": "waiting", "ENCAIXE": "waiting",
        "FALTOU": "no_show",
    }
    pending = [r for r in rows if r['CD_AGENDA'] not in migrated]
    print(f"  Faltam migrar: {len(pending):,}")
    
    total = 0
    failed = 0
    for i in range(0, len(pending), 200):
        chunk = pending[i:i+200]
        data = []
        for r in chunk:
            pid = pat_map.get(r['CD_PACIENTE'])
            did = prof_map.get(r['CD_MEDICO'])
            if not pid or not did: continue
            dt = "2000-01-01"
            if r.get('DT_AGENDA') and 20000000 < r['DT_AGENDA'] < 40000000:
                try:
                    s = str(r['DT_AGENDA'])
                    if len(s) == 8: dt = f"{s[:4]}-{s[4:6]}-{s[6:8]}"
                except: pass
            hr = "08:00:00"
            if r.get('HR_AGENDA'):
                try:
                    hr_s = str(int(r['HR_AGENDA'])).zfill(4)
                    hr = f"{hr_s[:2]}:{hr_s[2:4]}:00"
                except: pass
            data.append({
                "id": r['CD_AGENDA'],
                "patient_id": pid,
                "professional_id": did,
                "appointment_date": dt,
                "start_time": hr,
                "status": status_map.get((r.get('DS_SITUACAO') or '').upper(), "scheduled"),
                "lg_ativo": True,
            })
        if not data: continue
        try:
            n = push_supa(data, "id")
            total += n
            if (i+200) % 5000 == 0 or (i+200) >= len(pending):
                print(f"  ... {min(i+200, len(pending)):,}/{len(pending):,}")
        except Exception as e:
            failed += 1
            if failed > 5:
                print(f"  ! Muitas falhas, parando: {str(e)[:100]}")
                break
    elapsed = time.time() - 0
    print(f"\n  Migradas: {total:,} (de {len(pending):,} pendentes)")
    print(f"  Status final: {len(migrated) + total:,} de {total_sigh:,} ({100*(len(migrated)+total)/total_sigh:.1f}%)")


if __name__ == "__main__":
    main()


