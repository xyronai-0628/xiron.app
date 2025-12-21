import { generateContent } from '../config/openai.js';
import { getPromptByPlan, getTokenLimits } from '../services/planPrompts.js';
import { cleanAIResponse } from '../services/responseCleaner.js';
import { deductCreditsWithLog, updateGenerationStatus } from '../services/generationLogger.js';

/**
 * Generate Database Schema
 * Enterprise-grade execution order with audit logging
 */
export async function generateDatabase(req, res) {
  const verifiedPlan = req.userPlan;
  const creditCost = req.creditCost;
  const userId = req.user.id;
  let generationId = null;

  try {
    const { projectName, description, question1, question2, question3, question4, question5, question6, question7 } = req.body;

    if (!projectName || !description) {
      return res.status(400).json({
        error: 'Project name and description are required'
      });
    }

    console.log('Generating Database Schema for user:', userId, 'Plan:', verifiedPlan);

    const deductResult = await deductCreditsWithLog(
      userId, creditCost, 'database',
      `Database schema generation for: ${projectName}`
    );

    if (!deductResult.success) {
      return res.status(402).json({
        error: 'Credit Processing Failed',
        message: deductResult.error
      });
    }

    generationId = deductResult.generationId;

    try {
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

      await updateGenerationStatus(generationId, true, null);
      console.log('✅ Database Schema generated:', generationId);

      res.json({
        success: true,
        schema: responseText,
        projectName: projectName,
        plan: verifiedPlan,
        creditsUsed: creditCost,
        creditsRemaining: deductResult.newBalance,
        generationId: generationId,
        timestamp: new Date().toISOString()
      });

    } catch (generationError) {
      await updateGenerationStatus(generationId, false, generationError);
      console.error(`❌ Generation failed: ${generationId}`, generationError.message);
      throw generationError;
    }

  } catch (error) {
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
      ...(generationId && { generationId, supportNote: 'Contact support with this ID if you believe this was a platform error.' })
    });
  }
}
