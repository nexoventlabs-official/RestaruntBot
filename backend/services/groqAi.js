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
  async transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
    try {
      const client = getGroq();
      
      // Create a File-like object from buffer
      const file = new File([audioBuffer], 'audio.ogg', { type: mimeType });
      
      // Don't specify language - let Whisper auto-detect
      // This supports Hindi, Tamil, English, and many other languages
      const transcription = await client.audio.transcriptions.create({
        file: file,
        model: 'whisper-large-v3',
        response_format: 'text'
      });
      
      console.log('🎤 Transcription result:', transcription);
      return transcription || '';
    } catch (error) {
      console.error('❌ Groq transcription error:', error.message);
      return null;
    }
  },

  // Translate local language text to English for search
  // Returns multiple possible translations for better search matching
  async translateToEnglish(text) {
    try {
      // Check if text contains non-English characters (Indian languages)
      const hasNonEnglish = /[^\x00-\x7F]/.test(text);
      if (!hasNonEnglish) {
        return { primary: text, variations: [text] };
      }

      const client = getGroq();
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'system',
          content: `You are an expert Indian food translator. Translate food names from ANY Indian language to English.

IMPORTANT: Return multiple possible translations/variations separated by commas.

RULES:
1. Give the most common English name first
2. Include romanized regional name
3. Include alternative spellings
4. Include related terms that might be on a menu
5. Return ONLY translations separated by commas, no explanations

EXAMPLES:
- చిత్రాన్నం → lemon rice, chitranna, chitrannam, nimbu rice
- పులిహోర → tamarind rice, pulihora, pulihoura, puliyogare
- கொங்கூரா சிக்கன் → gongura chicken, sorrel chicken, gongura kozhi
- బిర్యానీ → biryani, biriyani, briyani
- தயிர் சாதம் → curd rice, thayir sadam, dahi chawal, mosaru anna
- పెసరట్టు → pesarattu, pesaratu, moong dal dosa, green gram dosa
- சாம்பார் → sambar, sambhar, sambaar
- ரசம் → rasam, rasamu, pepper water
- இட்லி → idli, idly, idle
- దోశ → dosa, dosai, dhosha
- ఉప్మా → upma, uppuma, uppit, rava upma
- పొంగల్ → pongal, ven pongal, khara pongal
- వడ → vada, vadai, vade, medu vada
- గొంగూర → gongura, gongura, sorrel leaves, pulicha keerai
- మసాలా దోశ → masala dosa, masale dose, stuffed dosa
- పనీర్ బట్టర్ మసాలా → paneer butter masala, paneer makhani, butter paneer
- చికెన్ 65 → chicken 65, chicken sixtyfive
- మటన్ బిర్యానీ → mutton biryani, goat biryani, lamb biryani`
        }, {
          role: 'user',
          content: `Translate with variations: "${text}"`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 150,
        temperature: 0.2
      });
      
      let response = completion.choices[0]?.message?.content?.trim() || text;
      
      // Clean up the response
      response = response.replace(/^["']|["']$/g, '').trim();
      response = response.replace(/^(translation|english|answer|result|variations?)[\s:=→]+/i, '').trim();
      
      // Parse variations (comma or slash separated)
      let variations = response.split(/[,\/]/).map(v => v.trim().toLowerCase()).filter(v => v.length > 0);
      
      // Remove any non-English variations
      variations = variations.filter(v => !/[^\x00-\x7F]/.test(v));
      
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
  },

  // Extract transaction ID from text or image using Groq Vision
  async extractTransactionId(text) {
    try {
      const client = getGroq();
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'system',
          content: `You are a transaction ID extractor. Extract ONLY the transaction ID/UTR number from the text.

RULES:
1. Transaction IDs are typically 12-16 digit numbers
2. UTR numbers are 12 digits
3. Return ONLY the transaction ID, nothing else
4. If multiple IDs found, return the first one
5. If no ID found, return "NOT_FOUND"

EXAMPLES:
- "Transaction ID: 123456789012" → "123456789012"
- "UTR: 987654321098" → "987654321098"
- "Paid ₹500, txn id 445566778899" → "445566778899"
- "Payment successful" → "NOT_FOUND"`
        }, {
          role: 'user',
          content: `Extract transaction ID from: "${text}"`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 50,
        temperature: 0.1
      });
      
      let txnId = completion.choices[0]?.message?.content?.trim() || 'NOT_FOUND';
      
      // Clean up the response
      txnId = txnId.replace(/[^0-9]/g, '');
      
      // Validate length (12-16 digits)
      if (txnId.length >= 12 && txnId.length <= 16) {
        console.log(`✅ Extracted transaction ID: ${txnId}`);
        return txnId;
      }
      
      console.log(`❌ No valid transaction ID found in: "${text}"`);
      return null;
    } catch (error) {
      console.error('Groq transaction ID extraction error:', error.message);
      return null;
    }
  },

  // Verify transaction details match order
  async verifyTransactionDetails(text, expectedAmount, orderId) {
    try {
      const client = getGroq();
      const completion = await client.chat.completions.create({
        messages: [{
          role: 'system',
          content: `You are a payment verification assistant. Verify if the transaction details match the expected payment.

RULES:
1. Check if amount matches (allow ±₹5 difference for rounding)
2. Extract transaction ID if present
3. Return JSON: {"verified": true/false, "transactionId": "id or null", "amount": extracted_amount, "reason": "explanation"}

EXAMPLES:
Input: "Paid ₹500 to 8106811285@ybl, txn 123456789012"
Expected: ₹500
Output: {"verified": true, "transactionId": "123456789012", "amount": 500, "reason": "Amount matches"}

Input: "Payment of ₹450"
Expected: ₹500
Output: {"verified": false, "transactionId": null, "amount": 450, "reason": "Amount mismatch: expected ₹500, got ₹450"}`
        }, {
          role: 'user',
          content": `Verify payment:\nText: "${text}"\nExpected Amount: ₹${expectedAmount}\nOrder ID: ${orderId}`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 200,
        temperature: 0.1
      });
      
      let response = completion.choices[0]?.message?.content?.trim() || '{}';
      
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        console.log(`🔍 Transaction verification result:`, result);
        return result;
      }
      
      return { verified: false, transactionId: null, amount: null, reason: 'Failed to parse verification result' };
    } catch (error) {
      console.error('Groq transaction verification error:', error.message);
      return { verified: false, transactionId: null, amount: null, reason: error.message };
    }
  }
};

module.exports = groqAi;
