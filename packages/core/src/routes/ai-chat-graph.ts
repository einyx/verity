/* eslint-disable new-cap -- LangGraph's Annotation and StateGraph are factories called as functions by its API. */
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import {
  maxToolRounds,
  roundLimitReply,
  type ModelMessage,
  type ModelReply,
  type ToolCall,
} from './ai-chat-loop.js';

// The same tool-calling loop as `runToolLoop`, expressed as a LangGraph state graph. The model node
// asks for a reply; the tools node runs the calls in order and counts a round. The round limit,
// the tool order, and the outcomes match `runToolLoop`, so the parity tests hold for both.
// Writes still never run here: `executeTool` only returns the pending-action text for a proposal.

type LoopOutcome = { content: string; ok: boolean };

const LoopState = Annotation.Root({
  messages: Annotation<ModelMessage[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  round: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 0,
  }),
  pendingCalls: Annotation<ToolCall[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  outcome: Annotation<{ result?: LoopOutcome }>({
    reducer: (_previous, next) => next,
    default: () => ({}),
  }),
});

export const runToolLoopWithGraph = async ({
  messages,
  callModel,
  executeTool,
  maxRounds = maxToolRounds,
}: {
  messages: ModelMessage[];
  callModel: (conversation: ModelMessage[]) => Promise<ModelReply | undefined>;
  executeTool: (call: ToolCall) => Promise<string>;
  maxRounds?: number;
}): Promise<LoopOutcome> => {
  const modelNode = async (state: typeof LoopState.State) => {
    if (state.round >= maxRounds) {
      return { outcome: { result: { content: roundLimitReply, ok: true } } };
    }

    const reply = await callModel(state.messages);

    if (!reply) {
      return { outcome: { result: { content: '', ok: false } } };
    }

    if (reply.toolCalls.length === 0) {
      return { outcome: { result: { content: reply.content ?? '', ok: true } } };
    }

    return {
      messages: [
        ...state.messages,
        { role: 'assistant' as const, content: reply.content, tool_calls: reply.toolCalls },
      ],
      pendingCalls: reply.toolCalls,
    };
  };

  const toolsNode = async (state: typeof LoopState.State) => {
    // Tool calls run in order, so a later call sees the effects of an earlier one.
    const toolMessages = await state.pendingCalls.reduce<Promise<ModelMessage[]>>(
      async (previous, call) => {
        const done = await previous;
        const output = await executeTool(call);

        return [...done, { role: 'tool' as const, tool_call_id: call.id, content: output }];
      },
      Promise.resolve([])
    );

    return {
      messages: [...state.messages, ...toolMessages],
      pendingCalls: [],
      round: state.round + 1,
    };
  };

  const graph = new StateGraph(LoopState)
    .addNode('model', modelNode)
    .addNode('tools', toolsNode)
    .addEdge(START, 'model')
    .addConditionalEdges('model', (state) => (state.outcome.result ? END : 'tools'), {
      tools: 'tools',
      [END]: END,
    })
    .addEdge('tools', 'model')
    .compile();

  // Each round is one model step and one tools step; the last model step ends the run.
  const result = await graph.invoke({ messages }, { recursionLimit: maxRounds * 2 + 4 });

  return result.outcome.result ?? { content: '', ok: false };
};

/* eslint-enable new-cap */
