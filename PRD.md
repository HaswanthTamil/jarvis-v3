# Jarvis v2 — Product Requirements Document (PRD)

## 1. Overview

Jarvis is a personal AI orchestration system designed to function as a structured "execution brain" for the user. It integrates:

- Local Small Language Models (SLMs) for orchestration
- A cloud LLM for deep reasoning
- Structured filesystem memory
- Context-aware prompt construction

Jarvis v1 relied entirely on a cloud LLM for reasoning and orchestration. Jarvis v2 introduces a **local intelligence layer** responsible for handling lightweight cognitive tasks locally while delegating heavy reasoning to a powerful cloud model.

Primary reasoning engine: Gemini

Target local runtime: Ollama

Hardware target: 8GB RAM development laptop.

---

# 2. Objectives

## Primary Goals

1. Introduce a local orchestration intelligence layer
2. Reduce cloud model usage for non-reasoning tasks
3. Enable structured memory retrieval
4. Enable automatic memory generation
5. Maintain low hardware requirements
6. Introduce a planning layer for multi-step reasoning

## Success Criteria

Jarvis should be able to:

- Understand user intent
- Extract relevant entities
- Generate an execution plan
- Retrieve relevant memories
- Construct enriched prompts
- Send structured prompts to Gemini
- Summarize conversations
- Store useful knowledge automatically

---

# 3. System Architecture

Jarvis follows a hybrid intelligence architecture separating orchestration from reasoning.

Pipeline:

User
→ Local SLM (Intent + Entity Extraction)
→ Planner Layer
→ Memory Retrieval
→ Context Builder
→ Gemini Reasoning Engine
→ Local SLM (Memory Processor)
→ Filesystem Memory

This design allows:

- low hardware usage
- modular reasoning
- model swap flexibility

The cloud model remains stateless while Jarvis manages system state.

---

# 4. Core Components

## 4.1 Local SLM Layer

The local SLM acts as the orchestration brain.

Responsibilities:

- Intent classification
- Entity extraction
- Planning
- Conversation summarization
- Memory generation

Target model size:

1B–3B parameters.

Example models:

- Qwen2.5 1.5B
- Phi-3 Mini
- Gemma 2B

Runtime: Ollama

Example:

ollama run qwen2.5:1.5b

The local model is **not used for deep reasoning**.

---

# 5. Processing Pipeline

## Step 1 — User Input

The user sends a prompt to Jarvis.

Example:

"Explain Forge project"

---

## Step 2 — Intent Analysis

The local SLM analyzes the user input and extracts structured information.

Output fields:

- intent
- entities

Example output:

{
"intent": "project_query",
"entities": ["forge"]
}

Intent categories may include:

- project_query
- personal_query
- system_query
- knowledge_query
- planning_request
- casual_chat

---

## Step 3 — Planning Layer

After identifying intent, Jarvis generates an **execution plan**.

The planner determines what steps must be executed before generating a response.

Example output:

{
"intent": "project_query",
"entities": ["forge"],
"memory_required": true,
"memory_scope": "projects",
"plan": [
"retrieve_project_memory",
"construct_context",
"query_reasoning_model"
]
}

Planner responsibilities:

- Determine if memory retrieval is required
- Determine memory scope
- Define execution steps

This enables future support for:

- tool usage
- API calls
- automation workflows

---

# 6. Memory System

Jarvis uses a filesystem-based structured memory system.

Directory structure:

memory/

projects/
clients/
personal/
knowledge/

Each memory entry is stored as a JSON file.

Example memory:

{
"uid": "20260124-1832-forge",
"title": "Forge - Language Translation System",
"type": "personal_project",
"status": "paused",
"domain": ["compiler", "IR", "language-translation"]
}

Memory files are retrieved based on planner decisions.

---

# 7. Memory Retrieval

If memory is required, Jarvis retrieves relevant memory files from the filesystem.

Retrieval strategies:

- UID match
- entity match
- directory scan

Retrieved memory is transformed into structured context blocks.

Example context block:

PROJECT MEMORY
Title: Forge
Status: Paused
Description: Language translation system based on native IR.

These context blocks are passed to the prompt builder.

---

# 8. Context Builder

The context builder constructs the final prompt sent to Gemini.

Structure:

SYSTEM
You are Jarvis, the user's personal AI system.

CONTEXT <retrieved memory blocks>

USER <user prompt>

The goal is to ensure Gemini receives **complete context in a single request**.

---

# 9. Gemini Reasoning Engine

Gemini performs:

- reasoning
- explanation
- planning
- generation

Gemini operates as a stateless reasoning engine.

Jarvis manages:

- memory
- context
- execution pipeline

This separation allows model replacement in the future.

---

# 10. Memory Processing Layer

After Gemini produces a response, the conversation is processed by the local SLM.

Input:

- user prompt
- Gemini response

Tasks:

1. Conversation summarization
2. Detection of memory-worthy information
3. Creation of new long-term memories

Example output:

{
"summary": "User asked about Forge relevance and current status.",
"new_memories": [
{
"type": "project_status",
"target": "forge",
"content": "Forge currently paused while user focuses on internship and other projects."
}
]
}

---

# 11. Session Memory

Jarvis maintains lightweight session memory for active conversations.

Location:

cache/session/

Session memory contains:

- conversation summaries
- temporary context

This prevents sending entire chat histories to Gemini.

---

# 12. Non-Functional Requirements

Hardware constraints:

- 8GB RAM
- CPU inference

Local models must remain under:

3GB memory usage.

System requirements:

- Ollama runtime
- Node.js backend
- filesystem-based storage

---

# 13. Future Enhancements

Potential upgrades:

- vector memory retrieval
- tool execution system
- multi-model routing
- task automation
- knowledge graph memory

Future architecture may introduce:

- tool registry
- execution engine
- semantic memory search

---

# 14. Key Design Principles

Jarvis v2 follows these principles:

1. Orchestration local, reasoning remote
2. Memory managed by the system, not the model
3. Stateless reasoning engine
4. Modular architecture
5. Hardware-efficient design

---

# 15. Summary

Jarvis v2 introduces a hybrid AI architecture combining:

- local orchestration intelligence
- structured memory systems
- cloud reasoning models

The system separates **thinking from remembering**, enabling Jarvis to function as a scalable personal AI brain while remaining compatible with low-resource hardware.
