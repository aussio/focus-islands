const { ms, iso, sameDay } = require('./planning');
const minutes = seconds => Math.max(1, Math.ceil(seconds / 60));
const time = value => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const label = { focus: 'Focus time', break: 'A break', meeting: 'A meeting', away: 'Away time' };
const guidance = (situation, title, detail, action = null, breakAction = null) => ({ situation, title, detail, action, breakAction });
function proposedBreak(plan, blocks, now) {
  if (!plan || now < ms(plan.start) || now >= ms(plan.end) || blocks.some(block => block.kind === 'meeting' && ms(block.start) <= now && now < ms(block.end))) return null;
  const block = blocks.find(item => ms(item.start) <= now && now < ms(item.end));
  const meeting = blocks.find(item => item.kind === 'meeting' && ms(item.start) > now);
  let end = Math.min(ms(plan.end), now + Math.max(1, plan.breakMinutes) * 60000);
  if (block?.kind === 'break') end = Math.min(end, ms(block.end));
  if (meeting && ms(meeting.start) < end) return null;
  return end - now >= 60000 ? { type: 'rest', until: iso(end) } : null;
}
function nextFocusDescription(blocks, date) {
  const next = blocks.find(item => ms(item.end) > date);
  if (!next) return `Your planned day ends at ${time(date)}.`;
  if (next.kind === 'focus') return `Then ${minutes((ms(next.end) - Math.max(date, ms(next.start))) / 1000)} minutes of focus until ${time(next.end)}.`;
  if (ms(next.start) < date) return `${next.title || label[next.kind]} is scheduled until ${time(next.end)}.`;
  return `${next.title || label[next.kind]} is next at ${time(next.start)}.`;
}
function scheduled(plan, blocks, now) {
  if (!plan) return guidance('noPlan', 'Ready when you are', 'Start a focus session or create a plan for today.', { type: 'editPlan' });
  if (now < ms(plan.start)) return guidance('beforeDay', `Your day starts at ${time(plan.start)}`, 'Your schedule is ready. Start when your day begins, or adjust your plan.', { type: 'editPlan' });
  if (now >= ms(plan.end)) return guidance('afterDay', "You've reached the end of your plan", 'Adjust your finish time to extend today’s plan.', { type: 'editPlan' });
  const block = blocks.find(item => ms(item.start) <= now && now < ms(item.end));
  if (block?.kind === 'meeting') return guidance('working', block.title || 'Working', `Meeting until ${time(block.end)}.`, { type: 'working', until: block.end });
  if (!block) return guidance('pause', 'No activity scheduled now', 'Check your plan for what comes next.', { type: 'editPlan' });
  const focusEnd = Math.min(ms(block.end), now + plan.focusMinutes * 60000, ms(plan.end));
  if (block.kind === 'focus' && focusEnd - now >= 60000) {
    const next = blocks.find(item => ms(item.start) >= ms(block.end));
    const detail = next ? `${label[next.kind]} at ${time(next.start)}. This focus session fits the time left in your plan.` : `Your planned day ends at ${time(plan.end)}. This session fits the time you have left.`;
    return guidance('focus', `Focus for ${minutes((focusEnd - now) / 1000)} minutes`, detail, { type: 'focus', until: iso(focusEnd) });
  }
  if (block.kind === 'break') return guidance('rest', 'Time for a break', nextFocusDescription(blocks, ms(block.end)), proposedBreak(plan, blocks, now));
  return guidance('rest', 'Time for a break', nextFocusDescription(blocks, ms(block.end)), proposedBreak(plan, blocks, now));
}
function todayGuidance(plan, blocks, actual, nowDate, timer) {
  const now = ms(nowDate);
  if (plan && !sameDay(plan.day, now)) plan = null;
  const schedule = scheduled(plan, blocks, now);
  if (timer.phase === 'idle') return schedule;
  const isFocus = timer.phase === 'focus';
  if (isFocus && timer.isDue && schedule.situation === 'working') return schedule;
  const title = timer.isSleeping ? (isFocus ? 'Focus is paused' : 'Your break is paused') : timer.isDue ? (isFocus ? 'Time for a real break' : 'Break complete') : (isFocus ? 'Focus in progress' : 'Break in progress');
  const remaining = Math.max(0, timer.targetSeconds - timer.elapsedSeconds) * 1000;
  const boundary = blocks.find(item => ms(item.end) > now);
  let context = schedule.detail;
  const snoozedFocus = isFocus && timer.isDue && blocks.some(item => item.active && item.kind === 'focus' && ms(item.end) > now);
  if (snoozedFocus) context = `Your break is moved to ${time(blocks.find(item => item.active && item.kind === 'focus' && ms(item.end) > now).end)}. You can start it sooner.`;
  else if (isFocus && timer.isDue) context = 'Your focus block is complete. Start a break, snooze, or skip.';
  else if (plan && isFocus && now >= ms(plan.start) && now < ms(plan.end)) {
    const meeting = blocks.find(item => item.kind === 'meeting' && ms(item.start) > now && ms(item.start) < now + remaining);
    if (meeting) context = `${meeting.title || 'Your meeting'} starts in ${minutes((ms(meeting.start) - now) / 1000)} minutes at ${time(meeting.start)}. Your focus timer will not stop automatically.`;
    else if (boundary) context = `${boundary.title || label[boundary.kind]} until ${time(boundary.end)}. Your running timer keeps the length you started.`;
  } else if (plan && !isFocus && now >= ms(plan.start) && now < ms(plan.end)) context = nextFocusDescription(blocks, now + remaining);
  return guidance(isFocus ? 'runningFocus' : 'runningBreak', snoozedFocus ? 'Focus extended' : title, context, null, isFocus ? proposedBreak(plan, blocks, now) : null);
}
module.exports = { todayGuidance };
