/**
 * Authentication Middleware
 * 
 * Purpose: Verify JWT tokens and attach user to request
 * Used for: Admin routes, protected API endpoints
 * 
 * Flow:
 * 1. Extract token from Authorization header
 * 2. Verify JWT signature and expiration
 * 3. Attach decoded user to req.user
 * 4. Pass to next middleware
 */

const jwt = require('jsonwebtoken');

/**
 * Authenticate JWT token
 * 
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Next middleware
 */
function authenticate(req, res, next) {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'NO_TOKEN'
      });
    }
    
    // Check Bearer format
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Invalid authorization format. Use: Bearer <token>',
        code: 'INVALID_FORMAT'
      });
    }
    
    // Extract token
    const token = authHeader.substring(7); // Remove 'Bearer '
    
    if (!token || token.trim() === '') {
      return res.status(401).json({ 
        error: 'Token is empty',
        code: 'EMPTY_TOKEN'
      });
    }
    
    // Verify JWT
    const jwtSecret = process.env.JWT_SECRET;
    
    if (!jwtSecret) {
      console.error('❌ JWT_SECRET not configured');
      return res.status(500).json({ 
        error: 'Server configuration error',
        code: 'CONFIG_ERROR'
      });
    }
    
    try {
      const decoded = jwt.verify(token, jwtSecret);
      
      // Attach user to request
      req.user = {
        id: decoded.id || decoded.userId,
        role: decoded.role,
        email: decoded.email,
        phone: decoded.phone
      };
      
      // Log authentication (for audit)
      console.log(`🔐 Authenticated: ${req.user.role} (${req.user.id}) - ${req.method} ${req.originalUrl}`);
      
      next();
      
    } catch (jwtError) {
      // Handle specific JWT errors
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token has expired',
          code: 'TOKEN_EXPIRED',
          expiredAt: jwtError.expiredAt
        });
      }
      
      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Invalid token',
          code: 'INVALID_TOKEN'
        });
      }
      
      if (jwtError.name === 'NotBeforeError') {
        return res.status(401).json({ 
          error: 'Token not yet valid',
          code: 'TOKEN_NOT_ACTIVE'
        });
      }
      
      // Unknown JWT error
      console.error('JWT verification error:', jwtError);
      return res.status(401).json({ 
        error: 'Token verification failed',
        code: 'VERIFICATION_FAILED'
      });
    }
    
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({ 
      error: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
}

/**
 * Optional authentication - doesn't fail if no token
 * Useful for endpoints that work for both authenticated and anonymous users
 */
function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token provided - continue as anonymous
    req.user = null;
    return next();
  }
  
  // Token provided - verify it
  authenticate(req, res, next);
}

module.exports = {
  authenticate,
  optionalAuthenticate
};
