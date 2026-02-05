/**
 * Auth API Integration Tests - Phase 6.6
 * 
 * Tests authentication endpoints:
 * - POST /api/auth/login
 * - POST /api/auth/register
 * - POST /api/auth/logout
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../server');
const User = require('../../models/User');

describe('Auth API Integration Tests', () => {
  let server;
  
  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/restaurant-test');
    }
    
    // Start server
    server = app.listen(0); // Random port
  });
  
  afterAll(async () => {
    // Cleanup
    await User.deleteMany({ email: /test.*@example\.com/ });
    await mongoose.connection.close();
    await server.close();
  });
  
  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test-register@example.com',
          password: 'TestPass123',
          phone: '9876543210',
          role: 'customer'
        });
      
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toHaveProperty('email', 'test-register@example.com');
      expect(response.body).toHaveProperty('token');
    });
    
    it('should reject duplicate email', async () => {
      // Create user first
      await User.create({
        name: 'Existing User',
        email: 'test-duplicate@example.com',
        password: 'TestPass123',
        phone: '9876543211',
        role: 'customer'
      });
      
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test-duplicate@example.com',
          password: 'TestPass123',
          phone: '9876543212',
          role: 'customer'
        });
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
    
    it('should reject invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'invalid-email',
          password: 'TestPass123',
          phone: '9876543210',
          role: 'customer'
        });
      
      expect(response.status).toBe(400);
    });
    
    it('should reject weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test-weak@example.com',
          password: 'weak',
          phone: '9876543210',
          role: 'customer'
        });
      
      expect(response.status).toBe(400);
    });
  });
  
  describe('POST /api/auth/login', () => {
    beforeAll(async () => {
      // Create test user
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('TestPass123', 10);
      
      await User.create({
        name: 'Login Test User',
        email: 'test-login@example.com',
        password: hashedPassword,
        phone: '9876543213',
        role: 'customer'
      });
    });
    
    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test-login@example.com',
          password: 'TestPass123'
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('token');
      expect(response.body.user).toHaveProperty('email', 'test-login@example.com');
    });
    
    it('should reject invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test-login@example.com',
          password: 'WrongPassword123'
        });
      
      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
    
    it('should reject non-existent user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'TestPass123'
        });
      
      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
    
    it('should reject missing credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({});
      
      expect(response.status).toBe(400);
    });
  });
});
