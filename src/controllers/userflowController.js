import { generateContent } from '../config/openai.js';
import { getPromptByPlan, getTokenLimits } from '../services/planPrompts.js';
import { cleanAIResponse } from '../services/responseCleaner.js';
import { deductCreditsWithLog, updateGenerationStatus } from '../services/generationLogger.js';

/**
 * Generate User Flow Document
 * Enterprise-grade execution order with audit logging
 */
export async function generateUserflow(req, res) {
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

    console.log('Generating User Flow for user:', userId, 'Plan:', verifiedPlan);

    const deductResult = await deductCreditsWithLog(
      userId, creditCost, 'userflow',
      `User flow generation for: ${projectName}`
    );

    if (!deductResult.success) {
      return res.status(402).json({
        error: 'Credit Processing Failed',
        message: deductResult.error
      });
    }

    generationId = deductResult.generationId;

    try {
      const systemPrompt = getPromptByPlan(verifiedPlan, 'userflow');
      const tokenLimits = getTokenLimits(verifiedPlan);

      let fullPrompt = `${systemPrompt}\n\nProject Name: ${projectName}\n\nDescription:\n${description}`;

      if (question1 && question2) {
        fullPrompt += `\n\nAdditional Information:\n\nQ1 - Main User Tasks: ${question1}\n\nQ2 - User Journey Stages: ${question2}`;
        if (question3) fullPrompt += `\n\nQ3 - Information at Each Step: ${question3}`;
        if (question4) fullPrompt += `\n\nQ4 - New User Journey: ${question4}`;
        if (question5) fullPrompt += `\n\nQ5 - Returning User Journey: ${question5}`;
        if (verifiedPlan === 'pro' && question6) fullPrompt += `\n\nQ6 - Error Handling & Recovery Flows: ${question6}`;
        if (verifiedPlan === 'pro' && question7) fullPrompt += `\n\nQ7 - Accessibility & Mobile Considerations: ${question7}`;
      }

      fullPrompt += `\n\nPlease generate a comprehensive User Flow document based on the above information.`;

      let responseText = await generateContent(fullPrompt, tokenLimits.maxOutputTokens, tokenLimits.model);
      responseText = cleanAIResponse(responseText);

      await updateGenerationStatus(generationId, true, null);
      console.log('✅ User Flow generated:', generationId);

      res.json({
        success: true,
        userflow: responseText,
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
    console.error('Error generating User Flow:', error.message);

    let errorMessage = 'Failed to generate User Flow';
    let statusCode = 500;

    if (error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('rate')) {
      statusCode = 402;
      errorMessage = 'API quota exceeded. Please try again later.';
    } else if (error.message?.includes('API_KEY') || error.message?.includes('api_key')) {
      errorMessage = 'Service configuration error. Please contact support.';
    }

    res.status(statusCode).json({
      error: 'Failed to generate User Flow',
      message: errorMessage,
      ...(generationId && { generationId, supportNote: 'Contact support with this ID if you believe this was a platform error.' })
    });
  }
}
