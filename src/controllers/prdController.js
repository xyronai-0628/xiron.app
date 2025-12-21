import { generateContent } from '../config/openai.js';
import { getPromptByPlan, getTokenLimits } from '../services/planPrompts.js';
import { cleanPRDResponse } from '../services/responseCleaner.js';
import { deductCreditsServer, refundCreditsServer, incrementDailyCount } from '../middleware/planValidation.js';

export async function generatePRD(req, res) {
  // Use SERVER-VERIFIED plan and credits (from validatePlanAndCredits middleware)
  // This prevents plan spoofing - we NEVER trust req.body.plan
  const verifiedPlan = req.userPlan;
  const verifiedCredits = req.userCredits;
  const creditCost = req.creditCost;
  const userId = req.user.id;

  try {
    const { projectName, description, aiPowered, question1, question2, question3, question4, question5, question6, question7 } = req.body;

    // Validate input
    if (!projectName || !description) {
      return res.status(400).json({
        error: 'Project name and description are required'
      });
    }

    console.log('Generating PRD for user:', userId, 'Verified Plan:', verifiedPlan);

    // DEDUCT CREDITS BEFORE GENERATION (prevents abuse)
    const deductResult = await deductCreditsServer(userId, creditCost, verifiedCredits);
    if (!deductResult.success) {
      return res.status(500).json({
        error: 'Credit Processing Failed',
        message: deductResult.error
      });
    }

    try {
      // Get plan-specific prompt and token limits using VERIFIED plan
      const systemPrompt = getPromptByPlan(verifiedPlan, 'prd');
      const tokenLimits = getTokenLimits(verifiedPlan);

      // Build the prompt with project info and question answers
      let fullPrompt = `${systemPrompt}\n\nProject Name: ${projectName}\n\nDescription:\n${description}`;

      // Add question answers if provided
      if (question1 && question2) {
        fullPrompt += `\n\nAdditional Information:\n\nQ1 - Essential Features: ${question1}\n\nQ2 - Competitors/Alternatives: ${question2}`;

        // Add extra questions for Starter/Pro plans
        if (question3) {
          fullPrompt += `\n\nQ3 - Target Users & Problem: ${question3}`;
        }
        if (question4) {
          fullPrompt += `\n\nQ4 - Timeline & Budget: ${question4}`;
        }
        if (question5) {
          fullPrompt += `\n\nQ5 - Success Metrics: ${question5}`;
        }

        // Pro-only questions for deeper analysis
        if (verifiedPlan === 'pro' && question6) {
          fullPrompt += `\n\nQ6 - Monetization Strategy: ${question6}`;
        }
        if (verifiedPlan === 'pro' && question7) {
          fullPrompt += `\n\nQ7 - Compliance & Regulatory Requirements: ${question7}`;
        }
      }

      fullPrompt += `\n\nPlease generate a comprehensive Product Requirement Document based on the above information.`;

      // Generate content using ChatGPT
      let responseText = await generateContent(fullPrompt, tokenLimits.maxOutputTokens, tokenLimits.model);

      // Clean up the response - remove reasoning tags and unwanted content
      responseText = cleanPRDResponse(responseText);

      console.log('PRD generated successfully for user:', userId);

      // Track daily generation count for abuse prevention
      incrementDailyCount(userId);

      // Return the generated PRD with verified (not client-provided) plan
      res.json({
        success: true,
        prd: responseText,
        projectName: projectName,
        plan: verifiedPlan,
        creditsUsed: creditCost,
        creditsRemaining: deductResult.newCredits,
        timestamp: new Date().toISOString()
      });

    } catch (generationError) {
      // REFUND credits if generation fails
      console.error('Generation failed, refunding credits for user:', userId);
      await refundCreditsServer(userId, creditCost);
      throw generationError;
    }

  } catch (error) {
    console.error('Error generating PRD:', error.message);

    let errorMessage = 'Failed to generate PRD';
    let statusCode = 500;

    // Check for specific error types - only expose safe messages
    if (error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('rate')) {
      statusCode = 402; // Payment Required
      errorMessage = 'API quota exceeded. Please try again later.';
    } else if (error.message?.includes('API_KEY') || error.message?.includes('api_key')) {
      errorMessage = 'Service configuration error. Please contact support.';
    }

    // Never expose internal error details to clients
    res.status(statusCode).json({
      error: 'Failed to generate PRD',
      message: errorMessage
    });
  }
}
