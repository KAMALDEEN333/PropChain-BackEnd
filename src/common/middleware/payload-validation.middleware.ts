import { Request, Response, NextFunction } from 'express';

export function payloadValidationMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.body && typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid payload format' });
  }

  // Example: enforce required fields for certain routes
  if (req.path.startsWith('/transactions') && !req.body.amount) {
    return res.status(422).json({ error: 'Missing required field: amount' });
  }

  next();
}
