(() => {
  const scenarios = SCENARIOS;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const time = value => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const duration = block => Math.round((Date.parse(block.end) - Date.parse(block.start)) / 60000);
  const label = block => block.title || ({ focus: 'Focus', break: 'Break', meeting: 'Meeting', away: 'Away', untracked: 'Untracked' }[block.kind] || block.kind);
  const $ = selector => document.querySelector(selector);
  let selected = Math.max(0, Math.min(scenarios.length - 1, Number(location.hash.slice(1)) || 0));

  function row(block) {
    const source = block.kind === 'untracked' ? 'No record' : block.actual ? 'Actual' : block.active ? 'Running' : 'Forecast';
    return `<div class="review-row ${escape(block.kind)} ${block.actual ? 'actual' : ''}">
      <span class="review-swatch"></span><span class="review-row-time">${escape(time(block.start))}–${escape(time(block.end))}</span>
      <span class="review-row-name">${escape(label(block))}${block.kind === 'break' && block.actual && block.confirmed ? ' <small>confirmed</small>' : ''}</span>
      <span class="review-row-length">${duration(block)}m</span><span class="review-source">${source}</span></div>`;
  }

  function pastRows(plan, actual, running, nowISO) {
    const present = Date.parse(nowISO);
    const cutoff = Math.min(present, ...running.map(block => Date.parse(block.start)));
    let cursor = Date.parse(plan.start);
    const rows = [];
    for (const block of [...actual].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
      const from = Date.parse(block.start), until = Date.parse(block.end);
      if (from > cursor && cursor < cutoff) rows.push({ kind: 'untracked', start: new Date(cursor).toISOString(), end: new Date(Math.min(from, cutoff)).toISOString() });
      rows.push({ ...block, actual: true });
      cursor = Math.max(cursor, until);
    }
    if (cursor < cutoff) rows.push({ kind: 'untracked', start: new Date(cursor).toISOString(), end: new Date(cutoff).toISOString() });
    return [...rows, ...running];
  }

  function navigation() {
    const query = $('#scenario-search').value.trim().toLowerCase();
    $('#scenario-list').innerHTML = scenarios.map((scenario, index) => {
      const name = scenario.input.name || `Scenario ${index + 1}`;
      const text = `${name} ${scenario.input.now} ${JSON.stringify(scenario.input)}`.toLowerCase();
      if (query && !text.includes(query)) return '';
      return `<button class="review-nav-item ${index === selected ? 'selected' : ''}" type="button" data-index="${index}" ${index === selected ? 'aria-current="true"' : ''}>
        <span class="review-nav-number">${String(index + 1).padStart(2, '0')}</span><span>${escape(name)}</span></button>`;
    }).join('');
    $('#scenario-count').textContent = scenarios.length;
  }

  function render() {
    const scenario = scenarios[selected], { input, plan, actual, blocks, nowISO } = scenario;
    const upcoming = blocks.filter(block => !block.actual && Date.parse(block.end) > Date.parse(nowISO));
    const running = blocks.filter(block => block.active);
    $('#scenario-title').textContent = input.name || `Scenario ${selected + 1}`;
    $('#scenario-subtitle').textContent = `As of ${time(nowISO)} · ${new Date(nowISO).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
    $('#scenario-position').textContent = `${selected + 1} / ${scenarios.length}`;
    $('#previous').disabled = selected === 0;
    $('#next').disabled = selected === scenarios.length - 1;
    $('#scenario-summary').innerHTML = [
      `<span><b>Day</b>${escape(time(plan.start))}–${escape(time(plan.end))}</span>`,
      `<span><b>Rhythm</b>${plan.focusMinutes}m focus / ${plan.breakMinutes}m break</span>`,
      `<span><b>Meetings</b>${plan.meetings.length}</span>`,
      `<span><b>Recommended now</b>${escape(upcoming.length ? label(upcoming[0]) : 'Day complete')}</span>`,
    ].join('');
    $('#meeting-plan').innerHTML = plan.meetings.length ? `<div class="eyebrow">Meetings in this plan</div><div class="review-meeting-list">${plan.meetings.map(meeting =>
      `<span class="review-meeting"><b>${escape(time(meeting.start))}–${escape(time(meeting.end))}</b>${escape(meeting.title)}</span>`).join('')}</div>${input.note ? `<p>${escape(input.note)}</p>` : ''}` : '';
    $('#day-path').innerHTML = FocusIslandsDayPath.dayPath({ plan, forecastTimeline: blocks, currentWallTimeISO: nowISO }, { showEdit: false });
    const past = pastRows(plan, actual, running, nowISO);
    $('#history').innerHTML = past.length ? past.map(row).join('') : '<p class="review-empty">No recorded activity yet.</p>';
    $('#upcoming').innerHTML = upcoming.length ? upcoming.map(row).join('') : '<p class="review-empty">No blocks remain.</p>';
    $('#decisions').innerHTML = input.decisions?.length ? input.decisions.map(([kind, at, minutes]) =>
      `<div class="review-decision"><time>${escape(at)}</time><span>${escape(kind === 'breakSnoozed' ? `Snoozed break ${minutes || 5} minutes` : kind === 'breakSkipped' ? 'Skipped break' : kind)}</span></div>`).join('') : '<p class="review-empty">No deliberate changes.</p>';
    $('#scenario-json').textContent = JSON.stringify(input, null, 2);
    navigation();
  }

  function select(index) {
    selected = Math.max(0, Math.min(scenarios.length - 1, index));
    history.replaceState(null, '', `#${selected}`);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('#scenario-list').addEventListener('click', event => {
    const button = event.target.closest('[data-index]');
    if (button) select(Number(button.dataset.index));
  });
  $('#scenario-search').addEventListener('input', navigation);
  $('#previous').addEventListener('click', () => select(selected - 1));
  $('#next').addEventListener('click', () => select(selected + 1));
  document.addEventListener('keydown', event => {
    if (event.target.matches('input, textarea')) return;
    if (event.key === 'ArrowLeft') select(selected - 1);
    if (event.key === 'ArrowRight') select(selected + 1);
  });
  render();
})();
