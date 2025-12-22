const Customer = require('../models/Customer');
const MenuItem = require('../models/MenuItem');
const Category = require('../models/Category');
const Order = require('../models/Order');
const whatsapp = require('./whatsapp');
const razorpayService = require('./razorpay');
const googleSheets = require('./googleSheets');
const axios = require('axios');

const generateOrderId = () => 'ORD' + Date.now().toString(36).toUpperCase();

const chatbot = {
  // Helper to find category by name
  findCategory(text, menuItems) {
    // Flatten category arrays and dedupe (category is an array field)
    const categories = [...new Set(menuItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
    const lowerText = text.toLowerCase();
    return categories.find(cat => cat.toLowerCase().includes(lowerText) || lowerText.includes(cat.toLowerCase()));
  },

  // Helper to find item by name
  findItem(text, menuItems) {
    const lowerText = text.toLowerCase();
    return menuItems.find(item => 
      item.name.toLowerCase().includes(lowerText) || 
      lowerText.includes(item.name.toLowerCase())
    );
  },

  // Helper to filter items by food type preference
  filterByFoodType(menuItems, preference) {
    if (preference === 'both') return menuItems;
    if (preference === 'veg') return menuItems.filter(item => item.foodType === 'veg');
    if (preference === 'nonveg') return menuItems.filter(item => item.foodType === 'nonveg' || item.foodType === 'egg');
    return menuItems;
  },

  // Reverse geocode coordinates to get readable address
  async reverseGeocode(latitude, longitude) {
    try {
      const response = await axios.get(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`,
        { headers: { 'User-Agent': 'RestaurantBot/1.0' } }
      );
      
      if (response.data && response.data.address) {
        const addr = response.data.address;
        // Build a readable address
        const parts = [];
        if (addr.house_number) parts.push(addr.house_number);
        if (addr.road) parts.push(addr.road);
        if (addr.neighbourhood || addr.suburb) parts.push(addr.neighbourhood || addr.suburb);
        if (addr.city || addr.town || addr.village) parts.push(addr.city || addr.town || addr.village);
        if (addr.state) parts.push(addr.state);
        if (addr.postcode) parts.push(addr.postcode);
        
        return parts.length > 0 ? parts.join(', ') : response.data.display_name || 'Location shared';
      }
      return 'Location shared';
    } catch (error) {
      console.error('Reverse geocoding error:', error.message);
      return 'Location shared';
    }
  },

  async handleMessage(phone, message, messageType = 'text', selectedId = null, senderName = null) {
    let customer = await Customer.findOne({ phone });
    if (!customer) {
      customer = new Customer({ 
        phone, 
        name: senderName || null,
        conversationState: { currentStep: 'welcome' }, 
        cart: [] 
      });
      await customer.save();
    } else if (senderName && (!customer.name || customer.name === 'Unknown' || customer.name === 'Customer')) {
      // Update name if we now have it and customer didn't have a proper name
      customer.name = senderName;
      await customer.save();
    }

    // Get paused categories to filter them out from chatbot
    const pausedCategories = await Category.find({ isPaused: true }).select('name');
    const pausedCategoryNames = pausedCategories.map(c => c.name);
    
    // Get available menu items and filter out items that belong ONLY to paused categories
    // Also remove paused category names from items that have multiple categories
    const allMenuItems = await MenuItem.find({ available: true });
    const menuItems = allMenuItems
      .filter(item => {
        const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
        // Keep item if it has at least one non-paused category
        return itemCategories.some(cat => !pausedCategoryNames.includes(cat));
      })
      .map(item => {
        // Remove paused categories from item's category array for display
        const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
        const filteredCategories = itemCategories.filter(cat => !pausedCategoryNames.includes(cat));
        return { ...item.toObject(), category: filteredCategories };
      });
    
    const state = customer.conversationState || { currentStep: 'welcome' };
    
    // Handle message - could be string or object (for location)
    const msg = typeof message === 'string' ? message.toLowerCase().trim() : '';
    const selection = selectedId || msg;

    console.log('🤖 Chatbot:', { phone, msg, selection, messageType, currentStep: state.currentStep });

    try {
      // ========== HANDLE LOCATION MESSAGE ==========
      if (messageType === 'location') {
        // message contains location data: { latitude, longitude, name, address }
        const locationData = typeof message === 'object' ? message : {};
        
        console.log('📍 Location received:', locationData);
        
        // Get proper address from coordinates using reverse geocoding
        let formattedAddress = 'Location shared';
        if (locationData.latitude && locationData.longitude) {
          formattedAddress = await this.reverseGeocode(locationData.latitude, locationData.longitude);
        }
        
        customer.deliveryAddress = {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          address: formattedAddress,
          updatedAt: new Date()
        };
        await customer.save();
        
        // If customer has items in cart, show order summary with payment options
        if (customer.cart?.length > 0) {
          await this.sendPaymentMethodOptions(phone, customer);
          state.currentStep = 'select_payment_method';
        } else {
          // No cart items, just confirm location saved
          await whatsapp.sendButtons(phone, 
            `📍 Location saved!\n\n${formattedAddress}\n\nStart ordering to use this address.`,
            [
              { id: 'place_order', text: 'Start Order' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
          state.currentStep = 'main_menu';
        }
      }
      // ========== GLOBAL COMMANDS (work from any state) ==========
      else if (msg === 'hi' || msg === 'hello' || msg === 'start' || msg === 'hey') {
        await this.sendWelcome(phone);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'home' || selection === 'back' || msg === 'home' || msg === 'back') {
        await this.sendWelcome(phone);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'view_menu' || msg === 'menu') {
        await this.sendFoodTypeSelection(phone);
        state.currentStep = 'select_food_type';
      }
      else if (selection === 'food_veg' || selection === 'food_nonveg' || selection === 'food_both') {
        state.foodTypePreference = selection.replace('food_', '');
        console.log('🍽️ Food type selected:', state.foodTypePreference);
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference);
        
        const foodTypeLabels = {
          veg: '🟢 Veg Menu',
          nonveg: '🔴 Non-Veg Menu',
          both: '🍽️ All Menu'
        };
        
        // If coming from order flow, show menu for ordering; otherwise show browse menu
        if (state.currentStep === 'select_food_type_order') {
          await this.sendMenuForOrderWithLabel(phone, filteredItems, foodTypeLabels[state.foodTypePreference]);
          state.currentStep = 'browsing_menu';
        } else {
          await this.sendMenuCategoriesWithLabel(phone, filteredItems, foodTypeLabels[state.foodTypePreference]);
          state.currentStep = 'select_category';
        }
      }
      else if (selection === 'view_cart' || msg === 'cart') {
        await this.sendCart(phone, customer);
        state.currentStep = 'viewing_cart';
      }
      else if (selection === 'place_order' || selection === 'order_now' || msg === 'order') {
        await this.sendServiceType(phone);
        state.currentStep = 'select_service';
      }
      else if (selection === 'order_status' || msg === 'status') {
        await this.sendOrderStatus(phone);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'track_order' || msg === 'track') {
        await this.sendTrackingOptions(phone);
        state.currentStep = 'select_track';
      }
      else if (selection === 'cancel_order') {
        await this.sendCancelOptions(phone);
        state.currentStep = 'select_cancel';
      }
      else if (selection === 'request_refund') {
        await this.sendRefundOptions(phone);
        state.currentStep = 'select_refund';
      }
      else if (selection === 'help' || msg === 'help') {
        await this.sendHelp(phone);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'checkout' || selection === 'review_pay') {
        // If cart is empty but user has a selected item, add it automatically with qty 1
        if (!customer.cart?.length && state.selectedItem) {
          const item = menuItems.find(m => m._id.toString() === state.selectedItem);
          if (item) {
            customer.cart = [{ menuItem: item._id, quantity: 1 }];
            await customer.save();
          }
        }
        
        if (!customer.cart?.length) {
          await whatsapp.sendButtons(phone, 'Your cart is empty! Please add items first.', [
            { id: 'place_order', text: 'Start Order' },
            { id: 'home', text: 'Main Menu' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          // Ask for delivery location first
          await this.requestLocation(phone);
          state.currentStep = 'awaiting_location';
        }
      }
      else if (selection === 'share_location') {
        // User tapped share location button - remind them to share
        await whatsapp.sendMessage(phone,
          `📍 Please share your location:\n\n` +
          `1️⃣ Tap the 📎 attachment icon below\n` +
          `2️⃣ Select "Location"\n` +
          `3️⃣ Send your current location\n\n` +
          `We're waiting for your location! 🛵`
        );
        state.currentStep = 'awaiting_location';
      }
      else if (selection === 'skip_location') {
        // Skip location - proceed to payment without address
        customer.deliveryAddress = {
          address: 'Address not provided - will confirm on call',
          updatedAt: new Date()
        };
        await customer.save();
        await this.sendPaymentMethodOptions(phone, customer);
        state.currentStep = 'select_payment_method';
      }
      else if (selection === 'pay_upi') {
        if (!customer.cart?.length) {
          await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
            { id: 'place_order', text: 'Start Order' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          state.paymentMethod = 'upi';
          const result = await this.processCheckout(phone, customer, state);
          if (result.success) state.currentStep = 'awaiting_payment';
        }
      }
      else if (selection === 'pay_cod') {
        if (!customer.cart?.length) {
          await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
            { id: 'place_order', text: 'Start Order' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          state.paymentMethod = 'cod';
          const result = await this.processCODOrder(phone, customer, state);
          if (result.success) state.currentStep = 'order_confirmed';
        }
      }
      else if (selection === 'confirm_order' || selection === 'pay_now') {
        if (!customer.cart?.length) {
          await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
            { id: 'place_order', text: 'Start Order' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          const result = await this.processCheckout(phone, customer, state);
          if (result.success) state.currentStep = 'awaiting_payment';
        }
      }
      else if (selection === 'clear_cart') {
        customer.cart = [];
        await whatsapp.sendButtons(phone, '🗑️ Cart cleared!', [
          { id: 'place_order', text: 'New Order' },
          { id: 'home', text: 'Main Menu' }
        ]);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'add_more') {
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        await this.sendMenuForOrder(phone, filteredItems);
        state.currentStep = 'browsing_menu';
      }

      // ========== CATEGORY SELECTION ==========
      else if (selection === 'cat_all') {
        // Show all items from all categories
        const preference = state.foodTypePreference || 'both';
        const filteredItems = this.filterByFoodType(menuItems, preference);
        console.log('🍽️ All items selected - Food preference:', preference, 'Total items:', filteredItems.length);
        await this.sendAllItems(phone, filteredItems);
        state.selectedCategory = 'all';
        state.currentStep = 'viewing_items';
      }
      else if (selection.startsWith('cat_')) {
        const sanitizedCat = selection.replace('cat_', '');
        const preference = state.foodTypePreference || 'both';
        const filteredItems = this.filterByFoodType(menuItems, preference);
        // Find original category name from sanitized ID
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9_]/g, '_') === sanitizedCat) || sanitizedCat;
        console.log('🍽️ Category selection - Food preference:', preference, 'Category:', category);
        console.log('🍽️ After filter - Items:', filteredItems.length, 'In category:', filteredItems.filter(m => Array.isArray(m.category) ? m.category.includes(category) : m.category === category).length);
        await this.sendCategoryItems(phone, filteredItems, category);
        state.selectedCategory = category;
        state.currentStep = 'viewing_items';
      }
      else if (selection === 'order_cat_all') {
        // Show all items for ordering
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        console.log('🍽️ All items for order - Total items:', filteredItems.length);
        await this.sendAllItemsForOrder(phone, filteredItems);
        state.selectedCategory = 'all';
        state.currentStep = 'selecting_item';
      }
      else if (selection.startsWith('order_cat_')) {
        const sanitizedCat = selection.replace('order_cat_', '');
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        // Find original category name from sanitized ID
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9_]/g, '_') === sanitizedCat) || sanitizedCat;
        await this.sendItemsForOrder(phone, filteredItems, category);
        state.selectedCategory = category;
        state.currentStep = 'selecting_item';
      }

      // ========== PAGINATION HANDLERS ==========
      // Category list pagination (for browsing)
      else if (selection.startsWith('menucat_page_')) {
        const page = parseInt(selection.replace('menucat_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.categoryPage = page;
        await this.sendMenuCategories(phone, filteredItems, 'Our Menu', page);
        state.currentStep = 'select_category';
      }
      // Category list pagination (for ordering)
      else if (selection.startsWith('ordercat_page_')) {
        const page = parseInt(selection.replace('ordercat_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.categoryPage = page;
        await this.sendMenuForOrder(phone, filteredItems, 'Select Items', page);
        state.currentStep = 'browsing_menu';
      }
      // All items pagination (for browsing)
      else if (selection.startsWith('allitems_page_')) {
        const page = parseInt(selection.replace('allitems_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.currentPage = page;
        await this.sendAllItems(phone, filteredItems, page);
        state.currentStep = 'viewing_items';
      }
      // All items pagination (for ordering)
      else if (selection.startsWith('orderitems_page_')) {
        const page = parseInt(selection.replace('orderitems_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.currentPage = page;
        await this.sendAllItemsForOrder(phone, filteredItems, page);
        state.currentStep = 'selecting_item';
      }
      else if (selection.startsWith('catpage_')) {
        const parts = selection.replace('catpage_', '').split('_');
        const page = parseInt(parts.pop());
        const safeCat = parts.join('_');
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9]/g, '_') === safeCat) || safeCat;
        state.currentPage = page;
        state.selectedCategory = category;
        await this.sendCategoryItems(phone, filteredItems, category, page);
        state.currentStep = 'viewing_items';
      }
      else if (selection.startsWith('ordercatpage_')) {
        const parts = selection.replace('ordercatpage_', '').split('_');
        const page = parseInt(parts.pop());
        const safeCat = parts.join('_');
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9]/g, '_') === safeCat) || safeCat;
        state.currentPage = page;
        state.selectedCategory = category;
        await this.sendItemsForOrder(phone, filteredItems, category, page);
        state.currentStep = 'selecting_item';
      }

      // ========== ITEM SELECTION ==========
      else if (selection.startsWith('view_')) {
        const itemId = selection.replace('view_', '');
        await this.sendItemDetails(phone, menuItems, itemId);
        state.selectedItem = itemId;
        state.currentStep = 'viewing_item_details';
      }
      else if (selection.startsWith('add_')) {
        const itemId = selection.replace('add_', '');
        const item = menuItems.find(m => m._id.toString() === itemId);
        if (item) {
          state.selectedItem = itemId;
          // Go directly to quantity selection
          await this.sendQuantitySelection(phone, item);
          state.currentStep = 'select_quantity';
        }
      }
      else if (selection.startsWith('confirm_add_')) {
        const itemId = selection.replace('confirm_add_', '');
        const item = menuItems.find(m => m._id.toString() === itemId);
        if (item) {
          state.selectedItem = itemId;
          await this.sendQuantitySelection(phone, item);
          state.currentStep = 'select_quantity';
        }
      }

      // ========== QUANTITY SELECTION ==========
      else if (selection.startsWith('qty_')) {
        const qty = parseInt(selection.replace('qty_', ''));
        console.log('🛒 Quantity selected:', { qty, selectedItem: state.selectedItem });
        
        const item = menuItems.find(m => m._id.toString() === state.selectedItem);
        
        if (item && qty > 0) {
          customer.cart = customer.cart || [];
          // Check if item already in cart
          const existingIndex = customer.cart.findIndex(c => c.menuItem?.toString() === item._id.toString());
          if (existingIndex >= 0) {
            customer.cart[existingIndex].quantity += qty;
          } else {
            customer.cart.push({ menuItem: item._id, quantity: qty });
          }
          console.log('🛒 Cart updated:', customer.cart.length, 'items');
          await this.sendAddedToCart(phone, item, qty, customer.cart);
          state.currentStep = 'item_added';
        } else {
          // Item not found - maybe state was lost, show menu again
          console.log('❌ Item not found for qty selection, showing menu');
          await whatsapp.sendButtons(phone,
            '⚠️ Something went wrong. Please select an item again.',
            [
              { id: 'place_order', text: 'Order Again' },
              { id: 'view_menu', text: 'View Menu' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
          state.currentStep = 'main_menu';
        }
      }

      // ========== SERVICE TYPE SELECTION ==========
      else if (state.currentStep === 'select_service') {
        const services = { 'delivery': 'delivery', 'pickup': 'pickup', 'dine_in': 'dine_in' };
        if (services[selection]) {
          state.selectedService = services[selection];
          // Ask for food type preference before showing menu
          await this.sendFoodTypeSelection(phone);
          state.currentStep = 'select_food_type_order';
        }
      }

      // ========== ORDER TRACKING ==========
      else if (selection.startsWith('track_')) {
        const orderId = selection.replace('track_', '');
        await this.sendTrackingDetails(phone, orderId);
        state.currentStep = 'main_menu';
      }

      // ========== ORDER CANCELLATION ==========
      else if (selection.startsWith('cancel_')) {
        const orderId = selection.replace('cancel_', '');
        await this.processCancellation(phone, orderId);
        state.currentStep = 'main_menu';
      }

      // ========== REFUND ==========
      else if (selection.startsWith('refund_')) {
        const orderId = selection.replace('refund_', '');
        await this.processRefund(phone, orderId);
        state.currentStep = 'main_menu';
      }

      // ========== CART ITEM REMOVAL ==========
      else if (selection.startsWith('remove_')) {
        const index = parseInt(selection.replace('remove_', ''));
        if (customer.cart && customer.cart[index]) {
          customer.cart.splice(index, 1);
          await this.sendCart(phone, customer);
          state.currentStep = 'viewing_cart';
        }
      }

      // ========== NUMBER SELECTION (for paginated categories) ==========
      else if (/^\d+$/.test(msg) && (state.currentStep === 'select_category' || state.currentStep === 'browsing_menu')) {
        const catNum = parseInt(msg);
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        const categories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        
        if (catNum === 0) {
          // "All Items" selected
          if (state.currentStep === 'browsing_menu') {
            await this.sendAllItemsForOrder(phone, filteredItems);
            state.selectedCategory = 'all';
            state.currentStep = 'selecting_item';
          } else {
            await this.sendAllItems(phone, filteredItems);
            state.selectedCategory = 'all';
            state.currentStep = 'viewing_items';
          }
        } else if (catNum >= 1 && catNum <= categories.length) {
          const category = categories[catNum - 1];
          if (state.currentStep === 'browsing_menu') {
            await this.sendItemsForOrder(phone, filteredItems, category);
            state.selectedCategory = category;
            state.currentStep = 'selecting_item';
          } else {
            await this.sendCategoryItems(phone, filteredItems, category);
            state.selectedCategory = category;
            state.currentStep = 'viewing_items';
          }
        } else {
          await whatsapp.sendButtons(phone, `❌ Invalid number. Please enter 0 for All Items or 1-${categories.length} for a category.`, [
            { id: 'home', text: 'Main Menu' }
          ]);
        }
      }

      // ========== NUMBER SELECTION (for paginated items) ==========
      else if (/^\d+$/.test(msg) && (state.currentStep === 'viewing_items' || state.currentStep === 'selecting_item')) {
        const itemNum = parseInt(msg);
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        let itemsList = filteredItems;
        
        // If a category is selected, filter by it
        if (state.selectedCategory && state.selectedCategory !== 'all') {
          itemsList = filteredItems.filter(m => 
            Array.isArray(m.category) ? m.category.includes(state.selectedCategory) : m.category === state.selectedCategory
          );
        }
        
        if (itemNum >= 1 && itemNum <= itemsList.length) {
          const item = itemsList[itemNum - 1];
          if (state.currentStep === 'selecting_item') {
            // For ordering - go to quantity selection
            state.selectedItem = item._id.toString();
            await this.sendQuantitySelection(phone, item);
            state.currentStep = 'select_quantity';
          } else {
            // For browsing - show item details
            await this.sendItemDetails(phone, menuItems, item._id.toString());
            state.selectedItem = item._id.toString();
            state.currentStep = 'viewing_item_details';
          }
        } else {
          await whatsapp.sendButtons(phone, `❌ Invalid number. Please enter a number between 1 and ${itemsList.length}.`, [
            { id: 'home', text: 'Main Menu' }
          ]);
        }
      }

      // ========== NATURAL LANGUAGE FALLBACKS ==========
      else if (this.findCategory(msg, menuItems)) {
        const category = this.findCategory(msg, menuItems);
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        if (state.currentStep === 'browsing_menu' || state.currentStep === 'selecting_item') {
          await this.sendItemsForOrder(phone, filteredItems, category);
          state.selectedCategory = category;
          state.currentStep = 'selecting_item';
        } else {
          await this.sendCategoryItems(phone, filteredItems, category);
          state.selectedCategory = category;
          state.currentStep = 'viewing_items';
        }
      }
      else if (this.findItem(msg, this.filterByFoodType(menuItems, state.foodTypePreference || 'both'))) {
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        const item = this.findItem(msg, filteredItems);
        state.selectedItem = item._id.toString();
        await this.sendQuantitySelection(phone, item);
        state.currentStep = 'select_quantity';
      }

      // ========== WELCOME FOR NEW/UNKNOWN STATE ==========
      else if (state.currentStep === 'welcome' || !state.currentStep) {
        await this.sendWelcome(phone);
        state.currentStep = 'main_menu';
      }

      // ========== FALLBACK ==========
      else {
        await whatsapp.sendButtons(phone,
          `🤔 I didn't understand that.\n\nPlease select an option:`,
          [
            { id: 'home', text: 'Main Menu' },
            { id: 'view_cart', text: 'View Cart' },
            { id: 'help', text: 'Help' }
          ]
        );
      }
    } catch (error) {
      console.error('Chatbot error:', error);
      await whatsapp.sendButtons(phone, '❌ Something went wrong. Please try again.', [
        { id: 'home', text: 'Main Menu' },
        { id: 'help', text: 'Help' }
      ]);
    }

    customer.conversationState = state;
    customer.conversationState.lastInteraction = new Date();
    await customer.save();
  },

  // ============ WELCOME & MAIN MENU ============
  async sendWelcome(phone) {
    // Send list menu with View Options button instantly
    await whatsapp.sendList(
      phone,
      '🍽️ Welcome!',
      'Welcome to our restaurant! How can we help you today?',
      'View Options',
      [
        {
          title: 'Order Food',
          rows: [
            { rowId: 'food_both', title: 'All Menu', description: 'Browse all dishes' },
            { rowId: 'food_veg', title: 'Veg Menu', description: 'Browse vegetarian dishes' },
            { rowId: 'food_nonveg', title: 'Non-Veg Menu', description: 'Browse non-vegetarian dishes' },
            { rowId: 'view_cart', title: 'My Cart', description: 'View items in cart' }
          ]
        },
        {
          title: 'My Orders',
          rows: [
            { rowId: 'order_status', title: 'Order Status', description: 'Check your orders' },
            { rowId: 'track_order', title: 'Track Delivery', description: 'Live order tracking' },
            { rowId: 'cancel_order', title: 'Cancel Order', description: 'Cancel & auto-refund if paid' }
          ]
        },
        {
          title: 'Support',
          rows: [{ rowId: 'help', title: 'Help', description: 'Get assistance' }]
        }
      ],
      'Powered by AI'
    );
  },

  // ============ MENU BROWSING ============
  async sendFoodTypeSelection(phone) {
    await whatsapp.sendButtons(phone,
      '🍽️ *Browse Menu*\n\nWhat would you like to see?',
      [
        { id: 'food_veg', text: 'Veg Only' },
        { id: 'food_nonveg', text: 'Non-Veg Only' },
        { id: 'food_both', text: 'Show All' }
      ]
    );
  },

  async sendMenuCategories(phone, menuItems, label = 'Our Menu', page = 0) {
    // Flatten category arrays and dedupe (category is an array field)
    const categories = [...new Set(menuItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
    
    if (!categories.length) {
      await whatsapp.sendButtons(phone, '📋 No menu items available right now.', [
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    // If 9 or fewer categories (+ All Items = 10), use WhatsApp list without pagination
    if (categories.length <= 9) {
      const rows = [
        { rowId: 'cat_all', title: '📋 All Items', description: `${menuItems.length} items - View everything` }
      ];
      
      categories.forEach(cat => {
        const count = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat).length;
        const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
        rows.push({ rowId: `cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items available` });
      });

      await whatsapp.sendList(phone, label, 'Select a category to browse items', 'View Categories',
        [{ title: 'Menu Categories', rows }], 'Fresh & Delicious!');
      return;
    }

    // More than 9 categories - use pagination with WhatsApp list
    const CATS_PER_PAGE = 9; // 9 categories + 1 "All Items" = 10 rows max
    const totalPages = Math.ceil(categories.length / CATS_PER_PAGE);
    const startIdx = page * CATS_PER_PAGE;
    const pageCats = categories.slice(startIdx, startIdx + CATS_PER_PAGE);

    // Build rows for the list
    const rows = [];
    
    // Add "All Items" option on first page only
    if (page === 0) {
      rows.push({ rowId: 'cat_all', title: '📋 All Items', description: `${menuItems.length} items - View everything` });
    }
    
    pageCats.forEach(cat => {
      const count = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat).length;
      const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
      rows.push({ rowId: `cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items available` });
    });

    await whatsapp.sendList(
      phone,
      `📋 ${label}`,
      `Page ${page + 1}/${totalPages} • ${categories.length} categories\nTap to select a category`,
      'View Categories',
      [{ title: 'Menu Categories', rows }],
      'Select a category'
    );

    // Send navigation buttons
    const buttons = [];
    if (page > 0) buttons.push({ id: `menucat_page_${page - 1}`, text: 'Previous' });
    if (page < totalPages - 1) buttons.push({ id: `menucat_page_${page + 1}`, text: 'Next' });
    buttons.push({ id: 'home', text: 'Menu' });

    await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
  },

  async sendMenuCategoriesWithLabel(phone, menuItems, label, page = 0) {
    await this.sendMenuCategories(phone, menuItems, label, page);
  },

  async sendCategoryItems(phone, menuItems, category, page = 0) {
    // Filter items that include this category (category is an array field)
    const items = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(category) : m.category === category);
    
    if (!items.length) {
      await whatsapp.sendButtons(phone, `📋 No items in ${category} right now.`, [
        { id: 'view_menu', text: 'Back to Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = items.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => ({
      rowId: `view_${item._id}`,
      title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
      description: `₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
    }));

    // Only items in the list, no navigation rows
    const sections = [{ title: `${category} (${items.length} items)`, rows }];

    await whatsapp.sendList(
      phone,
      `📋 ${category}`,
      `Page ${page + 1}/${totalPages} • ${items.length} items total\nTap an item to view details`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const safeCat = category.replace(/[^a-zA-Z0-9]/g, '_');
      const buttons = [];
      if (page > 0) buttons.push({ id: `catpage_${safeCat}_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `catpage_${safeCat}_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'view_menu', text: 'Menu' });
      await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  // Send all items (for browsing) - always use WhatsApp list with pagination
  async sendAllItems(phone, menuItems, page = 0) {
    if (!menuItems.length) {
      await whatsapp.sendButtons(phone, '📋 No items available right now.', [
        { id: 'view_menu', text: 'Back to Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(menuItems.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = menuItems.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => ({
      rowId: `view_${item._id}`,
      title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
      description: `₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
    }));

    const sections = [{ title: `All Items (${menuItems.length})`, rows }];

    await whatsapp.sendList(
      phone,
      '📋 All Items',
      `Page ${page + 1}/${totalPages} • ${menuItems.length} items total\nTap an item to view details`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const buttons = [];
      if (page > 0) buttons.push({ id: `allitems_page_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `allitems_page_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'view_menu', text: 'Menu' });
      await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  // Send products with images (fallback for catalog)
  async sendProductsWithImages(phone, items) {
    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    
    await whatsapp.sendMessage(phone, '🍽️ *Our Menu*\nBrowse items below and tap to add to cart!');
    
    for (const item of items.slice(0, 5)) {
      const icon = getFoodTypeIcon(item.foodType);
      const msg = `${icon} *${item.name}*\n💰 ₹${item.price}\n\n${item.description || 'Delicious!'}`;
      
      if (item.image && !item.image.startsWith('data:')) {
        await whatsapp.sendImageWithButtons(phone, item.image, msg, [
          { id: `add_${item._id}`, text: 'Add to Cart' }
        ]);
      } else {
        await whatsapp.sendButtons(phone, msg, [
          { id: `add_${item._id}`, text: 'Add to Cart' }
        ]);
      }
    }
    
    await whatsapp.sendButtons(phone, 'Want to see more items?', [
      { id: 'food_both', text: 'Full Menu' },
      { id: 'view_cart', text: 'View Cart' },
      { id: 'home', text: 'Home' }
    ]);
  },

  async sendItemDetails(phone, menuItems, itemId) {
    const item = menuItems.find(m => m._id.toString() === itemId);
    if (!item) {
      await whatsapp.sendButtons(phone, '❌ Item not found.', [
        { id: 'view_menu', text: 'View Menu' }
      ]);
      return;
    }

    const foodTypeLabel = item.foodType === 'veg' ? '🟢 Veg' : item.foodType === 'nonveg' ? '🔴 Non-Veg' : '';
    
    let msg = `*${item.name}*${foodTypeLabel ? ` ${foodTypeLabel}` : ''}\n\n`;
    msg += `💰 *Price:* ₹${item.price} / ${item.quantity || 1} ${item.unit || 'piece'}\n`;
    msg += `⏱️ *Prep Time:* ${item.preparationTime || 15} mins\n`;
    if (item.tags?.length) msg += `🏷️ *Tags:* ${item.tags.join(', ')}\n`;
    msg += `\n📝 ${item.description || 'Delicious dish prepared fresh!'}`;

    const buttons = [
      { id: `add_${item._id}`, text: 'Add to Cart' },
      { id: 'view_menu', text: 'Back to Menu' },
      { id: 'review_pay', text: 'Review & Pay' }
    ];

    if (item.image) {
      // Send image with details and buttons in one message
      await whatsapp.sendImageWithButtons(phone, item.image, msg, buttons);
    } else {
      // No image, send regular buttons with details
      await whatsapp.sendButtons(phone, msg, buttons);
    }
  },

  // Send item details for order flow (with Add to Cart focus)
  async sendItemDetailsForOrder(phone, item) {
    const foodTypeLabel = item.foodType === 'veg' ? '🟢 Veg' : item.foodType === 'nonveg' ? '🔴 Non-Veg' : '';
    
    let msg = `*${item.name}*${foodTypeLabel ? ` ${foodTypeLabel}` : ''}\n\n`;
    msg += `💰 *Price:* ₹${item.price} / ${item.quantity || 1} ${item.unit || 'piece'}\n`;
    msg += `⏱️ *Prep Time:* ${item.preparationTime || 15} mins\n`;
    if (item.tags?.length) msg += `🏷️ *Tags:* ${item.tags.join(', ')}\n`;
    msg += `\n📝 ${item.description || 'Delicious dish prepared fresh!'}`;

    const buttons = [
      { id: `confirm_add_${item._id}`, text: 'Add to Cart' },
      { id: 'add_more', text: 'Back to Menu' },
      { id: 'review_pay', text: 'Review & Pay' }
    ];

    if (item.image) {
      await whatsapp.sendImageWithButtons(phone, item.image, msg, buttons);
    } else {
      await whatsapp.sendButtons(phone, msg, buttons);
    }
  },

  // ============ ORDERING ============
  async sendServiceType(phone) {
    await whatsapp.sendButtons(phone,
      '🛒 *Place Order*\n\nHow would you like to receive your order?',
      [
        { id: 'delivery', text: 'Delivery' },
        { id: 'pickup', text: 'Pickup' },
        { id: 'dine_in', text: 'Dine-in' }
      ]
    );
  },

  async sendMenuForOrder(phone, menuItems, label = 'Select Items', page = 0) {
    // Flatten category arrays and dedupe (category is an array field)
    const categories = [...new Set(menuItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
    
    if (!categories.length) {
      await whatsapp.sendButtons(phone, '📋 No menu items available.', [
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    // If 9 or fewer categories (+ All Items = 10), use WhatsApp list without pagination
    if (categories.length <= 9) {
      const rows = [
        { rowId: 'order_cat_all', title: '📋 All Items', description: `${menuItems.length} items - View everything` }
      ];
      
      categories.forEach(cat => {
        const count = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat).length;
        const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
        rows.push({ rowId: `order_cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items` });
      });

      await whatsapp.sendList(phone, label, 'Choose a category to add items to your cart', 'View Categories',
        [{ title: 'Categories', rows }], 'Tap to browse');
      return;
    }

    // More than 9 categories - use pagination with WhatsApp list
    const CATS_PER_PAGE = 9; // 9 categories + 1 "All Items" = 10 rows max
    const totalPages = Math.ceil(categories.length / CATS_PER_PAGE);
    const startIdx = page * CATS_PER_PAGE;
    const pageCats = categories.slice(startIdx, startIdx + CATS_PER_PAGE);

    // Build rows for the list
    const rows = [];
    
    // Add "All Items" option on first page only
    if (page === 0) {
      rows.push({ rowId: 'order_cat_all', title: '📋 All Items', description: `${menuItems.length} items - View everything` });
    }
    
    pageCats.forEach(cat => {
      const count = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat).length;
      const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
      rows.push({ rowId: `order_cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items` });
    });

    await whatsapp.sendList(
      phone,
      `🛒 ${label}`,
      `Page ${page + 1}/${totalPages} • ${categories.length} categories\nTap to select a category`,
      'View Categories',
      [{ title: 'Categories', rows }],
      'Select a category'
    );

    // Send navigation buttons
    const buttons = [];
    if (page > 0) buttons.push({ id: `ordercat_page_${page - 1}`, text: 'Previous' });
    if (page < totalPages - 1) buttons.push({ id: `ordercat_page_${page + 1}`, text: 'Next' });
    buttons.push({ id: 'home', text: 'Menu' });

    await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
  },

  async sendMenuForOrderWithLabel(phone, menuItems, label, page = 0) {
    await this.sendMenuForOrder(phone, menuItems, label, page);
  },

  async sendItemsForOrder(phone, menuItems, category, page = 0) {
    // Filter items that include this category (category is an array field)
    const items = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(category) : m.category === category);
    
    if (!items.length) {
      await whatsapp.sendButtons(phone, `📋 No items in ${category}.`, [
        { id: 'add_more', text: 'Other Categories' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = items.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => ({
      rowId: `add_${item._id}`,
      title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
      description: `₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
    }));

    const sections = [{ title: `${category} (${items.length} items)`, rows }];

    await whatsapp.sendList(
      phone,
      `📋 ${category}`,
      `Page ${page + 1}/${totalPages} • ${items.length} items total\nTap an item to add to cart`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const safeCat = category.replace(/[^a-zA-Z0-9]/g, '_');
      const buttons = [];
      if (page > 0) buttons.push({ id: `ordercatpage_${safeCat}_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `ordercatpage_${safeCat}_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'home', text: 'Menu' });
      await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  // Send all items for ordering with pagination
  async sendAllItemsForOrder(phone, menuItems, page = 0) {
    if (!menuItems.length) {
      await whatsapp.sendButtons(phone, '📋 No items available.', [
        { id: 'add_more', text: 'Other Categories' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(menuItems.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = menuItems.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => ({
      rowId: `add_${item._id}`,
      title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
      description: `₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
    }));

    const sections = [{ title: `All Items (${menuItems.length})`, rows }];

    await whatsapp.sendList(
      phone,
      '📋 All Items',
      `Page ${page + 1}/${totalPages} • ${menuItems.length} items total\nTap an item to add to cart`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const buttons = [];
      if (page > 0) buttons.push({ id: `orderitems_page_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `orderitems_page_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'home', text: 'Menu' });
      await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  async sendQuantitySelection(phone, item) {
    const unitLabel = item.unit || 'piece';
    const qtyLabel = item.quantity || 1;
    await whatsapp.sendButtons(phone,
      `*${item.name}*\n💰 ₹${item.price} / ${qtyLabel} ${unitLabel}\n\nHow many would you like?`,
      [
        { id: 'qty_1', text: '1' },
        { id: 'qty_2', text: '2' },
        { id: 'qty_3', text: '3' }
      ]
    );
  },

  async sendAddedToCart(phone, item, qty, cart) {
    const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);
    const unitInfo = `${item.quantity || 1} ${item.unit || 'piece'}`;
    await whatsapp.sendButtons(phone,
      `✅ *Added to Cart!*\n\n${qty}x ${item.name} (${unitInfo})\n💰 ₹${item.price * qty}\n\n🛒 Cart: ${cartCount} items`,
      [
        { id: 'add_more', text: 'Add More' },
        { id: 'view_cart', text: 'View Cart' },
        { id: 'review_pay', text: 'Review & Pay' }
      ]
    );
  },

  // ============ CART & CHECKOUT ============
  async sendCheckoutOptions(phone, customer) {
    await customer.populate('cart.menuItem');
    
    if (!customer.cart?.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'place_order', text: 'Start Order' }
      ]);
      return;
    }

    let total = 0;
    let cartMsg = '🛒 *Your Cart*\n\n';
    
    customer.cart.forEach((item, i) => {
      if (item.menuItem) {
        const subtotal = item.menuItem.price * item.quantity;
        total += subtotal;
        const unitInfo = `${item.menuItem.quantity || 1} ${item.menuItem.unit || 'piece'}`;
        cartMsg += `${i + 1}. *${item.menuItem.name}* (${unitInfo})\n`;
        cartMsg += `   Qty: ${item.quantity} × ₹${item.menuItem.price} = ₹${subtotal}\n\n`;
      }
    });
    
    cartMsg += `━━━━━━━━━━━━━━━\n`;
    cartMsg += `*Total: ₹${total}*`;

    // Show Review & Pay, Add More, Cancel buttons
    await whatsapp.sendButtons(phone, cartMsg, [
      { id: 'review_pay', text: 'Review & Pay' },
      { id: 'add_more', text: 'Add More' },
      { id: 'clear_cart', text: 'Cancel' }
    ]);
  },

  async requestLocation(phone) {
    // Request location with action buttons
    await whatsapp.sendLocationRequest(phone,
      `📍 *Share Your Delivery Location*\n\nPlease share your location for accurate delivery.`
    );
  },

  async sendPaymentMethodOptions(phone, customer) {
    await customer.populate('cart.menuItem');
    
    if (!customer.cart?.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'place_order', text: 'Start Order' }
      ]);
      return;
    }

    let total = 0;
    let cartMsg = '🛒 *Order Summary*\n\n';
    
    customer.cart.forEach((item, i) => {
      if (item.menuItem) {
        const subtotal = item.menuItem.price * item.quantity;
        total += subtotal;
        const unitInfo = `${item.menuItem.quantity || 1} ${item.menuItem.unit || 'piece'}`;
        cartMsg += `${i + 1}. *${item.menuItem.name}* (${unitInfo})\n`;
        cartMsg += `   Qty: ${item.quantity} × ₹${item.menuItem.price} = ₹${subtotal}\n\n`;
      }
    });
    
    cartMsg += `━━━━━━━━━━━━━━━\n`;
    cartMsg += `*Total: ₹${total}*\n\n`;
    
    // Show delivery address if available
    if (customer.deliveryAddress?.address) {
      cartMsg += `📍 *Delivery Address:*\n${customer.deliveryAddress.address}\n\n`;
    }
    
    cartMsg += `💳 Select payment method:`;

    await whatsapp.sendButtons(phone, cartMsg, [
      { id: 'pay_upi', text: 'UPI/APP' },
      { id: 'pay_cod', text: 'COD' },
      { id: 'clear_cart', text: 'Cancel' }
    ]);
  },

  async processCODOrder(phone, customer, state) {
    await customer.populate('cart.menuItem');
    
    if (!customer.cart?.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'place_order', text: 'Start Order' }
      ]);
      return { success: false };
    }

    const orderId = generateOrderId();
    let total = 0;
    const items = customer.cart.filter(item => item.menuItem).map(item => {
      const subtotal = item.menuItem.price * item.quantity;
      total += subtotal;
      return {
        menuItem: item.menuItem._id,
        name: item.menuItem.name,
        quantity: item.quantity,
        price: item.menuItem.price,
        unit: item.menuItem.unit || 'piece',
        unitQty: item.menuItem.quantity || 1,
        image: item.menuItem.image
      };
    });

    if (!items.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'place_order', text: 'Start Order' }
      ]);
      return { success: false };
    }

    const order = new Order({
      orderId,
      customer: { phone: customer.phone, name: customer.name || 'Customer', email: customer.email },
      items,
      totalAmount: total,
      serviceType: state.selectedService || 'delivery',
      deliveryAddress: customer.deliveryAddress ? {
        address: customer.deliveryAddress.address,
        latitude: customer.deliveryAddress.latitude,
        longitude: customer.deliveryAddress.longitude
      } : null,
      paymentMethod: 'cod',
      status: 'confirmed',
      trackingUpdates: [{ status: 'confirmed', message: 'Order confirmed - Cash on Delivery' }]
    });
    await order.save();

    // Track today's orders count
    try {
      const DashboardStats = require('../models/DashboardStats');
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      await DashboardStats.findOneAndUpdate(
        {},
        { 
          $inc: { todayOrders: 1 },
          $set: { todayDate: todayStr, lastUpdated: new Date() }
        },
        { upsert: true }
      );
    } catch (statsErr) {
      console.error('Error tracking today orders:', statsErr.message);
    }

    // Emit event for real-time updates
    const dataEvents = require('./eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    // Sync to Google Sheets
    googleSheets.addOrder(order).catch(err => console.error('Google Sheets sync error:', err));

    customer.cart = [];
    customer.orderHistory = customer.orderHistory || [];
    customer.orderHistory.push(order._id);
    state.pendingOrderId = orderId;

    let confirmMsg = `✅ *Order Confirmed!*\n\n`;
    confirmMsg += `📦 Order ID: *${orderId}*\n`;
    confirmMsg += `💵 Payment: *Cash on Delivery*\n`;
    confirmMsg += `💰 Total: *₹${total}*\n\n`;
    confirmMsg += `━━━━━━━━━━━━━━━\n`;
    confirmMsg += `*Items:*\n`;
    items.forEach((item, i) => {
      confirmMsg += `${i + 1}. ${item.name} (${item.unitQty} ${item.unit}) x${item.quantity} - ₹${item.price * item.quantity}\n`;
    });
    confirmMsg += `━━━━━━━━━━━━━━━\n\n`;
    confirmMsg += `🙏 Thank you for your order!\nPlease keep ₹${total} ready for payment.`;

    await whatsapp.sendButtons(phone, confirmMsg, [
      { id: 'track_order', text: 'Track Order' },
      { id: 'home', text: 'Main Menu' }
    ]);

    return { success: true };
  },

  async sendOrderReview(phone, customer) {
    await customer.populate('cart.menuItem');
    
    if (!customer.cart?.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'place_order', text: 'Start Order' }
      ]);
      return;
    }

    let total = 0;
    let reviewMsg = '📋 *Review Your Order*\n\n';
    
    customer.cart.forEach((item, i) => {
      if (item.menuItem) {
        const subtotal = item.menuItem.price * item.quantity;
        total += subtotal;
        const unitInfo = `${item.menuItem.quantity || 1} ${item.menuItem.unit || 'piece'}`;
        reviewMsg += `${i + 1}. *${item.menuItem.name}* (${unitInfo})\n`;
        reviewMsg += `   Qty: ${item.quantity} × ₹${item.menuItem.price} = ₹${subtotal}\n\n`;
      }
    });
    
    reviewMsg += `━━━━━━━━━━━━━━━\n`;
    reviewMsg += `*Total: ₹${total}*\n\n`;
    reviewMsg += `Please confirm your order to proceed with payment.`;

    await whatsapp.sendButtons(phone, reviewMsg, [
      { id: 'confirm_order', text: 'Confirm & Pay' },
      { id: 'add_more', text: 'Add More' },
      { id: 'clear_cart', text: 'Cancel' }
    ]);
  },

  async sendCart(phone, customer) {
    await customer.populate('cart.menuItem');
    
    if (!customer.cart?.length) {
      await whatsapp.sendButtons(phone,
        '🛒 *Your Cart is Empty*\n\nStart adding delicious items!',
        [
          { id: 'place_order', text: 'Start Order' },
          { id: 'view_menu', text: 'View Menu' }
        ]
      );
      return;
    }

    let total = 0;
    let cartMsg = '🛒 *Your Cart*\n\n';
    
    customer.cart.forEach((item, i) => {
      if (item.menuItem) {
        const subtotal = item.menuItem.price * item.quantity;
        total += subtotal;
        const unitInfo = `${item.menuItem.quantity || 1} ${item.menuItem.unit || 'piece'}`;
        cartMsg += `${i + 1}. *${item.menuItem.name}* (${unitInfo})\n`;
        cartMsg += `   ${item.quantity} × ₹${item.menuItem.price} = ₹${subtotal}\n\n`;
      }
    });
    
    cartMsg += `━━━━━━━━━━━━━━━\n`;
    cartMsg += `*Total: ₹${total}*`;

    await whatsapp.sendButtons(phone, cartMsg, [
      { id: 'review_pay', text: 'Review & Pay' },
      { id: 'add_more', text: 'Add More' },
      { id: 'clear_cart', text: 'Clear Cart' }
    ]);
  },

  async processCheckout(phone, customer, state) {
    await customer.populate('cart.menuItem');
    
    if (!customer.cart?.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'place_order', text: 'Start Order' }
      ]);
      return { success: false };
    }

    const orderId = generateOrderId();
    let total = 0;
    const items = customer.cart.filter(item => item.menuItem).map(item => {
      const subtotal = item.menuItem.price * item.quantity;
      total += subtotal;
      return {
        menuItem: item.menuItem._id,
        name: item.menuItem.name,
        quantity: item.quantity,
        price: item.menuItem.price,
        unit: item.menuItem.unit || 'piece',
        unitQty: item.menuItem.quantity || 1,
        image: item.menuItem.image
      };
    });

    if (!items.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'place_order', text: 'Start Order' }
      ]);
      return { success: false };
    }

    const order = new Order({
      orderId,
      customer: { phone: customer.phone, name: customer.name || 'Customer', email: customer.email },
      items,
      totalAmount: total,
      serviceType: state.selectedService || 'delivery',
      deliveryAddress: customer.deliveryAddress ? {
        address: customer.deliveryAddress.address,
        latitude: customer.deliveryAddress.latitude,
        longitude: customer.deliveryAddress.longitude
      } : null,
      trackingUpdates: [{ status: 'pending', message: 'Order created, awaiting payment' }]
    });
    await order.save();

    // Track today's orders count
    try {
      const DashboardStats = require('../models/DashboardStats');
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      await DashboardStats.findOneAndUpdate(
        {},
        { 
          $inc: { todayOrders: 1 },
          $set: { todayDate: todayStr, lastUpdated: new Date() }
        },
        { upsert: true }
      );
    } catch (statsErr) {
      console.error('Error tracking today orders:', statsErr.message);
    }

    // Emit event for real-time updates
    const dataEvents = require('./eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    // Sync to Google Sheets
    googleSheets.addOrder(order).catch(err => console.error('Google Sheets sync error:', err));

    customer.cart = [];
    customer.orderHistory = customer.orderHistory || [];
    customer.orderHistory.push(order._id);
    state.pendingOrderId = orderId;

    try {
      const paymentLink = await razorpayService.createPaymentLink(total, orderId, customer.phone, customer.name);
      order.razorpayOrderId = paymentLink.id;
      await order.save();

      await whatsapp.sendOrder(phone, order, items, paymentLink.short_url);
      return { success: true };
    } catch (err) {
      console.error('Payment link error:', err);
      await whatsapp.sendButtons(phone,
        `✅ *Order Created!*\n\nOrder ID: ${orderId}\nTotal: ₹${total}\n\n⚠️ Payment link unavailable.\nPlease contact us.`,
        [
          { id: 'order_status', text: 'Check Status' },
          { id: 'home', text: 'Main Menu' }
        ]
      );
      return { success: true };
    }
  },


  // ============ ORDER MANAGEMENT ============
  async sendOrderStatus(phone) {
    const orders = await Order.find({ 'customer.phone': phone }).sort({ createdAt: -1 }).limit(5);
    
    if (!orders.length) {
      await whatsapp.sendButtons(phone,
        '📋 *No Orders Found*\n\nYou haven\'t placed any orders yet.',
        [{ id: 'place_order', text: 'Order Now' }, { id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    const statusEmoji = {
      pending: '⏳', confirmed: '✅', preparing: '👨‍🍳', ready: '📦',
      out_for_delivery: '🛵', delivered: '✅', cancelled: '❌', refunded: '💰'
    };
    const statusLabel = {
      pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
      out_for_delivery: 'On the Way', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded'
    };

    let msg = '📋 *Your Orders*\n\n';
    orders.forEach(o => {
      msg += `${statusEmoji[o.status] || '•'} *${o.orderId}*\n`;
      msg += `   ${statusLabel[o.status] || o.status.replace('_', ' ')} | ₹${o.totalAmount}\n`;
      msg += `   ${new Date(o.createdAt).toLocaleDateString()}\n\n`;
    });

    await whatsapp.sendButtons(phone, msg, [
      { id: 'track_order', text: 'Track Order' },
      { id: 'home', text: 'Main Menu' }
    ]);
  },

  async sendTrackingOptions(phone) {
    const orders = await Order.find({
      'customer.phone': phone,
      status: { $nin: ['delivered', 'cancelled', 'refunded'] }
    }).sort({ createdAt: -1 }).limit(5);

    if (!orders.length) {
      await whatsapp.sendButtons(phone,
        '📍 *No Active Orders*\n\nNo orders to track right now.',
        [{ id: 'place_order', text: 'Order Now' }, { id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    const statusLabel = {
      pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
      out_for_delivery: 'On the Way', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded'
    };
    const rows = orders.map(o => ({
      rowId: `track_${o.orderId}`,
      title: o.orderId,
      description: `₹${o.totalAmount} - ${statusLabel[o.status] || o.status.replace('_', ' ')}`
    }));

    await whatsapp.sendList(phone,
      'Track Order',
      'Select an order to track',
      'Select Order',
      [{ title: 'Active Orders', rows }]
    );
  },

  async sendTrackingDetails(phone, orderId) {
    const order = await Order.findOne({ orderId, 'customer.phone': phone });
    
    if (!order) {
      await whatsapp.sendButtons(phone, '❌ Order not found.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    const statusEmoji = {
      pending: '⏳', confirmed: '✅', preparing: '👨‍🍳', ready: '📦',
      out_for_delivery: '🛵', delivered: '✅', cancelled: '❌', refunded: '💰'
    };
    const statusLabel = {
      pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
      out_for_delivery: 'On the Way', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded'
    };

    let msg = `📍 *Order Tracking*\n\n`;
    msg += `Order: *${order.orderId}*\n`;
    msg += `Status: ${statusEmoji[order.status] || '•'} *${(statusLabel[order.status] || order.status.replace('_', ' ')).toUpperCase()}*\n`;
    msg += `Amount: ₹${order.totalAmount}\n\n`;
    msg += `━━━━━━━━━━━━━━━\n*Timeline:*\n\n`;
    
    order.trackingUpdates.forEach(u => {
      msg += `${statusEmoji[u.status] || '•'} ${u.message}\n`;
      msg += `   ${new Date(u.timestamp).toLocaleString()}\n\n`;
    });

    if (order.estimatedDeliveryTime) {
      msg += `⏰ *ETA:* ${new Date(order.estimatedDeliveryTime).toLocaleString()}`;
    }

    await whatsapp.sendButtons(phone, msg, [
      { id: 'order_status', text: 'All Orders' },
      { id: 'home', text: 'Main Menu' }
    ]);
  },

  async sendCancelOptions(phone) {
    // Can cancel orders that are not delivered, cancelled, or refunded
    const orders = await Order.find({
      'customer.phone': phone,
      status: { $in: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'] }
    }).sort({ createdAt: -1 }).limit(5);

    if (!orders.length) {
      await whatsapp.sendButtons(phone,
        '❌ *No Orders to Cancel*\n\nNo cancellable orders found.',
        [{ id: 'order_status', text: 'View Orders' }, { id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    const rows = orders.map(o => ({
      rowId: `cancel_${o.orderId}`,
      title: o.orderId,
      description: `₹${o.totalAmount} - ${o.status} - ${o.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}`
    }));

    await whatsapp.sendList(phone,
      'Cancel Order',
      'Select an order to cancel. If paid, refund will be requested.',
      'Select Order',
      [{ title: 'Your Orders', rows }],
      'This cannot be undone'
    );
  },

  async processCancellation(phone, orderId) {
    const order = await Order.findOne({ orderId, 'customer.phone': phone });
    
    if (!order) {
      await whatsapp.sendButtons(phone, '❌ Order not found.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    // Cannot cancel delivered, cancelled, or refunded orders
    if (['delivered', 'cancelled', 'refunded'].includes(order.status)) {
      await whatsapp.sendButtons(phone,
        `❌ *Cannot Cancel*\n\nOrder is already ${order.status.replace('_', ' ')}.`,
        [{ id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    order.status = 'cancelled';
    order.cancellationReason = 'Customer requested';
    order.trackingUpdates.push({ status: 'cancelled', message: 'Order cancelled by customer', timestamp: new Date() });
    
    // Update payment status for COD orders
    if (order.paymentMethod === 'cod' && order.paymentStatus === 'pending') {
      order.paymentStatus = 'cancelled';
    }
    
    let msg = `✅ *Order Cancelled*\n\nOrder ${orderId} has been cancelled.`;
    
    // Auto-refund if already paid via UPI/online
    if (order.paymentStatus === 'paid' && order.razorpayPaymentId) {
      try {
        console.log('💰 Initiating refund for order:', orderId, 'Payment ID:', order.razorpayPaymentId);
        const refund = await razorpayService.refund(order.razorpayPaymentId, order.totalAmount);
        
        order.refundStatus = 'pending'; // Set to pending first
        order.refundAmount = order.totalAmount;
        order.refundId = refund.id;
        order.refundInitiatedAt = new Date();
        order.trackingUpdates.push({ 
          status: 'refund_initiated', 
          message: `Refund of ₹${order.totalAmount} initiated`, 
          timestamp: new Date() 
        });
        
        msg += `\n\n💰 *Refund Processing*\nYour refund of ₹${order.totalAmount} is being processed.\n\n⏱️ Your money will be refunded in 5-10 minutes.`;
        console.log('✅ Refund initiated:', refund.id);
        
        // Schedule refund completion message after 5 minutes
        const refundScheduler = require('./refundScheduler');
        refundScheduler.scheduleRefundCompletion(order.orderId, 5 * 60 * 1000); // 5 minutes
      } catch (refundError) {
        console.error('❌ Refund initiation failed:', refundError.message);
        order.refundStatus = 'failed';
        order.refundAmount = order.totalAmount;
        order.trackingUpdates.push({ 
          status: 'refund_failed', 
          message: `Refund failed: ${refundError.message}`, 
          timestamp: new Date() 
        });
        
        msg += `\n\n⚠️ *Refund Issue*\nWe couldn't process your refund automatically.\nAmount: ₹${order.totalAmount}\n\nOur team will contact you within 24 hours to resolve this. Sorry for the inconvenience!`;
      }
    } else if (order.paymentStatus === 'paid' && !order.razorpayPaymentId) {
      // Paid but no payment ID (edge case)
      order.refundStatus = 'pending';
      order.refundAmount = order.totalAmount;
      msg += `\n\n💰 *Refund Processing*\nYour refund of ₹${order.totalAmount} is being processed. Our team will contact you shortly.`;
    }
    
    await order.save();
    
    // Emit event for real-time updates
    const dataEvents = require('./eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');
    
    // Sync cancellation to Google Sheets
    googleSheets.updateOrderStatus(order.orderId, 'cancelled', order.paymentStatus).catch(err => 
      console.error('Google Sheets sync error:', err)
    );
    console.log('📊 Customer cancelled order, syncing to Google Sheets:', order.orderId);

    await whatsapp.sendButtons(phone, msg, [
      { id: 'place_order', text: 'New Order' },
      { id: 'home', text: 'Main Menu' }
    ]);
  },

  async sendRefundOptions(phone) {
    // Show paid orders that are not delivered and not already refunded
    const orders = await Order.find({
      'customer.phone': phone,
      paymentStatus: 'paid',
      status: { $nin: ['delivered', 'refunded'] },
      refundStatus: { $ne: 'completed' }
    }).sort({ createdAt: -1 }).limit(5);

    if (!orders.length) {
      await whatsapp.sendButtons(phone,
        '💰 *No Refundable Orders*\n\nNo paid orders available for refund.\n\nNote: Delivered orders cannot be refunded.',
        [{ id: 'order_status', text: 'View Orders' }, { id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    const rows = orders.map(o => ({
      rowId: `refund_${o.orderId}`,
      title: o.orderId,
      description: `₹${o.totalAmount} - ${o.status}${o.refundStatus === 'pending' ? ' (Refund Pending)' : ''}`
    }));

    await whatsapp.sendList(phone,
      'Request Refund',
      'Select an order for refund. Admin approval required.',
      'Select Order',
      [{ title: 'Paid Orders', rows }]
    );
  },

  async processRefund(phone, orderId) {
    const order = await Order.findOne({ orderId, 'customer.phone': phone });
    
    if (!order) {
      await whatsapp.sendButtons(phone, '❌ Order not found.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    if (order.paymentStatus !== 'paid') {
      await whatsapp.sendButtons(phone, '❌ No payment found for this order.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    // Cannot refund delivered orders
    if (order.status === 'delivered') {
      await whatsapp.sendButtons(phone, '❌ Delivered orders cannot be refunded.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    if (order.refundStatus === 'completed' || order.paymentStatus === 'refunded') {
      await whatsapp.sendButtons(phone, '❌ This order is already refunded.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    if (order.refundStatus === 'pending') {
      await whatsapp.sendButtons(phone, 
        `⏳ *Refund Already Requested*\n\nYour refund request for ₹${order.totalAmount} is pending admin approval.`,
        [{ id: 'order_status', text: 'View Orders' }, { id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    // Request refund (admin approval needed)
    order.refundStatus = 'pending';
    order.refundAmount = order.totalAmount;
    order.status = 'cancelled';
    order.trackingUpdates.push({ status: 'refund_requested', message: 'Refund requested by customer', timestamp: new Date() });
    await order.save();
    
    // Emit event for real-time updates
    const dataEvents = require('./eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');
    
    // Sync to Google Sheets
    googleSheets.updateOrderStatus(order.orderId, 'cancelled', order.paymentStatus).catch(err => 
      console.error('Google Sheets sync error:', err)
    );
    console.log('📊 Customer requested refund, syncing to Google Sheets:', order.orderId);

    await whatsapp.sendButtons(phone,
      `✅ *Refund Requested!*\n\nOrder: ${orderId}\nAmount: ₹${order.totalAmount}\n\n⏳ Your refund request is pending admin approval. You will be notified once processed.`,
      [{ id: 'order_status', text: 'View Orders' }, { id: 'home', text: 'Main Menu' }]
    );
  },

  // ============ HELP ============
  async sendHelp(phone) {
    const msg = `❓ *Help & Support*\n\n` +
      `🍽️ *Ordering*\n` +
      `• Browse menu and place orders\n` +
      `• Choose delivery, pickup, or dine-in\n\n` +
      `📦 *Order Management*\n` +
      `• Track your order in real-time\n` +
      `• Cancel orders before preparation\n` +
      `• Request refunds for paid orders\n\n` +
      `💬 *Quick Commands*\n` +
      `• "hi" - Main menu\n` +
      `• "menu" - View menu\n` +
      `• "cart" - View cart\n` +
      `• "status" - Check orders`;

    await whatsapp.sendButtons(phone, msg, [
      { id: 'home', text: 'Main Menu' },
      { id: 'place_order', text: 'Order Now' }
    ]);
  }
};

module.exports = chatbot;
