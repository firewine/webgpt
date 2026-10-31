export function anthropicStream(text, options = {}) {
  const parts = options.parts ?? [text]; const events = [
    { type: 'message_start', message: { id: 'msg_fixture', role: 'assistant', content: [], usage: options.initialUsage ?? { input_tokens: 12, cache_creation_input_tokens: 3, cache_read_input_tokens: 8, output_tokens: 1 } } },
    { type: 'ping' }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...parts.map(text => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: {}, usage: { output_tokens: 20 } },
    { type: 'message_delta', delta: { stop_reason: options.reason ?? 'end_turn' }, ...(options.usage === false ? {} : { usage: options.usage ?? { output_tokens: 34 } }) },
    ...(options.end === false ? [] : [{ type: 'message_stop' }]),
  ];
  if (options.usage === false) events.splice(events.findIndex(e => e.type === 'message_delta'), 1);
  return new Response((options.events ?? events).map(e => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}
export function deepseekStream(text) {
  return new Response([
    { id: 'ds_fixture', choices: [{ index: 0, delta: { reasoning_content: 'private reasoning is not a final answer' }, finish_reason: null }] },
    { id: 'ds_fixture', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 11, completion_tokens: 22 } }, '[DONE]',
  ].map(e => 'data: ' + (typeof e === 'string' ? e : JSON.stringify(e)) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}
export const coralModel = { id: 'deepseek-v4.1-flash-fast', supports_reasoning: true, reasoning: { supported_efforts: ['low', 'high', 'max'], default_effort: 'none', mandatory: false, disable: { reasoning_effort: 'none' } } };
