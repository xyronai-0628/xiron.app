// Utility functions to clean AI responses

export function cleanAIResponse(text) {
  if (!text) return text;

  // Remove reasoning tags and their content (handles various formats)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  text = text.replace(/<think>[\s\S]*?<\/redacted_reasoning>/gi, '');
  text = text.replace(/<think>[\s\S]*/gi, '');
  text = text.replace(/<reasoning>[\s\S]*/gi, '');

  // Remove common reasoning/meta-commentary patterns
  const reasoningPatterns = [
    /Let me analyze[\s\S]*?(?=\n\n|##|#|$)/gi,
    /I'm asked to[\s\S]*?(?=\n\n|##|#|$)/gi,
    /However[\s\S]*?(?=\n\n|##|#|$)/gi,
    /This is essentially[\s\S]*?(?=\n\n|##|#|$)/gi,
  ];

  reasoningPatterns.forEach(pattern => {
    text = text.replace(pattern, '');
  });

  // Clean up multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  // Remove leading/trailing whitespace
  text = text.trim();

  return text;
}

export function cleanPRDResponse(text) {
  if (!text) return text;

  // Remove reasoning tags and their content (handles various formats)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  text = text.replace(/<think>[\s\S]*?<\/redacted_reasoning>/gi, '');
  text = text.replace(/<think>[\s\S]*/gi, '');
  text = text.replace(/<reasoning>[\s\S]*/gi, '');
  text = text.replace(/<think>[\s\S]*/gi, '');

  // Remove common reasoning/meta-commentary patterns
  const reasoningPatterns = [
    /Let me analyze[\s\S]*?(?=\n\n|##|#|$)/gi,
    /I'm asked to[\s\S]*?(?=\n\n|##|#|$)/gi,
    /However, the project[\s\S]*?(?=\n\n|##|#|$)/gi,
    /This is essentially[\s\S]*?(?=\n\n|##|#|$)/gi,
    /The project details[\s\S]*?(?=\n\n|##|#|$)/gi,
    /meaningful information[\s\S]*?(?=\n\n|##|#|$)/gi,
    /nonsensical placeholders[\s\S]*?(?=\n\n|##|#|$)/gi,
    /doesn't tell me anything[\s\S]*?(?=\n\n|##|#|$)/gi,
    /It appears[\s\S]*?(?=\n\n|##|#|$)/gi,
    /There might be[\s\S]*?(?=\n\n|##|#|$)/gi,
    /misunderstanding[\s\S]*?(?=\n\n|##|#|$)/gi,
    /paste error[\s\S]*?(?=\n\n|##|#|$)/gi,
    /Based on the[\s\S]*?(?=\n\n|##|#|$)/gi,
    /I notice that[\s\S]*?(?=\n\n|##|#|$)/gi,
    /The description you[\s\S]*?(?=\n\n|##|#|$)/gi,
  ];

  reasoningPatterns.forEach(pattern => {
    text = text.replace(pattern, '');
  });

  // Remove lines that are clearly reasoning/meta-commentary
  const lines = text.split('\n');
  const cleanedLines = [];
  let skipUntilPRD = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase().trim();

    // Check if this line starts actual PRD content
    if (skipUntilPRD) {
      if (lowerLine.startsWith('#') ||
        lowerLine.startsWith('##') ||
        lowerLine.startsWith('**executive summary**') ||
        lowerLine.startsWith('executive summary') ||
        lowerLine.match(/^\d+\.\s+\*\*/) ||
        (lowerLine.length > 20 && !lowerLine.includes('let me') && !lowerLine.includes("i'm asked"))) {
        skipUntilPRD = false;
      }
    }

    // Skip reasoning lines
    if (skipUntilPRD ||
      lowerLine.includes('let me analyze') ||
      lowerLine.includes("i'm asked to") ||
      lowerLine.includes('however, the project') ||
      lowerLine.includes('this is essentially') ||
      lowerLine.includes('project details provided') ||
      lowerLine.includes('meaningful information') ||
      lowerLine.includes('nonsensical placeholders') ||
      lowerLine.includes("doesn't tell me") ||
      lowerLine.includes('it appears') ||
      lowerLine.includes('there might be') ||
      lowerLine.includes('misunderstanding') ||
      lowerLine.includes('paste error') ||
      lowerLine.includes('based on the') ||
      lowerLine.includes('i notice that') ||
      lowerLine.includes('the description you') ||
      lowerLine.includes('cloud video')) {
      continue;
    }

    cleanedLines.push(line);
  }

  text = cleanedLines.join('\n');

  // Find the start of actual PRD content
  const prdStartPatterns = [
    /^#\s+Product Requirement Document/im,
    /^##\s+Executive Summary/im,
    /^#\s+Executive Summary/im,
    /^\*\*Executive Summary\*\*/im,
    /^Executive Summary/im,
    /^##\s+/m,
    /^#\s+/m,
  ];

  for (const pattern of prdStartPatterns) {
    const match = text.match(pattern);
    if (match) {
      text = text.substring(match.index);
      break;
    }
  }

  // Clean up multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  // Remove leading/trailing whitespace
  text = text.trim();

  // If text is too short or still contains reasoning, return a warning but keep the content
  if (text.length < 50) {
    return 'The AI response was too brief. Please try again with more detailed project information, including:\n- A clear project description (at least 2-3 sentences)\n- Specific features or goals\n- Target users or audience\n\nOriginal response: ' + text;
  }

  // If still contains reasoning artifacts, just warn but return the content
  if (text.toLowerCase().includes('let me analyze')) {
    // Remove the reasoning parts and return what's left
    text = text.replace(/let me analyze[\s\S]*?(?=\n\n|##|#|$)/gi, '').trim();
  }

  return text;
}

