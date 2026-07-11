"""Reconcilia DataSIGH.xml com ProntoMedic.tiss_xml sem escrever no DataSIGH."""

import argparse
import json
import os
import re
import sys
from datetime import date, datetime

import mysql.connector
import psycopg2
from psycopg2.extras import execute_values


REQUIRED_TARGET_COLUMNS = {
    "company_id", "cd_origem_sigh", "cd_convenio", "cd_fatura", "cd_lote",
    "ds_protocolo", "dt_fatura", "ds_tipo_guia", "vl_informado",
    "vl_processado", "vl_liberado", "vl_glosa", "ds_versao_tiss",
    "tp_ambiente", "status", "lg_deletado",
}
WRITE_PRIVILEGES = re.compile(r"\b(ALL PRIVILEGES|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b", re.I)


def required(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if not value:
        raise RuntimeError(f"Variavel obrigatoria ausente: {name}")
    return value


def mysql_config() -> dict:
    return {
        "host": required("SIGH_HOST"),
        "port": int(required("SIGH_PORT", "3306")),
        "user": required("SIGH_USER"),
        "password": required("SIGH_PASSWORD"),
        "database": required("SIGH_DATABASE", "DataSIGH"),
        "charset": "utf8",
        "connection_timeout": 30,
    }


def pg_config() -> dict:
    return {
        "host": required("PGHOST", "127.0.0.1"),
        "port": int(required("PGPORT", "5432")),
        "user": required("PGUSER"),
        "password": required("PGPASSWORD"),
        "database": required("PGDATABASE", "prontoclinic"),
    }


def iso_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def normalize_guide(value) -> str:
    raw = str(value or "").strip().upper().replace("-", "/")
    aliases = {
        "CONSULTA": "CONSULTA",
        "SP/SADT": "SP/SADT",
        "SPSADT": "SP/SADT",
        "SADT": "SP/SADT",
        "INTERNACAO": "INTERNACAO",
        "INTERNAÇÃO": "INTERNACAO",
        "HONORARIO": "HONORARIO",
        "HONORÁRIO": "HONORARIO",
        "ODONTOLOGIA": "ODONTOLOGIA",
    }
    return aliases.get(raw, "AUXILIAR")


def assert_mysql_read_only(cursor) -> list[str]:
    cursor.execute("SHOW GRANTS")
    grants = [str(row[0]) for row in cursor.fetchall()]
    unsafe = [grant for grant in grants if WRITE_PRIVILEGES.search(grant)]
    if unsafe:
        raise RuntimeError(
            "Usuario DataSIGH possui privilegios de escrita. Use uma conta estritamente SELECT."
        )
    return grants


def fetch_source(cursor) -> list[dict]:
    cursor.execute(
        """
        SELECT CD_XML, DS_TIPOGUIA, CD_CONVENIO, CD_FATURA, CD_LOTE,
               DS_PROTOCOLO, VL_INFORMADO, VL_PROCESSADO, VL_LIBERADO,
               VL_GLOSA, DT_ENVIO, DT_RETORNO, LG_RECURSADO, LG_DELETADO
        FROM xml
        WHERE LG_DELETADO = 0 OR LG_DELETADO IS NULL
        ORDER BY CD_XML
        """
    )
    return cursor.fetchall()


def target_columns(cursor) -> set[str]:
    cursor.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tiss_xml'
        """
    )
    return {row[0] for row in cursor.fetchall()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Insere chaves ausentes no PostgreSQL")
    parser.add_argument("--expected-source", type=int, default=544)
    args = parser.parse_args()

    source = mysql.connector.connect(**mysql_config())
    destination = psycopg2.connect(**pg_config())
    source_cursor = source.cursor(dictionary=True)
    target_cursor = destination.cursor()

    try:
        assert_mysql_read_only(source_cursor)
        source.start_transaction(consistent_snapshot=True)
        rows = fetch_source(source_cursor)
        source_ids = {int(row["CD_XML"]) for row in rows}

        if len(source_ids) != args.expected_source:
            raise RuntimeError(
                f"Fonte divergente: esperado={args.expected_source}, encontrado={len(source_ids)}"
            )

        columns = target_columns(target_cursor)
        missing_columns = sorted(REQUIRED_TARGET_COLUMNS - columns)
        if missing_columns:
            raise RuntimeError(f"Migration TISS ainda nao aplicada: {missing_columns}")

        target_cursor.execute(
            "SELECT cd_origem_sigh FROM public.tiss_xml WHERE cd_origem_sigh IS NOT NULL"
        )
        target_ids = {int(row[0]) for row in target_cursor.fetchall()}
        missing_ids = source_ids - target_ids
        stale_ids = target_ids - source_ids
        rows_to_insert = [row for row in rows if int(row["CD_XML"]) in missing_ids]

        target_cursor.execute(
            "SELECT count(*) FROM public.tiss_xml WHERE cd_origem_sigh IS NULL"
        )
        native_records = int(target_cursor.fetchone()[0])

        report = {
            "mode": "apply" if args.apply else "dry-run",
            "source_active": len(source_ids),
            "destination_legacy": len(target_ids),
            "destination_native": native_records,
            "missing_by_key": len(missing_ids),
            "stale_by_key": len(stale_ids),
            "missing_sample": sorted(missing_ids)[:20],
            "stale_sample": sorted(stale_ids)[:20],
        }

        if not args.apply:
            destination.rollback()
            print(json.dumps(report, indent=2, ensure_ascii=False))
            return 0

        company_id = required("PRONTOMEDIC_COMPANY_ID")
        payload = []
        for row in rows_to_insert:
            protocol = str(row.get("DS_PROTOCOLO") or "").strip() or None
            payload.append(
                (
                    company_id,
                    int(row["CD_XML"]),
                    row.get("CD_CONVENIO"),
                    row.get("CD_FATURA"),
                    row.get("CD_LOTE"),
                    protocol,
                    iso_date(row.get("DT_ENVIO")),
                    normalize_guide(row.get("DS_TIPOGUIA")),
                    row.get("VL_INFORMADO") or 0,
                    row.get("VL_PROCESSADO") or 0,
                    row.get("VL_LIBERADO") or 0,
                    row.get("VL_GLOSA") or 0,
                    "3.05.00",
                    "HOMOLOGACAO",
                    "ENVIADO" if protocol else "PENDENTE",
                    False,
                )
            )

        execute_values(
            target_cursor,
            """
            INSERT INTO public.tiss_xml (
              company_id, cd_origem_sigh, cd_convenio, cd_fatura, cd_lote,
              ds_protocolo, dt_fatura, ds_tipo_guia, vl_informado,
              vl_processado, vl_liberado, vl_glosa, ds_versao_tiss,
              tp_ambiente, status, lg_deletado
            ) VALUES %s
            ON CONFLICT (cd_origem_sigh) DO NOTHING
            """,
            payload,
            page_size=200,
        )
        target_cursor.execute(
            """
            SELECT count(DISTINCT cd_origem_sigh)
            FROM public.tiss_xml WHERE cd_origem_sigh = ANY(%s)
            """,
            (list(source_ids),),
        )
        reconciled = int(target_cursor.fetchone()[0])
        if reconciled != len(source_ids):
            raise RuntimeError(
                f"Validacao antes do commit falhou: esperado={len(source_ids)}, reconciliado={reconciled}"
            )

        destination.commit()
        report["inserted"] = len(rows_to_insert)
        report["reconciled_after"] = reconciled
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0
    except Exception:
        destination.rollback()
        raise
    finally:
        source.rollback()
        source.close()
        destination.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
