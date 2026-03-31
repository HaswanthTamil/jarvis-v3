import axios from 'axios';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';

export enum PlanStepType {
  RETRIEVE_MEMORY = 'RETRIEVE_MEMORY',
  BUILD_CONTEXT = 'BUILD_CONTEXT',
  REASON = 'REASON',
  GENERATE_CODE = 'GENERATE_CODE',
  GENERATE_FILE = 'GENERATE_FILE',
  RUN_COMMAND = 'RUN_COMMAND'
}

const SYSTEM_PROMPT_FOR_LARGE_MODEL = `
You are a planning agent for Jarvis, an AI system. 
Analyze the User Intent and Entities provided and generate a structured execution plan using ONLY the provided PlanStepType enum.

PlanStepType Enum:
1. RETRIEVE_MEMORY:
   - Used when user asks about stored data, past projects, or known info.
   - args: { "scope": "projects|knowledge|personal", "query": "string", "limit": number }
2. BUILD_CONTEXT:
   - MUST always be present before execution steps.
   - args: { "include_memory": boolean }
3. REASON:
   - General reasoning / answering / chatbot behavior.
   - args: { "model": "gemini|local", "temperature": number }
4. GENERATE_CODE:
   - Used when user wants code or files with code content.
   - args: { "language": "string", "description": "string" }
5. GENERATE_FILE:
   - Used when user wants files like pdf, txt, md.
   - args: { "type": "pdf|txt|md", "content": "string" }
6. RUN_COMMAND:
   - Used for terminal/system execution.
   - args: { "command": "string" }

PLANNING RULES:
- You MUST ONLY use the provided PlanStepType enum.
- You MUST NOT invent new step types.
- First step: RETRIEVE_MEMORY (if needed).
- Second step: BUILD_CONTEXT (always required).
- Final step: one of REASON / GENERATE_CODE / GENERATE_FILE / RUN_COMMAND.
- If RETRIEVE_MEMORY is used → BUILD_CONTEXT.include_memory = true.
- ids must be sequential strings ("1", "2", ...).
- Output MUST be valid JSON (no markdown, no comments).

Output Format:
{
  "meta": {
    "intent": "string",
    "requires_memory": boolean,
    "requires_reasoning": boolean
  },
  "steps": [
    {
      "id": "1",
      "type": "BUILD_CONTEXT",
      "args": { "include_memory": false }
    }
  ]
}
`;

const SYSTEM_PROMPT_FOR_SMALL_MODEL = `
You are a planning agent for Jarvis.

Your job is to convert a user request into a STRICT execution plan using a fixed enum system.

You MUST break the request into clear, atomic steps.

---

AVAILABLE STEP TYPES (ENUM)

You are ONLY allowed to use these:

RETRIEVE_MEMORY
BUILD_CONTEXT
REASON
GENERATE_CODE
GENERATE_FILE
RUN_COMMAND

DO NOT invent new types.

---

STEP DEFINITIONS

RETRIEVE_MEMORY
- Use if user refers to stored info (projects, personal, knowledge)
- args:
  { "scope": "projects|knowledge|personal", "query": "string", "limit": number }

BUILD_CONTEXT
- ALWAYS required before execution
- args:
  { "include_memory": boolean }

REASON
- Used to display output, explain, or respond to user
- args:
  { "model": "gemini|local", "temperature": number }

GENERATE_CODE
- Use when user asks to create code
- args:
  { "language": "string", "description": "string" }

GENERATE_FILE
- Use when user wants a file
- args:
  { "type": "pdf|txt|md", "content": "string" }

RUN_COMMAND
- Use for ANY system/terminal/API execution
- args:
  { "command": "string" }

---

PLANNING STRATEGY (VERY IMPORTANT)

You MUST decompose tasks step-by-step.

Common patterns:

- Run a script → RUN_COMMAND
- Call an API → RUN_COMMAND (use curl or similar)
- Pass output between steps → reference like "<output_of_step_X>"
- Show final output → REASON with model "local"

DO NOT combine multiple actions into one step.

---

META RULES

- requires_memory = true ONLY if RETRIEVE_MEMORY is used
- requires_reasoning = true if task has multiple steps or transformations

---

STEP ORDER RULES

1. RETRIEVE_MEMORY (optional)
2. BUILD_CONTEXT (mandatory)
3. One or more execution steps
4. Final step MUST be:
   - REASON OR
   - GENERATE_CODE OR
   - GENERATE_FILE OR
   - RUN_COMMAND

---

OUTPUT FORMAT (STRICT JSON ONLY)

{
  "meta": {
    "intent": "string",
    "requires_memory": boolean,
    "requires_reasoning": boolean
  },
  "steps": [
    {
      "id": "1",
      "type": "BUILD_CONTEXT",
      "args": { "include_memory": false }
    }
  ]
}

---

EXAMPLE

User Input:
Intent: "run script and send output to API and print response"
Entities: ["business.sh", "https://mybusiness.com/api/script"]

Output:

{
  "meta": {
    "intent": "script_execution_pipeline",
    "requires_memory": false,
    "requires_reasoning": true
  },
  "steps": [
    {
      "id": "1",
      "type": "BUILD_CONTEXT",
      "args": { "include_memory": false }
    },
    {
      "id": "2",
      "type": "RUN_COMMAND",
      "args": {
        "command": "bash business.sh"
      }
    },
    {
      "id": "3",
      "type": "RUN_COMMAND",
      "args": {
        "command": "curl -X POST https://mybusiness.com/api/script -d \"<output_of_step_2>\""
      }
    },
    {
      "id": "4",
      "type": "REASON",
      "args": {
        "model": "local",
        "temperature": 0
      }
    }
  ]
}

---

IMPORTANT

- ALWAYS return multiple steps for multi-action tasks
- NEVER return only BUILD_CONTEXT unless the request is trivial
- ALWAYS think in sequence
- OUTPUT JSON ONLY
`

const SYSTEM_PROMPT = process.env.LOCAL_SLM_SIZE == "small" ? SYSTEM_PROMPT_FOR_SMALL_MODEL : SYSTEM_PROMPT_FOR_LARGE_MODEL;

export interface Step {
  id: string;
  type: PlanStepType;
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

    // Validation: ensure BUILD_CONTEXT exists
    const hasBuildContext = plan.steps.some(s => s.type === PlanStepType.BUILD_CONTEXT);
    if (!hasBuildContext) {
      // Inject BUILD_CONTEXT if missing
      plan.steps.splice(0, 0, {
        id: "context_fix",
        type: PlanStepType.BUILD_CONTEXT,
        args: { include_memory: plan.meta.requires_memory }
      });
    }

    console.log("PLAN: ")
    console.log(plan)
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
        { id: "1", type: PlanStepType.BUILD_CONTEXT, args: { include_memory: false } },
        { id: "2", type: PlanStepType.REASON, args: { model: "gemini", temperature: 0.7 } }
      ]
    };
  }
}
