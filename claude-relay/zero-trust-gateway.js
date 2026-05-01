const security = require('./security-fortress');
const jwt = require('jsonwebtoken');

function createGateway(config) {
  return async function(req, res, next) {
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

    if (security.BLOCKED_IPS.has(ip)) {
      security.logSecurity('BLOCKED_ATTEMPT', ip, req.path);
      return res.status(403).json({ error: 'Access denied' });
    }

    const attackCheck = security.detectAttack(ip, req.path.includes('login') ? 'login' : 'api');
    if (attackCheck.isAttack) return res.status(429).json({ error: 'IP temporarily blocked' });

    // Login route doesn't need token
    if (req.path === '/remote/login' && req.method === 'POST') return next();

    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.relay_token || req.query?.token;
    if (!token) return res.status(401).json({ error: 'Token required' });

    try {
      const decoded = jwt.verify(token, config.jwtSecret || 'default');

      const tokenKey = token.slice(0, 16);
      const active = security.ACTIVE_TOKENS.get(tokenKey) || { requests: [], created: Date.now() };
      active.requests = active.requests.filter(t => Date.now() - t < 60000);
      active.requests.push(Date.now());
      active.lastUsed = Date.now();
      security.ACTIVE_TOKENS.set(tokenKey, active);

      if (active.requests.length > 200) return res.status(429).json({ error: 'Rate limit exceeded' });

      req.remoteUser = decoded;
      req.clientIp = ip;
      next();
    } catch (err) {
      security.logSecurity('INVALID_TOKEN', ip, err.message);
      return res.status(401).json({ error: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token' });
    }
  };
}

module.exports = { createGateway };
