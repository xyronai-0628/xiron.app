import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Require API key from environment - never hardcode
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY environment variable is required');
    console.error('   Please set it in your .env file or environment');
    throw new Error('OPENAI_API_KEY is required');
}

console.log('✅ OpenAI API key loaded from environment variable');

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY
});

/**
 * Generate content using ChatGPT API
 * @param {string} prompt - The prompt to send to the model
 * @param {number} maxTokens - Maximum tokens for the response
 * @param {string} model - Model to use (default: gpt-4o-mini)
 * @returns {Promise<string>} - The generated text
 */
export async function generateContent(prompt, maxTokens = 4000, model = 'gpt-4o-mini') {
    const response = await openai.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens
    });

    return response.choices[0]?.message?.content || 'No response generated';
}

export default openai;
