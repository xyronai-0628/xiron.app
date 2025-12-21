import { generateContent } from '../config/openai.js';
import { getBundlePrompt, getBundleConfig } from '../services/bundlePrompts.js';
import { cleanPRDResponse, cleanAIResponse } from '../services/responseCleaner.js';
import { deductCreditsServer, refundCreditsServer, incrementDailyCount } from '../middleware/planValidation.js';

export async function generateBundle(req, res) {
    // Use SERVER-VERIFIED plan and credits (from requireBundleAccess middleware)
    // Plan restriction is handled by middleware, not here
    const verifiedPlan = req.userPlan;
    const verifiedCredits = req.userCredits;
    const creditCost = req.creditCost;
    const userId = req.user.id;

    try {
        const { projectName, description, question1, question2, question3, question4, question5, question6, question7, question8, question9, question10 } = req.body;

        // NOTE: Plan restriction is now handled by requireBundleAccess middleware
        // No need to check plan === 'free' here - it's already verified server-side

        // Validate input - need project name and description
        if (!projectName || !description) {
            return res.status(400).json({
                error: 'Project name and description are required'
            });
        }

        console.log('Generating Developer Bundle for user:', userId, 'Verified Plan:', verifiedPlan);

        // DEDUCT CREDITS BEFORE GENERATION
        const deductResult = await deductCreditsServer(userId, creditCost, verifiedCredits);
        if (!deductResult.success) {
            return res.status(500).json({
                error: 'Credit Processing Failed',
                message: deductResult.error
            });
        }

        try {
            // Get bundle-specific config for VERIFIED plan
            const bundleConfig = getBundleConfig(verifiedPlan);

            // Build comprehensive prompt with description and all questions
            let baseContent = `Project Name: ${projectName}\n\n`;

            if (description) {
                baseContent += `=== PROJECT OVERVIEW ===\n${description}\n\n`;
            }

            baseContent += `=== DETAILED REQUIREMENTS ===\n`;
            if (question1) baseContent += `\n1. PROBLEM & TARGET USERS:\n${question1}\n`;
            if (question2) baseContent += `\n2. USER JOURNEY (START TO FINISH):\n${question2}\n`;
            if (question3) baseContent += `\n3. DATA TO COLLECT, STORE & DISPLAY:\n${question3}\n`;
            if (question4) baseContent += `\n4. SCALE & PLATFORMS:\n${question4}\n`;
            if (question5) baseContent += `\n5. MVP FEATURES VS FUTURE FEATURES:\n${question5}\n`;
            if (question6) baseContent += `\n6. THIRD-PARTY INTEGRATIONS:\n${question6}\n`;
            if (question7) baseContent += `\n7. SUCCESS METRICS:\n${question7}\n`;

            // Pro-only extra questions for deeper analysis
            if (verifiedPlan === 'pro') {
                if (question8) baseContent += `\n8. NON-NEGOTIABLE OUTCOMES:\n${question8}\n`;
                if (question9) baseContent += `\n9. REAL-WORLD SCALE (12-18 MONTHS):\n${question9}\n`;
                if (question10) baseContent += `\n10. DETAILED USER SCENARIO:\n${question10}\n`;
            }

            // Generate all 4 document types in parallel for speed
            const documentTypes = [
                { type: 'prd', name: 'Product Requirements Document' },
                { type: 'architecture', name: 'System Architecture' },
                { type: 'database', name: 'Database Schema' },
                { type: 'userflow', name: 'User Flow' }
            ];

            console.log('Generating all 4 documents in parallel...');

            const generatePromises = documentTypes.map(async (doc) => {
                // Use bundle-specific prompts with VERIFIED plan
                const systemPrompt = getBundlePrompt(verifiedPlan, doc.type);
                const fullPrompt = `${systemPrompt}\n\n${baseContent}\n\nGenerate a comprehensive ${doc.name} document.`;

                let responseText = await generateContent(fullPrompt, bundleConfig.maxOutputTokens, bundleConfig.model);
                responseText = doc.type === 'prd' ? cleanPRDResponse(responseText) : cleanAIResponse(responseText);

                return { type: doc.type, content: responseText };
            });

            // Wait for all documents to be generated
            const generatedDocs = await Promise.all(generatePromises);

            // Convert array to object
            const bundle = {};
            generatedDocs.forEach(doc => {
                bundle[doc.type] = doc.content;
            });

            console.log('Developer Bundle generated successfully for user:', userId);

            // Track daily generation count for abuse prevention
            // Bundle counts as 4 generations since it produces 4 documents
            incrementDailyCount(userId);
            incrementDailyCount(userId);
            incrementDailyCount(userId);
            incrementDailyCount(userId);

            // Return all generated documents with verified plan
            res.json({
                success: true,
                bundle: bundle,
                projectName: projectName,
                plan: verifiedPlan,
                creditsUsed: creditCost,
                creditsRemaining: deductResult.newCredits,
                timestamp: new Date().toISOString()
            });

        } catch (generationError) {
            // REFUND credits if generation fails
            console.error('Bundle generation failed, refunding credits for user:', userId);
            await refundCreditsServer(userId, creditCost);
            throw generationError;
        }

    } catch (error) {
        console.error('Error generating bundle:', error.message);

        let errorMessage = 'Failed to generate Developer Bundle';
        let statusCode = 500;

        if (error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('rate')) {
            statusCode = 402;
            errorMessage = 'API quota exceeded. Please try again later.';
        } else if (error.message?.includes('API_KEY') || error.message?.includes('api_key')) {
            errorMessage = 'Service configuration error. Please contact support.';
        }

        // Never expose internal error details to clients
        res.status(statusCode).json({
            error: 'Failed to generate Developer Bundle',
            message: errorMessage
        });
    }
}
