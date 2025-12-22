// Utility functions to clean AI responses

/**
 * Remove AI reasoning tags safely.
 * Only removes complete tag pairs or explicit unclosed tags at the end.
 * @param {string} text
 * @returns {string}
 */
function removeReasoningTags(text) {
  if (!text) return text;

  // Remove complete reasoning tag pairs (non-greedy)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  text = text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '');
  text = text.replace(/<redacted_reasoning>[\s\S]*?<\/redacted_reasoning>/gi, '');

  // Handle mixed/malformed closing tags
  text = text.replace(/<think>[\s\S]*?<\/redacted_reasoning>/gi, '');

  // Remove trailing unclosed reasoning tags (only at end of text)
  text = text.replace(/<think>[\s\S]*$/gi, function (match) {
    // Only remove if it looks like an unclosed reasoning block at the end
    if (match.length < 5000) return '';
    return match; // Preserve if suspiciously long (likely contains content)
  });
  text = text.replace(/<reasoning>[\s\S]*$/gi, function (match) {
    if (match.length < 5000) return '';
    return match;
  });
  text = text.replace(/<analysis>[\s\S]*$/gi, function (match) {
    if (match.length < 5000) return '';
    return match;
  });

  return text;
}

/**
 * Normalize whitespace without destroying content.
 * @param {string} text
 * @returns {string}
 */
function normalizeWhitespace(text) {
  if (!text) return text;
  // Reduce 3+ consecutive newlines to 2
  text = text.replace(/\n{3,}/g, '\n\n');
  // Trim leading/trailing whitespace
  return text.trim();
}

/**
 * Clean AI response for general use.
 * Safe, minimal cleaning that preserves valid markdown.
 * @param {string} text
 * @returns {string}
 */
export function cleanAIResponse(text) {
  if (!text) return text;

  // Step 1: Remove reasoning tags
  text = removeReasoningTags(text);

  // Step 2: Remove preamble meta-commentary (only at the start)
  // These patterns only match at the beginning of the response
  const preamblePatterns = [
    /^Let me analyze[^.]*\.\s*/i,
    /^I'm asked to[^.]*\.\s*/i,
    /^I'll create[^.]*\.\s*/i,
    /^Here's the[^.]*:\s*/i,
  ];

  for (const pattern of preamblePatterns) {
    text = text.replace(pattern, '');
  }

  // Step 3: Normalize whitespace
  text = normalizeWhitespace(text);

  return text;
}

/**
 * Clean PRD response with PRD-specific handling.
 * @param {string} text
 * @returns {string}
 */
export function cleanPRDResponse(text) {
  if (!text) return text;

  // Step 1: Remove reasoning tags
  text = removeReasoningTags(text);

  // Step 2: Find the start of actual PRD content
  // Look for common PRD section headers
  const prdStartPatterns = [
    /^#\s+Product Requirement/im,
    /^#\s+PRD/im,
    /^##?\s*Executive Summary/im,
    /^\*\*Executive Summary\*\*/im,
    /^#\s+[A-Z]/m, // Any H1 starting with capital letter
  ];

  for (const pattern of prdStartPatterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined && match.index < 500) {
      // Only trim if PRD content starts within first 500 chars
      text = text.substring(match.index);
      break;
    }
  }

  // Step 3: Remove preamble meta-commentary before actual content
  const preamblePatterns = [
    /^Let me analyze[^#]*(?=#)/is,
    /^I'm asked to[^#]*(?=#)/is,
    /^I'll create[^#]*(?=#)/is,
    /^Based on the information[^#]*(?=#)/is,
  ];

  for (const pattern of preamblePatterns) {
    text = text.replace(pattern, '');
  }

  // Step 4: Normalize whitespace
  text = normalizeWhitespace(text);

  // Step 5: Validate minimum content
  if (text.length < 50) {
    return 'The AI response was too brief. Please try again with more detailed project information, including:\n- A clear project description (at least 2-3 sentences)\n- Specific features or goals\n- Target users or audience\n\nOriginal response: ' + text;
  }

  return text;
}
