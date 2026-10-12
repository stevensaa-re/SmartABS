const router = require('express').Router();
const { query } = require('../db');
const { requireRole } = require('../auth');
const { asyncHandler, assert, str } = require('../util');

router.get('/', requireRole('admin'), asyncHandler(async (_req, res) => {
  const rows = await query(`SELECT actor_id AS actorUid, actor_name AS actorName, actor_role AS actorRole,
    action, entity, entity_id AS entityId, summary, created_at AS createdAt
    FROM audit_logs ORDER BY id DESC LIMIT 500`);
  res.json(rows);
}));

router.post('/', requireRole('admin', 'guru'), asyncHandler(async (req, res) => {
  const action = str(req.body.action);
  const entity = str(req.body.entity);
  const entityId = str(req.body.entityId);
  const summary = str(req.body.summary);
  assert(action.length > 0 && action.length <= 30, 'Aksi audit tidak valid.');
  assert(entity.length > 0 && entity.length <= 60, 'Jenis data audit tidak valid.');
  assert(entityId.length <= 100 && summary.length > 0 && summary.length <= 500, 'Ringkasan audit tidak valid.');
  const result = await query(`INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity, entity_id, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [req.user.id, req.user.name, req.user.role, action, entity, entityId, summary]);
  res.status(201).json({ id: result.insertId, actorUid: req.user.id, actorName: req.user.name,
    actorRole: req.user.role, action, entity, entityId, summary, createdAt: new Date().toISOString() });
}));

module.exports = router;
