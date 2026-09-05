BEGIN;

DO $contract$
DECLARE
  v_user UUID := '29000000-0000-4000-8000-000000000001';
  v_session UUID := '29000000-0000-4000-8000-000000000002';
  v_token UUID := '29000000-0000-4000-8000-000000000003';
BEGIN
  INSERT INTO auth.users(id, email, created_at, updated_at)
  VALUES (v_user, 'auth-session-contract@example.invalid', NOW(), NOW());

  INSERT INTO auth.sessions(id, user_id, created_at, updated_at)
  VALUES (v_session, v_user, NOW(), NOW());

  INSERT INTO auth.refresh_tokens(token, user_id, session_id)
  VALUES (v_token, v_user, v_session);

  IF NOT EXISTS (
    SELECT 1 FROM auth.refresh_tokens
     WHERE token = v_token AND session_id = v_session
  ) THEN
    RAISE EXCEPTION 'Refresh token was not linked to the native session';
  END IF;

  BEGIN
    INSERT INTO auth.refresh_tokens(token, user_id, session_id)
    VALUES (
      '29000000-0000-4000-8000-000000000004',
      v_user,
      '29000000-0000-4000-8000-000000000099'
    );
    RAISE EXCEPTION 'Orphan refresh token was accepted';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  DELETE FROM auth.sessions WHERE id = v_session;
  IF EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE token = v_token) THEN
    RAISE EXCEPTION 'Deleting a native session did not revoke its refresh tokens';
  END IF;
END
$contract$;

ROLLBACK;
