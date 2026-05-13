import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: { id: string; role: string; username: string };
}

const JWT_SECRET = process.env.JWT_SECRET || 'transit-tn-secret-change-in-production';

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role: string; username: string };
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

export const requireOperator = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!['ADMIN', 'OPERATOR'].includes(req.user?.role || '')) {
    return res.status(403).json({ message: 'Operator or Admin access required' });
  }
  next();
};

export const generateToken = (payload: { id: string; role: string; username: string }): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};
