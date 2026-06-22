#!/usr/bin/env python3
"""
notification_worker.py
======================

Worker assíncrono que consome a tabela `public.notifications` do Supabase
e envia pelos provedores (Resend / Z-API / Twilio).

Substitui o SMTP quebrado do SIGH (log_email 95% erro).

Recursos:
  - Polling com backoff
  - Renderização segura de templates com Mustache
  - Retry automático com backoff exponencial
  - Rate limiting por canal (1 SMS/s, 5 e-mails/s, 10 WhatsApp/s)
  - Log estruturado em JSON
  - APScheduler para tarefas recorrentes (limpeza, NPS batch)

Uso:
    pip install supabase resend twilio zapi-sdk python-mustache apscheduler python-dotenv
    python notification_worker.py

Variáveis de ambiente (ler .env):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    RESEND_API_KEY
    EMAIL_FROM
    EMAIL_REPLY_TO
    ZAPI_INSTANCE_ID
    ZAPI_TOKEN
    TWILIO_ACCOUNT_SID
    TWILIO_AUTH_TOKEN
    TWILIO_FROM_NUMBER
    WORKER_POLL_INTERVAL_SECONDS (default: 5)
    WORKER_BATCH_SIZE (default: 10)
    LOG_LEVEL (default: INFO)
"""

import os
import re
import sys
import json
import time
import logging
from datetime import datetime, timezone
from typing import Optional
from contextlib import contextmanager
from dataclasses import dataclass

# Dependências externas
try:
    from supabase import create_client, Client
except ImportError:
    print("ERRO: instale 'supabase' (pip install supabase)")
    sys.exit(1)

try:
    import pystache
except ImportError:
    print("ERRO: instale 'pystache' (pip install pystache)")
    sys.exit(1)

try:
    from apscheduler.schedulers.blocking import BlockingScheduler
except ImportError:
    print("ERRO: instale 'apscheduler' (pip install apscheduler)")
    sys.exit(1)

# Provedores (imports opcionais para permitir rodar só com e-mail)
try:
    import resend
    HAS_RESEND = True
except ImportError:
    HAS_RESEND = False

try:
    from twilio.rest import Client as TwilioClient
    HAS_TWILIO = True
except ImportError:
    HAS_TWILIO = False

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False


# =============================================================================
# Configuração
# =============================================================================
@dataclass
class Config:
    supabase_url: str
    supabase_key: str
    resend_api_key: Optional[str]
    email_from: str
    email_reply_to: Optional[str]
    zapi_instance_id: Optional[str]
    zapi_token: Optional[str]
    twilio_account_sid: Optional[str]
    twilio_auth_token: Optional[str]
    twilio_from_number: Optional[str]
    poll_interval: int
    batch_size: int
    rate_email_per_sec: float
    rate_sms_per_sec: float
    rate_whatsapp_per_sec: float


def load_config() -> Config:
    """Carrega config de variáveis de ambiente."""
    required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        raise RuntimeError(f"Variáveis obrigatórias faltando: {missing}")

    return Config(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        resend_api_key=os.getenv("RESEND_API_KEY"),
        email_from=os.getenv("EMAIL_FROM", "nao-responda@prontoclinic.com.br"),
        email_reply_to=os.getenv("EMAIL_REPLY_TO"),
        zapi_instance_id=os.getenv("ZAPI_INSTANCE_ID"),
        zapi_token=os.getenv("ZAPI_TOKEN"),
        twilio_account_sid=os.getenv("TWILIO_ACCOUNT_SID"),
        twilio_auth_token=os.getenv("TWILIO_AUTH_TOKEN"),
        twilio_from_number=os.getenv("TWILIO_FROM_NUMBER"),
        poll_interval=int(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "5")),
        batch_size=int(os.getenv("WORKER_BATCH_SIZE", "10")),
        rate_email_per_sec=float(os.getenv("RATE_EMAIL_PER_SEC", "5")),
        rate_sms_per_sec=float(os.getenv("RATE_SMS_PER_SEC", "1")),
        rate_whatsapp_per_sec=float(os.getenv("RATE_WHATSAPP_PER_SEC", "10")),
    )


# =============================================================================
# Logging estruturado
# =============================================================================
class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "msg": record.getMessage(),
            "logger": record.name,
        }
        if hasattr(record, "notification_id"):
            payload["notification_id"] = record.notification_id
        if hasattr(record, "channel"):
            payload["channel"] = record.channel
        if hasattr(record, "duration_ms"):
            payload["duration_ms"] = record.duration_ms
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging() -> logging.Logger:
    logger = logging.getLogger("notification-worker")
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    return logger


# =============================================================================
# Rate limiter (token bucket)
# =============================================================================
class RateLimiter:
    def __init__(self, rate_per_sec: float):
        self.interval = 1.0 / max(rate_per_sec, 0.1)
        self.last = 0.0

    def wait(self) -> None:
        now = time.monotonic()
        elapsed = now - self.last
        if elapsed < self.interval:
            time.sleep(self.interval - elapsed)
        self.last = time.monotonic()


# =============================================================================
# Renderização segura de template
# =============================================================================
class SafeRenderer:
    """
    Renderiza templates com Mustache.
    NUNCA usa eval/Function (proteção contra injection em variáveis).
    Variáveis ausentes são substituídas por string vazia.
    """

    VAR_PATTERN = re.compile(r"\{\{\s*([\w\.]+)\s*\}\}")

    def render(self, body: str, variables: dict) -> str:
        if not variables:
            return self.VAR_PATTERN.sub("", body)
        try:
            return pystache.render(body, variables)
        except Exception as e:
            # Fallback: substituição manual simples
            logging.getLogger("notification-worker").warning(
                "Mustache falhou, usando fallback: %s", e
            )
            return self.VAR_PATTERN.sub(
                lambda m: str(self._lookup(variables, m.group(1)) or ""),
                body,
            )

    def _lookup(self, data: dict, dotted_key: str):
        cur = data
        for part in dotted_key.split("."):
            if isinstance(cur, dict):
                cur = cur.get(part)
            else:
                return None
        return cur


# =============================================================================
# Provedores
# =============================================================================
class EmailProvider:
    def __init__(self, cfg: Config, logger: logging.Logger):
        self.cfg = cfg
        self.logger = logger
        self.limiter = RateLimiter(cfg.rate_email_per_sec)
        if HAS_RESEND and cfg.resend_api_key:
            resend.api_key = cfg.resend_api_key
            self.client = resend
            self.backend = "resend"
        else:
            # Fallback SMTP (enviar via smtplib se Resend não configurado)
            self.client = None
            self.backend = "smtp_fallback"
            self.logger.warning("Resend não configurado, usando SMTP fallback")

    def send(self, notification: dict) -> tuple[bool, Optional[str], Optional[dict]]:
        if not notification.get("recipient_email"):
            return False, "NO_EMAIL", None

        self.limiter.wait()
        to = notification["recipient_email"]
        subject = notification.get("subject") or "(sem assunto)"
        body = notification["body"]

        start = time.monotonic()
        try:
            if self.backend == "resend":
                params = {
                    "from": self.cfg.email_from,
                    "to": [to],
                    "subject": subject,
                    "html": f"<pre style='font-family:inherit;white-space:pre-wrap'>{body}</pre>",
                }
                if self.cfg.email_reply_to:
                    params["reply_to"] = self.cfg.email_reply_to
                response = self.client.Emails.send(params)
                message_id = getattr(response, "id", None) or str(response)
                duration_ms = int((time.monotonic() - start) * 1000)
                self.logger.info(
                    "email.sent",
                    extra={
                        "notification_id": notification["id"],
                        "channel": "EMAIL",
                        "duration_ms": duration_ms,
                    },
                )
                return True, message_id, {"response": str(response), "duration_ms": duration_ms}
            else:
                # SMTP fallback: implementação simplificada
                return self._send_smtp(to, subject, body, notification)
        except Exception as e:
            duration_ms = int((time.monotonic() - start) * 1000)
            self.logger.exception(
                "email.error",
                extra={"notification_id": notification["id"], "duration_ms": duration_ms},
            )
            return False, "EMAIL_ERROR", {"error": str(e), "duration_ms": duration_ms}

    def _send_smtp(self, to, subject, body, notification):
        """SMTP fallback (SendGrid/Mailgun/SES via SMTP)."""
        import smtplib
        from email.mime.text import MIMEText

        smtp_host = os.getenv("SMTP_HOST", "smtp.sendgrid.net")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        smtp_user = os.getenv("SMTP_USER", "apikey")
        smtp_pass = os.getenv("SMTP_PASS", "")

        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = self.cfg.email_from
        msg["To"] = to
        if self.cfg.email_reply_to:
            msg["Reply-To"] = self.cfg.email_reply_to

        try:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as srv:
                srv.starttls()
                srv.login(smtp_user, smtp_pass)
                srv.send_message(msg)
            return True, f"smtp:{int(time.time())}", {"backend": "smtp"}
        except Exception as e:
            return False, "SMTP_ERROR", {"error": str(e)}


class SmsProvider:
    def __init__(self, cfg: Config, logger: logging.Logger):
        self.cfg = cfg
        self.logger = logger
        self.limiter = RateLimiter(cfg.rate_sms_per_sec)
        self.client = None
        if HAS_TWILIO and cfg.twilio_account_sid and cfg.twilio_auth_token:
            self.client = TwilioClient(cfg.twilio_account_sid, cfg.twilio_auth_token)
            self.backend = "twilio"
        else:
            self.backend = "unavailable"
            self.logger.warning("Twilio não configurado, SMS indisponível")

    def send(self, notification: dict) -> tuple[bool, Optional[str], Optional[dict]]:
        if self.backend == "unavailable":
            return False, "SMS_UNAVAILABLE", None
        if not notification.get("recipient_phone"):
            return False, "NO_PHONE", None

        self.limiter.wait()
        to = notification["recipient_phone"]
        body = notification["body"]

        start = time.monotonic()
        try:
            msg = self.client.messages.create(
                body=body,
                from_=self.cfg.twilio_from_number,
                to=to,
            )
            duration_ms = int((time.monotonic() - start) * 1000)
            self.logger.info(
                "sms.sent",
                extra={
                    "notification_id": notification["id"],
                    "channel": "SMS",
                    "duration_ms": duration_ms,
                },
            )
            return True, msg.sid, {"sid": msg.sid, "status": msg.status, "duration_ms": duration_ms}
        except Exception as e:
            duration_ms = int((time.monotonic() - start) * 1000)
            self.logger.exception(
                "sms.error",
                extra={"notification_id": notification["id"], "duration_ms": duration_ms},
            )
            return False, "SMS_ERROR", {"error": str(e), "duration_ms": duration_ms}


class WhatsappProvider:
    def __init__(self, cfg: Config, logger: logging.Logger):
        self.cfg = cfg
        self.logger = logger
        self.limiter = RateLimiter(cfg.rate_whatsapp_per_sec)
        if HAS_REQUESTS and cfg.zapi_instance_id and cfg.zapi_token:
            self.base_url = (
                f"https://api.z-api.io/instances/{cfg.zapi_instance_id}"
                f"/token/{cfg.zapi_token}"
            )
            self.backend = "zapi"
        else:
            self.backend = "unavailable"
            self.logger.warning("Z-API não configurada, WhatsApp indisponível")

    def send(self, notification: dict) -> tuple[bool, Optional[str], Optional[dict]]:
        if self.backend == "unavailable":
            return False, "WHATSAPP_UNAVAILABLE", None
        if not notification.get("recipient_whatsapp"):
            return False, "NO_WHATSAPP", None

        self.limiter.wait()
        phone = notification["recipient_whatsapp"].replace("+", "").replace(" ", "")
        body = notification["body"]

        start = time.monotonic()
        try:
            response = requests.post(
                f"{self.base_url}/send-text",
                json={"phone": phone, "message": body},
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            message_id = data.get("messageId") or data.get("id") or str(data.get("zaapId", ""))
            duration_ms = int((time.monotonic() - start) * 1000)
            self.logger.info(
                "whatsapp.sent",
                extra={
                    "notification_id": notification["id"],
                    "channel": "WHATSAPP",
                    "duration_ms": duration_ms,
                },
            )
            return True, str(message_id), {"response": data, "duration_ms": duration_ms}
        except Exception as e:
            duration_ms = int((time.monotonic() - start) * 1000)
            self.logger.exception(
                "whatsapp.error",
                extra={"notification_id": notification["id"], "duration_ms": duration_ms},
            )
            return False, "WHATSAPP_ERROR", {"error": str(e), "duration_ms": duration_ms}


# =============================================================================
# Worker
# =============================================================================
class NotificationWorker:
    def __init__(self):
        self.cfg = load_config()
        self.logger = setup_logging()
        self.db: Client = create_client(self.cfg.supabase_url, self.cfg.supabase_key)
        self.renderer = SafeRenderer()
        self.email = EmailProvider(self.cfg, self.logger)
        self.sms = SmsProvider(self.cfg, self.logger)
        self.whatsapp = WhatsappProvider(self.cfg, self.logger)
        self.running = True

    @contextmanager
    def _processing(self, notification_id: str):
        """Marca notification como PROCESSING e libera no fim."""
        try:
            self.db.table("notifications").update(
                {
                    "status": "PROCESSING",
                    "dt_processing": datetime.now(timezone.utc).isoformat(),
                    "attempts": 0,  # será incrementado no markFailed
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("id", notification_id).execute()
            yield
        finally:
            pass  # status final já foi setado em mark_sent/mark_failed

    def fetch_pending(self) -> list[dict]:
        """Busca lote de notificações pendentes (agendadas que já venceram)."""
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            response = (
                self.db.table("notifications")
                .select("*")
                .eq("status", "PENDING")
                .or_("dt_scheduled_for.is.null,dt_scheduled_for.lte." + now_iso)
                .order("dt_queued", desc=False)
                .limit(self.cfg.batch_size)
                .execute()
            )
            return response.data or []
        except Exception as e:
            self.logger.exception("fetch_pending.error")
            return []

    def render_body(self, notification: dict) -> str:
        body = notification.get("body", "")
        variables = notification.get("variables") or {}
        return self.renderer.render(body, variables)

    def send_one(self, notification: dict) -> None:
        """Despacha uma notificação pelo provedor correto."""
        nid = notification["id"]
        channel = notification["channel"]

        # Renderizar body (idempotente: só substitui {{vars}})
        rendered_body = self.render_body(notification)
        notification_for_send = {**notification, "body": rendered_body}

        with self._processing(nid):
            if channel == "EMAIL":
                ok, msg_id, resp = self.email.send(notification_for_send)
            elif channel == "SMS":
                ok, msg_id, resp = self.sms.send(notification_for_send)
            elif channel == "WHATSAPP":
                ok, msg_id, resp = self.whatsapp.send(notification_for_send)
            else:
                ok, msg_id, resp = False, "UNSUPPORTED_CHANNEL", None

            # Log estruturado
            try:
                self.db.table("notification_logs").insert(
                    {
                        "notification_id": nid,
                        "attempt_number": notification.get("attempts", 0) + 1,
                        "channel": channel,
                        "provider": (
                            self.email.backend if channel == "EMAIL"
                            else self.sms.backend if channel == "SMS"
                            else self.whatsapp.backend if channel == "WHATSAPP"
                            else "unknown"
                        ),
                        "status": "SENT" if ok else "FAILED",
                        "provider_message_id": msg_id,
                        "response_payload": resp,
                        "error_code": None if ok else msg_id,
                        "error_message": None if ok else (resp or {}).get("error"),
                        "duration_ms": (resp or {}).get("duration_ms"),
                    }
                ).execute()
            except Exception as e:
                self.logger.warning("log.insert.failed", extra={"notification_id": nid})

            if ok:
                self.db.table("notifications").update(
                    {
                        "status": "SENT",
                        "provider_message_id": msg_id,
                        "provider_response": resp,
                        "dt_sent": datetime.now(timezone.utc).isoformat(),
                        "attempts": (notification.get("attempts") or 0) + 1,
                        "error_code": None,
                        "error_message": None,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                ).eq("id", nid).execute()
                self.logger.info("notification.sent", extra={"notification_id": nid, "channel": channel})
            else:
                next_attempts = (notification.get("attempts") or 0) + 1
                max_attempts = notification.get("max_attempts") or 3
                exhausted = next_attempts >= max_attempts
                # Backoff: 1min, 5min, 30min
                backoff_sec = {1: 60, 2: 300, 3: 1800}.get(next_attempts, 1800)
                update = {
                    "status": "FAILED" if exhausted else "PENDING",
                    "attempts": next_attempts,
                    "error_code": msg_id or "UNKNOWN",
                    "error_message": (resp or {}).get("error") or "Falha no envio",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                if not exhausted:
                    from datetime import timedelta
                    update["dt_scheduled_for"] = (
                        datetime.now(timezone.utc) + timedelta(seconds=backoff_sec)
                    ).isoformat()
                self.db.table("notifications").update(update).eq("id", nid).execute()
                self.logger.warning(
                    "notification.failed" if exhausted else "notification.retry",
                    extra={"notification_id": nid, "channel": channel},
                )

    def run_once(self) -> int:
        """Processa um lote. Retorna quantas notificações foram processadas."""
        pending = self.fetch_pending()
        if not pending:
            return 0

        self.logger.info("batch.start", extra={"size": len(pending)})
        for n in pending:
            if not self.running:
                break
            try:
                self.send_one(n)
            except Exception as e:
                self.logger.exception(
                    "send_one.error", extra={"notification_id": n.get("id")}
                )
        self.logger.info("batch.end", extra={"size": len(pending)})
        return len(pending)

    def run_forever(self) -> None:
        """Loop principal."""
        self.logger.info(
            "worker.start",
            extra={
                "poll_interval": self.cfg.poll_interval,
                "batch_size": self.cfg.batch_size,
            },
        )

        scheduler = BlockingScheduler(timezone="UTC")

        @scheduler.scheduled_job("interval", seconds=self.cfg.poll_interval)
        def poll():
            if not self.running:
                scheduler.shutdown(wait=False)
                return
            try:
                count = self.run_once()
                if count:
                    self.logger.info("cycle.processed", extra={"count": count})
            except Exception as e:
                self.logger.exception("cycle.error")

        # Job diário: limpar logs antigos (>90 dias)
        @scheduler.scheduled_job("cron", hour=3, minute=0)
        def cleanup():
            try:
                cutoff = datetime.now(timezone.utc) - timedelta(days=90)
                self.db.table("notification_logs").delete().lt(
                    "created_at", cutoff.isoformat()
                ).execute()
                self.logger.info("cleanup.done")
            except Exception:
                self.logger.exception("cleanup.error")

        try:
            scheduler.start()
        except (KeyboardInterrupt, SystemExit):
            self.logger.info("worker.shutdown")
            self.running = False


# =============================================================================
# CLI
# =============================================================================
def main():
    import argparse
    from datetime import timedelta  # noqa: F401 (usado em cleanup)

    parser = argparse.ArgumentParser(
        description="Worker de notificações multicanal do ProntoClinic Hub"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Processa apenas um lote e sai (útil para testes)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Apenas lista notificações pendentes sem enviar",
    )
    args = parser.parse_args()

    try:
        worker = NotificationWorker()
    except Exception as e:
        logging.basicConfig(level="ERROR")
        logging.error(f"Falha ao inicializar worker: {e}")
        sys.exit(1)

    if args.dry_run:
        pending = worker.fetch_pending()
        print(f"Notificações pendentes: {len(pending)}")
        for n in pending[:5]:
            print(
                f"  - {n['id'][:8]} {n['channel']:8s} {n['template_code']:30s} "
                f"-> {n.get('recipient_name', '?')}"
            )
        return

    if args.once:
        count = worker.run_once()
        print(f"Processadas: {count}")
        return

    worker.run_forever()


if __name__ == "__main__":
    main()
