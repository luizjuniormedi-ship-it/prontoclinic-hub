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

