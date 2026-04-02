export interface TaskDefinition {
  type: string;
  regex: RegExp;
  fuzzyKeywords: string[];
  argsTemplate: string;
  // Simple extraction mapping: maps capture group index to task property name
  extractionMap?: { [groupIndex: number]: string }; 
}

export const TASKS = {
    DISPLAY_OUTPUT: "DISPLAY_OUTPUT",
    GENERATE_CODE: "GENERATE_CODE",
    GENERATE_FILE: "GENERATE_FILE",
    // LLM_REASON: "LLM_REASON",
    RUN_COMMAND: "RUN_COMMAND"
} as const;

export const TASK_CONFIG: TaskDefinition[] = [
    // SPECIFIC TASKS FIRST
  {
    type: TASKS.RUN_COMMAND,
    regex: /(?:run|execute|cmd|terminal)\s+(?:the\s+)?(.+)/i,
    fuzzyKeywords: ['run', 'execute', 'command', 'bash', 'sh', 'terminal'],
    argsTemplate: "{ command: string, description: string }",
    extractionMap: { 1: "command" }
  },

  {
    type: TASKS.DISPLAY_OUTPUT,
    regex: /(?:print|show|display|echo|output)\s+(?:the\s+)?(?:response|output|result)/i,
    fuzzyKeywords: ['print', 'show', 'display', 'output', 'response'],
    argsTemplate: "{ description: string }"
  },
  {
    type: TASKS.GENERATE_CODE,
    regex: /(?:generate|write|create)\s+(?:code|snippet)\s+(?:for\s+)?(.+)/i,
    fuzzyKeywords: ['code', 'function', 'class', 'script', 'generate'],
    argsTemplate: "{ description: string }",
    extractionMap: { 1: "description" }
  },
  {
    type: TASKS.GENERATE_FILE,
    regex: /(?:generate|create|make)\s+(?:a\s+)?(\S+)\s+(?:file|document|report)/i,
    fuzzyKeywords: ['file', 'pdf', 'txt', 'md', 'document', 'report'],
    argsTemplate: "{ fileType: \"pdf\" | \"txt\" | \"md\", description: string }",
    extractionMap: { 1: "fileType" }
  },

    //   ALWAYS LAST
  // {
  //   type: TASKS.LLM_REASON,
  //   regex: /(.+)/i, // catch-all fallback
  //   fuzzyKeywords: ['explain', 'analyze', 'figure out', 'decide', 'reason'],
  //   argsTemplate: "{ prompt: string, description: string }",
  //   extractionMap: { 1: "prompt" }
  // }
];
