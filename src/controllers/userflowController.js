import { generateContent } from '../config/openai.js';
import { getPromptByPlan, getTokenLimits } from '../services/planPrompts.js';
import { cleanAIResponse } from '../services/responseCleaner.js';
import { deductCreditsWithLog } from '../services/generationLogger.js';

/**
 * Generate User Flow Document
 * Generate-First, Charge-On-Success pattern
 */
export async function generateUserflow(req, res) {
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

    console.log('Generating User Flow for user:', userId, 'Plan:', verifiedPlan);

    // STEP 1: Generate AI content FIRST (no credits deducted yet)
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

    // STEP 2: AI generation succeeded - NOW deduct credits
    const deductResult = await deductCreditsWithLog(
      userId, creditCost, 'userflow',
      `User flow generation for: ${projectName}`
    );

    if (!deductResult.success) {
      console.error('⚠️ Credit deduction failed after successful generation:', deductResult.error);
    }

    console.log('✅ User Flow generated successfully');

    res.json({
      success: true,
      userflow: responseText,
      projectName: projectName,
      plan: verifiedPlan,
      creditsUsed: deductResult.success ? creditCost : 0,
      creditsRemaining: deductResult.success ? deductResult.newBalance : verifiedCredits,
      generationId: deductResult.generationId || null,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    // AI generation failed - NO credits deducted
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
      creditsDeducted: false
    });
  }
}
