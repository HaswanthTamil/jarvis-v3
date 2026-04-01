export interface TaskDefinition {
  type: string;
  regex: RegExp;
  fuzzyKeywords: string[];
  argsTemplate: string;
  // Simple extraction mapping: maps capture group index to task property name
  extractionMap?: { [groupIndex: number]: string }; 
}

export const TASK_CONFIG: TaskDefinition[] = [
  {
    type: "RUN_SCRIPT",
    regex: /(?:run|execute)\s+(?:the\s+script\s+)?(\S+\.(?:sh|py|js|ts|rb|pl))/i,
    fuzzyKeywords: ['run', 'script', 'bash', 'sh', 'python', 'execute'],
    argsTemplate: "{ parameters: list, description: string }",
    extractionMap: { 1: "parameters" }
  },
  {
    type: "CALL_API",
    regex: /(?:send|post|call|request)\s+(?:the\s+)?(?:output\s+)?(?:to\s+|api\s+)?(https?:\/\/\S+)/i,
    fuzzyKeywords: ['http', 'https', 'api', 'endpoint', 'url', 'post', 'send'],
    argsTemplate: "{ url: string, method: \"POST\", description: string }",
    extractionMap: { 1: "url" }
  },
  {
    type: "DISPLAY_OUTPUT",
    regex: /(?:print|show|display|echo|output)\s+(?:the\s+)?(?:response|output|result)/i,
    fuzzyKeywords: ['print', 'show', 'display', 'output', 'response'],
    argsTemplate: "{ description: string }"
  },
  {
    type: "GENERATE_CODE",
    regex: /(?:generate|write|create)\s+(?:code|snippet)\s+(?:for\s+)?(.+)/i,
    fuzzyKeywords: ['code', 'function', 'class', 'script', 'generate'],
    argsTemplate: "{ description: string }",
    extractionMap: { 1: "description" }
  },
  {
    type: "GENERATE_FILE",
    regex: /(?:generate|create|make)\s+(?:a\s+)?(\S+)\s+(?:file|document|report)/i,
    fuzzyKeywords: ['file', 'pdf', 'txt', 'md', 'document', 'report'],
    argsTemplate: "{ fileType: \"pdf\" | \"txt\" | \"md\", description: string }",
    extractionMap: { 1: "fileType" }
  }
];
