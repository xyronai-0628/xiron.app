import { generateContent } from '../config/openai.js';
import { getPromptByPlan, getTokenLimits } from '../services/planPrompts.js';
import { cleanAIResponse } from '../services/responseCleaner.js';
import { deductCreditsServer, refundCreditsServer, incrementDailyCount } from '../middleware/planValidation.js';

export async function generateArchitecture(req, res) {
  // Use SERVER-VERIFIED plan and credits (prevents spoofing)
  const verifiedPlan = req.userPlan;
  const verifiedCredits = req.userCredits;
  const creditCost = req.creditCost;
  const userId = req.user.id;

  try {
    const { projectName, description, question1, question2, question3, question4, question5, question6, question7 } = req.body;

    // Validate input
    if (!projectName || !description) {
      return res.status(400).json({
        error: 'Project name and description are required'
      });
    }

    console.log('Generating Architecture for user:', userId, 'Verified Plan:', verifiedPlan);

    // DEDUCT CREDITS BEFORE GENERATION
    const deductResult = await deductCreditsServer(userId, creditCost, verifiedCredits);
    if (!deductResult.success) {
      return res.status(500).json({
        error: 'Credit Processing Failed',
        message: deductResult.error
      });
    }

    try {
      // Get plan-specific prompt and token limits using VERIFIED plan
      const systemPrompt = getPromptByPlan(verifiedPlan, 'architecture');
      const tokenLimits = getTokenLimits(verifiedPlan);

      // Build the prompt with project info and question answers
      let fullPrompt = `${systemPrompt}\n\nProject Name: ${projectName}\n\nDescription:\n${description}`;

      // Add question answers if provided
      if (question1 && question2) {
        fullPrompt += `\n\nAdditional Information:\n\nQ1 - Platform: ${question1}\n\nQ2 - Technical Requirements: ${question2}`;

        if (question3) {
          fullPrompt += `\n\nQ3 - Expected Users: ${question3}`;
        }
        if (question4) {
          fullPrompt += `\n\nQ4 - Third-party Integrations: ${question4}`;
        }
        if (question5) {
          fullPrompt += `\n\nQ5 - Hosting Preference: ${question5}`;
        }

        // Pro-only questions for deeper analysis
        if (verifiedPlan === 'pro' && question6) {
          fullPrompt += `\n\nQ6 - Disaster Recovery & High Availability: ${question6}`;
        }
        if (verifiedPlan === 'pro' && question7) {
          fullPrompt += `\n\nQ7 - Security & Authentication: ${question7}`;
        }
      }

      fullPrompt += `\n\nPlease generate a comprehensive System Architecture document based on the above information.`;

      // Generate content using ChatGPT
      let responseText = await generateContent(fullPrompt, tokenLimits.maxOutputTokens, tokenLimits.model);
      responseText = cleanAIResponse(responseText);

      console.log('Architecture generated successfully for user:', userId);

      // Track daily generation count for abuse prevention
      incrementDailyCount(userId);

      res.json({
        success: true,
        architecture: responseText,
        projectName: projectName,
        plan: verifiedPlan,
        creditsUsed: creditCost,
        creditsRemaining: deductResult.newCredits,
        timestamp: new Date().toISOString()
      });

    } catch (generationError) {
      console.error('Generation failed, refunding credits for user:', userId);
      await refundCreditsServer(userId, creditCost);
      throw generationError;
    }

  } catch (error) {
    console.error('Error generating Architecture:', error.message);

    let errorMessage = 'Failed to generate System Architecture';
    let statusCode = 500;

    if (error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('rate')) {
      statusCode = 402;
      errorMessage = 'API quota exceeded. Please try again later.';
    } else if (error.message?.includes('API_KEY') || error.message?.includes('api_key')) {
      errorMessage = 'Service configuration error. Please contact support.';
    }

    res.status(statusCode).json({
      error: 'Failed to generate System Architecture',
      message: errorMessage
    });
  }
}
