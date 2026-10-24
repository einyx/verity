/* eslint-disable @silverhand/fp/no-mutating-methods, @silverhand/fp/no-let, @silverhand/fp/no-mutation -- the test doubles record calls and replay scripted replies in order, which is the behavior being compared. */
import { runToolLoopWithGraph } from './ai-chat-graph.js';
import { runToolLoop, type ModelMessage, type ModelReply, type ToolCall } from './ai-chat-loop.js';

// Parity: the LangGraph loop must give the same outcome, the same tool order, and the same number
// of model calls as the hand-written loop for every scripted conversation.

const userMessage: ModelMessage = { role: 'user', content: 'hi' };

const call = (id: string, name = 'tool'): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: '{}' },
});

/** A model that replays the scripted replies in order, then returns undefined when they run out. */
const scriptedModel = (replies: Array<ModelReply | undefined>) => {
  const seen: number[] = [];
  let index = 0;

  const callModel = async (conversation: ModelMessage[]) => {
    seen.push(conversation.length);
    const reply = replies[index];
    index += 1;

    return reply;
  };

  return { callModel, seen };
};

const runBoth = async (
  replies: Array<ModelReply | undefined>,
  options: { maxRounds?: number } = {}
) => {
  const legacyModel = scriptedModel(replies);
  const legacyTools: string[] = [];
  const legacy = await runToolLoop({
    messages: [userMessage],
    callModel: legacyModel.callModel,
    executeTool: async (toolCall) => {
      legacyTools.push(toolCall.id);

      return `output:${toolCall.id}`;
    },
    ...options,
  });

  const graphModel = scriptedModel(replies);
  const graphTools: string[] = [];
  const graph = await runToolLoopWithGraph({
    messages: [userMessage],
    callModel: graphModel.callModel,
    executeTool: async (toolCall) => {
      graphTools.push(toolCall.id);

      return `output:${toolCall.id}`;
    },
    ...options,
  });

  return {
    legacy: { outcome: legacy, tools: legacyTools, modelCalls: legacyModel.seen },
    graph: { outcome: graph, tools: graphTools, modelCalls: graphModel.seen },
  };
};

describe('runToolLoopWithGraph parity with runToolLoop', () => {
  it('returns the model answer when no tool is called', async () => {
    const result = await runBoth([{ content: 'hello', toolCalls: [] }]);

    expect(result.graph).toEqual(result.legacy);
    expect(result.graph.outcome).toEqual({ content: 'hello', ok: true });
  });

  it('runs one tool round and then answers', async () => {
    const result = await runBoth([
      { content: undefined, toolCalls: [call('a')] },
      { content: 'done', toolCalls: [] },
    ]);

    expect(result.graph).toEqual(result.legacy);
    expect(result.graph.tools).toEqual(['a']);
  });

  it('runs several tool calls in order within one reply', async () => {
    const result = await runBoth([
      { content: undefined, toolCalls: [call('first'), call('second'), call('third')] },
      { content: 'done', toolCalls: [] },
    ]);

    expect(result.graph).toEqual(result.legacy);
    expect(result.graph.tools).toEqual(['first', 'second', 'third']);
  });

  it('stops at the round limit with the same reply', async () => {
    const replies = Array.from({ length: 6 }, (_, index) => ({
      content: undefined,
      toolCalls: [call(`round-${index}`)],
    }));
    const result = await runBoth(replies, { maxRounds: 3 });

    expect(result.graph).toEqual(result.legacy);
    expect(result.graph.outcome.ok).toBe(true);
    expect(result.graph.tools).toEqual(result.legacy.tools);
  });

  it('reports a failed model call as not ok, the same way', async () => {
    const result = await runBoth([undefined]);

    expect(result.graph).toEqual(result.legacy);
    expect(result.graph.outcome).toEqual({ content: '', ok: false });
  });

  it('calls the model with the same conversation length each time', async () => {
    const result = await runBoth([
      { content: undefined, toolCalls: [call('a')] },
      { content: undefined, toolCalls: [call('b')] },
      { content: 'done', toolCalls: [] },
    ]);

    expect(result.graph.modelCalls).toEqual(result.legacy.modelCalls);
  });
});

/* eslint-enable @silverhand/fp/no-mutating-methods, @silverhand/fp/no-let, @silverhand/fp/no-mutation */
