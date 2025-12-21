/**
 * Input sanitization utilities to prevent prompt injection and XSS
 */

// Characters and patterns that could be used for prompt injection
const DANGEROUS_PATTERNS = [
    /\bignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi,
    /\bdisregard\s+(all\s+)?(previous|above|prior)/gi,
    /\byou\s+are\s+now\s+(a|an)\b/gi,
    /\bact\s+as\s+(a|an|if)\b/gi,
    /\bforget\s+(everything|all|your)\b/gi,
    /\bnew\s+instructions?\s*:/gi,
    /\bsystem\s*:\s*/gi,
    /\bassistant\s*:\s*/gi,
    /\buser\s*:\s*/gi,
    /```[\s\S]*?```/g,  // Code blocks that might contain injection
    /<script[\s\S]*?<\/script>/gi,  // Script tags
    /<[^>]+on\w+\s*=/gi,  // Event handlers
];

// Max lengths for different input types
const MAX_LENGTHS = {
    projectName: 200,
    description: 10000,
    question: 5000
};

/**
 * Sanitize a string by removing dangerous patterns
 */
export function sanitizeInput(input, fieldName = 'input') {
    if (!input || typeof input !== 'string') {
        return '';
    }

    let sanitized = input;

    // Unicode normalization to prevent homoglyph attacks
    // NFKC normalizes characters like ℀ to a/c and ﬁ to fi
    sanitized = sanitized.normalize('NFKC');

    // Remove zero-width characters (used for invisible prompt injection)
    // U+200B Zero Width Space, U+200C Zero Width Non-Joiner, 
    // U+200D Zero Width Joiner, U+FEFF Byte Order Mark
    sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');

    // Remove right-to-left override characters (used to hide malicious text)
    // U+202A-U+202E are directional formatting characters
    sanitized = sanitized.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');

    // Check and enforce max length
    const maxLength = MAX_LENGTHS[fieldName] || MAX_LENGTHS.description;
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }

    // Remove dangerous patterns
    DANGEROUS_PATTERNS.forEach(pattern => {
        sanitized = sanitized.replace(pattern, '[REMOVED]');
    });

    // Remove null bytes and other control characters (except newlines and tabs)
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Trim whitespace
    sanitized = sanitized.trim();

    return sanitized;
}

/**
 * Sanitize all fields in request body
 */
export function sanitizeRequestBody(body) {
    const sanitized = {};

    if (body.projectName) {
        sanitized.projectName = sanitizeInput(body.projectName, 'projectName');
    }

    if (body.description) {
        sanitized.description = sanitizeInput(body.description, 'description');
    }

    if (body.question1) {
        sanitized.question1 = sanitizeInput(body.question1, 'question');
    }

    if (body.question2) {
        sanitized.question2 = sanitizeInput(body.question2, 'question');
    }

    if (body.question3) {
        sanitized.question3 = sanitizeInput(body.question3, 'question');
    }

    if (body.question4) {
        sanitized.question4 = sanitizeInput(body.question4, 'question');
    }

    if (body.question5) {
        sanitized.question5 = sanitizeInput(body.question5, 'question');
    }

    if (body.question6) {
        sanitized.question6 = sanitizeInput(body.question6, 'question');
    }

    if (body.question7) {
        sanitized.question7 = sanitizeInput(body.question7, 'question');
    }

    // Copy non-string fields as-is
    if (typeof body.aiPowered === 'boolean') {
        sanitized.aiPowered = body.aiPowered;
    }

    // Copy plan field (validate against allowed plans)
    const allowedPlans = ['free', 'starter', 'pro'];
    if (body.plan && allowedPlans.includes(body.plan)) {
        sanitized.plan = body.plan;
    }

    return sanitized;
}

/**
 * Validation middleware
 */
export function validateAndSanitize(req, res, next) {
    try {
        // Sanitize the request body
        req.body = sanitizeRequestBody(req.body);

        // Validate required fields
        if (!req.body.projectName || !req.body.description) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Project name and description are required'
            });
        }

        // Check minimum lengths
        if (req.body.projectName.length < 2) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Project name must be at least 2 characters'
            });
        }

        if (req.body.description.length < 10) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Description must be at least 10 characters'
            });
        }

        next();
    } catch (error) {
        console.error('Validation error:', error);
        return res.status(400).json({
            error: 'Validation Error',
            message: 'Invalid request data'
        });
    }
}
