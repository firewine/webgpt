import type { HealthResponse, Participant, Turn } from '../core/types.js';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element: ${id}`);
  return node as T;
}

const form = element<HTMLFormElement>('message-form');
const select = element<HTMLSelectElement>('participant');
const input = element<HTMLTextAreaElement>('message');
const send = element<HTMLButtonElement>('send');
const reconnect = element<HTMLButtonElement>('reconnect');
const error = element('error');
const status = element('turn-status');
const connection = element('connection-status');
const transcript = element<HTMLOListElement>('transcript');
let participants: Participant[] = [];
let ready = false;
let busy = false;

function refreshControls(): void {
  select.disabled = !ready || busy;
  input.disabled = !ready || busy;
  send.disabled = !ready || busy || !input.value.trim();
  reconnect.disabled = busy;
  element('character-count').textContent = `${input.value.length.toLocaleString('ko-KR')} / 2,000`;
  const participant = participants.find((p) => p.id === select.value);
  element('model-name').textContent = participant?.modelId ?? '';
}

function showError(message: string): void {
  error.textContent = message;
  error.hidden = false;
}

async function initialize(): Promise<void> {
  ready = false;
  error.hidden = true;
  connection.textContent = '연결 확인 중…';
  connection.dataset.ready = 'false';
  status.textContent = '준비 중';
  refreshControls();
  reconnect.disabled = true;
  try {
    const responses = await Promise.all(['/health', '/api/participants'].map((url) =>
      fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' }),
    ));
    const healthResponse = responses[0];
    const participantResponse = responses[1];
    if (!healthResponse?.ok || !participantResponse?.ok) throw new Error('Connection failed');
    const health = await healthResponse.json() as HealthResponse;
    const data = await participantResponse.json() as { participants: Participant[] };
    if (health.status !== 'ok' || health.mode !== 'fake' || !data.participants.length) throw new Error('Unexpected mode');
    participants = data.participants;
    const previous = select.value;
    select.replaceChildren(...participants.map((p) => new Option(`${p.label} · 모의`, p.id)));
    if (participants.some((p) => p.id === previous)) select.value = previous;
    ready = true;
    connection.textContent = '연결됨 · 모의 응답 준비';
    connection.dataset.ready = 'true';
    status.textContent = '대기';
  } catch {
    connection.textContent = '서버 연결 확인 필요';
    status.textContent = '연결 오류';
    showError('서버에 연결하지 못했습니다. 서버 실행 상태를 확인하고 연결을 다시 확인하세요.');
  } finally {
    refreshControls();
  }
}

function appendTurn(participant: Participant, text: string): HTMLLIElement {
  element('empty-state').hidden = true;
  const item = document.createElement('li');
  item.className = 'turn';
  const title = document.createElement('div');
  title.className = 'turn-title';
  const name = document.createElement('span');
  name.textContent = participant.label;
  const state = document.createElement('span');
  state.className = 'tag';
  state.textContent = '실행 중';
  title.append(name, state);
  item.append(title, messageNode('나', text, 'user-message'));
  transcript.append(item);
  while (transcript.children.length > 20) transcript.firstElementChild?.remove();
  scrollToLatest();
  return item;
}

function scrollToLatest(): void {
  const viewport = transcript.parentElement;
  if (viewport) viewport.scrollTop = viewport.scrollHeight;
}

function messageNode(label: string, text: string, className: string): HTMLDivElement {
  const message = document.createElement('div');
  message.className = `message ${className}`;
  const name = document.createElement('span');
  name.className = 'message-label';
  name.textContent = label;
  // Provider/user text never becomes HTML, including future model output.
  message.append(name, document.createTextNode(text));
  return message;
}

async function submit(): Promise<void> {
  if (!ready || busy || !input.value.trim()) return;
  const participant = participants.find((p) => p.id === select.value);
  if (!participant) return;
  const text = input.value;
  busy = true;
  error.hidden = true;
  status.textContent = '실행 중';
  refreshControls();
  const item = appendTurn(participant, text);
  const state = item.querySelector('.tag')!;
  try {
    const response = await fetch('/api/turns', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: participant.id, input: text }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json() as { turn?: Turn; error?: { message: string } };
    if (response.ok && data.turn?.status === 'completed' && data.turn.participantId === participant.id) {
      item.append(messageNode('모의 응답', data.turn.output, 'provider-message'));
      const meta = document.createElement('p');
      meta.className = 'turn-meta';
      meta.textContent = `요청 ${data.turn.id}`;
      item.append(meta);
      state.textContent = '완료';
      status.textContent = '완료';
      input.value = '';
    } else {
      state.textContent = '실패';
      status.textContent = '실패';
      const message = data.turn?.error?.message ?? data.error?.message ?? '응답을 완료하지 못했습니다.';
      item.append(messageNode('실행 결과', message, 'provider-message'));
      showError(message);
    }
  } catch {
    state.textContent = '응답 미확인';
    status.textContent = '응답 미확인';
    const message = '응답을 확인하지 못했습니다. 자동 재전송하지 않았습니다. 연결 상태를 확인하세요.';
    item.append(messageNode('실행 결과', message, 'provider-message'));
    showError(message);
  } finally {
    busy = false;
    refreshControls();
    scrollToLatest();
    input.focus();
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); void submit(); });
input.addEventListener('input', refreshControls);
select.addEventListener('change', refreshControls);
reconnect.addEventListener('click', () => { void initialize(); });
void initialize();
