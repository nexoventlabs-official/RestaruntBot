/**
 * Menu Handler Unit Tests - Phase 6.6
 * 
 * Tests menu domain handler functions
 */

const menuHandler = require('../../services/domains/menuHandler');
const MenuItem = require('../../models/MenuItem');
const Category = require('../../models/Category');

// Mock dependencies
jest.mock('../../services/whatsapp');
jest.mock('../../models/MenuItem');
jest.mock('../../models/Category');

describe('Menu Handler Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('showMenu', () => {
    it('should show menu with available categories', async () => {
      // Mock data
      const mockCategories = [
        { _id: '1', name: 'Starters', isActive: true, schedule: { isEnabled: false } },
        { _id: '2', name: 'Main Course', isActive: true, schedule: { isEnabled: false } }
      ];
      
      Category.find = jest.fn().mockResolvedValue(mockCategories);
      
      const whatsapp = require('../../services/whatsapp');
      whatsapp.sendList = jest.fn().mockResolvedValue(true);
      
      // Execute
      await menuHandler.showMenu('919876543210', {});
      
      // Verify
      expect(Category.find).toHaveBeenCalledWith({ isActive: true });
      expect(whatsapp.sendList).toHaveBeenCalled();
    });
    
    it('should handle no categories available', async () => {
      Category.find = jest.fn().mockResolvedValue([]);
      
      const whatsapp = require('../../services/whatsapp');
      whatsapp.sendMessage = jest.fn().mockResolvedValue(true);
      
      await menuHandler.showMenu('919876543210', {});
      
      expect(whatsapp.sendMessage).toHaveBeenCalledWith(
        '919876543210',
        expect.stringContaining('no categories')
      );
    });
  });
  
  describe('showCategoryItems', () => {
    it('should show items in a category', async () => {
      const mockCategory = {
        _id: '1',
        name: 'Starters',
        isActive: true
      };
      
      const mockItems = [
        {
          _id: '1',
          name: 'Spring Roll',
          price: 120,
          isAvailable: true,
          foodType: 'veg',
          image: 'image-url'
        },
        {
          _id: '2',
          name: 'Chicken Wings',
          price: 180,
          isAvailable: true,
          foodType: 'non-veg',
          image: 'image-url'
        }
      ];
      
      Category.findById = jest.fn().mockResolvedValue(mockCategory);
      MenuItem.find = jest.fn().mockResolvedValue(mockItems);
      
      const whatsapp = require('../../services/whatsapp');
      whatsapp.sendList = jest.fn().mockResolvedValue(true);
      
      await menuHandler.showCategoryItems('919876543210', { categoryId: '1' });
      
      expect(Category.findById).toHaveBeenCalledWith('1');
      expect(MenuItem.find).toHaveBeenCalledWith({
        category: '1',
        isAvailable: true
      });
      expect(whatsapp.sendList).toHaveBeenCalled();
    });
    
    it('should handle category not found', async () => {
      Category.findById = jest.fn().mockResolvedValue(null);
      
      const whatsapp = require('../../services/whatsapp');
      whatsapp.sendMessage = jest.fn().mockResolvedValue(true);
      
      await menuHandler.showCategoryItems('919876543210', { categoryId: 'invalid' });
      
      expect(whatsapp.sendMessage).toHaveBeenCalledWith(
        '919876543210',
        expect.stringContaining('not found')
      );
    });
    
    it('should handle no items in category', async () => {
      const mockCategory = {
        _id: '1',
        name: 'Empty Category',
        isActive: true
      };
      
      Category.findById = jest.fn().mockResolvedValue(mockCategory);
      MenuItem.find = jest.fn().mockResolvedValue([]);
      
      const whatsapp = require('../../services/whatsapp');
      whatsapp.sendMessage = jest.fn().mockResolvedValue(true);
      
      await menuHandler.showCategoryItems('919876543210', { categoryId: '1' });
      
      expect(whatsapp.sendMessage).toHaveBeenCalledWith(
        '919876543210',
        expect.stringContaining('no items')
      );
    });
  });
  
  describe('showItemDetails', () => {
    it('should show item details with add to cart button', async () => {
      const mockItem = {
        _id: '1',
        name: 'Spring Roll',
        description: 'Crispy spring rolls',
        price: 120,
        isAvailable: true,
        foodType: 'veg',
        image: 'image-url',
        category: { name: 'Starters' }
      };
      
      MenuItem.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockItem)
      });
      
      const whatsapp = require('../../services/whatsapp');
      whatsapp.sendImage = jest.fn().mockResolvedValue(true);
      
      await menuHandler.showItemDetails('919876543210', { itemId: '1' });
      
      expect(MenuItem.findById).toHaveBeenCalledWith('1');
      expect(whatsapp.sendImage).toHaveBeenCalled();
    });
    
    it('should handle item not found', async () => {
      MenuItem.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(null)
      });
      
      const whatsapp = require('../../services/whatsapp');
      whatsapp.sendMessage = jest.fn().mockResolvedValue(true);
      
      await menuHandler.showItemDetails('919876543210', { itemId: 'invalid' });
      
      expect(whatsapp.sendMessage).toHaveBeenCalledWith(
        '919876543210',
        expect.stringContaining('not found')
      );
    });
    
    it('should handle unavailable item', async () => {
      const mockItem = {
        _id: '1',
        name: 'Unavailable Item',
        isAvailable: false,
        category: { name: 'Starters' }
      };
      
      MenuItem.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockItem)
      });
      
      const whatsapp = require('../../services/whatsapp');
      whatsapp.sendMessage = jest.fn().mockResolvedValue(true);
      
      await menuHandler.showItemDetails('919876543210', { itemId: '1' });
      
      expect(whatsapp.sendMessage).toHaveBeenCalledWith(
        '919876543210',
        expect.stringContaining('not available')
      );
    });
  });
});
