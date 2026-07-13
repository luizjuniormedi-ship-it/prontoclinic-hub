-- Minimal reception defaults for operational read access.
-- Existing role customizations win: this bootstrap only fills missing rows.

INSERT INTO public.role_permissions (role_id, module, can_view)
SELECT reception_role.id, defaults.module, TRUE
  FROM public.roles AS reception_role
 CROSS JOIN (
   VALUES
     ('pacientes'::TEXT),
     ('agenda'::TEXT),
     ('recepcao'::TEXT)
 ) AS defaults(module)
 WHERE reception_role.name = 'recepcao'
ON CONFLICT (role_id, module) DO NOTHING;

-- Medical users need the same read-only operational context to open their
-- dashboard and patient schedule. Financial/admin modules are intentionally
-- absent and existing tenant customizations remain untouched.
INSERT INTO public.role_permissions (role_id, module, can_view)
SELECT medical_role.id, defaults.module, TRUE
  FROM public.roles AS medical_role
 CROSS JOIN (
   VALUES
     ('pacientes'::TEXT),
     ('agenda'::TEXT)
 ) AS defaults(module)
 WHERE medical_role.name = 'medico'
ON CONFLICT (role_id, module) DO NOTHING;

