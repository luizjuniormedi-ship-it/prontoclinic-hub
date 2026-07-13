-- F1 immutable receipt ledger gate. Ephemeral PostgreSQL only.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f1$
  SELECT NULLIF(current_setting('app.test_user_id', true), '')::uuid
$f1$;

INSERT INTO public.companies (id, name) VALUES
 ('31111111-aaaa-4111-8111-111111111111','Receipt A'),
 ('32222222-bbbb-4222-8222-222222222222','Receipt B');
INSERT INTO auth.users (id) VALUES
 ('31111111-0000-4000-8000-000000000001'),('32222222-0000-4000-8000-000000000001');
INSERT INTO public.user_profiles (id,full_name,email,role_name,company_id) VALUES
 ('31111111-0000-4000-8000-000000000001','Finance A','fa@receipt.test','financeiro','31111111-aaaa-4111-8111-111111111111'),
 ('32222222-0000-4000-8000-000000000001','Finance B','fb@receipt.test','financeiro','32222222-bbbb-4222-8222-222222222222');
INSERT INTO public.professionals (id,company_id,full_name) OVERRIDING SYSTEM VALUE VALUES
 (950001,'31111111-aaaa-4111-8111-111111111111','Doctor A'),
 (950002,'32222222-bbbb-4222-8222-222222222222','Doctor B');
INSERT INTO public.patients (id,company_id,full_name) OVERRIDING SYSTEM VALUE VALUES
 (950003,'31111111-aaaa-4111-8111-111111111111','Patient A'),
 (950004,'32222222-bbbb-4222-8222-222222222222','Patient B');
INSERT INTO public.appointments
 (id,company_id,patient_id,professional_id,appointment_date,start_time,end_time,status)
OVERRIDING SYSTEM VALUE VALUES
 (950005,'31111111-aaaa-4111-8111-111111111111',950003,950001,DATE '2026-07-22',TIME '09:00',TIME '09:30','completed'),
 (950006,'32222222-bbbb-4222-8222-222222222222',950004,950002,DATE '2026-07-22',TIME '10:00',TIME '10:30','completed');

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id='31111111-0000-4000-8000-000000000001';
DO $f1$
DECLARE v_bill_a public.billings; v_bill_b public.billings; v_receipt public.billing_receipts;
 v_again public.billing_receipts; v_reversal public.billing_receipts; v_balance RECORD; v_denied BOOLEAN;
BEGIN
 SELECT * INTO v_bill_a FROM public.create_billing_secure(950005,150,NULL,NULL);
 PERFORM set_config('app.test_user_id','32222222-0000-4000-8000-000000000001',TRUE);
 SELECT * INTO v_bill_b FROM public.create_billing_secure(950006,80,NULL,NULL);
 PERFORM set_config('app.test_user_id','31111111-0000-4000-8000-000000000001',TRUE);

 SELECT * INTO v_receipt FROM public.record_billing_receipt_secure(
   v_bill_a.id,50,'pix','31111111-1111-4111-8111-111111111111');
 SELECT * INTO v_again FROM public.record_billing_receipt_secure(
   v_bill_a.id,50,'pix','31111111-1111-4111-8111-111111111111');
 IF v_again.id <> v_receipt.id THEN RAISE EXCEPTION 'F1 receipt idempotency mismatch'; END IF;
 SELECT * INTO v_balance FROM public.get_billing_balance_secure(v_bill_a.id);
 IF v_balance.received_amount <> 50 OR v_balance.balance_amount <> 100 THEN
   RAISE EXCEPTION 'F1 partial receipt balance mismatch: %', row_to_json(v_balance);
 END IF;

 v_denied:=FALSE;
 BEGIN
   PERFORM public.record_billing_receipt_secure(v_bill_a.id,51,'pix','31111111-1111-4111-8111-111111111111');
 EXCEPTION WHEN OTHERS THEN v_denied:=SQLERRM LIKE '%payload diferente%'; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'F1 idempotency payload mismatch accepted'; END IF;

 PERFORM public.record_billing_receipt_secure(v_bill_a.id,100,'cartao','31111111-2222-4222-8222-222222222222');
 SELECT * INTO v_balance FROM public.get_billing_balance_secure(v_bill_a.id);
 IF v_balance.balance_amount <> 0 THEN RAISE EXCEPTION 'F1 total receipt balance mismatch'; END IF;
 v_denied:=FALSE;
 BEGIN
   PERFORM public.record_billing_receipt_secure(v_bill_a.id,.01,'pix','31111111-3333-4333-8333-333333333333');
 EXCEPTION WHEN OTHERS THEN v_denied:=SQLERRM LIKE '%excede saldo%'; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'F1 overpayment accepted'; END IF;

 SELECT * INTO v_reversal FROM public.reverse_billing_receipt_secure(
   v_receipt.id,'Erro operacional','31111111-4444-4444-8444-444444444444');
 SELECT * INTO v_again FROM public.reverse_billing_receipt_secure(
   v_receipt.id,'Erro operacional','31111111-4444-4444-8444-444444444444');
 IF v_again.id <> v_reversal.id THEN RAISE EXCEPTION 'F1 reversal idempotency mismatch'; END IF;
 SELECT * INTO v_balance FROM public.get_billing_balance_secure(v_bill_a.id);
 IF v_balance.received_amount <> 100 OR v_balance.balance_amount <> 50 THEN
   RAISE EXCEPTION 'F1 reversal balance mismatch: %', row_to_json(v_balance);
 END IF;

 PERFORM set_config('app.test_user_id','32222222-0000-4000-8000-000000000001',TRUE);
 v_denied:=FALSE;
 BEGIN
   PERFORM public.record_billing_receipt_secure(v_bill_a.id,1,'pix','32222222-1111-4111-8111-111111111111');
 EXCEPTION WHEN OTHERS THEN v_denied:=SQLERRM LIKE '%fora da empresa%'; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'F1 cross-tenant receipt accepted'; END IF;

 v_denied:=FALSE;
 BEGIN
   INSERT INTO public.billing_receipts(company_id,billing_id,entry_type,amount,idempotency_key,created_by)
   VALUES('32222222-bbbb-4222-8222-222222222222',v_bill_b.id,'receipt',1,
     '32222222-2222-4222-8222-222222222222','32222222-0000-4000-8000-000000000001');
 EXCEPTION WHEN insufficient_privilege THEN v_denied:=TRUE; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'F1 direct receipt DML accepted'; END IF;
END
$f1$;
RESET ROLE;
ROLLBACK;
SELECT 'F1_RUNTIME_RECEIPTS_BEHAVIOR=PASS' AS result;
