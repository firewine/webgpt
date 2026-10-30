export const discoveryUrl = service => service === 'chatgpt' ? 'https://chatgpt.com/c/discovery-fixture' : 'https://muse.ai/';
export function discoveryHtml(service, mode = 'normal') {
  const chat = service === 'chatgpt'; const input = chat ? 'id="prompt-textarea"' : 'data-testid="chat-input"';
  return `<!doctype html><html lang="ko"><head><title>${service} synthetic fixture</title></head><body>
    <div data-testid="${chat ? 'accounts-profile-button' : 'account-name'}">fixture-account · ${service}</div><header><h1>${chat ? 'dot' : 'Muse'} fixture</h1></header>
    ${chat ? '' : '<div data-hatch-link-entry-point=\'{"thread_id":"fixture-thread-a"}\'>Current side chat</div>'}
    <div ${chat ? 'data-message-author-role' : 'data-message-role'}="user">Unrelated earlier message</div>
    <div ${chat ? 'data-message-author-role' : 'data-message-role'}="assistant">Earlier original response</div>
    <${mode === 'old_dom' ? 'section' : 'form'}><textarea ${mode === 'old_dom' ? 'id="legacy-composer"' : input}>${mode === 'draft' ? 'KEEP OWNER DRAFT 개인 원문' : ''}</textarea>
    <button type="button" data-testid="send-button" disabled>Send</button></${mode === 'old_dom' ? 'section' : 'form'}>
    ${mode === 'ambiguous' ? `<textarea ${chat ? 'id="prompt-textarea"' : 'data-testid="chat-input"'}></textarea>` : ''}
    <button type="button" ${chat ? 'data-testid="stop-button"' : 'aria-label="Stop generating"'} ${mode === 'busy' ? '' : 'hidden'}>Stop</button>
    <script>window.fixtureSends=0;document.querySelector('[data-testid="send-button"]').onclick=()=>{window.fixtureSends++};</script>
    </body></html>`;
}
export function observation(preset, service) {
  return { url: discoveryUrl(service), ambiguous: false, supported: true, threadAmbiguous: false, threadValue: service === 'chatgpt' ? 'discovery-fixture' : 'fixture-thread-a', identityText: 'fixture-account · ' + service,
    agentLabel: service === 'chatgpt' ? 'dot fixture' : 'Muse fixture', draftPresent: false, busy: false,
    selectors: { identitySelector: preset.identity[0], inputSelector: preset.input[0], sendSelector: preset.send[0], readySelector: preset.ready.at(-1) } };
}
export function bridgeWithObservation(preset, service) {
  const fixture = { view: observation(preset, service), pageId: 7, profile: null, toolCalls: [], probes: [], inspectValue: { url: discoveryUrl(service), identity: true, thread: true, ready: true, busy: false, draft: '' } };
  fixture.bridge = {
    tool: async (name, args) => { fixture.toolCalls.push({ name, args }); return { structuredContent: { result: name === 'list_pages' ? { pages: [{ id: fixture.pageId, title: 'Fixture', url: discoveryUrl(service), ...(fixture.profile ? { isolatedContext: fixture.profile } : {}) }] } : structuredClone(fixture.view) } }; },
    probe: async binding => { fixture.probes.push(binding); }, inspect: async () => structuredClone(fixture.inspectValue),
  }; return fixture;
}
