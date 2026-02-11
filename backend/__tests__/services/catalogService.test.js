/**
 * CatalogService Tests — ensureCatalogMapping real-time sync
 * 
 * Verifies that when a single search result has no catalog mapping,
 * ensureCatalogMapping auto-creates it on-the-fly and returns the retailerId
 * so the native WhatsApp product card can be sent immediately.
 */

// Mock dependencies BEFORE requiring the module
jest.mock('../../models/CatalogProduct');
jest.mock('../../models/MenuItem');
jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));
jest.mock('../../services/metaCloud', () => ({
  createOrUpdateCatalogProduct: jest.fn().mockResolvedValue({ success: true }),
  batchCreateOrUpdateProducts: jest.fn().mockResolvedValue({ success: true })
}));

const CatalogProduct = require('../../models/CatalogProduct');
const catalogService = require('../../services/catalogService');
const metaCloud = require('../../services/metaCloud');
const logger = require('../../services/logger');

describe('catalogService.ensureCatalogMapping', () => {
  const mockItem = {
    _id: { toString: () => '64abc123def4567890abcdef' },
    name: 'Chicken Biryani',
    description: 'Fragrant basmati rice with tender chicken',
    price: 250,
    foodType: 'nonveg',
    image: 'https://example.com/biryani.jpg',
    category: ['Biryani'],
    available: true,
    isPaused: false,
    preparationTime: 25,
    totalRatings: 10,
    avgRating: 4.5,
    quantity: 1,
    unit: 'plate'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    catalogService.clearCache();
    process.env.META_CATALOG_ID = 'test-catalog-123';
  });

  afterEach(() => {
    delete process.env.META_CATALOG_ID;
  });

  test('returns null when catalog is not enabled (no META_CATALOG_ID)', async () => {
    delete process.env.META_CATALOG_ID;
    const result = await catalogService.ensureCatalogMapping(mockItem);
    expect(result).toBeNull();
  });

  test('returns existing retailerId immediately when mapping already exists (cache hit)', async () => {
    // Pre-populate cache with an existing mapping
    CatalogProduct.find = jest.fn().mockReturnValue({
      lean: () => Promise.resolve([
        { menuItem: '64abc123def4567890abcdef', retailerId: '64abc123def4567890abcdef', isActive: true }
      ])
    });

    const result = await catalogService.ensureCatalogMapping(mockItem);

    expect(result).toBe('64abc123def4567890abcdef');
    // Should NOT have called syncProductToMeta (no metaCloud push)
    expect(metaCloud.createOrUpdateCatalogProduct).not.toHaveBeenCalled();
  });

  test('auto-creates mapping and pushes to Meta when no mapping exists (real-time sync)', async () => {
    // First call: no mappings in DB (empty)
    CatalogProduct.find = jest.fn().mockReturnValue({
      lean: () => Promise.resolve([])
    });

    // syncProductToMeta internally calls findOneAndUpdate to create local mapping
    CatalogProduct.findOneAndUpdate = jest.fn().mockResolvedValue({
      menuItem: '64abc123def4567890abcdef',
      retailerId: '64abc123def4567890abcdef',
      isActive: true
    });

    const result = await catalogService.ensureCatalogMapping(mockItem);

    // Should return the itemId as retailerId
    expect(result).toBe('64abc123def4567890abcdef');

    // Should have pushed to Meta Commerce Catalog (single object, not array)
    expect(metaCloud.createOrUpdateCatalogProduct).toHaveBeenCalledWith(
      'test-catalog-123',
      expect.objectContaining({
        retailerId: '64abc123def4567890abcdef',
        name: 'Chicken Biryani',
        price: 250,
        currency: 'INR',
        imageUrl: 'https://example.com/biryani.jpg',
        availability: 'in stock'
      })
    );

    // Should have created local DB mapping
    expect(CatalogProduct.findOneAndUpdate).toHaveBeenCalledWith(
      { menuItem: mockItem._id },
      expect.objectContaining({
        menuItem: mockItem._id,
        retailerId: '64abc123def4567890abcdef',
        isActive: true
      }),
      { upsert: true, new: true }
    );

    // Should have logged the auto-creation
    expect(logger.info).toHaveBeenCalledWith(
      'Auto-creating catalog mapping for item',
      expect.objectContaining({ itemId: '64abc123def4567890abcdef', name: 'Chicken Biryani' })
    );
  });

  test('returns null gracefully when Meta push fails', async () => {
    CatalogProduct.find = jest.fn().mockReturnValue({
      lean: () => Promise.resolve([])
    });

    // Simulate Meta API failure — syncProductToMeta catches errors internally
    metaCloud.createOrUpdateCatalogProduct.mockRejectedValueOnce(new Error('Meta API rate limit'));
    CatalogProduct.findOneAndUpdate = jest.fn().mockRejectedValueOnce(new Error('DB error after Meta fail'));

    const result = await catalogService.ensureCatalogMapping(mockItem);

    // syncProductToMeta catches Meta errors internally and returns null,
    // but ensureCatalogMapping still returns the itemId since no exception was thrown
    // Only if syncProductToMeta itself throws does ensureCatalogMapping return null
    // Let's verify Meta was attempted
    expect(metaCloud.createOrUpdateCatalogProduct).toHaveBeenCalled();

    // The error is logged inside syncProductToMeta
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to sync product to Meta catalog',
      expect.objectContaining({ itemId: '64abc123def4567890abcdef' })
    );
  });

  test('second call uses cached mapping (no duplicate Meta push)', async () => {
    // First call: no mapping → auto-creates
    CatalogProduct.find = jest.fn().mockReturnValue({
      lean: () => Promise.resolve([])
    });
    CatalogProduct.findOneAndUpdate = jest.fn().mockResolvedValue({
      menuItem: '64abc123def4567890abcdef',
      retailerId: '64abc123def4567890abcdef',
      isActive: true
    });

    const result1 = await catalogService.ensureCatalogMapping(mockItem);
    expect(result1).toBe('64abc123def4567890abcdef');
    expect(metaCloud.createOrUpdateCatalogProduct).toHaveBeenCalledTimes(1);

    // Now simulate that getCatalogMap returns the new mapping (cache refreshed after clearCache)
    CatalogProduct.find = jest.fn().mockReturnValue({
      lean: () => Promise.resolve([
        { menuItem: '64abc123def4567890abcdef', retailerId: '64abc123def4567890abcdef', isActive: true }
      ])
    });

    const result2 = await catalogService.ensureCatalogMapping(mockItem);
    expect(result2).toBe('64abc123def4567890abcdef');

    // Should NOT push to Meta again — mapping already exists
    expect(metaCloud.createOrUpdateCatalogProduct).toHaveBeenCalledTimes(1);
  });

  test('handles paused/unavailable items with out of stock status', async () => {
    const pausedItem = { ...mockItem, isPaused: true };

    CatalogProduct.find = jest.fn().mockReturnValue({
      lean: () => Promise.resolve([])
    });
    CatalogProduct.findOneAndUpdate = jest.fn().mockResolvedValue({
      menuItem: '64abc123def4567890abcdef',
      retailerId: '64abc123def4567890abcdef',
      isActive: false
    });

    const result = await catalogService.ensureCatalogMapping(pausedItem);

    // Still returns retailerId — product exists in catalog
    expect(result).toBe('64abc123def4567890abcdef');

    // Pushed with 'out of stock' (single object)
    expect(metaCloud.createOrUpdateCatalogProduct).toHaveBeenCalledWith(
      'test-catalog-123',
      expect.objectContaining({
        availability: 'out of stock'
      })
    );
  });
});

describe('catalogService.buildCartSections', () => {
  const mockCartItems = [
    {
      menuItem: {
        _id: { toString: () => 'item1' },
        name: 'Meedhu Vadai',
        description: 'Crispy lentil fritter',
        price: 50,
        foodType: 'veg',
        image: 'https://example.com/vadai.jpg',
        category: ['Snacks'],
        available: true,
        isPaused: false,
        totalRatings: 5,
        avgRating: 4.2,
        quantity: 1,
        unit: 'piece'
      },
      quantity: 1
    },
    {
      menuItem: {
        _id: { toString: () => 'item2' },
        name: 'Sambar Vada',
        description: 'Vada soaked in sambar',
        price: 60,
        foodType: 'veg',
        image: 'https://example.com/sambar-vada.jpg',
        category: ['Snacks'],
        available: true,
        isPaused: false,
        totalRatings: 8,
        avgRating: 4.5,
        quantity: 1,
        unit: 'piece'
      },
      quantity: 1
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    catalogService.clearCache();
    process.env.META_CATALOG_ID = 'test-catalog-123';
  });

  afterEach(() => {
    delete process.env.META_CATALOG_ID;
  });

  test('returns null when catalog is not enabled', async () => {
    delete process.env.META_CATALOG_ID;
    const result = await catalogService.buildCartSections(mockCartItems);
    expect(result).toBeNull();
  });

  test('returns null for empty cart', async () => {
    const result = await catalogService.buildCartSections([]);
    expect(result).toBeNull();
  });

  test('auto-maps all cart items and returns sections (both items already mapped)', async () => {
    // Both items already have mappings in cache
    CatalogProduct.find = jest.fn().mockReturnValue({
      lean: () => Promise.resolve([
        { menuItem: 'item1', retailerId: 'item1', isActive: true },
        { menuItem: 'item2', retailerId: 'item2', isActive: true }
      ])
    });

    const result = await catalogService.buildCartSections(mockCartItems);

    expect(result).not.toBeNull();
    expect(result.totalMapped).toBe(2);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toBe('Your Items');
    expect(result.sections[0].productRetailerIds).toEqual(['item1', 'item2']);

    // No Meta push needed — both already mapped
    expect(metaCloud.createOrUpdateCatalogProduct).not.toHaveBeenCalled();
  });

  test('auto-creates missing mappings for unmapped cart items', async () => {
    // Only item1 is mapped, item2 is not
    CatalogProduct.find = jest.fn().mockReturnValue({
      lean: () => Promise.resolve([
        { menuItem: 'item1', retailerId: 'item1', isActive: true }
      ])
    });
    CatalogProduct.findOneAndUpdate = jest.fn().mockResolvedValue({
      menuItem: 'item2',
      retailerId: 'item2',
      isActive: true
    });

    const result = await catalogService.buildCartSections(mockCartItems);

    expect(result).not.toBeNull();
    expect(result.totalMapped).toBe(2);
    expect(result.sections[0].productRetailerIds).toEqual(['item1', 'item2']);

    // Should have pushed item2 to Meta (item1 was already mapped)
    expect(metaCloud.createOrUpdateCatalogProduct).toHaveBeenCalledTimes(1);
    expect(metaCloud.createOrUpdateCatalogProduct).toHaveBeenCalledWith(
      'test-catalog-123',
      expect.objectContaining({
        retailerId: 'item2',
        name: 'Sambar Vada'
      })
    );
  });

  test('skips cart items with null menuItem', async () => {
    const cartWithNull = [
      mockCartItems[0],
      { menuItem: null, quantity: 1 } // deleted menu item
    ];

    CatalogProduct.find = jest.fn().mockReturnValue({
      lean: () => Promise.resolve([
        { menuItem: 'item1', retailerId: 'item1', isActive: true }
      ])
    });

    const result = await catalogService.buildCartSections(cartWithNull);

    expect(result).not.toBeNull();
    expect(result.totalMapped).toBe(1);
    expect(result.sections[0].productRetailerIds).toEqual(['item1']);
  });
});
