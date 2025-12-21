import { generateContent } from '../config/openai.js';
import { getPromptByPlan, getTokenLimits } from '../services/planPrompts.js';
import { cleanPRDResponse } from '../services/responseCleaner.js';
import { deductCreditsWithLog, updateGenerationStatus } from '../services/generationLogger.js';

/**
 * Generate PRD (Product Requirements Document)
 * 
 * EXECUTION ORDER (Enterprise-Grade):
 * 1. Auth validation (done by authMiddleware)
 * 2. Fetch real plan & credits (done by validatePlanAndCredits)
 * 3. Enforce daily limit (done by enforceDailyLimit - DB RPC)
 * 4. Deduct credits atomically + create generation log (this controller)
 * 5. Generate AI content
 * 6. Update generation log with result
 * 7. NO automatic refunds - admin reviews failures
 */
export async function generatePRD(req, res) {
  const verifiedPlan = req.userPlan;
  const verifiedCredits = req.userCredits;
  const creditCost = req.creditCost;
  const userId = req.user.id;

  let generationId = null;

  try {
    const { projectName, description, question1, question2, question3, question4, question5, question6, question7 } = req.body;

    // Validate input
    if (!projectName || !description) {
      return res.status(400).json({
        error: 'Project name and description are required'
      });
    }

    console.log('Generating PRD for user:', userId, 'Plan:', verifiedPlan);

    // STEP 4: Deduct credits atomically + create generation log
    const deductResult = await deductCreditsWithLog(
      userId,
      creditCost,
      'prd',
      `PRD generation for: ${projectName}`
    );

    if (!deductResult.success) {
      return res.status(402).json({
        error: 'Credit Processing Failed',
        message: deductResult.error
      });
    }

    generationId = deductResult.generationId;

    // STEP 5: Generate AI content
    try {
      const systemPrompt = getPromptByPlan(verifiedPlan, 'prd');
      const tokenLimits = getTokenLimits(verifiedPlan);

      let fullPrompt = `${systemPrompt}\n\nProject Name: ${projectName}\n\nDescription:\n${description}`;

      if (question1 && question2) {
        fullPrompt += `\n\nAdditional Information:\n\nQ1 - Essential Features: ${question1}\n\nQ2 - Competitors/Alternatives: ${question2}`;

        if (question3) fullPrompt += `\n\nQ3 - Target Users & Problem: ${question3}`;
        if (question4) fullPrompt += `\n\nQ4 - Timeline & Budget: ${question4}`;
        if (question5) fullPrompt += `\n\nQ5 - Success Metrics: ${question5}`;
        if (verifiedPlan === 'pro' && question6) fullPrompt += `\n\nQ6 - Monetization Strategy: ${question6}`;
        if (verifiedPlan === 'pro' && question7) fullPrompt += `\n\nQ7 - Compliance & Regulatory Requirements: ${question7}`;
      }

      fullPrompt += `\n\nPlease generate a comprehensive Product Requirement Document based on the above information.`;

      let responseText = await generateContent(fullPrompt, tokenLimits.maxOutputTokens, tokenLimits.model);
      responseText = cleanPRDResponse(responseText);

      // STEP 6: Update generation log with SUCCESS
      await updateGenerationStatus(generationId, true, null);

      console.log('✅ PRD generated successfully:', generationId);

      res.json({
        success: true,
        prd: responseText,
        projectName: projectName,
        plan: verifiedPlan,
        creditsUsed: creditCost,
        creditsRemaining: deductResult.newBalance,
        generationId: generationId,
        timestamp: new Date().toISOString()
      });

    } catch (generationError) {
      // STEP 6: Update generation log with FAILURE
      // NO automatic refund - admin will review failed generations
      await updateGenerationStatus(generationId, false, generationError);

      console.error(`❌ Generation failed: ${generationId}`, generationError.message);
      throw generationError;
    }

  } catch (error) {
    console.error('Error generating PRD:', error.message);

    let errorMessage = 'Failed to generate PRD';
    let statusCode = 500;

    if (error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('rate')) {
      statusCode = 402;
      errorMessage = 'API quota exceeded. Please try again later.';
    } else if (error.message?.includes('API_KEY') || error.message?.includes('api_key')) {
      errorMessage = 'Service configuration error. Please contact support.';
    }

    res.status(statusCode).json({
      error: 'Failed to generate PRD',
      message: errorMessage,
      // Include generationId for support reference (if credits were deducted)
      ...(generationId && { generationId: generationId, supportNote: 'If you believe this was a platform error, please contact support with this generation ID.' })
    });
  }
}
