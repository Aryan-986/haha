const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

// Initialize SDK with environment variable
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const generateVisitAdvice = async (serviceName, currentQueue, bestTimeWindow, requiredDocuments = []) => {
  try {
    // Format documents array safely
    const docList = Array.isArray(requiredDocuments) && requiredDocuments.length > 0 
      ? requiredDocuments.join(', ') 
      : 'Standard Official identification & related forms';

    const prompt = `
You are the AI assistant for "QueueLess", a smart crowd prediction system in Nepal.

Context:
- Service: ${serviceName}
- Current Waiting Queue: ${currentQueue} people
- Recommended Low-Crowd Visit Window: ${bestTimeWindow}
- Base Documents Required: ${docList}

Task:
1. Provide a concise (2-sentence) strategic recommendation on why the user should visit during ${bestTimeWindow}.
2. Format the document list into an actionable preparation checklist.
`;

    // Use a standard supported model name like gemini-2.0-flash
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
    });

    return response.text;
  } catch (error) {
    console.error('Gemini API Error:', error);
    return `We recommend visiting between ${bestTimeWindow} to minimize your wait time. Please ensure you have all base documents ready before heading to the office.`;
  }
};

module.exports = {
  generateVisitAdvice
};