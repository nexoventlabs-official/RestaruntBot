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

  async generateTags(itemName, category, foodType) {
    try {
      const client = getGroq();
      const categoryText = Array.isArray(category) ? category.join(', ') : category;
      const foodTypeText = foodType === 'veg' ? 'vegetarian (veg)' : foodType === 'nonveg' ? 'non-vegetarian (non-veg)' : foodType === 'egg' ? 'egg item' : '';
      
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'user',
          content: `Generate 6-10 simple, commonly searched tags for an Indian restaurant menu item. Tags should be words that Indian customers typically type when searching for food.

Item: "${itemName}"
Category: ${categoryText}
Type: ${foodTypeText}

Generate tags focusing on:
- Simple Hindi/English food words Indians commonly search (like "roti", "rice", "curry", "gravy", "fry", "masala", "butter", "tandoori", "biryani")
- Main ingredient (chicken, paneer, dal, aloo, gobi, egg, mutton, fish)
- Cooking style in simple words (fried, grilled, roasted, steamed, tawa, tandoor)
- Taste (spicy, mild, sweet, hot, creamy, dry)
- Meal time (breakfast, lunch, dinner, snacks, tiffin)
- Regional cuisine if applicable (south indian, north indian, punjabi, hyderabadi, chinese, indo-chinese)
- Common short forms Indians use (veg, nonveg, combo, thali, meals)
- If it's a popular/famous dish add: popular, special, bestseller, famous

Return ONLY simple comma-separated words, all lowercase, no sentences. Keep words short and commonly typed.
Example for "Butter Chicken": butter, chicken, curry, gravy, creamy, punjabi, north indian, nonveg, dinner, popular, makhani`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 150,
        temperature: 0.6
      });
      
      const tagsText = completion.choices[0]?.message?.content?.trim() || '';
      // Clean up the tags - remove any extra formatting
      const cleanedTags = tagsText
        .replace(/[\[\]"]/g, '') // Remove brackets and quotes
        .replace(/\n/g, ',') // Replace newlines with commas
        .split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 1 && tag.length < 25 && !tag.includes(':')) // Filter empty, too long, or explanation tags
        .slice(0, 12) // Limit to 12 tags max
        .join(', ');
      
      return cleanedTags;
    } catch (error) {
      console.error('Groq AI tags error:', error);
      throw new Error('Failed to generate tags: ' + error.message);
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
