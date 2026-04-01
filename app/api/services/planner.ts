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

Your job is to convert a user request into a STRICT execution plan using a fixed enum system (Intermediate Representation).

---
AVAILABLE STEP TYPES (ENUM)
- RETRIEVE_MEMORY: { "scope": "projects|knowledge|personal", "query": "string", "limit": number }
- BUILD_CONTEXT: { "include_memory": boolean }
- REASON: { "model": "gemini|local", "temperature": number }
- GENERATE_CODE: { "language": "string", "description": "string" }
- GENERATE_FILE: { "type": "pdf|txt|md", "content": "string" }
- RUN_COMMAND: { "command": "string" }

---
PLANNING RULES
1. MANDATORY: Every plan MUST start with a BUILD_CONTEXT step.
2. If memory is needed, use RETRIEVE_MEMORY first, then BUILD_CONTEXT with include_memory: true.
3. Multiple steps are encouraged for complex tasks (e.g., BUILD -> RUN_COMMAND -> REASON).
4. OUTPUT ONLY JSON. No explanations.

---
FEW-SHOT EXAMPLE
User Input: "run script.sh and explain output"
Output:
{
  "meta": { "intent": "script_execution", "requires_memory": false, "requires_reasoning": true },
  "steps": [
    { "id": "1", "type": "BUILD_CONTEXT", "args": { "include_memory": false } },
    { "id": "2", "type": "RUN_COMMAND", "args": { "command": "bash script.sh" } },
    { "id": "3", "type": "REASON", "args": { "model": "local", "temperature": 0 } }
  ]
}
`;

const SYSTEM_PROMPT = process.env.LOCAL_SLM_SIZE === 'small' ? SYSTEM_PROMPT_FOR_SMALL_MODEL : SYSTEM_PROMPT_FOR_LARGE_MODEL;

export interface Step {
  id: string;
  type: PlanStepType;
  args: Record<string, any>;
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

/**
 * Layer 3: Normalizer
 * Auto-corrects common LLM mistakes to make plans executable.
 */
export function normalizePlan(plan: ExecutionPlan): ExecutionPlan {
  const normalizedSteps: Step[] = [...plan.steps];

  // 1. Ensure BUILD_CONTEXT exists at the start
  const firstStep = normalizedSteps[0];
  if (!firstStep || firstStep.type !== PlanStepType.BUILD_CONTEXT) {
    normalizedSteps.unshift({
      id: "placeholder",
      type: PlanStepType.BUILD_CONTEXT,
      args: { include_memory: plan.meta.requires_memory || normalizedSteps.some(s => s.type === PlanStepType.RETRIEVE_MEMORY) }
    });
  }

  // 2. Fix Step IDs (ensure sequential "1", "2", ...)
  normalizedSteps.forEach((step, index) => {
    step.id = (index + 1).toString();
  });

  // 3. Sync memory requirements
  const hasMemoryRetrieve = normalizedSteps.some(s => s.type === PlanStepType.RETRIEVE_MEMORY);
  if (hasMemoryRetrieve) {
    plan.meta.requires_memory = true;
    const contextStep = normalizedSteps.find(s => s.type === PlanStepType.BUILD_CONTEXT);
    if (contextStep) contextStep.args.include_memory = true;
  }

  // 4. Append REASON if only BUILD_CONTEXT exists for non-trivial intent
  if (normalizedSteps.length === 1 && plan.meta.intent !== "trivial") {
    normalizedSteps.push({
      id: (normalizedSteps.length + 1).toString(),
      type: PlanStepType.REASON,
      args: { model: "gemini", temperature: 0.7 }
    });
  }

  return { ...plan, steps: normalizedSteps };
}

/**
 * Layer 2: Validator
 * Strictly rejects plans that violate safety or logic rules.
 */
export function validatePlan(plan: ExecutionPlan): void {
  if (!plan.meta || !plan.meta.intent) throw new Error("Plan meta missing or invalid");
  if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error("Plan steps missing or empty");

  const stepTypes = Object.values(PlanStepType);
  
  plan.steps.forEach(step => {
    if (!step.id) throw new Error("Step ID missing");
    if (!step.type || !stepTypes.includes(step.type as PlanStepType)) throw new Error(`Invalid Step Type: ${step.type}`);
    if (!step.args || typeof step.args !== 'object') throw new Error(`Step ${step.id} missing arguments`);
  });

  const hasBuildContext = plan.steps.some(s => s.type === PlanStepType.BUILD_CONTEXT);
  if (!hasBuildContext) throw new Error("MANDATORY step 'BUILD_CONTEXT' missing");
}

/**
 * Layer 1: Planner (with Retry Logic)
 * Interacts with LLM and drives the 3-layer pipeline.
 */
export async function generatePlan(intent: string, entities: string[], attempt: number = 1): Promise<ExecutionPlan> {
  try {
    const prompt = `Intent: "${intent}"\nEntities: ${JSON.stringify(entities)}`;
    
    const response = await axios.post(OLLAMA_URL, {
      model: MODEL,
      prompt: `${SYSTEM_PROMPT}\n\nUser Input:\n${prompt}\n\nJSON Output:`,
      stream: false,
      format: 'json',
      options: { temperature: 0 }
    });

    const output = (response.data as any).response;
    let plan: ExecutionPlan = JSON.parse(output);

    // Pipeline: RAW -> NORMALIZE -> VALIDATE
    plan = normalizePlan(plan);
    validatePlan(plan);

    console.log(`[ATTEMPT ${attempt}] Valid Plan Generated:`, plan.meta.intent);
    return plan;

  } catch (error: any) {
    console.error(`AI Planning error (Attempt ${attempt}):`, error.message);

    if (attempt < 2) {
      console.log("Retrying planning...");
      return generatePlan(intent, entities, attempt + 1);
    }

    // Layer 5 Fallback: Robust safe plan
    console.warn("Retries exhausted. Using safe fallback plan.");
    return {
      meta: { intent: `FALLBACK: ${intent}`, requires_memory: false, requires_reasoning: true },
      steps: [
        { id: "1", type: PlanStepType.BUILD_CONTEXT, args: { include_memory: false } },
        { id: "2", type: PlanStepType.REASON, args: { model: "gemini", temperature: 0.7 } }
      ]
    };
  }
}

/**
 * Layer 6: Execution Mapping
 * Maps IR steps to actual system behaviors.
 */
export async function executeStep(step: Step): Promise<any> {
    console.log(`Executing Step ${step.id}: ${step.type}`);
    switch (step.type) {
        case PlanStepType.RETRIEVE_MEMORY:
            return `MOCK: memory.retrieve(${JSON.stringify(step.args)})`;
        case PlanStepType.BUILD_CONTEXT:
            return `MOCK: contextBuilder(${JSON.stringify(step.args)})`;
        case PlanStepType.REASON:
            return `MOCK: llmCall(${JSON.stringify(step.args)})`;
        case PlanStepType.GENERATE_CODE:
            return `MOCK: codeGenerator(${JSON.stringify(step.args)})`;
        case PlanStepType.GENERATE_FILE:
            return `MOCK: fileGenerator(${JSON.stringify(step.args)})`;
        case PlanStepType.RUN_COMMAND:
            return `MOCK: systemExec(${JSON.stringify(step.args)})`;
        default:
            throw new Error(`Execution error: Unknown step type ${step.type}`);
    }
}

export async function executePlan(plan: ExecutionPlan): Promise<void> {
    console.log(`STARTING EXECUTION: ${plan.meta.intent}`);
    for (const step of plan.steps) {
        try {
            const result = await executeStep(step);
            console.log(`Step ${step.id} result:`, result);
        } catch (error: any) {
            console.error(`Step ${step.id} failed:`, error.message);
            break; // Stop execution on failure
        }
    }
    console.log("EXECUTION FINISHED");
}
