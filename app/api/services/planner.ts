import axios from 'axios';
import { TASK_CONFIG, TaskDefinition, TASKS } from './tasks.config';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';

// --- TYPES ---

export enum PlanStepType {
  RETRIEVE_MEMORY = 'RETRIEVE_MEMORY',
  BUILD_CONTEXT = 'BUILD_CONTEXT',
  REASON = 'REASON',
  GENERATE_CODE = 'GENERATE_CODE',
  GENERATE_FILE = 'GENERATE_FILE',
  RUN_COMMAND = 'RUN_COMMAND'
}

export type Task =
  | { type: typeof TASKS.RUN_COMMAND; command: string; description: string }
  | { type: typeof TASKS.DISPLAY_OUTPUT; description: string; sourceStep?: number }
  | { type: typeof TASKS.GENERATE_CODE; description: string }
  | { type: typeof TASKS.GENERATE_FILE; fileType: "pdf" | "txt" | "md"; description: string }
  // | { type: typeof TASKS.LLM_REASON; prompt: string; description: string };

export type ScoredTask = {
  task: Task | null;
  confidence: number; // 0 to 1
  source: "deterministic" | "fuzzy" | "llm";
};

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

// --- MODULE 1: SENTENCE DECOMPOSER ---

/**
 * Splits raw user input into atomic imperative instructions.
 */
export async function decomposeRequest(input: string): Promise<string[]> {
  console.log("[PLANNER] Decomposing request:", input);

  
  const prompt = `Decompose the following user request into a JSON array of atomic, imperative instructions. 
Rules:
- Each sentence must represent EXACTLY ONE action.
- Preserve order.
- Do NOT infer or add steps.
- Output MUST be a valid JSON array of strings.
- Each sentence should contain the necessary information to perform the action. Do NOT add any extra information.

Input: "${input}"
Output:`;

  try {
    const response = await axios.post(OLLAMA_URL, {
      model: MODEL,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0 }
    });
    const output = (response.data as any).response;
    let sentences = JSON.parse(output);

    if (!Array.isArray(sentences)) {
      console.log("[PLANNER] LLM output is not an array, attempting object → array conversion:");
      console.log(sentences);

      if (typeof sentences === "object" && sentences !== null) {
        sentences = Object.values(sentences);
      } else {
        throw new Error("Parsed output is neither array nor object");
      }
    }

    const cleaned = sentences.map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    if (cleaned.length === 0) throw new Error("No instructions found");

    console.log("[PLANNER] Decomposed into:", cleaned);
    return cleaned;
  } catch (error: any) {
    console.error("[PLANNER] Decomposition failed:", error.message);
    // Fallback: return as single instruction if LLM fails
    return [input];
  }
}

// --- MODULE 2: TASK EXTRACTION ---

/**
 * Deterministic pattern matching for high-confidence extraction.
 */
function extractDeterministic(sentence: string): ScoredTask {
  for (const config of TASK_CONFIG) {
    if (config.regex.test(sentence)) {
      const match = sentence.match(config.regex);
      const task: any = { type: config.type, description: sentence };
      
      if (config.extractionMap) {
        Object.entries(config.extractionMap).forEach(([groupIndex, key]) => {
          task[key] = match![parseInt(groupIndex)];
        });
      }
      
      // Special override for file type extraction
      if (config.type === "GENERATE_FILE" && task.fileType) {
        const ext = task.fileType.split('.').pop();
        task.fileType = (ext === 'pdf' || ext === 'md') ? ext : 'txt';
      }

      return { task, confidence: 1.0, source: "deterministic" };
    }
  }
  return { task: null, confidence: 0, source: "deterministic" };
}

/**
 * Fuzzy matching based on keyword overlap.
 */
function extractFuzzy(sentence: string): ScoredTask {
  const words = sentence.toLowerCase().split(/\W+/);
  let bestConfig: TaskDefinition | null = null;
  let maxScore = 0;

  for (const config of TASK_CONFIG) {
    const matches = config.fuzzyKeywords.filter(k => words.includes(k));
    const score = matches.length / config.fuzzyKeywords.length;
    if (score > maxScore) {
      maxScore = score;
      bestConfig = config;
    }
  }

  if (maxScore > 0.3 && bestConfig) {
    const task: any = { type: bestConfig.type, description: sentence };
    // Provide safe defaults for fuzzy matched tasks
    if (bestConfig.type === TASKS.RUN_COMMAND) task.command = "unknown";
    if (bestConfig.type === TASKS.GENERATE_FILE) task.fileType = "txt";
    // if (bestConfig.type === TASKS.LLM_REASON) task.prompt = sentence;

    return { task, confidence: Math.min(maxScore, 0.8), source: "fuzzy" };
  }

  return { task: null, confidence: 0, source: "fuzzy" };
}

/**
 * LLM-based classification fallback.
 */
async function extractLLM(sentence: string): Promise<ScoredTask> {
  const taskOptions = TASK_CONFIG.map(t => `- ${t.type} (args: ${t.argsTemplate})`).join('\n');

  const prompt = `Classify the following atomic instruction into one of these task types:
${taskOptions}

Rules:
- Output ONLY valid JSON.
- Do NOT generate plans or raw commands. args should only contain required parameters and description for the task.
- If type is unknown, set type to null.
- Task type naming convention should be as exact as mentioned above.

Instruction: "${sentence}"
Result:`;

  try {
    const response = await axios.post(OLLAMA_URL, {
      model: MODEL,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0 }
    });

    const result = JSON.parse((response.data as any).response);
    if (!result.type) return { task: null, confidence: 0, source: "llm" };

    return { task: { ...result.args, type: result.type }, confidence: 0.9, source: "llm" };
  } catch (error: any) {
    return { task: null, confidence: 0, source: "llm" };
  }
}

/**
 * Extracts a task from a single sentence using hybrid strategy.
 */
export async function extractTask(sentence: string): Promise<ScoredTask> {
  console.log(`[PLANNER] Extracting task from: "${sentence}"`);

  // 1. Deterministic
  const detResult = extractDeterministic(sentence);
  if (detResult.confidence === 1.0) return detResult;

  // 2. Fuzzy
  const fuzzyResult = extractFuzzy(sentence);
  if (fuzzyResult.confidence > 0.6) return fuzzyResult;

  // 3. LLM Fallback
  const llmResult = await extractLLM(sentence);
  if (llmResult.confidence > 0.5) return llmResult;

  return detResult; // Return lowest confidence deterministic if all fail
}


// --- MODULE 3: DEPENDENCY LINKING ---

/**
 * Connects tasks in sequence and infers dependencies.
 */
export function linkDependencies(scoredTasks: ScoredTask[]): Task[] {
  console.log("[PLANNER] Linking dependencies");
  const tasks: Task[] = [];
  
  for (let i = 0; i < scoredTasks.length; i++) {
    const scored = scoredTasks[i];
    if (!scored.task) continue;
    
    const task = { ...scored.task };
    
    // Simple sequential dependency: if I'm not the first task, 
    // I might depend on the output of the previous task.
    if (i > 0) {
      if (task.type === TASKS.DISPLAY_OUTPUT) {
        (task as any).sourceStep = i + 1;
      }
    }
    
    tasks.push(task);
  }
  
  return tasks;
}

// --- MODULE 5: TASK -> PLANSTEP MAPPING ---

/**
 * Converts a high-level Task into a low-level PlanStep with declarative args.
 */
export function mapTaskToStep(task: Task, id: string): Step {
  switch (task.type) {
    case TASKS.RUN_COMMAND:
      return { 
        id, 
        type: PlanStepType.RUN_COMMAND, 
        args: { command: task.command, description: task.description } 
      };
    case TASKS.DISPLAY_OUTPUT:
      const sourceRef = task.type === TASKS.DISPLAY_OUTPUT && task.sourceStep ? `<output_of_step_${task.sourceStep}>` : "";
      return { 
        id, 
        type: PlanStepType.REASON, 
        args: { 
          sourceRef, 
          description: task.description 
        } 
      };
    case TASKS.GENERATE_CODE:
      return { 
        id, 
        type: PlanStepType.GENERATE_CODE, 
        args: { description: task.description } 
      };
    case TASKS.GENERATE_FILE:
      return { 
        id, 
        type: PlanStepType.GENERATE_FILE, 
        args: { type: task.type === TASKS.GENERATE_FILE ? task.fileType : 'txt', description: task.description } 
      };
    // case TASKS.LLM_REASON:
    //   return {
    //     id,
    //     type: PlanStepType.REASON,
    //     args: { prompt: task.prompt, description: task.description }
    //   };
    default:
      throw new Error(`Unsupported task type: ${(task as any).type}`);
  }
}


// --- CORE PIPELINE ---

export async function generatePlan(input: string): Promise<ExecutionPlan> {
  // 1. Decompose
  const sentences = await decomposeRequest(input);
  
  // 2. Extract Tasks
  const scoredTasks: ScoredTask[] = [];
  for (const sentence of sentences) {
    scoredTasks.push(await extractTask(sentence));
  }

  // 3. Link Dependencies
  const tasks = linkDependencies(scoredTasks);

  // 4. Map to Steps
  const steps: Step[] = [];
  
  // ALWAYS start with BUILD_CONTEXT (Module 5 Rule)
  steps.push({
    id: "1",
    type: PlanStepType.BUILD_CONTEXT,
    args: { include_memory: false }
  });

  // Map each task to a step starting from ID 2
  tasks.forEach((task, index) => {
    steps.push(mapTaskToStep(task, (index + 2).toString()));
  });

  // 5. Build Final Plan (Module 6)
  const plan: ExecutionPlan = {
    meta: {
      intent: input,
      requires_memory: false,
      requires_reasoning: steps.length > 2
    },
    steps
  };

  // 6. Validate & Normalize (Module 7 & 8)
  const finalPlan = normalizePlan(validatePlan(plan));
  console.log("FINAL PLAN:");
  console.log(JSON.stringify(finalPlan, null, 2));
  return finalPlan;
}

// --- MODULE 7 & 8: VALIDATION & NORMALIZATION ---

export function validatePlan(plan: ExecutionPlan): ExecutionPlan {
  if (plan.steps.length === 0) throw new Error("Plan steps cannot be empty");
  if (plan.steps[0].type !== PlanStepType.BUILD_CONTEXT) throw new Error("First step must be BUILD_CONTEXT");
  
  plan.steps.forEach((step, index) => {
    if (step.id !== (index + 1).toString()) throw new Error(`Invalid step ID: ${step.id} at index ${index}`);
  });
  
  return plan;
}

export function normalizePlan(plan: ExecutionPlan): ExecutionPlan {
  // Ensure sequential IDs (already mostly handled but for safety)
  plan.steps.forEach((step, index) => {
    step.id = (index + 1).toString();
  });
  
  // If only BUILD_CONTEXT exists, append a REASON step
  if (plan.steps.length === 1) {
    plan.steps.push({
      id: "2",
      type: PlanStepType.REASON,
      args: { model: "local", prompt: "How can I help you further?" }
    });
    plan.meta.requires_reasoning = true;
  }
  
  return plan;
}


// --- EXISTING EXECUTION LOGIC (MOCKS) ---

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
            break;
        }
    }
    console.log("EXECUTION FINISHED");
}

