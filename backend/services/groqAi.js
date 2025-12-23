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
      
      const transcription = await client.audio.transcriptions.create({
        file: file,
        model: 'whisper-large-v3',
        language: 'en', // Can be changed or auto-detected
        response_format: 'text'
      });
      
      console.log('🎤 Transcription result:', transcription);
      return transcription || '';
    } catch (error) {
      console.error('❌ Groq transcription error:', error.message);
      return null;
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
  }
};

module.exports = groqAi;
