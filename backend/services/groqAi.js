const Groq = require('groq-sdk');

let groq = null;
const getGroq = () => {
  if (!groq) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groq;
};

const groqAi = {
  // Transcribe audio using Groq's Whisper model
  // Optimized for Indian food ordering context
  async transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
    try {
      const client = getGroq();
      
      // Create a File-like object from buffer
      const file = new File([audioBuffer], 'audio.ogg', { type: mimeType });
      
      // Use prompt to help Whisper understand food-related context
      // This significantly improves accuracy for food names
      const transcription = await client.audio.transcriptions.create({
        file: file,
        model: 'whisper-large-v3',
        response_format: 'text',
        prompt: 'Food ordering: dosa, idli, vada, sambar, rasam, biryani, pulao, curry, rice, roti, parotta, chapati, naan, paneer, chicken, mutton, fish, prawn, egg, masala, butter, ghee, curd, dal, fry, gravy, soup, juice, coffee, tea, lassi, buttermilk, payasam, halwa, gulab jamun, jalebi, pongal, upma, pesarattu, uttapam, appam, puttu, poori, bonda, bajji, pakora, manchurian, fried rice, noodles, gobi, aloo, palak, mushroom, tomato, onion, gongura, pulihora, curd rice, lemon rice, tamarind rice, coconut rice, veg, non-veg, spicy, mild, hot, cold, sweet, order, cart, menu, cancel, status, track, delivery, pickup, dine-in'
      });
      
      console.log('🎤 Transcription result:', transcription);
      return transcription || '';
    } catch (error) {
      console.error('❌ Groq transcription error:', error.message);
      return null;
    }
  },

  // Clean and normalize transcribed text for better food search
  // Fixes common voice recognition mistakes for food items
  normalizeTranscription(text) {
    if (!text) return '';
    
    let normalized = text.toLowerCase().trim();
    
    // Common voice recognition mistakes for food items
    const corrections = {
      // Dosa variations
      'dosha': 'dosa', 'dhosha': 'dosa', 'dhosa': 'dosa', 'dosai': 'dosa',
      'those a': 'dosa', 'those are': 'dosa', 'dozer': 'dosa', 'closer': 'dosa',
      'dossa': 'dosa', 'doza': 'dosa', 'tosa': 'dosa', 'rosa': 'dosa',
      // Idli variations
      'idly': 'idli', 'idle': 'idli', 'italy': 'idli', 'ideally': 'idli',
      'idlee': 'idli', 'iddly': 'idli', 'iddli': 'idli', 'it lee': 'idli',
      // Vada variations
      'wada': 'vada', 'vadai': 'vada', 'vade': 'vada', 'water': 'vada',
      'vader': 'vada', 'voda': 'vada', 'bada': 'vada', 'wadda': 'vada',
      // Sambar variations
      'sambhar': 'sambar', 'sambaar': 'sambar', 'samba': 'sambar',
      'summer': 'sambar', 'somber': 'sambar', 'sambor': 'sambar',
      // Biryani variations
      'biriyani': 'biryani', 'briyani': 'biryani', 'biriani': 'biryani',
      'birani': 'biryani', 'bryani': 'biryani', 'beriani': 'biryani',
      // Rasam variations
      'rasamu': 'rasam', 'rasa': 'rasam', 'rasum': 'rasam',
      // Upma variations
      'uppuma': 'upma', 'uppit': 'upma', 'uppma': 'upma', 'up ma': 'upma',
      // Pongal variations
      'pongali': 'pongal', 'pongala': 'pongal', 'pongol': 'pongal',
      // Uttapam variations
      'uttappam': 'uttapam', 'uthappam': 'uttapam', 'utappam': 'uttapam',
      // Parotta variations
      'paratha': 'parotta', 'parota': 'parotta', 'barotta': 'parotta',
      // Chapati variations
      'chapathi': 'chapati', 'chapatti': 'chapati', 'chappati': 'chapati',
      // Poori variations
      'puri': 'poori', 'puree': 'poori', 'pooree': 'poori',
      // Paneer variations
      'panir': 'paneer', 'panner': 'paneer', 'panier': 'paneer',
      // Masala variations
      'masalla': 'masala', 'marsala': 'masala', 'massala': 'masala',
      // Chicken variations
      'chiken': 'chicken', 'chikken': 'chicken', 'chickan': 'chicken',
      // Mutton variations
      'mutan': 'mutton', 'muton': 'mutton', 'matton': 'mutton',
      // Curry variations
      'curri': 'curry', 'kari': 'curry', 'karri': 'curry',
      // Pulao/Pulav variations
      'pulav': 'pulao', 'pilaf': 'pulao', 'pilau': 'pulao',
      // Gongura variations
      'gongora': 'gongura', 'gangura': 'gongura', 'gonguru': 'gongura',
      // Pesarattu variations
      'pesaratu': 'pesarattu', 'pesarat': 'pesarattu', 'pesarathu': 'pesarattu',
      // Common phrases
      'i want': '', 'i need': '', 'give me': '', 'get me': '',
      'please': '', 'can i have': '', 'order': '', 'one': '1', 'two': '2',
      'three': '3', 'four': '4', 'five': '5'
    };
    
    // Apply corrections
    for (const [wrong, correct] of Object.entries(corrections)) {
      const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
      normalized = normalized.replace(regex, correct);
    }
    
    // Clean up extra spaces
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return normalized;
  },

  // Translate local language text to English for search
  // Returns multiple possible translations for better search matching
  async translateToEnglish(text) {
    try {
      // Check if text contains non-English characters (Indian languages)
      const hasNonEnglish = /[^\x00-\x7F]/.test(text);
      if (!hasNonEnglish) {
        // For English text, normalize and return
        const normalized = this.normalizeTranscription(text);
        return { primary: normalized || text, variations: [normalized || text] };
      }

      const client = getGroq();
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'system',
          content: `You are an expert Indian food translator. Translate food names from ANY Indian language (Telugu, Tamil, Hindi, Kannada, Malayalam) to English.

CRITICAL: Many food items have the SAME name in English and regional languages. Keep these as-is:
- dosa, idli, vada, biryani, sambar, rasam, upma, pongal, parotta, chapati, poori, naan, roti
- paneer, dal, curry, fry, rice, pulao

RULES:
1. Return ONLY the food name in English, no explanations
2. If the word is already a common food name, return it as-is
3. For regional-specific names, provide English equivalent

EXAMPLES:
- దోశ/தோசை → dosa
- ఇడ్లీ/இட்லி → idli  
- బిర్యానీ/பிரியாணி → biryani
- చిత్రాన్నం → lemon rice
- పులిహోర → tamarind rice
- గొంగూర చికెన్ → gongura chicken
- మటన్ బిర్యానీ → mutton biryani`
        }, {
          role: 'user',
          content: `Translate: "${text}"`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 100,
        temperature: 0.1
      });
      
      let response = completion.choices[0]?.message?.content?.trim() || text;
      
      // Clean up the response
      response = response.replace(/^["']|["']$/g, '').trim();
      response = response.replace(/^(translation|english|answer|result|variations?|the food item is|food item)[\s:=→]+/i, '').trim();
      
      // Parse variations (comma or slash separated)
      let variations = response.split(/[,\/]/).map(v => v.trim().toLowerCase()).filter(v => v.length > 0);
      
      // Remove any non-English variations and normalize
      variations = variations
        .filter(v => !/[^\x00-\x7F]/.test(v))
        .map(v => this.normalizeTranscription(v))
        .filter(v => v.length > 0);
      
      // If no valid variations, return original
      if (variations.length === 0) {
        return { primary: text, variations: [text] };
      }
      
      // Remove duplicates
      variations = [...new Set(variations)];
      
      console.log(`🌐 Translated "${text}" to variations: [${variations.join(', ')}]`);
      return { primary: variations[0], variations };
    } catch (error) {
      console.error('Groq translation error:', error.message);
      return { primary: text, variations: [text] };
    }
  },

  // Translate romanized Indian food names to standard English/searchable terms
  async translateRomanizedFood(text) {
    try {
      const client = getGroq();
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'system',
          content: `You are a food search assistant for an Indian restaurant. Convert romanized Indian food names to their standard searchable English names.

RULES:
1. If it's a specific regional dish name, keep it (gongura, pulihora, pesarattu)
2. Convert regional words to common English equivalents for searching
3. Return ONLY the converted name, no explanations

EXAMPLES:
- "gongura chicken" → "gongura chicken"
- "kodi biryani" → "chicken biryani"
- "mamsam curry" → "mutton curry"
- "chepala pulusu" → "fish curry"
- "bendakaya fry" → "okra fry"
- "gutti vankaya" → "stuffed brinjal"
- "pappu" → "dal"
- "koora" → "curry"
- "pulusu" → "curry"
- "vepudu" → "fry"
- "iguru" → "dry curry"
- "perugu" → "curd"
- "annam" → "rice"
- "roti" → "roti"
- "parotta" → "parotta"
- "dosai" → "dosa"
- "idly" → "idli"
- "vadai" → "vada"
- "kozhi" → "chicken"
- "aattu" → "mutton"
- "meen" → "fish"
- "murgh" → "chicken"
- "gosht" → "mutton"
- "machli" → "fish"

If already standard or you're unsure, return as is.`
        }, {
          role: 'user',
          content: `Convert: "${text}"`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 50,
        temperature: 0.1
      });
      
      let translated = completion.choices[0]?.message?.content?.trim() || text;
      
      // Clean up the response
      translated = translated.replace(/^["']|["']$/g, '').trim();
      translated = translated.replace(/^(the |a |an )/i, '').trim();
      translated = translated.replace(/^(translation|english|answer|result|convert)[\s:=→]+/i, '').trim();
      
      // If response is too long or contains explanation, return original
      if (translated.length > 50 || translated.includes('\n')) {
        return text;
      }
      
      console.log(`🔤 Romanized "${text}" → "${translated}"`);
      return translated;
    } catch (error) {
      console.error('Groq romanized translation error:', error.message);
      return text;
    }
  },

  async generateDescription(itemName, category) {
    try {
      const client = getGroq();
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'user',
          content: `Write a short, appetizing description (max 50 words) for a restaurant menu item called "${itemName}" in the "${category}" category. Make it enticing and highlight flavors. Only return the description, no quotes or extra text.`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 150,
        temperature: 0.7
      });
      return completion.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
      console.error('Groq AI error:', error);
      throw new Error('Failed to generate description: ' + error.message);
    }
  },

  // Category to meal time mappings - used to add relevant meal time tags
  categoryMealMapping: {
    // Breakfast/Morning items
    'tiffin': ['breakfast', 'morning', 'tiffin'],
    'tiffins': ['breakfast', 'morning', 'tiffin'],
    'breakfast': ['breakfast', 'morning'],
    'morning': ['breakfast', 'morning'],
    // Lunch items
    'meals': ['lunch', 'dinner', 'meals'],
    'meal': ['lunch', 'dinner', 'meals'],
    'lunch': ['lunch', 'afternoon'],
    'thali': ['lunch', 'dinner', 'thali'],
    // Dinner items
    'dinner': ['dinner', 'night'],
    'night': ['dinner', 'night'],
    // Snacks
    'snacks': ['snacks', 'evening', 'tea time'],
    'starters': ['snacks', 'starters', 'appetizer'],
    'appetizers': ['snacks', 'starters', 'appetizer'],
    'chat': ['snacks', 'evening', 'chat'],
    'chaat': ['snacks', 'evening', 'chaat'],
    // Beverages
    'beverages': ['drinks', 'beverages'],
    'drinks': ['drinks', 'beverages'],
    'juices': ['drinks', 'juice', 'beverages'],
    // Desserts
    'desserts': ['desserts', 'sweets', 'sweet'],
    'sweets': ['desserts', 'sweets', 'sweet'],
    // Biryani/Rice
    'biryani': ['biryani', 'lunch', 'dinner', 'rice'],
    'rice': ['rice', 'lunch', 'dinner'],
    'pulao': ['rice', 'lunch', 'dinner', 'pulao'],
    // Curries
    'curries': ['curry', 'gravy', 'lunch', 'dinner'],
    'curry': ['curry', 'gravy', 'lunch', 'dinner'],
    'gravies': ['curry', 'gravy', 'lunch', 'dinner'],
    // Breads
    'breads': ['bread', 'roti', 'naan'],
    'rotis': ['bread', 'roti', 'chapati'],
    // Chinese
    'chinese': ['chinese', 'indo chinese'],
    'indo chinese': ['chinese', 'indo chinese', 'noodles'],
    // South Indian specific
    'south indian': ['south indian', 'dosa', 'idli'],
    'north indian': ['north indian', 'punjabi'],
  },

  // Get meal time tags based on category
  getMealTimeTags(categories) {
    const mealTags = [];
    const categoriesArray = Array.isArray(categories) ? categories : [categories];
    
    for (const cat of categoriesArray) {
      const catLower = cat.toLowerCase().trim();
      // Check exact match
      if (this.categoryMealMapping[catLower]) {
        mealTags.push(...this.categoryMealMapping[catLower]);
      }
      // Check partial match
      for (const [key, values] of Object.entries(this.categoryMealMapping)) {
        if (catLower.includes(key) || key.includes(catLower)) {
          mealTags.push(...values);
        }
      }
    }
    
    return [...new Set(mealTags)]; // Remove duplicates
  },

  async generateTags(itemName, category, foodType, quantity = '1', unit = 'piece') {
    try {
      const client = getGroq();
      const categories = Array.isArray(category) ? category : [category];
      
      // Food type label
      const foodTypeLabel = foodType === 'veg' ? 'veg' : foodType === 'nonveg' ? 'non veg' : foodType === 'egg' ? 'egg' : '';
      
      // Build quantity info for context (e.g., "2 pieces", "1 plate")
      const qty = parseInt(quantity) || 1;
      const unitLabel = unit || 'piece';
      
      // Get meal time tags based on category
      const mealTimeTags = this.getMealTimeTags(categories);
      const mealTimeHint = mealTimeTags.length > 0 ? `Meal times for this category: ${mealTimeTags.join(', ')}` : '';
      
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'system',
          content: `You are a tag generator for an Indian restaurant food ordering chatbot. Generate EXACTLY 10 simple, accurate search tags that customers would use to find this food item.

CRITICAL RULES:
1. Tags must be simple daily-use words that EXACTLY match the food item
2. NO abstract ingredients (don't add "rice" for "idli", don't add "flour" for "dosa", don't add "wheat" for "chapati")
3. ONLY add ingredients that are IN THE NAME (e.g., "chicken biryani" → add "chicken")
4. Include exact food item name as first tag
5. Include category name(s) as tags
6. Include food type (veg/non veg/egg) as tag
7. Include meal time (breakfast/lunch/dinner/snacks) based on category
8. Add common spelling variations people search (idli/idly, dosa/dosai)
9. Add 1-2 simple descriptive words (hot, crispy, spicy, soft)
10. Keep tags SHORT (1-2 words max per tag)
11. NO duplicate tags, all lowercase
12. NO generic words like "food", "item", "delicious", "tasty"

CATEGORY TO MEAL TIME MAPPING:
- Tiffin/Breakfast → breakfast, morning
- Meals/Thali → lunch, dinner
- Snacks/Starters → snacks, evening
- Desserts/Sweets → desserts, sweets

EXAMPLES:
- "Idli" (Tiffin, Veg, 4 pieces) → idli, tiffin, veg, breakfast, morning, south indian, soft, hot, steamed, idly
- "Chicken Biryani" (Meals, Non-Veg, 1 plate) → chicken biryani, chicken, biryani, meals, non veg, lunch, dinner, spicy, hyderabadi, dum
- "Masala Dosa" (Tiffin, Veg, 1 piece) → masala dosa, dosa, tiffin, veg, breakfast, morning, crispy, south indian, dosai, hot
- "Veg Fried Rice" (Chinese, Veg, 1 plate) → veg fried rice, fried rice, chinese, veg, lunch, dinner, rice, indo chinese, hot, noodles`
        }, {
          role: 'user',
          content: `Generate exactly 10 search tags for:
Food Item: "${itemName}"
Category: ${categories.join(', ')}
Food Type: ${foodTypeLabel}
Serving: ${qty} ${unitLabel}${qty > 1 ? 's' : ''}
${mealTimeHint}

Return ONLY 10 comma-separated lowercase tags. No explanations, no numbering, no extra text.`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 150,
        temperature: 0.3
      });
      
      const aiTagsText = completion.choices[0]?.message?.content?.trim() || '';
      
      // Clean and parse tags
      let tags = aiTagsText
        .replace(/[\[\]"\d\.\)\(]/g, '')
        .replace(/\n/g, ',')
        .split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => 
          tag.length > 0 && 
          tag.length < 25 && 
          !tag.includes(':') && 
          !tag.includes('tag') &&
          !tag.includes('example') &&
          !tag.includes('here') &&
          !tag.includes('food') &&
          tag !== 'delicious' &&
          tag !== 'tasty'
        );
      
      // Remove duplicates
      tags = [...new Set(tags)];
      
      // Ensure we have essential tags at the start
      const essentialTags = [];
      
      // Add item name as first tag
      const itemNameLower = itemName.toLowerCase().trim();
      if (!tags.includes(itemNameLower)) {
        essentialTags.push(itemNameLower);
      }
      
      // Add categories
      categories.forEach(cat => {
        const catLower = cat.toLowerCase().trim();
        if (!tags.includes(catLower) && !essentialTags.includes(catLower)) {
          essentialTags.push(catLower);
        }
      });
      
      // Add food type
      if (foodTypeLabel && !tags.includes(foodTypeLabel) && !essentialTags.includes(foodTypeLabel)) {
        essentialTags.push(foodTypeLabel);
      }
      
      // Add quantity and unit (e.g., "4 pieces", "1 plate")
      const servingTag = `${qty} ${unitLabel}${qty > 1 ? 's' : ''}`;
      if (!tags.includes(servingTag) && !essentialTags.includes(servingTag)) {
        essentialTags.push(servingTag);
      }
      
      // Add meal time tags based on category
      for (const mealTag of mealTimeTags.slice(0, 2)) { // Add up to 2 meal time tags
        if (!tags.includes(mealTag) && !essentialTags.includes(mealTag)) {
          essentialTags.push(mealTag);
        }
      }
      
      // Combine essential tags first, then AI tags
      const finalTags = [...essentialTags, ...tags.filter(t => !essentialTags.includes(t))];
      
      // Limit to exactly 10 unique tags
      return finalTags.slice(0, 10).join(', ');
    } catch (error) {
      console.error('Groq AI tags error:', error);
      // Fallback: generate basic tags without AI
      const categories = Array.isArray(category) ? category : [category];
      const foodTypeLabel = foodType === 'veg' ? 'veg' : foodType === 'nonveg' ? 'non veg' : foodType === 'egg' ? 'egg' : '';
      const qty = parseInt(quantity) || 1;
      const unitLabel = unit || 'piece';
      const mealTimeTags = this.getMealTimeTags(categories);
      
      const fallbackTags = [
        itemName.toLowerCase().trim(),
        ...categories.map(c => c.toLowerCase().trim()),
        foodTypeLabel,
        `${qty} ${unitLabel}${qty > 1 ? 's' : ''}`,
        ...mealTimeTags.slice(0, 2)
      ].filter(t => t && t.length > 0);
      
      // Remove duplicates and limit to 10
      return [...new Set(fallbackTags)].slice(0, 10).join(', ');
    }
  },

  // AI-powered tag matching for search queries
  // Helps match native language or variations to actual tags
  async matchSearchToTags(searchQuery, availableTags) {
    try {
      const client = getGroq();
      
      // Get unique tags from all items (limit to avoid token overflow)
      const uniqueTags = [...new Set(availableTags)].slice(0, 100);
      
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'system',
          content: `You are a food search assistant for an Indian restaurant chatbot. Match the customer's search query to the most relevant tags from the available tags list.

RULES:
1. Return ONLY matching tags from the available list, comma-separated
2. Match regional language words to English equivalents (e.g., "టిఫిన్" → "tiffin", "नाश्ता" → "breakfast")
3. Match spelling variations (idli/idly, dosa/dosai)
4. Match synonyms (morning food → breakfast, రోజు → dosa)
5. Return maximum 5 most relevant tags
6. If no match found, return the closest possible matches
7. ONLY return tags that exist in the available list

EXAMPLES:
- Query: "నేను breakfast కావాలి" (Telugu for "I want breakfast") → breakfast, morning, tiffin
- Query: "सुबह का खाना" (Hindi for "morning food") → breakfast, morning, tiffin
- Query: "dosa" → dosa, dosai, masala dosa
- Query: "undi" (slang for idli) → idli, idly`
        }, {
          role: 'user',
          content: `Search query: "${searchQuery}"
Available tags: ${uniqueTags.join(', ')}

Return ONLY comma-separated matching tags from the available list. No explanations.`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 100,
        temperature: 0.2
      });
      
      const matchedTagsText = completion.choices[0]?.message?.content?.trim() || '';
      
      // Clean and parse matched tags
      const matchedTags = matchedTagsText
        .replace(/[\[\]"]/g, '')
        .split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 0 && tag.length < 30 && uniqueTags.includes(tag));
      
      console.log(`🤖 AI tag match: "${searchQuery}" → [${matchedTags.join(', ')}]`);
      return matchedTags;
    } catch (error) {
      console.error('Groq AI tag matching error:', error.message);
      return [];
    }
  },

  // Smart semantic search - matches search query to menu item names using AI
  // Handles related items like "pulka" → "chapathi", "rotta" → "roti"
  async findRelatedMenuItems(searchQuery, menuItemNames) {
    try {
      const client = getGroq();
      
      // Limit items to avoid token overflow
      const itemList = menuItemNames.slice(0, 150).join(', ');
      
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'system',
          content: `You are an expert Indian food search assistant. Find menu items that match or are RELATED to the customer's search.

CRITICAL MATCHING RULES:
1. Match EXACT names if available
2. Match SIMILAR/RELATED foods (same type of dish):
   - pulka, phulka, fulka, rotta → chapati, chapathi, roti
   - parotta, paratha, barotta → chapati, roti
   - rumali roti, naan → chapati, roti
   - uppit, uppittu → upma
   - avalakki → poha
   - pesarattu, pesarat → dosa
   - undi → idli
   - vade, wada → vada
   - koora, kura → curry
   - pulusu → curry, gravy
   - pappu → dal
   - annam → rice
   - podi → powder
   - pachadi → chutney
   - perugu → curd

3. Match regional language names to English:
   - Telugu: పులక (pulka), చపాతి (chapathi), ఇడ్లీ (idli)
   - Tamil: சப்பாத்தி (chapathi), இட்லி (idli)
   - Hindi: रोटी (roti), चपाती (chapati)

4. Return ONLY item names from the available menu list
5. Maximum 10 most relevant items
6. If EXACT match exists, prioritize it

EXAMPLES:
- "pulka" when menu has "Chapathi" → Chapathi
- "rotta" when menu has "Plain Roti", "Butter Roti" → Plain Roti, Butter Roti
- "undi" when menu has "Idli", "Idli Vada" → Idli, Idli Vada
- "pesarat" when menu has "Pesarattu Dosa" → Pesarattu Dosa`
        }, {
          role: 'user',
          content: `Customer searched: "${searchQuery}"

Available menu items: ${itemList}

Return ONLY comma-separated item names from the menu that match or are related to the search. No explanations. If nothing matches, return "NONE".`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 200,
        temperature: 0.3
      });
      
      const responseText = completion.choices[0]?.message?.content?.trim() || '';
      
      // Check if no match
      if (responseText.toUpperCase() === 'NONE' || responseText.toLowerCase().includes('no match') || responseText.toLowerCase().includes('not found')) {
        console.log(`🤖 AI semantic search: "${searchQuery}" → No matches found`);
        return [];
      }
      
      // Parse matched items - be flexible with the AI response format
      const matchedItems = responseText
        .replace(/[\[\]"]/g, '')
        .split(',')
        .map(item => item.trim())
        .filter(item => {
          if (!item || item.length < 2 || item.length > 50) return false;
          // Check if this item exists in menu (case-insensitive)
          return menuItemNames.some(menuItem => 
            menuItem.toLowerCase() === item.toLowerCase() ||
            menuItem.toLowerCase().includes(item.toLowerCase()) ||
            item.toLowerCase().includes(menuItem.toLowerCase())
          );
        });
      
      console.log(`🤖 AI semantic search: "${searchQuery}" → [${matchedItems.join(', ')}]`);
      return matchedItems;
    } catch (error) {
      console.error('Groq AI semantic search error:', error.message);
      return [];
    }
  },

  // AI-powered typo correction for food search
  // Handles misspellings like "thaiyr" → "thayir", "brekfast" → "breakfast"
  async correctFoodTypo(searchQuery, availableTags = [], menuItemNames = []) {
    try {
      const client = getGroq();
      
      // Combine tags and menu item names for context
      const contextItems = [...new Set([...availableTags, ...menuItemNames])].slice(0, 100);
      
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'system',
          content: `You are an expert food search typo corrector for an Indian restaurant. Correct spelling mistakes in food search queries.

TASK: Identify if the search query has spelling mistakes and return the corrected food term.

COMMON FOOD TYPO PATTERNS:
1. Letter swaps: "thaiyr" → "thayir", "brekfast" → "breakfast"
2. Missing letters: "brakfast" → "breakfast", "coffe" → "coffee"
3. Extra letters: "breakfastt" → "breakfast", "coffeee" → "coffee"
4. Wrong vowels: "biryoni" → "biryani", "idlee" → "idli"
5. Phonetic mistakes: "dhosha" → "dosa", "chappathi" → "chapati"

REGIONAL FOOD TERMS TO RECOGNIZE:
- thayir/thair/tayir = curd (Tamil)
- perugu = curd (Telugu)
- mosaru = curd (Kannada)
- dahi = curd (Hindi)
- annam/anna = rice
- dosai = dosa
- idly = idli
- vadai = vada
- rasam/rasamu = rasam
- sambar/sambhar = sambar
- upma/uppuma/uppit = upma
- pongal/pongali = pongal
- pulihora/pulihoura = tamarind rice
- pesarattu/pesarat = pesarattu
- parotta/paratha/barotta = parotta
- chapathi/chapati/roti/phulka/pulka = chapati/roti

RULES:
1. Return ONLY the corrected word(s), nothing else
2. If no correction needed, return the original query
3. Keep the correction simple and common
4. Match to available items/tags if provided
5. Handle multi-word queries word by word`
        }, {
          role: 'user',
          content: `Search query: "${searchQuery}"
${contextItems.length > 0 ? `Available items/tags: ${contextItems.slice(0, 50).join(', ')}` : ''}

Return ONLY the corrected search term. No explanation.`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 50,
        temperature: 0.1
      });
      
      const corrected = completion.choices[0]?.message?.content?.trim()?.toLowerCase() || searchQuery;
      
      // Clean the response - remove quotes, explanations
      const cleanCorrected = corrected
        .replace(/^["']|["']$/g, '')
        .replace(/^corrected:?\s*/i, '')
        .replace(/\s*\(.*\)\s*$/, '')
        .trim();
      
      if (cleanCorrected && cleanCorrected.length > 0 && cleanCorrected.length < 50) {
        if (cleanCorrected.toLowerCase() !== searchQuery.toLowerCase()) {
          console.log(`🤖 AI typo correction: "${searchQuery}" → "${cleanCorrected}"`);
        }
        return cleanCorrected;
      }
      
      return searchQuery;
    } catch (error) {
      console.error('Groq AI typo correction error:', error.message);
      return searchQuery;
    }
  },

  // Enhanced fuzzy search using AI - finds similar items even with bad typos
  async fuzzySearchWithAI(searchQuery, menuItemNames, tags = []) {
    try {
      const client = getGroq();
      
      const itemList = menuItemNames.slice(0, 100).join(', ');
      const tagList = [...new Set(tags)].slice(0, 50).join(', ');
      
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'system',
          content: `You are an expert Indian food search assistant. The customer may have MISSPELLED their search. Find matching menu items even if the spelling is wrong.

SPELLING MISTAKE PATTERNS TO HANDLE:
- Swapped letters: "thaiyr" = "thayir" = curd
- Missing vowels: "brkfst" = "breakfast"  
- Extra letters: "breakfastt" = "breakfast"
- Phonetic spelling: "beak fasr" = "breakfast"
- Regional variations: "thayir sadam" = "curd rice"

REGIONAL FOOD KNOWLEDGE:
Tamil: thayir=curd, sadam/saadam=rice, dosai=dosa, idly=idli
Telugu: perugu=curd, annam=rice, dosa=dosa, idli=idli
Kannada: mosaru=curd, anna=rice
Hindi: dahi=curd, chawal=rice

MATCHING RULES:
1. Find items that SOUND LIKE or MEAN THE SAME as the search
2. Handle character swaps (thaiyr → thayir)
3. Handle missing/extra characters
4. Match regional food names to English equivalents
5. Return maximum 10 items, ordered by relevance
6. Return ONLY exact item names from the menu list`
        }, {
          role: 'user',
          content: `Customer searched: "${searchQuery}"

Menu items: ${itemList}
${tagList ? `Available tags: ${tagList}` : ''}

Find ALL menu items that match this search (consider spelling mistakes). Return comma-separated item names. If nothing matches, return "NONE".`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 200,
        temperature: 0.3
      });
      
      const responseText = completion.choices[0]?.message?.content?.trim() || '';
      
      if (responseText.toUpperCase() === 'NONE' || responseText.toLowerCase().includes('no match')) {
        return [];
      }
      
      const matchedItems = responseText
        .replace(/[\[\]"]/g, '')
        .split(',')
        .map(item => item.trim())
        .filter(item => {
          if (!item || item.length < 2 || item.length > 50) return false;
          return menuItemNames.some(menuItem => 
            menuItem.toLowerCase() === item.toLowerCase() ||
            menuItem.toLowerCase().includes(item.toLowerCase()) ||
            item.toLowerCase().includes(menuItem.toLowerCase())
          );
        });
      
      console.log(`🤖 AI fuzzy search: "${searchQuery}" → [${matchedItems.join(', ')}]`);
      return matchedItems;
    } catch (error) {
      console.error('Groq AI fuzzy search error:', error.message);
      return [];
    }
  },

  async processCustomerMessage(message, context, menuItems) {
    try {
      const menuList = menuItems.map(m => `${m.name} (₹${m.price}) - ${m.category}`).join('\n');
      const systemPrompt = `You are a helpful restaurant AI assistant. Help customers with:
- Viewing menu and ordering food
- Checking order status
- Cancelling orders
- Requesting refunds
- Tracking deliveries
- Answering questions about menu items

Current menu:
${menuList}

Customer context: ${JSON.stringify(context)}

Respond naturally and helpfully. If they want to order, guide them through the process.
For actions, include JSON at the end: {"action": "action_name", "data": {...}}
Actions: view_menu, add_to_cart, view_cart, checkout, check_status, cancel_order, request_refund, track_order`;

      const client = getGroq();
      const completion = await client.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        model: 'llama-3.1-8b-instant',
        max_tokens: 500
      });
      return completion.choices[0]?.message?.content || "I'm sorry, I couldn't understand that. Please try again.";
    } catch (error) {
      console.error('Groq AI chat error:', error.message);
      return "I'm having trouble processing your request. Please try again.";
    }
  }
};

module.exports = groqAi;
