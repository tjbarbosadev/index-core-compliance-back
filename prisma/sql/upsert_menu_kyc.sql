-- One-shot: menu Dossiês KYC (/kyc) — require compliance.read
INSERT INTO menu_items (id, key, label, route, icon, sort_order, required_permission_id, active)
SELECT gen_random_uuid(), 'menu-kyc', 'Dossiês KYC', '/kyc', 'file-search', 75, p.id, true
FROM permissions p
WHERE p.key = 'compliance.read'
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    route = EXCLUDED.route,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    required_permission_id = EXCLUDED.required_permission_id,
    active = true;
