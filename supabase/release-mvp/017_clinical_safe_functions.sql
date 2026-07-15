-- Clinical calculation RPC with no patient or tenant data access.
-- Review/local artifact only. Do not run against DataSIGH or production.

CREATE OR REPLACE FUNCTION public.calc_imc(
  p_peso NUMERIC,
  p_altura_cm NUMERIC
)
RETURNS TABLE (imc NUMERIC, classificacao TEXT)
LANGUAGE plpgsql
IMMUTABLE
AS $f1$
DECLARE
  v_imc NUMERIC;
BEGIN
  IF p_peso IS NULL OR p_altura_cm IS NULL OR p_peso <= 0 OR p_altura_cm <= 0 THEN
    RAISE EXCEPTION 'peso e altura devem ser maiores que zero';
  END IF;
  IF p_altura_cm > 300 OR p_peso > 500 THEN
    RAISE EXCEPTION 'valores antropometricos fora do limite operacional';
  END IF;

  v_imc := ROUND((p_peso / POWER(p_altura_cm / 100, 2))::NUMERIC, 2);
  imc := v_imc;
  classificacao := CASE
    WHEN v_imc < 18.5 THEN 'baixo peso'
    WHEN v_imc < 25 THEN 'eutrofia'
    WHEN v_imc < 30 THEN 'sobrepeso'
    WHEN v_imc < 35 THEN 'obesidade grau I'
    WHEN v_imc < 40 THEN 'obesidade grau II'
    ELSE 'obesidade grau III'
  END;
  RETURN NEXT;
END
$f1$;

REVOKE ALL ON FUNCTION public.calc_imc(NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calc_imc(NUMERIC, NUMERIC) TO authenticated;
