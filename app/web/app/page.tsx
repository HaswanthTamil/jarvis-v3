"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, User, Bot, Sparkles, AlertCircle } from "lucide-react";

interface Step {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

interface Plan {
  meta: {
    intent: string;
    requires_memory: boolean;
    requires_reasoning: boolean;
  };
  steps: Step[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  intents?: string[];
  entities?: string[];
  plan?: Plan;
  isLoading?: boolean;
  error?: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    const assistantMsgId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      isLoading: true,
    };

    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const response = await fetch("http://localhost:3001/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: input }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || "Failed to classify intent");
      }

      const data = await response.json();

      // Second stage: Planning
      const planResponse = await fetch("http://localhost:3001/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          prompt: input,
          intent: data.intents[0], 
          entities: data.entities 
        }),
      });

      if (!planResponse.ok) {
        throw new Error("Failed to generate execution plan");
      }

      const planData = await planResponse.json();

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                isLoading: false,
                content: `Plan generated for: ${data.intents[0]}`,
                intents: data.intents,
                entities: data.entities,
                plan: planData
              }
            : msg
        )
      );
    } catch (err) {
      const error = err as Error;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                isLoading: false,
                error: error.message,
              }
            : msg
        )
      );
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-zinc-950" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Jarvis v3</h1>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto px-4 md:px-0 py-8 scrollbar-hide">
        <div className="max-w-3xl mx-auto space-y-8">
          {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
                <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center border border-zinc-800">
                    <Sparkles className="w-8 h-8 text-zinc-500" />
                </div>
                <div className="space-y-2">
                    <h2 className="text-2xl font-medium">How can I help you today?</h2>
                    <p className="text-zinc-500 max-w-sm">
                        Jarvis is ready to classify your intents and help you execute your tasks.
                    </p>
                </div>
              </div>
          )}
          
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-4 p-4 rounded-2xl transition-all ${
                message.role === "user" ? "bg-zinc-900/50 border border-zinc-800/50" : ""
              }`}
            >
              <div className="flex-shrink-0 pt-1">
                {message.role === "user" ? (
                  <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
                    <User className="w-5 h-5" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-zinc-950" />
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-widest">
                  {message.role === "user" ? "You" : "Jarvis"}
                </div>
                
                {message.isLoading ? (
                  <div className="flex items-center gap-2 text-zinc-500 animate-pulse">
                    <div className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                ) : message.error ? (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/20 border border-red-900/30 text-red-400 text-sm">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <span>{message.error}</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-zinc-200 leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </p>
                    
                    {message.role === "assistant" && message.plan && (
                        <div className="space-y-3 pt-3 border-t border-zinc-900">
                            <div className="flex items-center justify-between">
                                <div className="text-[10px] text-zinc-600 uppercase font-bold tracking-tighter">Execution Plan</div>
                                <div className="flex gap-2">
                                    {message.plan.meta.requires_memory && <span className="px-1.5 py-0.5 rounded-sm bg-amber-900/10 border border-amber-900/30 text-[8px] text-amber-500 uppercase font-bold">Memory Required</span>}
                                    {message.plan.meta.requires_reasoning && <span className="px-1.5 py-0.5 rounded-sm bg-purple-900/10 border border-purple-900/30 text-[8px] text-purple-500 uppercase font-bold">Reasoning Required</span>}
                                </div>
                            </div>
                            <div className="space-y-2">
                                {message.plan.steps.map((step, idx) => (
                                    <div key={step.id} className="flex gap-3 items-start p-2 rounded-lg bg-zinc-900/50 border border-zinc-800/50">
                                        <div className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-500">{idx + 1}</div>
                                        <div className="flex-1">
                                            <div className="text-xs font-mono text-zinc-300">{step.tool}</div>
                                            <div className="text-[10px] text-zinc-500 font-mono mt-1 opacity-60">args: {JSON.stringify(step.args)}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    
                    {message.role === "assistant" && message.entities && message.entities.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-zinc-900">
                            <div className="text-[10px] text-zinc-600 uppercase font-bold tracking-tighter">Entities Detected</div>
                            <div className="flex flex-wrap gap-2">
                                {message.entities.map(entity => (
                                    <span key={entity} className="px-2 py-0.5 bg-blue-900/10 border border-blue-900/30 rounded text-xs text-blue-400">
                                        {entity}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="p-4 md:p-8 bg-zinc-950">
        <div className="max-w-3xl mx-auto relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-zinc-800 to-zinc-900 rounded-2xl opacity-50 group-focus-within:opacity-100 transition-opacity blur-[2px]" />
          <div className="relative bg-zinc-900 rounded-2xl border border-zinc-800 p-2 flex items-end gap-2 shadow-2xl">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Talk to Jarvis..."
              className="w-full bg-transparent border-none focus:ring-0 text-zinc-100 placeholder-zinc-500 py-3 px-4 resize-none min-h-[52px] max-h-60"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className={`p-3 rounded-xl transition-all ${
                input.trim() && !isTyping
                  ? "bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              }`}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-3 text-center">
            <p className="text-[10px] text-zinc-600 font-medium tracking-tight">
                JARVIS V3 ORCHESTRATION LAYER • SLM: QWEN 2.5 1.5B
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
