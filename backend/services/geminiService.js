const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

// Initialize the Gemini SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Generate human-friendly visit advice and checklist via Gemini API
 */
const generateVisitAdvice = async (serviceName, currentQueue, bestTimeWindow, requiredDocuments) => {
  try {
    const prompt = `
You are the AI assistant for "QueueLess", a smart crowd prediction system in Nepal.

Context:
- Service: ${serviceName}
- Current Waiting Queue: ${currentQueue} people
- Recommended Low-Crowd Visit Window: ${bestTimeWindow}
- Base Documents Required: ${requiredDocuments.join(', ')}

Task:
1. Provide a concise (2-sentence) strategic recommendation on why the user should visit during ${bestTimeWindow}.
2. Format the document list into an actionable, step-by-step preparation checklist.

Keep your response structured, practical, and helpful.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text;
  } catch (error) {
    console.error('Gemini API Error:', error);
    // Fallback response if API key is missing or quota is exceeded
    return `We recommend visiting between ${bestTimeWindow} to minimize your wait time. Please ensure you have all base documents ready before heading to the office.`;
  }
};

module.exports = {
  generateVisitAdvice
};