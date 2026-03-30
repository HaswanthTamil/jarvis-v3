import axios from 'axios';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';

const SYSTEM_PROMPT = `
You are an intent classifier for Jarvis, an AI agent. 
Analyze the user's prompt and extract:
1. Intent: Categorize the prompt into one or more of the following: project_explanation, code_generation, casual_chat, brainstorm, system_query, knowledge_query, planning_request.
2. Entities: Extract key subjects or nouns mentioned in the prompt.

Output ONLY a JSON object in this format:
{
  "intents": ["intent1", "intent2"],
  "entities": ["entity1", "entity2"]
}
`;

export interface ClassificationResult {
  intents: string[];
  entities: string[];
}

export async function classifyIntent(prompt: string): Promise<ClassificationResult> {
  try {
    const response = await axios.post(OLLAMA_URL, {
      model: MODEL,
      prompt: `${SYSTEM_PROMPT}\n\nUser prompt: "${prompt}"\n\nJSON Output:`,
      stream: false,
      format: 'json',
      options: {
        temperature: 0
      }
    });

    const output = (response.data as any).response;
    return JSON.parse(output);
  } catch (error: any) {
    console.error('Ollama API error:', error);
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Ollama is not running at ${OLLAMA_URL}. Please ensure Ollama is started.`);
    }
    throw error;
  }
}
