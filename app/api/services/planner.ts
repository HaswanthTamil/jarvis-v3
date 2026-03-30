import axios from 'axios';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';

const SYSTEM_PROMPT = `
You are a planning agent for Jarvis, an AI system. 
Analyze the User Intent and Entities provided and generate a structured execution plan.

Available Tools:
1. memory.retrieve: { "scope": "projects|knowledge|personal", "query": "string", "limit": number }
   - Use this if the user asks about specific projects, personal info, or general knowledge Jarvis should have.
2. context.build: { "include_memory": boolean }
   - ALWAYS use this step before llm.generate. include_memory should be true if memory.retrieve was used.
3. llm.generate: { "model": "gemini|local", "temperature": number }
   - Use "gemini" for complex reasoning, project queries, or large generation tasks.
   - Use "local" for greetings, casual chat, or very simple system status checks.

PLANNING RULES:
- First step is usually memory.retrieve (if needed).
- Second step is context.build.
- Final step is llm.generate.
- Output ONLY a JSON object in the specified format.

Output Format:
{
  "meta": {
    "intent": "string",
    "requires_memory": boolean,
    "requires_reasoning": boolean
  },
  "steps": [
    { "id": "1", "tool": "tool_name", "args": { ... } }
  ]
}
`;

export interface Step {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface PlanMeta {
  intent: string;
  requires_memory: boolean;
  requires_reasoning: boolean;
}

export interface ExecutionPlan {
  meta: PlanMeta;
  steps: Step[];
}

export async function generatePlan(intent: string, entities: string[]): Promise<ExecutionPlan> {
  try {
    const prompt = `Intent: "${intent}"\nEntities: ${JSON.stringify(entities)}`;
    
    const response = await axios.post(OLLAMA_URL, {
      model: MODEL,
      prompt: `${SYSTEM_PROMPT}\n\nUser Input:\n${prompt}\n\nJSON Output:`,
      stream: false,
      format: 'json',
      options: {
        temperature: 0
      }
    });

    const output = (response.data as any).response;
    const plan: ExecutionPlan = JSON.parse(output);
    
    // Safety check: ensure required structure exists
    if (!plan.meta || !plan.steps || !Array.isArray(plan.steps)) {
        throw new Error("Invalid plan structure received from SLM");
    }

    return plan;
  } catch (error: any) {
    console.error('AI Planning error:', error);
    
    // Fallback to a basic plan if AI fails
    return {
      meta: {
        intent,
        requires_memory: false,
        requires_reasoning: true
      },
      steps: [
        { id: "1", tool: "context.build", args: { include_memory: false } },
        { id: "2", tool: "llm.generate", args: { model: "gemini", temperature: 0.7 } }
      ]
    };
  }
}
