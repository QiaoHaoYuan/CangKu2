import { useEffect, useRef, useState } from 'react';
import './style.css';
import { locale, t } from './i18n.js';

const KEY = 'timetable.v1';
const SEEDED_KEY = 'timetable.seeded';
const COLORS = ['#4F6BFF', '#FF6B4A', '#F59E0B', '#10B981', '#8B5CF6', '#0EA5B7'];
const PERIOD_OPTIONS = [8, 10, 12];

// The bells of this timetable, so a class block can say when it starts.
const PERIOD_TIMES = [
  ['8:00', '8:45'],
  ['8:50', '9:35'],
  ['9:50', '10:35'],
  ['10:45', '11:30'],
  ['11:35', '12:20'],
  ['14:00', '14:45'],
  ['14:50', '15:35'],
  ['15:55', '16:40'],
  ['16:45', '17:30'],
  ['18:30', '19:15'],
  ['19:20', '20:05'],
  ['20:10', '20:55'],
];

// 空白模板：不预置任何课程，每个人打开后自己填。
const SEED = [];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const dateOnly = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const mondayOf = (date) => addDays(date, -((date.getDay() + 6) % 7));

const shortDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });

/// What was saved before still opens: anything missing gets a safe default.
function seedData() {
  return { courses: SEED.map((course) => ({ ...course })), settings: { weekend: false, periods: 12 } };
}

function load() {
  const blank = { courses: [], settings: { weekend: false, periods: 12 } };
  try {
    const stored = localStorage.getItem(KEY);
    // 第一次打开是空课表；没有历史数据时也从空白开始。
    if (stored == null) return seedData();
    const raw = JSON.parse(stored);
    if (!raw || !Array.isArray(raw.courses)) return seedData();
    // 之前存过的空课表保持为空（模板不再自动塞课）。
    if (raw.courses.length === 0 && localStorage.getItem(SEEDED_KEY) == null) return seedData();
    return {
      courses: raw.courses
        .filter((course) => course && course.id && course.name)
        .map((course) => ({
          id: String(course.id),
          name: String(course.name),
          room: typeof course.room === 'string' ? course.room : '',
          teacher: typeof course.teacher === 'string' ? course.teacher : '',
          note: typeof course.note === 'string' ? course.note : '',
          day: clamp(Number(course.day) || 1, 1, 7),
          start: clamp(Number(course.start) || 1, 1, 20),
          len: clamp(Number(course.len) || 1, 1, 8),
          color: COLORS.includes(course.color) ? course.color : COLORS[0],
        })),
      settings: {
        weekend: Boolean(raw.settings && raw.settings.weekend),
        periods: PERIOD_OPTIONS.includes(raw.settings && raw.settings.periods) ? raw.settings.periods : 12,
      },
    };
  } catch {
    return seedData();
  }
}

/// The day turns over at midnight, or when the phone comes back after a while.
function useToday() {
  const [today, setToday] = useState(() => dateOnly(new Date()));
  useEffect(() => {
    const tick = () =>
      setToday((previous) => {
        const now = dateOnly(new Date());
        return sameDay(previous, now) ? previous : now;
      });
    const timer = setInterval(tick, 30000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return today;
}

export default function App() {
  const [data, setData] = useState(load);
  const today = useToday();
  const [editing, setEditing] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { courses, settings } = data;

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(data));
    localStorage.setItem(SEEDED_KEY, '1');
  }, [data]);

  const dayCount = settings.weekend ? 7 : 5;
  const visible = courses.filter((course) => course.day <= dayCount);
  const periods = Math.max(settings.periods, ...visible.map((course) => course.start + course.len - 1));
  const monday = mondayOf(today);
  const days = Array.from({ length: dayCount }, (_, i) => ({ day: i + 1, date: addDays(monday, i) }));
  const todayIndex = days.findIndex((day) => sameDay(day.date, today));
  const columns = `26px repeat(${dayCount}, minmax(0, 1fr))`;

  const totalPeriods = visible.reduce((sum, course) => sum + course.len, 0);
  const courseCount = new Set(visible.map((course) => course.name.trim())).size;
  const nextColor =
    COLORS.find((color) => !courses.some((course) => course.color === color)) ||
    COLORS[courses.length % COLORS.length];

  const busy = (day, period) => courses.some((course) => course.day === day && period >= course.start && period < course.start + course.len);

  const freeRun = (day, start) => {
    let n = 0;
    for (let period = start; period <= periods; period++) {
      if (busy(day, period)) break;
      n++;
    }
    return n;
  };

  const startAdd = (day, start) => {
    setEditing({
      day,
      start,
      len: clamp(freeRun(day, start), 1, 2),
      color: nextColor,
      name: '',
      room: '',
      teacher: '',
      note: '',
    });
  };

  // The + button goes to today, at the first free period.
  const openAdd = () => {
    const order = [todayIndex + 1, 1, 2, 3, 4, 5, 6, 7].filter((day) => day >= 1 && day <= dayCount);
    for (const day of order) {
      for (let period = 1; period <= periods; period++) {
        if (!busy(day, period)) return startAdd(day, period);
      }
    }
    setEditing({ day: 1, start: 1, len: 1, color: nextColor, name: '', room: '', teacher: '', note: '' });
  };

  const saveCourse = (course) => {
    setData((previous) => ({
      courses: [...previous.courses.filter((item) => item.id !== course.id), course],
      // A class on the weekend makes the weekend columns appear.
      settings: course.day > 5 && !previous.settings.weekend ? { ...previous.settings, weekend: true } : previous.settings,
    }));
    setEditing(null);
  };

  const removeCourse = (id) => {
    setData((previous) => ({ ...previous, courses: previous.courses.filter((course) => course.id !== id) }));
    setEditing(null);
  };

  const changeSettings = (patch) => {
    setData((previous) => ({ ...previous, settings: { ...previous.settings, ...patch } }));
  };

  return (
    <main className="page">
      <header className="head">
        <div className="head-row">
          <p className="eyebrow">
            {shortDate.format(days[0].date)} – {shortDate.format(days[days.length - 1].date)}
          </p>
          <div className="actions">
            <button className="icon-btn" onClick={openAdd} aria-label={t.add}>
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
            <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label={t.settings}>
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7.5h8.6M17.4 7.5H20M4 16.5h2.6M11.4 16.5H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="15" cy="7.5" r="2.3" stroke="currentColor" strokeWidth="2" />
                <circle cx="9" cy="16.5" r="2.3" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          </div>
        </div>
        <h1>{t.title}</h1>
        <p className="sub">{visible.length ? t.summary(courseCount, totalPeriods) : t.empty}</p>
      </header>

      <section className={`board${dayCount === 7 ? ' seven' : ''}`} aria-label={t.title}>
        <div className="week" style={{ gridTemplateColumns: columns }}>
          <span className="corner" />
          {days.map((day) => (
            <div key={day.day} className={`day${sameDay(day.date, today) ? ' today' : ''}`}>
              <span className="wd">{t.weekdays[day.day - 1]}</span>
              <span className="dn">{day.date.getDate()}</span>
            </div>
          ))}
        </div>

        <div className="slots" style={{ gridTemplateColumns: columns }}>
          {Array.from({ length: periods }, (_, i) => (
            <div key={`n${i}`} className="num" style={{ gridColumn: 1, gridRow: i + 1 }}>
              <b>{i + 1}</b>
              {PERIOD_TIMES[i] ? <span>{PERIOD_TIMES[i][0]}</span> : null}
            </div>
          ))}

          {days.map((day, di) =>
            Array.from({ length: periods }, (_, pi) => (
              <button
                key={`${day.day}-${pi + 1}`}
                className={`cell${di === todayIndex ? ' today' : ''}`}
                style={{ gridColumn: di + 2, gridRow: pi + 1 }}
                onClick={() => startAdd(day.day, pi + 1)}
                aria-label={t.cellLabel(t.weekdays[day.day - 1], pi + 1)}
              />
            )),
          )}

          {visible.map((course) => (
            <button
              key={course.id}
              className="block"
              style={{ gridColumn: course.day + 1, gridRow: `${course.start} / span ${course.len}`, '--tone': course.color }}
              onClick={() => setEditing({ ...course })}
            >
              <b>{course.name}</b>
              {course.len > 1 && course.room ? <small>{course.room}</small> : null}
              {course.len > 2 && course.note ? <small className="note-line">{course.note}</small> : null}
            </button>
          ))}
        </div>
      </section>

      {editing && (
        <CourseSheet
          course={editing}
          courses={courses}
          periods={periods}
          onSave={saveCourse}
          onRemove={removeCourse}
          onClose={() => setEditing(null)}
        />
      )}
      {settingsOpen && (
        <SettingsSheet settings={settings} onChange={changeSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </main>
  );
}

/// The sheet slides up, follows a finger down, and leaves the way it came.
function useSheet(onClose) {
  const [shown, setShown] = useState(false);
  const [pull, setPull] = useState(0);
  const grab = useRef(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const leave = (then) => {
    setShown(false);
    setPull(0);
    setTimeout(then || onClose, 280);
  };

  const drag = {
    onPointerDown: (event) => {
      grab.current = event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event) => {
      if (grab.current != null) setPull(Math.max(0, event.clientY - grab.current));
    },
    onPointerUp: () => {
      if (grab.current == null) return;
      grab.current = null;
      if (pull > 90) leave();
      else setPull(0);
    },
    onPointerCancel: () => {
      grab.current = null;
      setPull(0);
    },
  };

  return { shown, pull, leave, drag };
}

function SheetShell({ shown, pull, drag, onBackdrop, label, children }) {
  return (
    <div className={`backdrop${shown ? ' shown' : ''}`} onClick={onBackdrop}>
      <div
        className={`sheet${pull ? ' pulled' : ''}`}
        style={pull ? { transform: `translateY(${pull}px)` } : undefined}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <div className="grab" {...drag}>
          <span />
        </div>
        {children}
      </div>
    </div>
  );
}

function CourseSheet({ course, courses, periods, onSave, onRemove, onClose }) {
  const isNew = !course.id;
  const [name, setName] = useState(course.name || '');
  const [room, setRoom] = useState(course.room || '');
  const [teacher, setTeacher] = useState(course.teacher || '');
  const [note, setNote] = useState(course.note || '');
  const [day, setDay] = useState(course.day || 1);
  const [start, setStart] = useState(course.start || 1);
  const [len, setLen] = useState(course.len || 1);
  const [color, setColor] = useState(course.color || COLORS[0]);
  const [sure, setSure] = useState(false);
  const { shown, pull, leave, drag } = useSheet(onClose);

  useEffect(() => {
    if (!sure) return;
    const timer = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(timer);
  }, [sure]);

  const maxLen = Math.min(4, periods - start + 1);
  const length = Math.min(len, maxLen);
  const overlap = courses.find(
    (item) =>
      item.id !== course.id &&
      item.day === day &&
      start <= item.start + item.len - 1 &&
      item.start <= start + length - 1,
  );
  const valid = name.trim().length > 0 && !overlap;
  const bellsFrom = PERIOD_TIMES[clamp(start, 1, PERIOD_TIMES.length) - 1][0];
  const bellsTo = PERIOD_TIMES[clamp(start + length - 1, 1, PERIOD_TIMES.length) - 1][1];

  const bumpStart = (delta) => {
    const next = clamp(start + delta, 1, periods);
    setStart(next);
    setLen((current) => Math.min(current, Math.min(4, periods - next + 1)));
  };
  const bumpLength = (delta) => setLen(clamp(length + delta, 1, maxLen));

  const submit = () => {
    if (!valid) return;
    const saved = {
      id: course.id || String(Date.now()),
      name: name.trim(),
      room: room.trim(),
      teacher: teacher.trim(),
      note: note.trim(),
      day,
      start,
      len: length,
      color,
    };
    leave(() => onSave(saved));
  };

  return (
    <SheetShell shown={shown} pull={pull} drag={drag} onBackdrop={() => leave()} label={isNew ? t.newCourse : t.editCourse}>
      <header className="bar">
        <button className="link" onClick={() => leave()}>{t.cancel}</button>
        <strong>{isNew ? t.newCourse : t.editCourse}</strong>
        <button className="link strong" disabled={!valid} onClick={submit}>{t.save}</button>
      </header>

      <div className="group">
        <label className="field">
          <span className="label">{t.name}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.namePlaceholder}
            maxLength={24}
            enterKeyHint="done"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="label">{t.room}</span>
          <input
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            placeholder={t.roomPlaceholder}
            maxLength={24}
            enterKeyHint="done"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="label">{t.teacher}</span>
          <input
            value={teacher}
            onChange={(event) => setTeacher(event.target.value)}
            placeholder={t.teacherPlaceholder}
            maxLength={20}
            enterKeyHint="done"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="label">{t.note}</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t.notePlaceholder}
            maxLength={40}
            enterKeyHint="done"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="group picker">
        <p className="picker-label">{t.day}</p>
        <div className="pills">
          {t.weekdays.map((weekday, i) => (
            <button
              key={weekday}
              type="button"
              className={`pill${day === i + 1 ? ' on' : ''}`}
              onClick={() => setDay(i + 1)}
              aria-pressed={day === i + 1}
            >
              {weekday}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <div className="step">
          <span className="label">{t.start}</span>
          <div className="stepper">
            <button type="button" onClick={() => bumpStart(-1)} disabled={start <= 1} aria-label={t.decrement}>
              −
            </button>
            <b>{t.startValue(start)}</b>
            <button type="button" onClick={() => bumpStart(1)} disabled={start >= periods} aria-label={t.increment}>
              +
            </button>
          </div>
        </div>
        <div className="step">
          <span className="label">{t.length}</span>
          <div className="stepper">
            <button type="button" onClick={() => bumpLength(-1)} disabled={length <= 1} aria-label={t.decrement}>
              −
            </button>
            <b>{t.lengthValue(length)}</b>
            <button type="button" onClick={() => bumpLength(1)} disabled={length >= maxLen} aria-label={t.increment}>
              +
            </button>
          </div>
        </div>
        <p className="time-hint">{bellsFrom} – {bellsTo}</p>
      </div>

      {overlap && (
        <p className="warn">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 7.6v5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="16.2" r="1.1" fill="currentColor" />
          </svg>
          {t.conflict(overlap.name)}
        </p>
      )}

      <div className="group">
        <div className="colors">
          <span className="label">{t.color}</span>
          {COLORS.map((swatch, i) => (
            <button
              key={swatch}
              type="button"
              className={`swatch${color === swatch ? ' on' : ''}`}
              style={{ '--c': swatch }}
              onClick={() => setColor(swatch)}
              aria-label={t.colorNames[i]}
              aria-pressed={color === swatch}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 12.5 9.2 16.7 19 6.8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {!isNew && (
        <button
          type="button"
          className={`remove${sure ? ' sure' : ''}`}
          onClick={() => (sure ? leave(() => onRemove(course.id)) : setSure(true))}
        >
          {sure ? t.removeSure : t.remove}
        </button>
      )}
    </SheetShell>
  );
}

function SettingsSheet({ settings, onChange, onClose }) {
  const { shown, pull, leave, drag } = useSheet(onClose);

  return (
    <SheetShell shown={shown} pull={pull} drag={drag} onBackdrop={() => leave()} label={t.settings}>
      <header className="bar">
        <span className="link" />
        <strong>{t.settings}</strong>
        <button className="link strong" onClick={() => leave()}>{t.done}</button>
      </header>

      <div className="group">
        <div className="field">
          <span className="label grow">{t.weekend}</span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.weekend}
            aria-label={t.weekend}
            className={`switch${settings.weekend ? ' on' : ''}`}
            onClick={() => onChange({ weekend: !settings.weekend })}
          />
        </div>
      </div>

      <div className="group">
        <div className="field">
          <span className="label grow">{t.periods}</span>
          <div className="seg">
            {PERIOD_OPTIONS.map((count) => (
              <button
                key={count}
                type="button"
                className={settings.periods === count ? 'on' : ''}
                aria-pressed={settings.periods === count}
                onClick={() => onChange({ periods: count })}
              >
                {count}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="note">{t.storageNote}</p>
    </SheetShell>
  );
}
