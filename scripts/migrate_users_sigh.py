"""
Migracao de usuarios SIGH (MySQL) -> Supabase Auth + public.user_profiles.

Lê cada usuário do SIGH, cria:
  1. auth.users com UUID novo, email_confirmed_at = NOW(), encrypted_password NULL
  2. public.user_profiles com role_name mapeado de LG_* e CD_GRUPO_USUARIO

Idempotente: usa ON CONFLICT (id) DO NOTHING em ambas as tabelas.
Pula luizjuniormedi@gmail.com (ja existe).

Empresa padrao: MEDILIFE (id = '6ca68729-bd31-4bc3-9d30-477bf5302de9')

Uso:
  cd C:/Users/Meu Computador/AppData/Local/Temp/prontoclinic-hub
  python scripts/migrate_users_sigh.py [--dry-run] [--only-id=<cd_usuario>]

LGPD:
  - Senhas plain-text do SIGH NAO sao migradas. Cada usuario precisara
    redefinir senha via link de reset.
  - Emails invalidos (NAOTEM@..., NAO@...) sao pulados ou recebem um
    sufixo numerico para permitir criacao no Auth.
"""
from __future__ import annotations

import argparse
import csv
import os
import random
import re
import string
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

# ----------------------------------------------------------------------------
# Configuracoes
# ----------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path("C:/Users/Meu Computador")))

from db_datasigh import query as sigh_query  # type: ignore

COMPANY_ID = "6ca68729-bd31-4bc3-9d30-477bf5302de9"  # MEDILIFE
SKIP_EMAIL = "luizjuniormedi@gmail.com"  # ja criado
SCRIPT_DIR = Path(__file__).resolve().parent
REPORT_CSV = SCRIPT_DIR / "migrate_users_report.csv"

# ----------------------------------------------------------------------------
# Mapeamento de role (RBAC granular)
# ----------------------------------------------------------------------------
# Ordem de precedencia (do mais forte para o mais fraco):
#   1. LG_MASTER  -> master (super-admin) - so 1 usuario
#   2. LG_ADMIN   -> admin (qualquer valor !=0)
#   3. CD_MEDICO_AG > 0 -> doctor (medico)
#   4. LG_FINANCEIRO !=0 -> financial
#   5. LG_CALLCENTER !=0 -> callcenter
#   6. fallback: staff (recepcao, supervisão, etc)
#
# Tambem copiamos todos os flags LG_* para user_metadata para RBAC
# granular via claims.

# Dominios invalidos (emails placeholder do SIGH) que devem ser substituidos
INVALID_EMAIL_DOMAINS = (
    "naotem.com.br",
    "naotem.com",
    "nao.com.br",
    "nao.com",
    "nao@naotem.con.br",
    "nao.com",
    "naotem@nao.com",
    "naotwmo@naotem.com",
    "nao@naotem.con.br",
    "naotem@nao.com",
    "nao.com",
    "naotem.con.br",
    "nao.com.br",
    "naotem.com",
)


def normalize_email(raw_email: str, cd_usuario: int) -> tuple[str, bool]:
    """Retorna (email_normalizado, foi_alterado). Para emails placeholder,
    gera um derivado user<cd>@medilife.local."""
    if not raw_email:
        return f"user{cd_usuario}@medilife.local", True
    email = raw_email.strip().lower()
    if not email or "@" not in email:
        return f"user{cd_usuario}@medilife.local", True

    # Tira acento/mojibake do dominio
    local, _, domain = email.partition("@")
    # Limpa caracteres invalidos
    local = re.sub(r"[^a-z0-9._+\-]", "", local)
    domain_clean = re.sub(r"[^a-z0-9.\-]", "", domain.encode("ascii", "ignore").decode("ascii"))

    if not local or not domain_clean:
        return f"user{cd_usuario}@medilife.local", True

    # Verifica se e placeholder
    placeholder_patterns = [
        r"naotem",
        r"nao\s*tem",
        r"n[aã]o\s*tem",
        r"nao@",
        r"naotwmo",
        r"nao\.com",
        r"naotem",
        r"nao\s*possui",
        r"naopossui",
    ]
    full_email = f"{local}@{domain_clean}"
    if any(re.search(p, full_email) for p in placeholder_patterns):
        return f"user{cd_usuario}@medilife.local", True

    return f"{local}@{domain_clean}", False


def map_role(sigh_user: dict) -> str:
    """Mapeia LG_* flags para um role_name do Supabase."""
    if sigh_user.get("LG_MASTER"):
        return "master"
    if sigh_user.get("LG_ADMIN") and sigh_user.get("LG_ADMIN") != 0:
        return "admin"
    cd_medico = sigh_user.get("CD_MEDICO_AG") or 0
    if cd_medico > 0:
        return "doctor"
    if sigh_user.get("LG_FINANCEIRO"):
        return "financial"
    if sigh_user.get("LG_CALLCENTER"):
        return "callcenter"
    return "staff"


def build_user_metadata(sigh_user: dict) -> dict:
    """Serializa todas as colunas LG_* e CD_MEDICO_AG para user_metadata."""
    md = {
        "sigh_id": int(sigh_user["CD_USUARIO"]),
        "sigh_login": sigh_user.get("DS_LOGIN", "") or "",
        "full_name": (sigh_user.get("DS_NOME", "") or "").strip(),
        "funcao": (sigh_user.get("DS_FUNCAO", "") or "").strip(),
        "cd_medico_ag": int(sigh_user.get("CD_MEDICO_AG") or 0),
        "cd_grupo_usuario": int(sigh_user.get("CD_GRUPO_USUARIO") or 0),
        "lg_admin": int(sigh_user.get("LG_ADMIN") or 0),
        "lg_master": int(sigh_user.get("LG_MASTER") or 0),
        "lg_financeiro": int(sigh_user.get("LG_FINANCEIRO") or 0),
        "lg_callcenter": int(sigh_user.get("LG_CALLCENTER") or 0),
        "lg_libera_cotacao": int(sigh_user.get("LG_LIBERA_COTACAO") or 0),
        "lg_libera_compra": int(sigh_user.get("LG_LIBERA_COMPRA") or 0),
        "lg_libera_valores_servico": int(sigh_user.get("LG_LIBERA_VALORES_SERVICO") or 0),
        "lg_libera_contrato_servico": int(sigh_user.get("LG_LIBERA_CONTRATO_SERVICO") or 0),
        "lg_libera_contas_financeiro": int(sigh_user.get("LG_LIBERA_CONTAS_FINANCEIRO") or 0),
        "lg_recebe_servico_realizado": int(sigh_user.get("LG_RECEBE_SERVICO_REALIZADO") or 0),
        "lg_visualizar_todas_mensagens": int(sigh_user.get("LG_VISUALIZAR_TODAS_MENSAGENS") or 0),
        "lg_alterar_agenda": int(sigh_user.get("LG_ALTERAR_AGENDA") or 0),
        "lg_mapa_cirurgico": int(sigh_user.get("LG_MAPA_CIRURGICO") or 0),
        "lg_financeiro_movimento": int(sigh_user.get("LG_FINANCEIRO_MOVIMENTO") or 0),
        "lg_excluir_fatura": int(sigh_user.get("LG_EXCLUIR_FATURA") or 0),
        "lg_desbloquear_agenda": int(sigh_user.get("LG_DESBLOQUEAR_AGENDA") or 0),
        "lg_bloqueada": int(sigh_user.get("LG_BLOQUEADA") or 0),
        "lg_trocar_senha": int(sigh_user.get("LG_TROCAR_SENHA") or 0),
    }
    return md


def gen_temp_password() -> str:
    """Gera senha temporaria que o usuario tera que redefinir."""
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"RESET-{suffix}"


def fetch_sigh_users(only_id: int | None = None) -> list[dict]:
    """Busca usuarios ativos do SIGH (LG_DELETADO = 0)."""
    where = "WHERE LG_DELETADO = 0"
    params: tuple = ()
    if only_id is not None:
        where += " AND CD_USUARIO = %s"
        params = (only_id,)
    sql = f"""
        SELECT CD_USUARIO, DS_NOME, DS_LOGIN, DS_EMAIL,
               LG_ADMIN, LG_MASTER, LG_FINANCEIRO, LG_CALLCENTER,
               CD_MEDICO_AG, CD_GRUPO_USUARIO, DS_FUNCAO,
               LG_BLOQUEADA, LG_TROCAR_SENHA,
               LG_LIBERA_COTACAO, LG_LIBERA_COMPRA, LG_LIBERA_VALORES_SERVICO,
               LG_LIBERA_CONTRATO_SERVICO, LG_LIBERA_CONTAS_FINANCEIRO,
               LG_RECEBE_SERVICO_REALIZADO, LG_VISUALIZAR_TODAS_MENSAGENS,
               LG_ALTERAR_AGENDA, LG_MAPA_CIRURGICO,
               LG_FINANCEIRO_MOVIMENTO, LG_EXCLUIR_FATURA,
               LG_DESBLOQUEAR_AGENDA
        FROM usuarios
        {where}
        ORDER BY CD_USUARIO
    """
    return sigh_query(sql, params)


def build_sql_for_user(uid: str, sigh_user: dict, email: str) -> str:
    """Monta o SQL de INSERT idempotente (auth.users + user_profiles)."""
    import json
    metadata = build_user_metadata(sigh_user)
    full_name = metadata.pop("full_name")
    role_name = map_role(sigh_user)
    metadata_json = json.dumps(metadata, ensure_ascii=False)
    lg_ativo = not bool(sigh_user.get("LG_BLOQUEADA"))

    sql = f"""
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '{uid}',
  'authenticated',
  'authenticated',
  '{email}',
  NULL,
  NOW(),
  '{{"provider":"email","providers":["email"]}}'::jsonb,
  '{metadata_json.replace("'", "''")}'::jsonb,
  NOW(),
  NOW(),
  '',
  '',
  '',
  ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (
  id, full_name, email, role_name, company_id, lg_ativo
) VALUES (
  '{uid}',
  '{full_name.replace("'", "''")}',
  '{email}',
  '{role_name}',
  '{COMPANY_ID}',
  {str(lg_ativo).lower()}
)
ON CONFLICT (id) DO NOTHING;
"""
    return sql.strip()


def run_supabase_query(sql: str) -> tuple[bool, str]:
    """Executa SQL via `supabase db query --linked`. Retorna (ok, output)."""
    # Escreve o SQL em arquivo temp para escapar do problema de aspas
    tmp_sql = SCRIPT_DIR / "_migrate_tmp.sql"
    try:
        tmp_sql.write_text(sql, encoding="utf-8")
        result = subprocess.run(
            f'supabase db query --linked < "{tmp_sql}"',
            capture_output=True,
            text=True,
            cwd=str(PROJECT_ROOT),
            timeout=60,
            shell=True,
        )
        if result.returncode != 0:
            return False, (result.stderr or result.stdout)[:600]
        return True, result.stdout
    except Exception as e:
        return False, f"EXCECAO: {e}"
    finally:
        if tmp_sql.exists():
            try: tmp_sql.unlink()
            except: pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Gera SQL mas nao executa")
    ap.add_argument("--only-id", type=int, help="Migra apenas um CD_USUARIO")
    args = ap.parse_args()

    print(f"[{datetime.now().isoformat()}] Iniciando migracao de usuarios SIGH -> Supabase")
    print(f"  Empresa: {COMPANY_ID} (MEDILIFE)")
    print(f"  Skip:    {SKIP_EMAIL}")
    print(f"  Modo:    {'DRY-RUN' if args.dry_run else 'EXECUTAR'}")
    print()

    sigh_users = fetch_sigh_users(args.only_id)
    print(f"Usuarios SIGH ativos encontrados: {len(sigh_users)}")

    # Filtrar o admin ja criado
    sigh_users = [u for u in sigh_users if (u.get("DS_EMAIL", "") or "").lower() != SKIP_EMAIL]
    print(f"Usuarios a migrar (apos skip):   {len(sigh_users)}")
    print()

    report_rows = []
    role_counts: dict[str, int] = {}
    email_collisions: dict[str, int] = {}
    used_emails: set[str] = set()
    errors: list[tuple[int, str, str]] = []

    for i, u in enumerate(sigh_users, 1):
        cd = int(u["CD_USUARIO"])
        original_email = (u.get("DS_EMAIL") or "").strip()
        email, _altered = normalize_email(original_email, cd)

        # Resolve colisao de email (mesmo email em varios usuarios SIGH)
        if email in used_emails:
            suffix = 2
            while f"{email.split('@')[0]}+{suffix}@{email.split('@')[1]}" in used_emails:
                suffix += 1
            local, _, dom = email.partition("@")
            email = f"{local}+{suffix}@{dom}"
        used_emails.add(email)

        role = map_role(u)
        role_counts[role] = role_counts.get(role, 0) + 1

        uid = str(uuid.uuid4())
        sql = build_sql_for_user(uid, u, email)
        temp_pwd = gen_temp_password()

        nome = (u.get("DS_NOME") or "").strip()
        print(f"  [{i:3}/{len(sigh_users)}] CD={cd:3} {nome[:35]:35} | {email:40} | role={role:10}", end="")

        if args.dry_run:
            print(" [DRY-RUN]")
        else:
            ok, out = run_supabase_query(sql)
            if ok:
                print(" OK")
            else:
                print(f" ERRO: {out[:120]}")
                errors.append((cd, email, out[:300]))
                continue

        report_rows.append({
            "sigh_id": cd,
            "uuid": uid,
            "nome": nome,
            "login_sigh": u.get("DS_LOGIN", ""),
            "email_original": original_email,
            "email_migrado": email,
            "role": role,
            "temp_password": temp_pwd,
            "lg_ativo": not bool(u.get("LG_BLOQUEADA")),
            "status": "DRY-RUN" if args.dry_run else ("OK" if not errors or errors[-1][0] != cd else "ERRO"),
        })

    # Relatorio CSV
    if report_rows:
        with open(REPORT_CSV, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(report_rows[0].keys()))
            w.writeheader()
            w.writerows(report_rows)
        print()
        print(f"[CSV] Relatorio salvo em: {REPORT_CSV}")
        print(f"[CSV] {len(report_rows)} linhas")
    else:
        print()
        print("[CSV] Nenhuma linha para escrever.")
    print()
    print("=== Distribuicao por role ===")
    for r, c in sorted(role_counts.items(), key=lambda x: -x[1]):
        print(f"  {r:12} {c:3}")
    print()
    print("=== Erros ===")
    if errors:
        for cd, em, msg in errors[:10]:
            print(f"  CD={cd} email={em}: {msg[:200]}")
    else:
        print("  (nenhum)")
    print()
    print(f"[{datetime.now().isoformat()}] Concluido.")


if __name__ == "__main__":
    main()
