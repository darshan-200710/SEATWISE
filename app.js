const $ = (id) => document.getElementById(id);
const state = { rooms: [], plan: [], activeRoom: '' };
const departments = ['CE', 'CSE', 'ECS', 'MECH'];

function addRoom(room = { number: '', rows: 2, benches: 3, perBench: 2 }) {
  if (state.rooms.length >= 100) return notify('A maximum of 100 classrooms is supported.');
  state.rooms.push({ ...room }); renderRooms();
}
function renderRooms() {
  $('roomRows').replaceChildren();
  state.rooms.forEach((room, i) => {
    const row = document.createElement('div'); row.className = 'room-row';
    const fields = [['number', 'text'], ['rows', 'number'], ['benches', 'number'], ['perBench', 'number']];
    fields.forEach(([key, type]) => {
      const input = document.createElement('input'); input.type = type; input.value = room[key];
      input.setAttribute('aria-label', `${key} for classroom ${i + 1}`);
      if (type === 'number') { input.min = key === 'perBench' ? '1' : '1'; input.max = key === 'perBench' ? '2' : '100'; }
      input.addEventListener('input', () => { room[key] = type === 'number' ? Number(input.value) : input.value; updateStats(); });
      row.append(input);
    });
    const remove = document.createElement('button'); remove.className = 'icon-btn'; remove.textContent = '×'; remove.title = 'Remove classroom'; remove.onclick = () => { state.rooms.splice(i, 1); renderRooms(); }; row.append(remove); $('roomRows').append(row);
  });
  $('roomCountTag').textContent = `${state.rooms.length} room${state.rooms.length === 1 ? '' : 's'}`; updateStats();
}
function parseRoster() {
  return $('roster').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
    const parts = line.split(/[\s,;]+/); return { roll: parts[0] || '', dept: (parts[1] || '').toUpperCase() };
  });
}
function capacity() { return state.rooms.reduce((sum, r) => sum + (+r.rows || 0) * (+r.benches || 0) * (+r.perBench || 0), 0); }
function updateStats() {
  const students = parseRoster(), cap = capacity(); $('roomCount').textContent = String(state.rooms.length).padStart(2, '0'); $('studentCount').textContent = String(students.length).padStart(2, '0');
  $('capacity').textContent = cap; $('capacityLine').innerHTML = `${cap} <small>seats</small>`; $('rosterTag').textContent = `${students.length} students`; $('coverage').textContent = cap ? `${Math.min(100, Math.round(students.length / cap * 100))}%` : '—';
  $('rosterState').textContent = students.length ? `${students.length} entries detected` : 'Ready for input'; $('actionNote').textContent = students.length && state.rooms.length ? `${students.length} students · ${cap} seats available` : 'Add rooms and students to begin.';
}
function notify(message, success = false) { const box = $('notice'); box.textContent = message; box.className = `notice${success ? ' success' : ''}`; }
function validate(students) {
  if (!state.rooms.length) return 'Add at least one classroom.';
  if (!students.length) return 'Add at least one student to the roster.';
  if (capacity() > 4000 || students.length > 4000) return 'The limit is 4,000 seats and students.';
  const names = new Set();
  for (const [i, r] of state.rooms.entries()) {
    const name = r.number.trim();
    if (!name || /^(=|\+|-|@)|[,\t\r\n]/.test(name)) return `Classroom ${i + 1} has an invalid name.`;
    if (names.has(name)) return `Classroom name '${name}' is duplicated.`; names.add(name);
    if (!Number.isInteger(+r.rows) || r.rows < 1 || r.rows > 100 || !Number.isInteger(+r.benches) || r.benches < 1 || r.benches > 100 || ![1, 2].includes(+r.perBench)) return `Check the layout values for classroom '${name}'.`;
  }
  const rolls = new Set();
  for (const s of students) {
    if (!s.roll || /^(=|\+|-|@)|[,\t\r\n]/.test(s.roll) || !departments.includes(s.dept)) return `Invalid roster entry '${s.roll}'. Use a roll number and CE, CSE, ECS, or MECH.`;
    if (rolls.has(s.roll)) return `Duplicate roll number '${s.roll}'.`; rolls.add(s.roll);
  }
  if (students.length > capacity()) return `Insufficient capacity: ${students.length} students but only ${capacity()} seats.`;
  return '';
}
function generate() {
  const students = parseRoster(), error = validate(students); if (error) return notify(error);
  const benches = [];
  state.rooms.forEach((r, roomIndex) => { for (let row = 1; row <= r.rows; row++) for (let bench = 1; bench <= r.benches; bench++) benches.push({ room: r.number.trim(), roomIndex, row, bench, seats: +r.perBench }); });
  const policy = +$('policy').value;
  if (policy === 1 || policy === 3) {
    const counts = students.reduce((m, s) => (m[s.dept] = (m[s.dept] || 0) + 1, m), {});
    if (policy === 1 && Object.values(counts).some(n => n % 2 && students.length - Object.values(counts).filter(v => v % 2).length < students.length)) {
      // Strict pairing is impossible when any department has an odd count and all seats are paired.
      if (benches.filter(b => b.seats === 2).length * 2 === students.length) return notify('Strict same-department pairing is impossible with the current department counts.');
    }
  }
  const remaining = students.slice(), plan = [];
  for (const b of benches) {
    if (!remaining.length) break;
    let first = remaining.shift();
    plan.push({ ...first, room: b.room, row: b.row, bench: b.bench, seat: 1 });
    if (b.seats < 2 || !remaining.length) continue;
    let index = 0;
    if (policy === 1 || policy === 3) { const found = remaining.findIndex(s => s.dept === first.dept); if (found >= 0) index = found; else if (policy === 1) return notify('Strict same-department pairing cannot be satisfied.'); }
    if (policy === 2 || policy === 4) { const found = remaining.findIndex(s => s.dept !== first.dept); if (found >= 0) index = found; else if (policy === 2) return notify('Strict different-department pairing cannot be satisfied.'); }
    const second = remaining.splice(index, 1)[0]; plan.push({ ...second, room: b.room, row: b.row, bench: b.bench, seat: 2 });
  }
  if (remaining.length) return notify('Not enough configured seats for the roster.');
  state.plan = plan; state.activeRoom = ''; renderPlan(); notify(`Seating plan generated: ${plan.length} students assigned across ${new Set(plan.map(p => p.room)).size} classroom(s).`, true);
  $('resultsSubtitle').textContent = `${plan.length} students assigned · ${new Set(plan.map(p => p.room)).size} classrooms`; $('seating-plan').classList.remove('hidden'); $('pageName').textContent = 'Seating plans'; $('seating-plan').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderPlan() {
  const q = $('search').value.trim().toLowerCase(), rooms = [...new Set(state.plan.map(p => p.room))];
  $('roomTabs').replaceChildren(); const all = document.createElement('button'); all.textContent = `All classrooms ${state.plan.length}`; all.className = state.activeRoom ? '' : 'selected'; all.onclick = () => { state.activeRoom = ''; renderPlan(); }; $('roomTabs').append(all);
  rooms.forEach(room => { const b = document.createElement('button'); b.innerHTML = `${room} <span>${state.plan.filter(p => p.room === room).length}</span>`; b.className = state.activeRoom === room ? 'selected' : ''; b.onclick = () => { state.activeRoom = room; renderPlan(); }; $('roomTabs').append(b); });
  const rows = state.plan.filter(p => (!state.activeRoom || p.room === state.activeRoom) && [p.roll,p.dept,p.room].some(v => v.toLowerCase().includes(q)));
  $('planRows').replaceChildren(); rows.forEach(p => { const tr = document.createElement('tr'); [p.roll,p.dept,p.room,`Row ${p.row}`,`Bench ${p.bench} · Seat ${p.seat}`,'✓ Assigned'].forEach((text,i) => { const td = document.createElement('td'); td.textContent = text; if (i === 0) { const b = document.createElement('b'); b.textContent=text; td.replaceChildren(b); } if (i === 1) { td.textContent=''; const tag=document.createElement('span');tag.className='dept-tag';tag.textContent=text;td.append(tag); } if(i===5) td.className='assigned'; tr.append(td); }); $('planRows').append(tr); });
}
function csvField(value) { let s = String(value); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replaceAll('"','""')}"` : s; }
function exportCsv() { const data = ['roll,department,classroom,row,bench,seat', ...state.plan.map(p => [p.roll,p.dept,p.room,p.row,p.bench,p.seat].map(csvField).join(','))].join('\n'); const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([data],{type:'text/csv'}));link.download='exam-seating-plan.csv';link.click();URL.revokeObjectURL(link.href); }

$('addRoom').onclick = () => addRoom(); $('roster').addEventListener('input', updateStats); $('generate').onclick = generate; $('search').addEventListener('input', renderPlan); $('export').onclick = exportCsv;
$('demo').onclick = () => { state.rooms = [{number:'R101',rows:2,benches:2,perBench:2},{number:'R102',rows:2,benches:1,perBench:1}]; $('roster').value='24001, CSE\n24002, CSE\n24003, CE\n24004, CE\n24005, ECS\n24006, ECS\n24007, MECH\n24008, MECH'; state.plan=[]; $('seating-plan').classList.add('hidden'); renderRooms(); notify('Sample demo data loaded. Edit classrooms or generate a plan.', true); };
$('clear').onclick = () => { state.rooms=[];state.plan=[];$('roster').value='';$('seating-plan').classList.add('hidden');renderRooms();$('notice').classList.add('hidden'); };
$('helpBtn').onclick=()=>$('dialog').showModal();$('closeDialog').onclick=()=>$('dialog').close();$('gotIt').onclick=()=>$('dialog').close();$('today').textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
$('term').onclick=()=>{const terms=['Semester 1','Semester 2','Supplementary'];const current=$('term').querySelector('span').textContent;$('term').querySelector('span').textContent=terms[(terms.indexOf(current)+1)%terms.length];};
document.querySelectorAll('.nav').forEach(a=>a.addEventListener('click',()=>{$('pageName').textContent=a.textContent.trim();}));document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('search').focus();}});
addRoom({number:'R101',rows:2,benches:3,perBench:2});
