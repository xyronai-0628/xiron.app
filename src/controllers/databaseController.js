import { generateContent } from '../config/openai.js';
import { getPromptByPlan, getTokenLimits } from '../services/planPrompts.js';
import { cleanAIResponse } from '../services/responseCleaner.js';
import { deductCreditsWithLog } from '../services/generationLogger.js';

/**
 * Generate Database Schema
 * Generate-First, Charge-On-Success pattern
 */
export async function generateDatabase(req, res) {
  const verifiedPlan = req.userPlan;
  const verifiedCredits = req.userCredits;
  const creditCost = req.creditCost;
  const userId = req.user.id;

  try {
    const { projectName, description, question1, question2, question3, question4, question5, question6, question7 } = req.body;

    if (!projectName || !description) {
      return res.status(400).json({
        error: 'Project name and description are required'
      });
    }

    console.log('Generating Database Schema for user:', userId, 'Plan:', verifiedPlan);

    // STEP 1: Generate AI content FIRST (no credits deducted yet)
    const systemPrompt = getPromptByPlan(verifiedPlan, 'database');
    const tokenLimits = getTokenLimits(verifiedPlan);

    let fullPrompt = `${systemPrompt}\n\nProject Name: ${projectName}\n\nDescription:\n${description}`;

    if (question1 && question2) {
      fullPrompt += `\n\nAdditional Information:\n\nQ1 - Main Entities to Track: ${question1}\n\nQ2 - Expected Users: ${question2}`;
      if (question3) fullPrompt += `\n\nQ3 - Frequent Reports/Searches: ${question3}`;
      if (question4) fullPrompt += `\n\nQ4 - Information to Store: ${question4}`;
      if (question5) fullPrompt += `\n\nQ5 - Sensitive Data Protection: ${question5}`;
      if (verifiedPlan === 'pro' && question6) fullPrompt += `\n\nQ6 - Data Retention & Archival: ${question6}`;
      if (verifiedPlan === 'pro' && question7) fullPrompt += `\n\nQ7 - Real-time Sync, Caching & Search: ${question7}`;
    }

    fullPrompt += `\n\nPlease generate a comprehensive Database Schema document based on the above information.`;

    let responseText = await generateContent(fullPrompt, tokenLimits.maxOutputTokens, tokenLimits.model);
    responseText = cleanAIResponse(responseText);

    // STEP 2: AI generation succeeded - NOW deduct credits
    const deductResult = await deductCreditsWithLog(
      userId, creditCost, 'database',
      `Database schema generation for: ${projectName}`
    );

    if (!deductResult.success) {
      console.error('⚠️ Credit deduction failed after successful generation:', deductResult.error);
    }

    console.log('✅ Database Schema generated successfully');

    res.json({
      success: true,
      schema: responseText,
      projectName: projectName,
      plan: verifiedPlan,
      creditsUsed: deductResult.success ? creditCost : 0,
      creditsRemaining: deductResult.success ? deductResult.newBalance : verifiedCredits,
      generationId: deductResult.generationId || null,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    // AI generation failed - NO credits deducted
    console.error('Error generating Database Schema:', error.message);

    let errorMessage = 'Failed to generate Database Schema';
    let statusCode = 500;

    if (error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('rate')) {
      statusCode = 402;
      errorMessage = 'API quota exceeded. Please try again later.';
    } else if (error.message?.includes('API_KEY') || error.message?.includes('api_key')) {
      errorMessage = 'Service configuration error. Please contact support.';
    }

    res.status(statusCode).json({
      error: 'Failed to generate Database Schema',
      message: errorMessage,
      creditsDeducted: false
    });
  }
}
