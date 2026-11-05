import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Armchair,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  DoorOpen,
  FileSpreadsheet,
  GraduationCap,
  LayoutDashboard,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Users,
} from 'lucide-react';
import './style.css';
import {
  VALID_DEPTS,
  MAX_SEATS,
  MAX_ROOMS,
  MAX_STUDENTS,
  exportToCSV,
  parseRoster,
  calculateCapacity,
  validateInputs,
  filterPlan,
  assertPlanInvariants,
} from './utils.js';

const DEMO_ROOMS = [
  { number: 'R101', rows: 2, benches: 2, perBench: 2 },
  { number: 'R102', rows: 2, benches: 1, perBench: 1 },
];

const DEMO_ROLLS = `24001, CSE
24002, CSE
24003, CE
24004, CE
24005, ECS
24006, ECS
24007, MECH
24008, MECH`;

function App() {
  const [rooms, setRooms] = useState([]);
  const [rolls, setRolls] = useState('');
  const [plan, setPlan] = useState([]);
  const [planStale, setPlanStale] = useState(false);
  const [activeRoom, setActiveRoom] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState(''); // 'success' | 'error' | 'info'
  const [page, setPage] = useState('Overview');
  const [query, setQuery] = useState('');
  const [showPrefs, setShowPrefs] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [term, setTerm] = useState('Semester 1');
  const [examName, setExamName] = useState('Semester 1 · 2026');
  const [searchOpen, setSearchOpen] = useState(false);
  const [departmentPolicy, setDepartmentPolicy] = useState('0'); // '0'=none, '1'=same, '2'=diff
  const [allowFallback, setAllowFallback] = useState(false);
  const searchRef = useRef(null);

  /** Parse roster */
  const students = useMemo(() => parseRoster(rolls), [rolls]);

  /** Total room capacity */
  const capacity = useMemo(() => calculateCapacity(rooms), [rooms]);

  /** Validation errors */
  const validationErrors = useMemo(
    () => validateInputs({ rooms, students, capacity }),
    [rooms, students, capacity]
  );

  const canGenerate = validationErrors.length === 0 && rooms.length > 0 && students.length > 0;

  const markStale = () => {
    if (plan.length > 0) setPlanStale(true);
  };

  const goTo = (name, id) => {
    setPage(name);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (e.key === 'Escape') {
        setShowPrefs(false);
        setShowHelp(false);
        setShowTerms(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const updateRoom = (index, key, value) => {
    setRooms(rooms.map((r, j) => (index === j ? { ...r, [key]: value } : r)));
    markStale();
  };

  const loadDemoData = () => {
    setRooms(DEMO_ROOMS);
    setRolls(DEMO_ROLLS);
    setPlan([]);
    setPlanStale(false);
    setNotice('Sample demo data loaded. You can edit classrooms or click Generate.');
    setNoticeType('info');
  };

  const clearWorkspace = () => {
    setRooms([]);
    setRolls('');
    setPlan([]);
    setPlanStale(false);
    setNotice('Workspace cleared.');
    setNoticeType('info');
  };

  /** Compute effective policy number (0..4) sent to backend */
  const effectivePolicy = useMemo(() => {
    if (departmentPolicy === '0') return '0';
    if (departmentPolicy === '1') return allowFallback ? '3' : '1';
    if (departmentPolicy === '2') return allowFallback ? '4' : '2';
    return '0';
  }, [departmentPolicy, allowFallback]);

  async function generate() {
    if (!canGenerate) {
      setNotice(validationErrors[0] || 'Please fix errors before generating.');
      setNoticeType('error');
      return;
    }

    const body = [
      String(rooms.length),
      ...rooms.map(
        (r) =>
          `${r.number.trim()} ${Number(r.rows)} ${Number(r.benches)} ${Number(r.perBench)}`
      ),
      `${students.length} ${effectivePolicy}`,
      ...students.map((s) => `${s.roll} ${s.dept}`),
    ].join('\n');

    setBusy(true);
    setNotice('');
    setNoticeType('');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch('/api/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.text();
      if (!res.ok) {
        throw new Error(data);
      }

      const lines = data.trim().split('\n');
      if (lines.length < 2) {
        throw new Error('Allocator returned empty seating plan.');
      }

      const parsed = lines.slice(1).map((line) => {
        const [roll, dept, room, row, bench, seat] = line.split(',');
        return { roll, dept, room, row, bench, seat };
      });

      // Assert all allocation invariants on client side as an extra safeguard
      assertPlanInvariants(parsed, students, rooms);

      setPlan(parsed);
      setPlanStale(false);
      setActiveRoom('');
      setNotice(
        `Seating plan generated successfully: ${parsed.length} students allocated across ${
          new Set(parsed.map((p) => p.room)).size
        } classroom(s).`
      );
      setNoticeType('success');
      setPage('Seating plans');
      setTimeout(() => {
        document.getElementById('seating-plan')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (e) {
      if (e.name === 'AbortError') {
        setNotice('Request timed out. The backend server did not respond in time.');
      } else if (e instanceof TypeError) {
        setNotice(
          'Cannot connect to the Rust backend API. Ensure it is running (`cd backend && cargo run`) on port 8080.'
        );
      } else {
        setNotice(e.message);
      }
      setNoticeType('error');
    } finally {
      setBusy(false);
    }
  }

  const downloadCSV = () => {
    const csvContent = exportToCSV(plan);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exam-seating-plan-${term.toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredPlan = useMemo(
    () => filterPlan(plan, activeRoom, query),
    [plan, activeRoom, query]
  );

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <div className="brandmark">
            <Armchair size={21} aria-hidden="true" />
          </div>
          <span>seatwise</span>
          <span className="brandtag">ADMIN</span>
        </div>
        <div className="side-label">WORKSPACE</div>
        <button
          onClick={() => goTo('Overview', 'top')}
          className={`nav ${page === 'Overview' ? 'active' : ''}`}
        >
          <LayoutDashboard size={17} aria-hidden="true" /> Overview
        </button>
        <button
          onClick={() => goTo('Classrooms', 'classrooms')}
          className={`nav ${page === 'Classrooms' ? 'active' : ''}`}
        >
          <DoorOpen size={17} aria-hidden="true" /> Classrooms
        </button>
        <button
          onClick={() => goTo('Students', 'students')}
          className={`nav ${page === 'Students' ? 'active' : ''}`}
        >
          <Users size={17} aria-hidden="true" /> Students
        </button>
        <button
          onClick={() => goTo('Seating plans', plan.length ? 'seating-plan' : 'actions')}
          className={`nav ${page === 'Seating plans' ? 'active' : ''}`}
        >
          <FileSpreadsheet size={17} aria-hidden="true" /> Seating plans
        </button>

        <div className="side-bottom">
          <button className="help" onClick={() => setShowHelp(true)}>
            <CircleHelp size={17} aria-hidden="true" />
            <span>
              Need a hand?<small>Read the quick guide</small>
            </span>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
          <div className="profile">
            <div className="avatar">AD</div>
            <div>
              <b>Administrator</b>
              <small>Exam office</small>
            </div>
            <ChevronDown size={15} aria-hidden="true" />
          </div>
        </div>
      </aside>

      <main className="main" id="top">
        <header>
          <div className="crumb">
            Workspace <span>/</span> <b>{page}</b>
          </div>
          <div className="header-right">
            <label className="search">
              <Search size={16} aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value && plan.length) setPage('Seating plans');
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search roll, dept, or room"
                aria-label="Search roll numbers, departments, and classrooms"
              />
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSearchOpen(false);
                  searchRef.current?.blur();
                }}
                aria-label="Clear search"
              >
                {query ? '×' : '⌘ K'}
              </button>
            </label>
            <span className="date">
              {new Date().toLocaleDateString('en-IN', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
            <div className="avatar small">AD</div>
          </div>
        </header>

        <div className="content">
          <div className="welcome">
            <div>
              <div className="eyebrow">EXAM OPERATIONS · 2026</div>
              <h1>Seating, sorted.</h1>
              <p>Set up your classrooms and student roster. We'll take it from here.</p>
            </div>
            <div className="term-wrap">
              <button
                className="term"
                onClick={() => setShowTerms(!showTerms)}
                aria-expanded={showTerms}
              >
                <span className="dot"></span> {term}{' '}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {showTerms && (
                <div className="term-menu">
                  {['Semester 1', 'Semester 2', 'Supplementary'].map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTerm(t);
                        setExamName(`${t} · 2026`);
                        setShowTerms(false);
                      }}
                    >
                      {t}
                      {term === t && <Check size={14} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quick preset controls */}
          <div className="workspace-bar">
            <div className="workspace-presets">
              <button
                type="button"
                className="quiet"
                onClick={loadDemoData}
                title="Populate sample classrooms and student roster for testing"
              >
                <Plus size={14} aria-hidden="true" /> Load demo data (optional)
              </button>
              {(rooms.length > 0 || rolls.length > 0) && (
                <button
                  type="button"
                  className="quiet"
                  onClick={clearWorkspace}
                  title="Clear all rooms and student roster"
                >
                  <RotateCcw size={14} aria-hidden="true" /> Clear workspace
                </button>
              )}
            </div>
            <button className="quiet" onClick={() => setShowPrefs(true)}>
              <Settings2 size={16} aria-hidden="true" /> Preferences
            </button>
          </div>

          <section className="stats" aria-label="Session statistics">
            <div className="stat">
              <div className="stat-icon">
                <DoorOpen size={17} aria-hidden="true" />
              </div>
              <small>Classrooms</small>
              <strong>{rooms.length.toString().padStart(2, '0')}</strong>
              <span>in this session</span>
            </div>
            <div className="stat">
              <div className="stat-icon green">
                <Armchair size={17} aria-hidden="true" />
              </div>
              <small>Total capacity</small>
              <strong>{capacity}</strong>
              <span>available seats</span>
            </div>
            <div className="stat">
              <div className="stat-icon blue">
                <GraduationCap size={18} aria-hidden="true" />
              </div>
              <small>Students</small>
              <strong>{students.length.toString().padStart(2, '0')}</strong>
              <span>on the roster</span>
            </div>
            <div className="stat">
              <div className="stat-icon peach">
                <Check size={17} aria-hidden="true" />
              </div>
              <small>Seat coverage</small>
              <strong>
                {capacity ? Math.round((students.length / capacity) * 100) : 0}
                <i>%</i>
              </strong>
              <span>
                {students.length > capacity
                  ? `${students.length - capacity} seats overflow`
                  : `${capacity - students.length} seats free`}
              </span>
            </div>
          </section>

          <div className="section-title">
            <div>
              <h2>Build a seating plan</h2>
              <p>Enter the room layout and student roll numbers.</p>
            </div>
          </div>

          <div className="builder">
            {/* Classroom panel */}
            <section id="classrooms" className="panel rooms">
              <div className="panel-head">
                <div className="panel-icon">
                  <DoorOpen size={17} aria-hidden="true" />
                </div>
                <div>
                  <h3>Classrooms</h3>
                  <p>Define each room's seat layout</p>
                </div>
                <span className="count">{rooms.length} rooms</span>
              </div>
              <div className="room-labels">
                <span>ROOM NUMBER</span>
                <span>ROWS</span>
                <span>BENCHES / ROW</span>
                <span>SEATS / BENCH</span>
                <span></span>
              </div>
              {rooms.map((room, i) => (
                <div className="room-row" key={i}>
                  <input
                    className="room-name"
                    value={room.number}
                    onChange={(e) => updateRoom(i, 'number', e.target.value)}
                    placeholder="e.g. R101"
                    aria-label={`Classroom ${i + 1} number`}
                    maxLength={60}
                  />
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={room.rows}
                    onChange={(e) => updateRoom(i, 'rows', +e.target.value)}
                    aria-label={`Classroom ${room.number || i + 1} rows`}
                  />
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={room.benches}
                    onChange={(e) => updateRoom(i, 'benches', +e.target.value)}
                    aria-label={`Classroom ${room.number || i + 1} benches per row`}
                  />
                  <select
                    aria-label={`Classroom ${room.number || i + 1} seats per bench`}
                    value={room.perBench}
                    onChange={(e) => updateRoom(i, 'perBench', +e.target.value)}
                  >
                    <option value={1}>1 seat</option>
                    <option value={2}>2 seats</option>
                  </select>
                  <button
                    type="button"
                    className="icon-btn delete"
                    onClick={() => {
                      setRooms(rooms.filter((_, j) => j !== i));
                      markStale();
                    }}
                    aria-label={`Remove classroom ${room.number || i + 1}`}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              ))}
              {rooms.length === 0 && (
                <div className="empty-state">
                  No classrooms configured yet. Click "Add classroom" below or load demo data.
                </div>
              )}
              <button
                type="button"
                className="add-room"
                onClick={() => {
                  setRooms([...rooms, { number: '', rows: 1, benches: 1, perBench: 1 }]);
                  markStale();
                }}
              >
                <Plus size={15} aria-hidden="true" /> Add classroom
              </button>
              <div className="capacity-line">
                <span>Combined room capacity</span>
                <b>
                  {capacity} <small>seats</small>
                </b>
              </div>
            </section>

            {/* Roster panel */}
            <section id="students" className="panel roster">
              <div className="panel-head">
                <div className="panel-icon violet">
                  <Users size={17} aria-hidden="true" />
                </div>
                <div>
                  <h3>Student roster</h3>
                  <p>Roll number and department code per line</p>
                </div>
                <span className="count">{students.length} students</span>
              </div>
              <textarea
                value={rolls}
                onChange={(e) => {
                  setRolls(e.target.value);
                  markStale();
                }}
                placeholder={
                  'Paste one student per line:\n24001, CSE\n24002, CE\n24003, ECS\n24004, MECH'
                }
                spellCheck="false"
                aria-label="Student roster text input"
              />
              <div className="roster-foot">
                <span>
                  <span className="dot"></span> {students.length} roster entries · {capacity} seats
                </span>
                <span>Format: ROLL, DEPT</span>
              </div>

              {/* Policy selector */}
              <label className="policy-control">
                <span>Two-seat bench pairing policy</span>
                <select
                  value={departmentPolicy}
                  onChange={(e) => {
                    setDepartmentPolicy(e.target.value);
                    markStale();
                  }}
                  aria-label="Two-seat bench pairing policy"
                >
                  <option value="0">No department rule (sequential)</option>
                  <option value="1">Pair same department</option>
                  <option value="2">Pair different departments</option>
                </select>
              </label>

              {/* Fallback option */}
              {departmentPolicy !== '0' && (
                <label className="fallback-control">
                  <input
                    type="checkbox"
                    checked={allowFallback}
                    onChange={(e) => {
                      setAllowFallback(e.target.checked);
                      markStale();
                    }}
                  />
                  <span>
                    Allow fallback if exact department pairing cannot be satisfied (best-effort)
                  </span>
                </label>
              )}

              <div className="roster-tip">
                <span>i</span>
                <span>
                  Accepted department codes: <b>{VALID_DEPTS.join(', ')}</b>. Strict mode stops
                  if a bench would violate the rule; checking "Allow fallback" enables best-effort
                  seating.
                </span>
              </div>
            </section>
          </div>

          {/* Action footer with generation status */}
          <div id="actions" className="actions">
            <div className="action-note">
              {!canGenerate ? (
                <span className="action-blocked">
                  <span className="spark" style={{ color: '#b96050' }}>
                    ⚠
                  </span>{' '}
                  {validationErrors[0]}
                </span>
              ) : (
                <span className="action-ready">
                  <span className="spark">✳</span> Ready to generate: {students.length} student(s)
                  into {capacity} seat(s).
                </span>
              )}
            </div>
            <button
              className="primary"
              onClick={generate}
              disabled={busy || !canGenerate}
              aria-busy={busy}
            >
              {busy ? (
                <>
                  <RefreshCw size={16} className="spin" aria-hidden="true" /> Building plan…
                </>
              ) : (
                <>
                  Generate seating plan <ArrowRight size={16} aria-hidden="true" />
                </>
              )}
            </button>
          </div>

          {/* User notices */}
          {notice && (
            <div className={`notice ${noticeType}`} role="alert">
              {notice}
            </div>
          )}

          {/* Stale plan warning */}
          {plan.length > 0 && planStale && (
            <div className="notice info stale-notice" role="status">
              <span>⚠ Room layouts or roster have changed since this plan was generated.</span>
              <button
                type="button"
                className="quiet small"
                onClick={generate}
                disabled={!canGenerate || busy}
              >
                Re-generate plan
              </button>
            </div>
          )}

          {/* Seating plan results table */}
          {plan.length > 0 && (
            <section id="seating-plan" className="panel results" aria-label="Seating plan results">
              <div className="results-head">
                <div>
                  <h3>Seating plan</h3>
                  <p>
                    {plan.length} students allocated across{' '}
                    {new Set(plan.map((x) => x.room)).size} room(s)
                  </p>
                </div>
                <button className="export" onClick={downloadCSV} aria-label="Export seating plan as CSV">
                  <ArrowDownToLine size={15} aria-hidden="true" /> Export CSV
                </button>
              </div>

              {/* Classroom filter tabs */}
              <div className="room-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={!activeRoom}
                  className={!activeRoom ? 'selected' : ''}
                  onClick={() => setActiveRoom('')}
                >
                  All rooms <span>({plan.length})</span>
                </button>
                {rooms.map((r) => {
                  const count = plan.filter((p) => p.room === r.number).length;
                  return (
                    <button
                      role="tab"
                      aria-selected={activeRoom === r.number}
                      key={r.number}
                      className={activeRoom === r.number ? 'selected' : ''}
                      onClick={() => setActiveRoom(r.number)}
                    >
                      {r.number} <span>({count})</span>
                    </button>
                  );
                })}
              </div>

              {/* Seating Table */}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">ROLL NUMBER</th>
                      <th scope="col">DEPARTMENT</th>
                      <th scope="col">CLASSROOM</th>
                      <th scope="col">ROW</th>
                      <th scope="col">BENCH · SEAT</th>
                      <th scope="col">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlan.length > 0 ? (
                      filteredPlan.map((p) => (
                        <tr key={p.roll}>
                          <td>
                            <b>{p.roll}</b>
                          </td>
                          <td>
                            <span className="dept-tag">{p.dept}</span>
                          </td>
                          <td>{p.room}</td>
                          <td>Row {p.row}</td>
                          <td>
                            Bench {p.bench} · Seat {p.seat}
                          </td>
                          <td>
                            <span className="assigned">
                              <Check size={12} aria-hidden="true" /> Assigned
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={6}
                          style={{ textAlign: 'center', color: '#92958d', padding: '24px 0' }}
                        >
                          No students match the current filter "{query}".
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <footer>
            Seatwise <span>·</span> Exam administration made simpler
          </footer>
        </div>

        {/* Preferences / Guide Modals */}
        {(showPrefs || showHelp) && (
          <div
            className="modal-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setShowPrefs(false);
                setShowHelp(false);
              }
            }}
          >
            <section className="modal" role="dialog" aria-modal="true">
              <button
                className="modal-close"
                onClick={() => {
                  setShowPrefs(false);
                  setShowHelp(false);
                }}
                aria-label="Close dialog"
              >
                ×
              </button>
              {showPrefs ? (
                <>
                  <div className="eyebrow">WORKSPACE SETTINGS</div>
                  <h2>Preferences</h2>
                  <p>Set the label used for this exam session.</p>
                  <label className="pref-label">
                    Exam session
                    <input
                      value={examName}
                      onChange={(e) => setExamName(e.target.value)}
                      aria-label="Exam session name"
                    />
                  </label>
                  <button
                    className="primary modal-save"
                    onClick={() => {
                      setShowPrefs(false);
                      setNotice('Preferences saved.');
                      setNoticeType('success');
                    }}
                  >
                    Save preferences <Check size={15} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <div className="eyebrow">QUICK GUIDE</div>
                  <h2>How to make a seating plan</h2>
                  <ol>
                    <li>
                      Click <b>Add classroom</b>. Enter a unique classroom identifier (e.g.{' '}
                      <code>R101</code>), rows, benches per row, and seats per bench (1 or 2).
                    </li>
                    <li>
                      Paste your student roster into the text area, one per line:{' '}
                      <code>ROLL, DEPARTMENT</code>. Accepted departments:{' '}
                      <b>{VALID_DEPTS.join(', ')}</b>.
                    </li>
                    <li>
                      Choose a pairing policy for two-seat benches:
                      <ul>
                        <li>
                          <b>No department rule</b>: Sequential seat-graph traversal.
                        </li>
                        <li>
                          <b>Pair same department</b>: Strict same-department allocation.
                        </li>
                        <li>
                          <b>Pair different departments</b>: Prevents adjacent students sharing a
                          department.
                        </li>
                      </ul>
                    </li>
                    <li>
                      Check <b>Allow fallback</b> if you want best-effort seating when exact pairing
                      is mathematically impossible for your roster counts.
                    </li>
                    <li>
                      Click <b>Generate seating plan</b>. The plan can be searched, filtered by
                      classroom, and exported as CSV.
                    </li>
                  </ol>
                  <button
                    className="primary modal-save"
                    onClick={() => {
                      setShowHelp(false);
                      goTo('Classrooms', 'classrooms');
                    }}
                  >
                    Got it <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </>
              )}
            </section>
          </div>
        )}

        {showTerms && <div className="click-away" onClick={() => setShowTerms(false)} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
