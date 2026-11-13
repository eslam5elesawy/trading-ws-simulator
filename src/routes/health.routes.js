import { Router } from 'express';

export function healthRoutes(getStats) {
  const router = Router();
  router.get('/health', (req, res) => res.json({ status: 'ok', ...getStats() }));
  return router;
}
