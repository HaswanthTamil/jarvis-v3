import axios from 'axios';

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
  | { type: "RUN_SCRIPT"; script: string; description: string }
  | { type: "CALL_API"; url: string; method: "POST"; description: string; bodyFrom?: number }
  | { type: "DISPLAY_OUTPUT"; description: string; sourceStep?: number }
  | { type: "GENERATE_CODE"; description: string }
  | { type: "GENERATE_FILE"; fileType: "pdf" | "txt" | "md"; description: string };

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

const TASK_REGEX = {
  RUN_SCRIPT: /(?:run|execute)\s+(?:the\s+script\s+)?(\S+\.(?:sh|py|js|ts|rb|pl))/i,
  CALL_API: /(?:send|post|call|request)\s+(?:the\s+)?(?:output\s+)?(?:to\s+|api\s+)?(https?:\/\/\S+)/i,
  DISPLAY_OUTPUT: /(?:print|show|display|echo|output)\s+(?:the\s+)?(?:response|output|result)/i,
  GENERATE_CODE: /(?:generate|write|create)\s+(?:code|snippet)\s+(?:for\s+)?(.+)/i,
  GENERATE_FILE: /(?:generate|create|make)\s+(?:a\s+)?(\S+)\s+(?:file|document|report)/i
};

const FUZZY_KEYWORDS = {
  RUN_SCRIPT: ['run', 'script', 'bash', 'sh', 'python', 'execute'],
  CALL_API: ['http', 'https', 'api', 'endpoint', 'url', 'post', 'send'],
  DISPLAY_OUTPUT: ['print', 'show', 'display', 'output', 'response'],
  GENERATE_CODE: ['code', 'function', 'class', 'script', 'generate'],
  GENERATE_FILE: ['file', 'pdf', 'txt', 'md', 'document', 'report']
};

/**
 * Deterministic pattern matching for high-confidence extraction.
 */
function extractDeterministic(sentence: string): ScoredTask {
  if (TASK_REGEX.RUN_SCRIPT.test(sentence)) {
    const match = sentence.match(TASK_REGEX.RUN_SCRIPT);
    return { task: { type: "RUN_SCRIPT", script: match![1], description: sentence }, confidence: 1.0, source: "deterministic" };
  }
  if (TASK_REGEX.CALL_API.test(sentence)) {
    const match = sentence.match(TASK_REGEX.CALL_API);
    return { task: { type: "CALL_API", url: match![1], method: "POST", description: sentence }, confidence: 1.0, source: "deterministic" };
  }
  if (TASK_REGEX.DISPLAY_OUTPUT.test(sentence)) {
    return { task: { type: "DISPLAY_OUTPUT", description: sentence }, confidence: 1.0, source: "deterministic" };
  }
  if (TASK_REGEX.GENERATE_CODE.test(sentence)) {
    const match = sentence.match(TASK_REGEX.GENERATE_CODE);
    return { task: { type: "GENERATE_CODE", description: sentence }, confidence: 1.0, source: "deterministic" };
  }
  if (TASK_REGEX.GENERATE_FILE.test(sentence)) {
    const match = sentence.match(TASK_REGEX.GENERATE_FILE);
    const ext = match![1].split('.').pop();
    const type = (ext === 'pdf' || ext === 'md') ? ext : 'txt';
    return { task: { type: "GENERATE_FILE", fileType: type as any, description: sentence }, confidence: 1.0, source: "deterministic" };
  }
  return { task: null, confidence: 0, source: "deterministic" };
}

/**
 * Fuzzy matching based on keyword overlap.
 */
function extractFuzzy(sentence: string): ScoredTask {
  const words = sentence.toLowerCase().split(/\W+/);
  let bestType: any = null;
  let maxScore = 0;

  for (const [type, keywords] of Object.entries(FUZZY_KEYWORDS)) {
    const matches = keywords.filter(k => words.includes(k));
    const score = matches.length / keywords.length;
    if (score > maxScore) {
      maxScore = score;
      bestType = type;
    }
  }

  if (maxScore > 0.3) {
    // Map fuzzy result to partially populated task
    let task: Task | null = null;
    switch (bestType) {
      case "RUN_SCRIPT": task = { type: "RUN_SCRIPT", script: "unknown", description: sentence }; break;
      case "CALL_API": task = { type: "CALL_API", url: "unknown", method: "POST", description: sentence }; break;
      case "DISPLAY_OUTPUT": task = { type: "DISPLAY_OUTPUT", description: sentence }; break;
      case "GENERATE_CODE": task = { type: "GENERATE_CODE", description: sentence }; break;
      case "GENERATE_FILE": task = { type: "GENERATE_FILE", fileType: "txt", description: sentence }; break;
    }
    return { task, confidence: Math.min(maxScore, 0.8), source: "fuzzy" };
  }

  return { task: null, confidence: 0, source: "fuzzy" };
}

/**
 * LLM-based classification fallback.
 */
async function extractLLM(sentence: string): Promise<ScoredTask> {
  const prompt = `Classify the following atomic instruction into one of these task types:
- RUN_SCRIPT (args: { parameters: list, description: string })
- CALL_API (args: { url: string, method: "POST", description: string })
- DISPLAY_OUTPUT (args: { description: string })
- GENERATE_CODE (args: { description: string })
- GENERATE_FILE (args: { fileType: "pdf" | "txt" | "md", description: string })

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
      if (task.type === "CALL_API") {
        task.bodyFrom = i + 1; // Step ID of the previous task (BUILD_CONTEXT is 1, Tasks start at 2)
      } else if (task.type === "DISPLAY_OUTPUT") {
        task.sourceStep = i + 1;
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
    case "RUN_SCRIPT":
      return { 
        id, 
        type: PlanStepType.RUN_COMMAND, 
        args: { script: task.script, description: task.description } 
      };
    case "CALL_API":
      const bodyRef = task.bodyFrom ? `<output_of_step_${task.bodyFrom}>` : "";
      return { 
        id, 
        type: PlanStepType.RUN_COMMAND, 
        args: { 
          url: task.url, 
          method: task.method, 
          bodyRef, 
          description: task.description 
        } 
      };
    case "DISPLAY_OUTPUT":
      const sourceRef = task.sourceStep ? `<output_of_step_${task.sourceStep}>` : "";
      return { 
        id, 
        type: PlanStepType.REASON, 
        args: { 
          sourceRef, 
          description: task.description 
        } 
      };
    case "GENERATE_CODE":
      return { 
        id, 
        type: PlanStepType.GENERATE_CODE, 
        args: { description: task.description } 
      };
    case "GENERATE_FILE":
      return { 
        id, 
        type: PlanStepType.GENERATE_FILE, 
        args: { type: task.fileType, description: task.description } 
      };
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

