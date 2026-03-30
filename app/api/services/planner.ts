export interface Step {
  id: string;
  tool: string;
  args: any;
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

export function generatePlan(intent: string, entities: string[]): ExecutionPlan {
  const steps: Step[] = [];
  let requires_memory = false;
  let requires_reasoning = false;

  switch (intent) {
    case 'project_query':
    case 'project_explanation':
      requires_memory = true;
      requires_reasoning = true;
      steps.push({
        id: "1",
        tool: "memory.retrieve",
        args: {
          scope: "projects",
          query: entities.join(" "),
          limit: 5
        }
      });
      steps.push({
        id: "2",
        tool: "context.build",
        args: {
            include_memory: true
        }
      });
      steps.push({
        id: "3",
        tool: "llm.generate",
        args: {
            model: "gemini",
            temperature: 0.7
        }
      });
      break;

    case 'knowledge_query':
      requires_memory = false;
      requires_reasoning = true;
      steps.push({
        id: "1",
        tool: "context.build",
        args: {
            include_memory: false
        }
      });
      steps.push({
        id: "2",
        tool: "llm.generate",
        args: {
            model: "gemini",
            temperature: 0.7
        }
      });
      break;

    case 'casual_chat':
      requires_memory = false;
      requires_reasoning = false;
      steps.push({
        id: "1",
        tool: "context.build",
        args: {
            include_memory: false
        }
      });
      steps.push({
        id: "2",
        tool: "llm.generate",
        args: {
            model: "local",
            temperature: 0.7
        }
      });
      break;

    default:
      // Default to a basic reasoning step if intent unknown but reasoning likely needed
      requires_memory = false;
      requires_reasoning = true;
      steps.push({
        id: "1",
        tool: "context.build",
        args: { include_memory: false }
      });
      steps.push({
        id: "2",
        tool: "llm.generate",
        args: { model: "gemini", temperature: 0.7 }
      });
  }

  return {
    meta: {
      intent,
      requires_memory,
      requires_reasoning
    },
    steps
  };
}
