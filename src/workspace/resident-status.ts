import type { DurableEvent, WorkspaceState } from './model.js';

export interface ResidentStatusAxis { state: string; observedAt: string | null; source: string; reason: string | null }
export interface ResidentStatusProjection {
  members: {
    participantId: string; generation: number; previousGeneration: boolean;
    connection: ResidentStatusAxis; response: ResidentStatusAxis; tool: ResidentStatusAxis; work: ResidentStatusAxis;
    lastSpeechAt: string | null; lastProgressAt: string | null;
  }[];
  notices: { id: string; eventId: number; roomId: string; at: string; text: string }[];
}

// Read-only, explicit public projection. Neither raw responses, private material,
// commands, account identities nor owner capability reports cross this boundary.
// Notifications are views of journal events, never scheduler inputs or new events.
export function projectResidentStatus(state: WorkspaceState, roomId: string, events: readonly DurableEvent[] = []): ResidentStatusProjection {
  const room = state.resident?.rooms.find(r => r.id === roomId);
  if (!room) return { members: [], notices: [] };
  const focus = state.discussions.find(d => d.id === room.topicLink);
  const axis = (value: string, at: string | null, source: string, reason: string | null = null): ResidentStatusAxis => ({ state: value, observedAt: at, source, reason });
  const members = room.members.map(member => {
    const participant = state.participants.find(p => p.id === member.participantId);
    const connection = state.connections.find(c => c.id === participant?.connectionId);
    const context = room.contexts?.find(c => c.participantId === member.participantId);
    const turn = state.resident!.turns.filter(t => t.roomId === roomId && t.participantId === member.participantId).at(-1);
    const topicContext = focus?.contexts.find(c => c.participantId === member.participantId);
    const job = focus && state.jobs.filter(j => j.discussionId === focus.id && focus.tasks.some(t => t.id === j.taskId && t.participantId === member.participantId)).at(-1);
    const progress = turn && events.filter(e => e.type === 'resident.turn_progress' && data(e).turnId === turn.id).at(-1);
    const observed = turn && events.filter(e => ['resident.turn_prepared', 'resident.turn_dispatched', 'resident.turn_receipt', 'resident.turn_progress', 'resident.turn_finished', 'resident.reconciled'].includes(e.type) && data(e).turnId === turn.id).at(-1);
    const generation = context?.generation ?? 1;
    const previousGeneration = !!turn && (turn.generation !== generation || turn.epoch !== room.epoch || turn.status === 'stale');
    const observation = topicContext?.observation;
    const workAttempt = state.resident!.workAttempts.filter(a => a.roomId === roomId && a.participantId === member.participantId).at(-1);
    const workTask = workAttempt && state.resident!.workItems.find(t => t.id === workAttempt.taskId);
    const activity = job?.activities.at(-1);
    return {
      participantId: member.participantId, generation, previousGeneration,
      connection: axis(participant?.kind === 'fake' ? 'fixture' : connection?.status ?? 'unknown', connection?.lastCheckedAt ?? null, 'connection', connection?.error ?? null),
      response: observation ? axis(observation.response, observation.observedAt, observation.source, observation.reason)
        : axis(turn ? previousGeneration ? 'stale' : turn.status : 'unknown', observed?.at ?? turn?.finishedAt ?? turn?.startedAt ?? null, turn ? 'resident_turn' : 'unobserved', turn?.error ?? member.blockedReason ?? null),
      tool: job ? axis(job.status, activity?.observedAt ?? job.finishedAt ?? job.createdAt, 'codex_job', job.error)
        : observation ? axis(observation.tool, observation.observedAt, observation.source, observation.reason) : axis('unknown', null, 'unobserved'),
      work: workTask ? axis(workTask.status, workAttempt!.finishedAt ?? workTask.updatedAt, 'work_queue', workTask.reason) : observation ? axis(observation.work, observation.observedAt, observation.source, observation.reason) : axis('not_run', null, 'work_queue_pending'),
      lastSpeechAt: state.resident!.messages.filter(m => m.roomId === roomId && m.visibility === 'room_public' && m.authorId === member.participantId).at(-1)?.createdAt ?? null,
      lastProgressAt: observation?.lastProgressAt ?? progress?.at ?? turn?.finishedAt ?? null,
    };
  });
  const notices = new Map<string, ResidentStatusProjection['notices'][number]>();
  for (const event of events) {
    // Allowlist prevents notification -> notification feedback, and excludes
    // heartbeat/delta/message events (ordinary chat is already rendered once).
    if (data(event).roomId !== roomId) continue;
    let text: string | null = null;
    if (event.type === 'resident.room_changed') {
      const labels: Record<string, string> = { on: '상주 대화를 켰습니다.', off: '상주 대화를 껐습니다.', wake: '휴면에서 깨웠습니다.', configure: '진행 한도와 속도를 저장했습니다.' };
      text = labels[String(data(event).action)] ?? null;
    } else if (event.type === 'resident.status_changed') {
      const labels: Record<string, string> = { sleeping: '말할 내용이 없어 휴면합니다.', blocked: '상주 대화에 확인이 필요합니다.', budget_exhausted: '진행 한도에 도달해 새 발언을 멈췄습니다.' };
      text = labels[String(data(event).status)] ?? null;
    } else if (event.type === 'resident.blocked' || event.type === 'resident.recovery_blocked') text = '원래 응답·실행 기록을 확인해 주세요.';
    else if (event.type === 'resident.focus_returned') text = '주제 토론에서 같은 방으로 돌아왔습니다.';
    else if (event.type === 'resident.reconciled') text = '원래 응답의 대조 결과를 기록했습니다.';
    if (text) {
      const id = `resident-status:${event.id}`;
      notices.set(id, { id, eventId: event.id, roomId, at: event.at, text });
    }
  }
  return { members, notices: [...notices.values()] };
}
function data(event: DurableEvent): Record<string, unknown> { return event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data as Record<string, unknown> : {}; }
