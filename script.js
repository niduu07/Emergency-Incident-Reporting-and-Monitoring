'use strict';
/* =====================================================================
   Emergency Response & Disaster Management Platform - Code Clash 2026
   ROUND 2: prioritisation, team management, nearest-team assignment,
            lifecycle tracking, map/route visualisation, analytics.
   Sections: 1 Config  2 Storage  3 Engines (severity, priority, distance,
   assignment)  4 Helpers  5 Map  6 Rendering  7 Report form  8 Incident
   modal  9 Teams  10 CSV  11 Init
   ===================================================================== */

/* ---------- 1. Config ---------- */
const KEY_I = 'cc2026_r2_incidents', KEY_T = 'cc2026_r2_teams', KEY_AUTO = 'cc2026_r2_auto';
const CATEGORIES = ['Fire Emergency', 'Road Accident', 'Medical Emergency', 'Flood', 'Building Collapse', 'Other Emergencies'];
const STATUSES = ['Reported', 'Assigned', 'In Progress', 'Resolved'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const SEV_WEIGHT = { Critical: 4, High: 3, Medium: 2, Low: 1 };
const TEAM_TYPES = ['Fire', 'Medical', 'Rescue', 'Traffic'];
const TYPE_LETTER = { Fire: 'F', Medical: 'M', Rescue: 'R', Traffic: 'T' };

// Severity rules (Round 1)
const CATEGORY_POINTS = { 'Building Collapse': 3, 'Fire Emergency': 2, 'Flood': 2, 'Road Accident': 1, 'Medical Emergency': 1, 'Other Emergencies': 0 };
const DANGER_WORDS = ['trapped', 'unconscious', 'explosion', 'fatal', 'dead', 'death', 'bleeding', 'spreading', 'collapsed',
  'children', 'child', 'gas leak', 'drowning', 'not breathing', 'swept away', 'chemical', 'burning', 'critical condition'];

// Priority rules (Round 2): total out of 100
const SEV_PTS = { Critical: 40, High: 30, Medium: 20, Low: 10 };
const CAT_PTS = { 'Building Collapse': 15, 'Fire Emergency': 12, 'Flood': 10, 'Medical Emergency': 10, 'Road Accident': 8, 'Other Emergencies': 3 };

// Which team types suit which emergency, best match first
const PREF = {
  'Fire Emergency': ['Fire', 'Rescue', 'Medical'],
  'Road Accident': ['Medical', 'Traffic', 'Rescue'],
  'Medical Emergency': ['Medical'],
  'Flood': ['Rescue', 'Medical'],
  'Building Collapse': ['Rescue', 'Fire', 'Medical'],
  'Other Emergencies': ['Rescue', 'Traffic', 'Fire', 'Medical']
};
const GUIDANCE = {
  'Fire Emergency': ['Dispatch fire brigade and an ambulance on standby.', 'Evacuate the building and keep people away from smoke.', 'Cut power and gas supply if it is safe to do so.'],
  'Road Accident': ['Dispatch ambulance and traffic police.', 'Set up warning markers and divert traffic.', 'Do not move injured people unless there is fire risk.'],
  'Medical Emergency': ['Dispatch the nearest ambulance.', 'Keep the patient calm, still and warm.', 'Start CPR only if trained and the person is not breathing.'],
  'Flood': ['Alert the disaster response team.', 'Move people to higher ground and shelters.', 'Avoid walking or driving through flood water.'],
  'Building Collapse': ['Dispatch search-and-rescue, fire brigade and ambulances.', 'Keep the public away from unstable structures.', 'Do not move rubble without trained rescuers.'],
  'Other Emergencies': ['Confirm the location and assess the situation.', 'Dispatch the most suitable response unit.', 'Contact the reporter for details.']
};
// Known areas for quick location selection (demo coordinates)
const ZONES = [
  ['North Colony', 13.060, 80.215], ['Market Square', 13.035, 80.245], ['Riverside Road', 13.020, 80.205],
  ['Ring Road Junction', 13.000, 80.250], ['Central Bus Stand', 13.045, 80.270], ['University Gate', 13.075, 80.250],
  ['Industrial Estate', 12.985, 80.215], ['Harbour Road', 13.080, 80.285]
];

/* ---------- 2. State and storage ---------- */
let incidents = [], teams = [];
let filters = { q: '', cat: '', sev: '', status: '', sort: 'priority' };
let openId = null, openTeamId = null, bannerDismissed = false;

function saveData() {
  try { localStorage.setItem(KEY_I, JSON.stringify(incidents)); localStorage.setItem(KEY_T, JSON.stringify(teams)); }
  catch (e) { toast('Could not save data in this browser.', true); }
}
function loadData() {
  try {
    const i = JSON.parse(localStorage.getItem(KEY_I)), t = JSON.parse(localStorage.getItem(KEY_T));
    if (Array.isArray(i) && Array.isArray(t)) {
      incidents = i; teams = t; validateStoredState(); saveData(); return true;
    }
  } catch (e) { /* use demo data */ }
  return false;
}
function validateStoredState() {
  const activeByTeam = new Map();
  incidents = Array.isArray(incidents) ? incidents.filter(Boolean) : [];
  teams = Array.isArray(teams) ? teams.filter(Boolean) : [];

  incidents.forEach(inc => {
    if (!inc || typeof inc !== 'object') return;
    inc.log = Array.isArray(inc.log) ? inc.log : [];
    inc.assignmentHistory = Array.isArray(inc.assignmentHistory) ? inc.assignmentHistory : [];
    inc.lastAssignedAt = inc.lastAssignedAt || inc.assignedAt || null;
    inc.lastDispatchKm = inc.lastDispatchKm != null ? inc.lastDispatchKm : inc.dispatchKm != null ? inc.dispatchKm : null;

    if (inc.teamId && !getTeam(inc.teamId)) {
      inc.teamId = null;
      if (['Assigned', 'In Progress'].includes(inc.status)) inc.status = 'Reported';
      logEvt(inc, 'Stale team assignment removed during validation');
    }
    if (inc.status === 'Resolved' && inc.teamId) {
      inc.teamId = null;
      logEvt(inc, 'Resolved incident assignment was cleared during validation');
    }
    if (!inc.teamId && ['Assigned', 'In Progress'].includes(inc.status)) {
      inc.status = 'Reported';
      logEvt(inc, 'Incident rolled back to Reported because no active team was linked');
    }
  });

  incidents.forEach(inc => {
    if (!inc || typeof inc !== 'object') return;
    if (inc.teamId && inc.status !== 'Resolved') {
      const team = getTeam(inc.teamId);
      if (!team) {
        inc.teamId = null; return;
      }
      const existing = activeByTeam.get(team.id);
      if (existing && existing !== inc.id) {
        inc.teamId = null;
        if (inc.status !== 'Resolved') inc.status = 'Reported';
        logEvt(inc, 'Team was already linked to another active incident; assignment removed');
        return;
      }
      activeByTeam.set(team.id, inc.id);
      team.incidentId = inc.id;
      team.status = 'Busy';
    }
  });

  teams.forEach(team => {
    if (!team || typeof team !== 'object') return;
    team.activity = Array.isArray(team.activity) ? team.activity : [];
    team.locationHistory = Array.isArray(team.locationHistory) ? team.locationHistory : [];
    if (team.incidentId) {
      const inc = getInc(team.incidentId);
      if (!inc || inc.status === 'Resolved' || inc.teamId !== team.id) {
        team.incidentId = null;
        if (team.status === 'Busy') team.status = 'Available';
        logTeamEvt(team, 'Cleared stale incident assignment during validation');
      } else {
        team.status = 'Busy';
      }
    } else if (team.status === 'Busy') {
      const activeInc = incidents.find(inc => inc.teamId === team.id && inc.status !== 'Resolved');
      if (activeInc) {
        team.incidentId = activeInc.id; team.status = 'Busy';
      } else {
        team.status = 'Available';
      }
    }
  });
}
const getTeam = id => teams.find(t => t.id === id);
const getInc = id => incidents.find(i => i.id === id);
const getLatestAssignment = inc => {
  const arr = Array.isArray(inc && inc.assignmentHistory) ? inc.assignmentHistory : [];
  return arr.length ? arr[arr.length - 1] : null;
};
const newId = () => 'INC-' + Math.random().toString(36).slice(2, 7).toUpperCase();

/* ---------- 3. Engines ---------- */
/** Round 1: transparent rule-based severity. */
function classify(category, people, description) {
  const reasons = [];
  let score = CATEGORY_POINTS[category] || 0;
  reasons.push((category || 'Category') + ' base risk: +' + score);
  const p = Number(people) || 0, pp = p >= 50 ? 3 : p >= 10 ? 2 : p >= 3 ? 1 : 0;
  if (pp) reasons.push(p + ' people affected: +' + pp);
  score += pp;
  const text = (description || '').toLowerCase(), hits = DANGER_WORDS.filter(w => text.includes(w)), kp = Math.min(hits.length * 2, 4);
  if (kp) reasons.push('Danger words (' + hits.slice(0, 3).join(', ') + '): +' + kp);
  score += kp;
  const severity = score >= 7 ? 'Critical' : score >= 5 ? 'High' : score >= 3 ? 'Medium' : 'Low';
  reasons.push('Total score ' + score + ' = ' + severity + ' (Critical 7+, High 5-6, Medium 3-4, Low 0-2)');
  return { severity, score, reasons };
}
/** Round 2: priority score out of 100 from severity, people, category and waiting time. */
function priority(inc) {
  if (inc.status === 'Resolved') return { score: 0, level: 'Low', parts: [0, 0, 0, 0] };
  const mins = (Date.now() - inc.created) / 60000;
  const parts = [SEV_PTS[inc.severity] || 0, Math.min(25, inc.people * 0.5), CAT_PTS[inc.category] || 0, Math.min(20, mins / 6)];
  const score = Math.round(parts.reduce((a, b) => a + b, 0));
  return { score, level: score >= 70 ? 'Critical' : score >= 50 ? 'High' : score >= 30 ? 'Medium' : 'Low', parts: parts.map(Math.round) };
}
/** Great-circle distance in km (haversine formula). */
function haversine(la1, lo1, la2, lo2) {
  const r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
const eta = km => Math.max(1, Math.round(km / 35 * 60)); // assumes 35 km/h average speed
/** Rank available, suitable teams. Score = distance + 4 km penalty per step down the preferred team types. */
function rankTeams(inc) {
  const pref = PREF[inc.category] || [];
  return teams.filter(t => t.status === 'Available' && pref.includes(t.type)).map(t => {
    const km = haversine(t.lat, t.lng, inc.lat, inc.lng), idx = pref.indexOf(t.type);
    return { team: t, km, eta: eta(km), score: km + idx * 4, best: idx === 0 };
  }).sort((a, b) => a.score - b.score);
}
function logEvt(inc, text, t) { (inc.log = inc.log || []).push({ t: t || Date.now(), text }); }
function logTeamEvt(team, text, t) { if (!team) return; (team.activity = team.activity || []).push({ t: t || Date.now(), text }); }
function persistAssignmentHistory(inc, team, action) {
  if (!inc || !team) return;
  const entry = {
    teamId: team.id,
    teamName: team.name,
    teamType: team.type,
    assignedAt: inc.assignedAt || Date.now(),
    dispatchKm: inc.dispatchKm != null ? inc.dispatchKm : null,
    action,
    recordedAt: Date.now()
  };
  inc.assignmentHistory = Array.isArray(inc.assignmentHistory) ? inc.assignmentHistory : [];
  inc.assignmentHistory.push(entry);
  inc.lastTeamId = team.id;
  inc.lastTeamName = team.name;
  inc.lastTeamType = team.type;
  inc.lastAssignedAt = inc.assignedAt || entry.assignedAt;
  inc.lastDispatchKm = inc.dispatchKm != null ? inc.dispatchKm : entry.dispatchKm;
}

function assignTeam(inc, team, auto, notify = true) {
  if (!inc || !team) {
    if (notify) toast('A valid incident and team are required.', true);
    return false;
  }
  if (inc.status === 'Resolved') {
    if (notify) toast('Cannot assign a team to a resolved incident.', true);
    return false;
  }
  if (!PREF[inc.category] || !PREF[inc.category].includes(team.type)) {
    if (notify) toast(`${team.name} is not suitable for the ${inc.category} response.`, true);
    return false;
  }
  if (team.status !== 'Available' || (team.incidentId && team.incidentId !== inc.id)) {
    if (notify) toast(`${team.name} is not available for this assignment.`, true);
    return false;
  }
  if (inc.teamId && inc.teamId !== team.id) releaseTeam(inc, false);
  const km = haversine(team.lat, team.lng, inc.lat, inc.lng);
  inc.teamId = team.id; inc.dispatchKm = km; inc.assignedAt = Date.now();
  if (inc.status === 'Reported') inc.status = 'Assigned';
  team.status = 'Busy'; team.incidentId = inc.id;
  logEvt(inc, `${team.name} ${auto ? 'auto-' : ''}assigned: ${km.toFixed(1)} km away, ETA ${eta(km)} min`);
  logTeamEvt(team, `Assigned to ${inc.title} (${inc.id})`);
  persistAssignmentHistory(inc, team, 'assigned');
  return true;
}
function releaseTeam(inc, moveToIncident) {
  if (!inc) return;
  const t = getTeam(inc.teamId);
  const teamName = t ? t.name : inc.lastTeamName || 'Team';
  const teamId = t ? t.id : inc.lastTeamId || null;
  if (t) {
    if (moveToIncident) {
      logTeamEvt(t, `Explicit simulated arrival at ${inc.location} (${inc.id})`);
      t.lat = inc.lat; t.lng = inc.lng;
      t.locationHistory = t.locationHistory || [];
      t.locationHistory.push({ at: Date.now(), lat: inc.lat, lng: inc.lng, reason: 'simulated arrival' });
      logEvt(inc, `${t.name} simulated arrival at ${inc.location}`);
    }
    t.status = 'Available'; t.incidentId = null;
    logTeamEvt(t, `Released from ${inc.title} (${inc.id})`);
  }
  if (teamId && inc.teamId) {
    const historyEntry = {
      teamId: teamId,
      teamName,
      teamType: t ? t.type : inc.lastTeamType || 'Unknown',
      assignedAt: inc.assignedAt || Date.now(),
      dispatchKm: inc.dispatchKm != null ? inc.dispatchKm : null,
      action: moveToIncident ? 'resolved' : 'released',
      recordedAt: Date.now()
    };
    inc.assignmentHistory = Array.isArray(inc.assignmentHistory) ? inc.assignmentHistory : [];
    if (!inc.assignmentHistory.some(entry => entry.teamId === historyEntry.teamId && entry.recordedAt === historyEntry.recordedAt)) {
      inc.assignmentHistory.push(historyEntry);
    }
    inc.lastTeamId = historyEntry.teamId;
    inc.lastTeamName = historyEntry.teamName;
    inc.lastTeamType = historyEntry.teamType;
    inc.lastAssignedAt = inc.assignedAt || historyEntry.assignedAt;
    inc.lastDispatchKm = inc.dispatchKm != null ? inc.dispatchKm : historyEntry.dispatchKm;
  }
  inc.teamId = null;
}
function markTeamArrived(inc) {
  if (!inc || !inc.teamId) {
    toast('Assign a team before marking arrival.', true);
    return false;
  }
  const team = getTeam(inc.teamId);
  if (!team) {
    toast('The assigned team could not be found.', true);
    return false;
  }
  team.lat = inc.lat; team.lng = inc.lng;
  team.locationHistory = Array.isArray(team.locationHistory) ? team.locationHistory : [];
  team.locationHistory.push({ at: Date.now(), lat: inc.lat, lng: inc.lng, reason: 'arrival confirmed' });
  logTeamEvt(team, `Marked arrived at ${inc.location} (${inc.id})`);
  logEvt(inc, `${team.name} marked arrived at the incident site`);
  saveData(); renderAll(); if (openId) openModal(openId); toast(`${team.name} marked arrived at ${inc.location}.`);
  return true;
}
function reopenForReassignment(inc) {
  if (!inc) return false;
  if (inc.status !== 'Resolved') {
    toast('This incident is already open and can be reassigned immediately.', true);
    return false;
  }
  inc.resolvedAt = null;
  inc.status = 'Reported';
  if (inc.teamId) releaseTeam(inc, false);
  logEvt(inc, 'Incident reopened for reassignment.');
  saveData(); renderAll(); if (openId) openModal(openId); toast('Incident reopened. Select a team to reassign.');
  return true;
}
/** Change status following the lifecycle rules. Returns an error message or null. */
function getValidStatusOptions(inc) {
  if (!inc) return [];
  const allowed = {
    Reported: ['Assigned', 'Resolved'],
    Assigned: ['In Progress', 'Reported', 'Resolved'],
    'In Progress': ['Resolved', 'Assigned', 'Reported'],
    Resolved: ['Reported']
  };
  const options = [inc.status, ...(allowed[inc.status] || [])].filter((v, i, arr) => arr.indexOf(v) === i);
  if (!inc.teamId) return options.filter(s => s !== 'Assigned' && s !== 'In Progress');
  return options;
}
function setStatus(inc, s) {
  if (!inc) return 'Incident is missing.';
  const prev = inc.status;
  const allowed = {
    Reported: ['Assigned', 'Resolved'],
    Assigned: ['In Progress', 'Reported', 'Resolved'],
    'In Progress': ['Resolved', 'Assigned', 'Reported'],
    Resolved: ['Reported']
  };
  if (!STATUSES.includes(s)) return 'Choose a valid status.';
  if (allowed[prev] && !allowed[prev].includes(s)) return `Status cannot change from "${prev}" to "${s}".`;
  const t = getTeam(inc.teamId);
  if (s === 'Reported' && t) {
    releaseTeam(inc, false);
    logEvt(inc, t.name + ' released');
  }
  if ((s === 'Assigned' || s === 'In Progress' || s === 'Resolved') && !inc.teamId) {
    return 'Assign a response team before setting "' + s + '".';
  }
  if (prev === 'Resolved' && s !== 'Resolved') {
    inc.resolvedAt = null;
    logEvt(inc, 'Incident reopened from Resolved to ' + s + '.');
  }
  if (s === 'Resolved') {
    if (!inc.teamId) return 'A response team must be assigned before resolving an incident.';
    inc.resolvedAt = Date.now();
    logEvt(inc, 'Incident resolved by ' + (t ? t.name : 'team') + '.');
    if (t) { releaseTeam(inc, false); }
  }
  inc.status = s; logEvt(inc, 'Status changed to ' + s);
  return null;
}
function autoAssign(inc) {
  if (inc.teamId || inc.status === 'Resolved') return false;
  const r = rankTeams(inc)[0];
  return r ? assignTeam(inc, r.team, true) : false;
}
const openIncidents = () => incidents.filter(i => i.status !== 'Resolved');
const byPriority = () => openIncidents().sort((a, b) => priority(b).score - priority(a).score || a.created - b.created);

/* ---------- Demo data ---------- */
function buildIncident(f, minutesAgo, status) {
  const c = classify(f.category, f.people, f.description), t = Date.now() - (minutesAgo || 0) * 60000;
  const inc = { id: newId(), title: f.title, description: f.description, category: f.category, location: f.location,
    lat: Number(f.lat), lng: Number(f.lng), people: Number(f.people), contact: f.contact || '', status: status || 'Reported',
    severity: c.severity, autoSeverity: c.severity, manual: false, reasons: c.reasons, teamId: null, dispatchKm: null,
    assignedAt: null, resolvedAt: null, created: t, log: [] };
  logEvt(inc, 'Reported (severity ' + c.severity + ')', t);
  return inc;
}
function demoData() {
  teams = [
    ['FIRE-01', 'Fire Brigade Alpha', 'Fire', 13.050, 80.235], ['FIRE-02', 'Fire Brigade Bravo', 'Fire', 12.995, 80.230],
    ['MED-01', 'Ambulance Unit 1', 'Medical', 13.040, 80.262], ['MED-02', 'Ambulance Unit 2', 'Medical', 13.070, 80.228],
    ['MED-03', 'Ambulance Unit 3', 'Medical', 13.010, 80.240], ['RSC-01', 'Rescue Squad Alpha', 'Rescue', 13.028, 80.218],
    ['RSC-02', 'Rescue Squad Bravo', 'Rescue', 13.066, 80.272], ['TRF-01', 'Traffic Response Unit', 'Traffic', 13.006, 80.256]
  ].map(x => ({ id: x[0], name: x[1], type: x[2], lat: x[3], lng: x[4], status: 'Available', incidentId: null }));
  const z = n => ZONES.find(a => a[0] === n);
  const d = [
    ['Apartment block fire, upper floors', 'Smoke spreading fast, residents trapped on the 4th floor.', 'Fire Emergency', 'North Colony', 14, 'In Progress', 22],
    ['Highway bus collision', 'Bus and truck collided, several passengers bleeding and some unconscious.', 'Road Accident', 'Ring Road Junction', 25, 'In Progress', 41],
    ['Shopping complex roof collapsed', 'Part of the roof collapsed, people trapped under debris.', 'Building Collapse', 'Market Square', 30, 'Reported', 9],
    ['River overflow in low-lying homes', 'Water entering ground floor homes, families moving upstairs.', 'Flood', 'Riverside Road', 60, 'Reported', 75],
    ['Cardiac arrest at bus stand', 'Man collapsed and is not breathing, bystanders giving first aid.', 'Medical Emergency', 'Central Bus Stand', 1, 'Reported', 6],
    ['Minor two-wheeler collision', 'Two riders with minor scratches, traffic slow.', 'Road Accident', 'Ring Road Junction', 2, 'Reported', 120],
    ['Kitchen fire in restaurant', 'Fire in kitchen, staff evacuated, contained quickly.', 'Fire Emergency', 'Market Square', 5, 'Resolved', 300],
    ['Waterlogged underpass', 'Underpass flooded, vehicles stuck.', 'Flood', 'Riverside Road', 8, 'Reported', 35],
    ['Fainting at college campus', 'Student fainted in class, now conscious.', 'Medical Emergency', 'University Gate', 1, 'Resolved', 500],
    ['Fallen tree blocking street', 'Large tree fell across the road, no injuries.', 'Other Emergencies', 'North Colony', 0, 'Reported', 180],
    ['Gas leak smell near school', 'Strong gas leak smell, children being moved outside.', 'Other Emergencies', 'North Colony', 40, 'Reported', 15]
  ];
  incidents = d.map((x, k) => {
    const zz = z(x[3]); // small offsets so markers at the same area do not overlap
    return buildIncident({ title: x[0], description: x[1], category: x[2], location: x[3],
      lat: zz[1] + ((k % 3) - 1) * 0.004, lng: zz[2] + ((k % 4) - 1.5) * 0.004, people: x[4] }, x[6], x[5]);
  });
  [[0, 'FIRE-01'], [1, 'MED-03']].forEach(([k, tid]) => {
    const inc = incidents[k], st = inc.status;
    assignTeam(inc, getTeam(tid), false); inc.status = st; logEvt(inc, 'Status changed to ' + st);
  });
}

/* ---------- 4. Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = s => s.replace(/\s/g, '');
const isOpen = i => i.status !== 'Resolved';
function ago(t) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
}
function toast(msg, isError) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : ''); el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3400);
}
const options = (arr, sel) => arr.map(x => `<option ${x === sel ? 'selected' : ''}>${x}</option>`).join('');
function bar(label, n, max, c, text) {
  return `<div class="bar-row"><span>${esc(label)}</span><div class="track"><div class="fill ${c || ''}" style="width:${max ? n / max * 100 : 0}%"></div></div><b>${text || n}</b></div>`;
}
function rowHTML(i, opts) {
  opts = opts || {};
  const t = getTeam(i.teamId), p = priority(i), last = getLatestAssignment(i);
  const teamLine = i.status === 'Resolved'
    ? (last ? `<div class="team-line has">Former team: ${esc(last.teamName)} (${esc(last.teamId)})${last.dispatchKm != null ? ' · ' + last.dispatchKm.toFixed(1) + ' km' : ''}</div>` : '<div class="team-line none">No assignment history recorded</div>')
    : t ? `<div class="team-line has">Team: ${esc(t.name)} (${i.dispatchKm != null ? i.dispatchKm.toFixed(1) + ' km' : ''})</div>` : '<div class="team-line none">No team assigned</div>';
  const lead = opts.rank ? `<span class="rank">${opts.rank}</span>` : `<span class="badge ${i.severity}">${i.severity}</span>`;
  const right = opts.queue && !i.teamId ? `<button class="btn red sm" data-auto="${i.id}">Assign nearest</button>` : opts.del ? `<button class="btn danger sm" data-del="${i.id}">Delete</button>` : '<span></span>';
  return `<div class="row ${i.severity} ${isOpen(i) ? 'open' : ''}" data-open="${i.id}" role="button" tabindex="0">${lead}
    <div><div class="t">${esc(i.title)}</div><div class="m">${opts.rank ? `<span class="badge ${i.severity}">${i.severity}</span> ` : ''}${esc(i.category)} &middot; ${esc(i.location)} &middot; ${i.people} affected &middot; ${ago(i.created)}</div>${teamLine}</div>
    <span class="pscore pl-${p.level}" title="Priority level and score out of 100">${i.status === 'Resolved' ? 'Done' : p.level + ' · ' + p.score}</span><span class="badge status ${cls(i.status)}">${i.status}</span>${right}</div>`;
}

/* ---------- 5. Map (offline SVG, no external libraries) ---------- */
const MAP_W = 760, MAP_H = 420, maps = {};
function makeProj(pts) {
  pts = pts.filter(p => isFinite(p.lat) && isFinite(p.lng));
  if (!pts.length) pts = [{ lat: ZONES[0][1], lng: ZONES[0][2] }];
  let minLat = Math.min(...pts.map(p => p.lat)), maxLat = Math.max(...pts.map(p => p.lat));
  let minLng = Math.min(...pts.map(p => p.lng)), maxLng = Math.max(...pts.map(p => p.lng));
  if (maxLat - minLat < 0.02) { const c = (minLat + maxLat) / 2; minLat = c - 0.01; maxLat = c + 0.01; }
  if (maxLng - minLng < 0.02) { const c = (minLng + maxLng) / 2; minLng = c - 0.01; maxLng = c + 0.01; }
  const k = Math.cos((minLat + maxLat) / 2 * Math.PI / 180), sx = (maxLng - minLng) * k, sy = maxLat - minLat, pad = 55;
  const s = Math.min((MAP_W - 2 * pad) / sx, (MAP_H - 2 * pad) / sy), ox = (MAP_W - sx * s) / 2, oy = (MAP_H - sy * s) / 2;
  return { xy: (la, lo) => [ox + (lo - minLng) * k * s, oy + (maxLat - la) * s], ll: (x, y) => [maxLat - (y - oy) / s, minLng + (x - ox) / (k * s)], kpp: 1 / (s * 111.32) };
}
/** o: { incs, teams, focusId, candidate, extra, clickable, ranks } */
function mapHTML(id, o) {
  const P = makeProj([...o.incs, ...o.teams, ...(o.extra ? [o.extra] : [])]); maps[id] = P;
  let g = '';
  for (let x = 0; x <= MAP_W; x += 70) g += `<line class="gl" x1="${x}" y1="0" x2="${x}" y2="${MAP_H}"/>`;
  for (let y = 0; y <= MAP_H; y += 70) g += `<line class="gl" x1="0" y1="${y}" x2="${MAP_W}" y2="${y}"/>`;
  // Routes from assigned teams to incidents, labelled with distance
  o.incs.forEach(i => {
    const t = o.teams.find(x => x.id === i.teamId);
    if (!t || !isOpen(i)) return;
    const [x1, y1] = P.xy(t.lat, t.lng), [x2, y2] = P.xy(i.lat, i.lng), km = haversine(t.lat, t.lng, i.lat, i.lng);
    g += `<line class="route" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text class="rl" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}">${km.toFixed(1)} km</text>`;
  });
  if (o.candidate && o.focusId) { // dotted line to the nearest suitable team
    const i = o.incs.find(x => x.id === o.focusId), t = o.candidate;
    const [x1, y1] = P.xy(t.lat, t.lng), [x2, y2] = P.xy(i.lat, i.lng);
    g += `<line class="cline" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text class="rl" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}">${haversine(t.lat, t.lng, i.lat, i.lng).toFixed(1)} km</text>`;
  }
  o.teams.forEach(t => {
    const [x, y] = P.xy(t.lat, t.lng);
    g += `<g ${o.clickable ? `data-team="${t.id}"` : ''}><title>${esc(t.name)} (${t.type}, ${t.status})</title><rect class="tm ${t.status}" x="${x - 12}" y="${y - 12}" width="24" height="24" rx="6"/>
      <text class="mt" x="${x}" y="${y + 4}">${TYPE_LETTER[t.type] || '?'}</text><text class="tl" x="${x}" y="${y + 28}">${esc(t.id)}</text></g>`;
  });
  o.incs.forEach(i => {
    const [x, y] = P.xy(i.lat, i.lng), r = o.ranks && o.ranks[i.id];
    g += `<g ${o.clickable ? `data-open="${i.id}"` : ''}><title>${esc(i.title)} (${i.severity})</title>${i.severity === 'Critical' && isOpen(i) ? `<circle class="ring" cx="${x}" cy="${y}" r="13"/>` : ''}
      <circle class="mk ${i.severity}" cx="${x}" cy="${y}" r="${i.id === o.focusId ? 15 : 13}"/><text class="mt ${i.severity === 'Medium' ? 'dk' : ''}" x="${x}" y="${y + 4}">${r || '!'}</text></g>`;
  });
  if (o.extra && isFinite(o.extra.lat) && isFinite(o.extra.lng)) {
    const [x, y] = P.xy(o.extra.lat, o.extra.lng);
    g += `<circle class="pin" cx="${x}" cy="${y}" r="9"/><line class="pin" x1="${x - 16}" y1="${y}" x2="${x + 16}" y2="${y}"/><line class="pin" x1="${x}" y1="${y - 16}" x2="${x}" y2="${y + 16}"/>`;
  }
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].filter(n => n / P.kpp <= 150).pop() || 0.1, w = nice / P.kpp;
  g += `<path class="sc" d="M20 ${MAP_H - 18} v8 h${w} v-8"/><text class="tl" x="${20 + w / 2}" y="${MAP_H - 22}">${nice} km</text>`;
  return `<svg class="map" viewBox="0 0 ${MAP_W} ${MAP_H}" data-map="${id}" role="img" aria-label="Map of incidents and response teams">${g}</svg>`;
}
function rankMap() { const r = {}; byPriority().forEach((i, k) => r[i.id] = k + 1); return r; }

/* ---------- 6. Rendering ---------- */
function renderAll() {
  renderDashboard(); renderIncidents(); renderTeams(); renderLiveMap(); renderAnalytics(); renderBanner();
  $('#navCount').textContent = incidents.length; $('#navTeams').textContent = teams.length;
}
function renderBanner() {
  const crit = incidents.filter(i => i.severity === 'Critical' && isOpen(i));
  if (!crit.length || bannerDismissed) { $('#alertBanner').classList.add('hidden'); return; }
  const waiting = crit.filter(i => !i.teamId).length;
  $('#bannerText').textContent = `${crit.length} critical emergenc${crit.length > 1 ? 'ies' : 'y'} open, ${waiting} still waiting for a response team.`;
  $('#alertBanner').classList.remove('hidden');
}
function renderDashboard() {
  const n = f => incidents.filter(f).length;
  $('#statTotal').textContent = incidents.length;
  $('#statCritical').textContent = n(i => i.severity === 'Critical' && isOpen(i));
  $('#statAvail').textContent = teams.filter(t => t.status === 'Available').length;
  $('#statBusy').textContent = teams.filter(t => t.status === 'Busy').length;
  $('#statAssigned').textContent = n(i => i.teamId && isOpen(i));
  $('#statResolved').textContent = n(i => i.status === 'Resolved');

  const q = byPriority().slice(0, 6);
  $('#queue').innerHTML = q.length ? q.map((i, k) => rowHTML(i, { rank: k + 1, queue: true })).join('') : '<div class="empty">No open incidents. All clear.</div>';
  const counts = CATEGORIES.map(c => n(i => i.category === c)), max = Math.max(1, ...counts);
  $('#catStats').innerHTML = CATEGORIES.map((c, k) => bar(c, counts[k], max)).join('');
  $('#teamStats').innerHTML = TEAM_TYPES.map(ty => {
    const all = teams.filter(t => t.type === ty), av = all.filter(t => t.status === 'Available').length;
    return bar(ty, av, all.length, 'Low', `${av}/${all.length}`);
  }).join('') + '<p class="muted">Available teams out of total, per response category.</p>';
  renderHotspots();
  const total = incidents.reduce((s, i) => s + i.people, 0);
  $('#quickStats').innerHTML = [
    [openIncidents().length, 'Open incidents'], [total, 'People affected'],
    [incidents.length ? Math.round(n(i => i.status === 'Resolved') / incidents.length * 100) + '%' : '0%', 'Resolution rate'],
    [n(i => isOpen(i) && !i.teamId), 'Waiting for a team']
  ].map(x => `<div><b>${x[0]}</b><span>${x[1]}</span></div>`).join('');
}
function renderHotspots() {
  const map = {};
  incidents.forEach(i => {
    const k = i.location.trim().toLowerCase(), h = map[k] || (map[k] = { name: i.location.trim(), count: 0, weight: 0, top: 'Low' });
    h.count++; h.weight += SEV_WEIGHT[i.severity] * (isOpen(i) ? 1 : 0.4);
    if (SEV_WEIGHT[i.severity] > SEV_WEIGHT[h.top]) h.top = i.severity;
  });
  const list = Object.values(map).sort((a, b) => b.weight - a.weight).slice(0, 5), max = Math.max(1, ...list.map(h => h.weight));
  const col = { Critical: 'var(--red)', High: 'var(--orange)', Medium: 'var(--yellow)', Low: 'var(--green)' };
  $('#hotspots').innerHTML = list.length ? list.map(h => {
    const size = 34 + Math.round(h.weight / max * 26);
    return `<div class="hot"><div class="hot-dot" style="width:${size}px;height:${size}px;background:${col[h.top]}">${h.count}</div><div class="hot-info"><b>${esc(h.name)}</b>
      <div class="track"><div class="fill ${h.top}" style="width:${h.weight / max * 100}%"></div></div><small class="muted">${h.count} report${h.count > 1 ? 's' : ''}, highest: ${h.top}</small></div></div>`;
  }).join('') : '<div class="empty">No locations yet.</div>';
}
function renderIncidents() {
  const q = filters.q.toLowerCase();
  const list = incidents.filter(i => (!filters.cat || i.category === filters.cat) && (!filters.sev || i.severity === filters.sev) && (!filters.status || i.status === filters.status) &&
    (!q || (i.title + ' ' + i.location + ' ' + i.id + ' ' + i.description + ' ' + ((getTeam(i.teamId) || {}).name || '')).toLowerCase().includes(q)));
  list.sort(filters.sort === 'newest' ? (a, b) => b.created - a.created : (a, b) => priority(b).score - priority(a).score || b.created - a.created);
  $('#resultCount').textContent = `Showing ${list.length} of ${incidents.length} incidents, sorted by ${filters.sort === 'newest' ? 'newest first' : 'priority'}`;
  $('#incidentList').innerHTML = list.length ? list.map(i => rowHTML(i, { del: true })).join('') : '<div class="card empty">No incidents match your filters.</div>';
}
function renderTeams() {
  $('#teamCount').textContent = `${teams.length} teams: ${teams.filter(t => t.status === 'Available').length} available, ${teams.filter(t => t.status === 'Busy').length} busy`;
  $('#teamList').innerHTML = teams.length ? teams.map(t => {
    const inc = getInc(t.incidentId);
    return `<div class="card team ${t.status}"><h3>${esc(t.name)}</h3><small class="muted">${esc(t.id)}</small>
      <div class="badges"><span class="badge type">${t.type}</span><span class="badge ${t.status}">${t.status}</span></div>
      <div class="m">Location: ${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}</div>
      <div class="m">Assigned incident: ${inc ? `<a href="#" data-open="${inc.id}">${esc(inc.title)}</a>` : 'None'}</div>
      <div class="actions"><button class="btn sm dark" data-tedit="${t.id}">Edit</button>
      <button class="btn sm ghost-dark" data-ttoggle="${t.id}" ${t.incidentId ? 'disabled title="Team is on an incident"' : ''}>Mark ${t.status === 'Available' ? 'busy' : 'available'}</button></div></div>`;
  }).join('') : '<div class="card empty">No teams yet. Add one above.</div>';
}
function renderLiveMap() {
  const open = openIncidents();
  $('#liveMap').innerHTML = mapHTML('live', { incs: open, teams, clickable: true, ranks: rankMap() });
  const act = open.filter(i => i.teamId);
  $('#routeList').innerHTML = act.length ? act.map(i => {
    const t = getTeam(i.teamId), km = haversine(t.lat, t.lng, i.lat, i.lng);
    return `<div class="row ${i.severity}" data-open="${i.id}" role="button" tabindex="0"><span class="badge ${i.severity}">${i.severity}</span>
      <div><div class="t">${esc(t.name)} &rarr; ${esc(i.title)}</div><div class="m">${km.toFixed(1)} km &middot; ETA ${eta(km)} min</div></div><span></span><span class="badge status ${cls(i.status)}">${i.status}</span><span></span></div>`;
  }).join('') : '<div class="empty">No active assignments.</div>';
}
function renderAnalytics() {
  const n = f => incidents.filter(f).length;
  const sc = SEVERITIES.map(s => n(i => i.severity === s)), sm = Math.max(1, ...sc);
  $('#sevChart').innerHTML = SEVERITIES.map((s, k) => bar(s, sc[k], sm, s)).join('');
  const tc = STATUSES.map(s => n(i => i.status === s)), tm = Math.max(1, ...tc);
  $('#statusChart').innerHTML = STATUSES.map((s, k) => bar(s, tc[k], tm, cls(s))).join('');
  $('#typeChart').innerHTML = TEAM_TYPES.map(ty => {
    const all = teams.filter(t => t.type === ty), busy = all.filter(t => t.status === 'Busy').length;
    return bar(ty, busy, all.length, 'High', `${busy}/${all.length}`);
  }).join('') + '<p class="muted">Busy teams out of total, per response category.</p>';
  const as = incidents.filter(i => i.assignedAt), km = incidents.filter(i => i.dispatchKm != null);
  const avgAssign = as.length ? Math.round(as.reduce((s, i) => s + (i.assignedAt - i.created), 0) / as.length / 60000) : 0;
  const avgKm = km.length ? (km.reduce((s, i) => s + i.dispatchKm, 0) / km.length).toFixed(1) : '0';
  const open = openIncidents(), avgP = open.length ? Math.round(open.reduce((s, i) => s + priority(i).score, 0) / open.length) : 0;
  const cc = CATEGORIES.map(c => n(i => i.category === c));
  $('#kpis').innerHTML = [
    [teams.length ? Math.round(teams.filter(t => t.status === 'Busy').length / teams.length * 100) + '%' : '0%', 'Team utilisation'],
    [avgAssign + ' min', 'Avg time to assign'], [avgKm + ' km', 'Avg dispatch distance'], [avgP, 'Avg open priority score'],
    [incidents.length ? CATEGORIES[cc.indexOf(Math.max(...cc))] : 'None', 'Most common category'],
    [n(i => i.severity === 'Critical' && isOpen(i) && !i.teamId), 'Critical, no team yet']
  ].map(x => `<div><b>${esc(x[0])}</b><span>${x[1]}</span></div>`).join('');
}

/* ---------- 7. Report form ---------- */
const FIELDS = ['title', 'description', 'category', 'people', 'location', 'lat', 'lng', 'contact'];
const readForm = () => { const f = {}; FIELDS.forEach(k => f[k] = $('#' + k).value.trim()); return f; };
const validCoord = (v, lim) => v !== '' && isFinite(Number(v)) && Math.abs(Number(v)) <= lim;
function validate(f) {
  const e = {};
  if (f.title.length < 3) e.title = 'Enter a title of at least 3 characters.';
  if (f.description.length < 10) e.description = 'Describe the situation in at least 10 characters.';
  if (!CATEGORIES.includes(f.category)) e.category = 'Choose an emergency category.';
  if (f.location.length < 3) e.location = 'Enter the location name.';
  if (f.people === '' || !/^\d+$/.test(f.people) || Number(f.people) > 100000) e.people = 'Enter a whole number from 0 to 100000.';
  if (!validCoord(f.lat, 90)) e.lat = 'Enter latitude between -90 and 90.';
  if (!validCoord(f.lng, 180)) e.lng = 'Enter longitude between -180 and 180.';
  if (f.contact && !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contact) || /^\+?[\d\s-]{7,15}$/.test(f.contact))) e.contact = 'Enter a valid phone number or email, or leave blank.';
  return e;
}
function showErrors(e) { FIELDS.forEach(k => { $('#err-' + k).textContent = e[k] || ''; $('#' + k).classList.toggle('invalid', !!e[k]); }); }
function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}
function textOverlap(a, b) {
  const A = normalizeText(a), B = normalizeText(b), inter = A.filter(w => B.includes(w));
  if (!A.length && !B.length) return 0;
  return inter.length / Math.max(new Set([...A, ...B]).size, 1);
}
function findDuplicate(f) {
  if (!f || !f.title || !f.location) return false;
  const fLat = Number(f.lat), fLng = Number(f.lng);
  const titleWords = normalizeText(f.title);
  return incidents.some(i => {
    if (!i || typeof i !== 'object') return false;
    if (Date.now() - (i.created || 0) > 60 * 60000) return false;
    const sameLocation = String(i.location || '').trim().toLowerCase() === String(f.location || '').trim().toLowerCase() ||
      (Number.isFinite(fLat) && Number.isFinite(fLng) && Number.isFinite(i.lat) && Number.isFinite(i.lng) && haversine(fLat, fLng, Number(i.lat), Number(i.lng)) <= 0.5);
    if (!sameLocation) return false;
    const titleOverlap = textOverlap(i.title, f.title);
    const descriptionOverlap = textOverlap((i.description || '') + ' ' + (i.title || ''), (f.description || '') + ' ' + (f.title || ''));
    const categoryMatch = i.category === f.category;
    const keywordMatch = titleWords.some(w => w.length > 3 && ((i.title || '') + ' ' + (i.description || '')).toLowerCase().includes(w));
    return categoryMatch ? (titleOverlap >= 0.25 || descriptionOverlap >= 0.2 || keywordMatch) : (titleOverlap >= 0.5 || descriptionOverlap >= 0.35 || keywordMatch);
  });
}
function formPoint() { const f = readForm(); return validCoord(f.lat, 90) && validCoord(f.lng, 180) ? { lat: Number(f.lat), lng: Number(f.lng) } : null; }
function renderPickMap() { $('#pickMap').innerHTML = mapHTML('pick', { incs: openIncidents(), teams, extra: formPoint() }); }
function updatePreview() {
  const f = readForm();
  if (!f.category && !f.description) { $('#previewBody').innerHTML = 'Fill in the form to see severity, priority and the nearest suitable team.'; return; }
  const c = classify(f.category, f.people, f.description), pt = formPoint();
  const tmp = { category: f.category, severity: c.severity, people: Number(f.people) || 0, created: Date.now(), status: 'Reported' };
  const p = priority(tmp);
  let team = '<p class="muted">Enter coordinates to find the nearest suitable team.</p>';
  if (pt && f.category) {
    const r = rankTeams({ category: f.category, lat: pt.lat, lng: pt.lng })[0];
    team = r ? `<p>Nearest suitable team: <b>${esc(r.team.name)}</b> (${r.team.type}), ${r.km.toFixed(1)} km away, ETA ${r.eta} min.</p>` : '<p class="team-line none">No suitable team is available right now.</p>';
  }
  const g = GUIDANCE[f.category] || [];
  $('#previewBody').innerHTML = `<p>Severity: <span class="badge ${c.severity}">${c.severity}</span> &nbsp; Starting priority: <span class="pscore pl-${p.level}">${p.level} priority · ${p.score}</span></p>
    <ul class="reasons">${c.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>${team}
    ${g.length ? `<h2 style="font-size:15px">Suggested response</h2><ul class="guide">${g.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
}
function submitReport(ev) {
  ev.preventDefault();
  const f = readForm(), e = validate(f);
  showErrors(e);
  if (Object.keys(e).length) { toast('Please fix the highlighted fields.', true); return; }
  if (findDuplicate(f) && !confirm('Possible duplicate report detected nearby. This may be a repeat or a related event. Submit anyway?')) {
    toast('Duplicate report flagged for review. Submission cancelled.', true);
    return;
  }
  const inc = buildIncident(f);
  incidents.unshift(inc);
  let msg = `Report ${inc.id} submitted. Severity: ${inc.severity}.`;
  if (inc.severity === 'Critical') {
    bannerDismissed = false;
    if ($('#autoDispatch').checked) msg += autoAssign(inc) ? ` Auto-dispatched ${getTeam(inc.teamId).name}.` : ' No team available for auto-dispatch.';
  }
  saveData(); clearForm(); renderAll(); toast(msg);
  showView('incidents'); openModal(inc.id);
}
function clearForm() { $('#reportForm').reset(); $('#people').value = 1; showErrors({}); updatePreview(); renderPickMap(); }
function fillZone(sel, latId, lngId, locId) {
  const z = ZONES.find(a => a[0] === sel.value);
  if (!z) return;
  $('#' + latId).value = z[1]; $('#' + lngId).value = z[2];
  if (locId) $('#' + locId).value = z[0];
}

/* ---------- 8. Incident modal ---------- */
function openModal(id) {
  const i = getInc(id); if (!i) return;
  const box = $('#modalBox'), scroll = box.scrollTop;
  openId = id; openTeamId = null;
  const t = getTeam(i.teamId), p = priority(i), cands = !t && isOpen(i) ? rankTeams(i) : [];
  const lastAssignment = getLatestAssignment(i);
  let assign;
  if (i.status === 'Resolved') {
    if (lastAssignment) {
      assign = `<p><b>${esc(lastAssignment.teamName || 'Former team')}</b> <span class="badge type">${esc(lastAssignment.teamType || 'Historic')}</span></p>
        <p class="m">Team ID ${esc(lastAssignment.teamId)} &middot; assigned ${new Date(lastAssignment.assignedAt || i.created).toLocaleString()} &middot; dispatch distance ${lastAssignment.dispatchKm != null ? lastAssignment.dispatchKm.toFixed(1) + ' km' : 'not recorded'}</p>
        <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm red" id="mReopen">Reopen & reassign</button></div>`;
    } else {
      assign = '<p class="muted">This incident is resolved without a recorded response team.</p><div class="actions" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm red" id="mReopen">Reopen & reassign</button></div>';
    }
  } else if (t) {
    const km = haversine(t.lat, t.lng, i.lat, i.lng);
    assign = `<p><b>${esc(t.name)}</b> <span class="badge type">${t.type}</span> <span class="badge ${t.status}">${t.status}</span></p>
      <p class="m">Team ID ${esc(t.id)} &middot; currently at ${t.lat.toFixed(4)}, ${t.lng.toFixed(4)} &middot; <b>${km.toFixed(1)} km away, ETA ${eta(km)} min</b></p>
      <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm danger" id="mUnassign">Unassign team</button>
      <button class="btn sm dark" id="mMarkArrived">Mark arrived</button>
      <a class="btn sm blue" style="text-decoration:none" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${t.lat},${t.lng}&destination=${i.lat},${i.lng}">Open route in Google Maps</a></div>`;
  } else {
    assign = cands.length ? `<p class="muted">Suitable available teams, best fit first (distance plus a penalty for less suitable team types):</p>` +
      cands.slice(0, 4).map((c, k) => `<div class="cand ${k === 0 ? 'best' : ''}"><div><b>${esc(c.team.name)}</b> <span class="badge type">${c.team.type}</span> ${k === 0 ? '<span class="badge Low">Best fit</span>' : ''}<br><small>${c.km.toFixed(1)} km &middot; ETA ${c.eta} min &middot; ${c.best ? 'primary match' : 'backup type'}</small></div>
      <button class="btn sm ${k === 0 ? 'red' : 'dark'}" data-assign="${c.team.id}">Assign</button></div>`).join('')
      : '<p class="team-line none">No suitable team is currently available. Free up a team or add a new one.</p>';
  }
  const cand0 = cands[0] ? cands[0].team : null;
  box.innerHTML = `<div class="modal-head"><div><small class="muted">${i.id}</small><h2 style="font-size:21px">${esc(i.title)}</h2></div><div><span class="badge ${i.severity}">${i.severity}</span> <span class="pscore pl-${p.level}">${isOpen(i) ? p.level + ' priority · ' + p.score : 'Resolved'}</span></div></div>
    <p>${esc(i.description)}</p>
    <dl><dt>Category</dt><dd>${esc(i.category)}</dd><dt>Location</dt><dd>${esc(i.location)} (${i.lat.toFixed(4)}, ${i.lng.toFixed(4)})</dd><dt>People affected</dt><dd>${i.people}</dd>
    <dt>Contact</dt><dd>${esc(i.contact) || 'Not provided'}</dd><dt>Reported</dt><dd>${new Date(i.created).toLocaleString()} (${ago(i.created)})</dd>
    <dt>Priority breakdown</dt><dd>${isOpen(i) ? `Severity ${p.parts[0]} + people ${p.parts[1]} + category ${p.parts[2]} + waiting time ${p.parts[3]} = ${p.score}/100` : 'Not applicable (resolved)'}</dd></dl>
    <h2 style="font-size:15px">Location and route</h2>
    ${mapHTML('modal', { incs: [i], teams: t ? [t] : cands.slice(0, 3).map(c => c.team), focusId: i.id, candidate: cand0 })}
    <p class="muted" style="margin-top:8px">This map is a simulated coordinate view, not live road navigation. Google Maps opens live directions separately.</p>
    <div class="assign-box"><h2 style="font-size:15px">Response team</h2>${assign}</div>
    <div class="manage">
      <div class="field"><label for="mStatus">Status</label><select id="mStatus">${options(getValidStatusOptions(i), i.status)}</select></div>
      <div class="field"><label for="mSev">Severity ${i.manual ? '(manually set)' : '(automatic)'}</label><select id="mSev">${options(SEVERITIES, i.severity)}</select></div>
    </div>
    ${i.manual ? `<p class="muted">Automatic rating was ${i.autoSeverity}. <button class="btn ghost-dark sm" id="mRevert">Restore automatic rating</button></p>` : ''}
    <h2 style="font-size:15px">Why this severity</h2><ul class="reasons">${(i.reasons || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <h2 style="font-size:15px">Suggested response</h2><ul class="guide">${(GUIDANCE[i.category] || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <h2 style="font-size:15px;margin-top:12px">Incident timeline</h2><ul class="timeline">${(i.log || []).map(l => `<li><small>${new Date(l.t).toLocaleTimeString()}</small>${esc(l.text)}</li>`).join('')}</ul>
    <div class="modal-actions" style="margin-top:18px"><button class="btn danger" id="mDelete">Delete report</button><button class="btn ghost-dark" id="mClose">Close</button></div>`;
  $('#modal').classList.remove('hidden'); box.scrollTop = scroll;
}
function closeModal() { openId = null; openTeamId = null; $('#modal').classList.add('hidden'); }
function afterChange(msg, isErr) { saveData(); renderAll(); if (openId) openModal(openId); toast(msg, isErr); }
function deleteIncident(id) {
  const i = getInc(id); if (!i || !confirm('Delete this report permanently? This cannot be undone.')) return;
  if (i.teamId) releaseTeam(i, false);
  incidents = incidents.filter(x => x.id !== id);
  saveData(); closeModal(); renderAll(); toast('Report deleted.');
}

/* ---------- 9. Teams ---------- */
function nextTeamId(type) {
  const prefix = { Fire: 'FIRE', Medical: 'MED', Rescue: 'RSC', Traffic: 'TRF' }[type]; let k = 1;
  while (getTeam(prefix + '-' + String(k).padStart(2, '0'))) k++;
  return prefix + '-' + String(k).padStart(2, '0');
}
function submitTeam(ev) {
  ev.preventDefault();
  const name = $('#tName').value.trim(), lat = $('#tLat').value.trim(), lng = $('#tLng').value.trim(), e = {};
  if (name.length < 3) e.tName = 'Enter a team name of at least 3 characters.';
  else if (teams.some(t => t.name.toLowerCase() === name.toLowerCase())) e.tName = 'A team with this name already exists.';
  if (!validCoord(lat, 90)) e.tLat = 'Latitude must be between -90 and 90.';
  if (!validCoord(lng, 180)) e.tLng = 'Longitude must be between -180 and 180.';
  ['tName', 'tLat', 'tLng'].forEach(k => { $('#err-' + k).textContent = e[k] || ''; $('#' + k).classList.toggle('invalid', !!e[k]); });
  if (Object.keys(e).length) { toast('Please fix the highlighted fields.', true); return; }
  const type = $('#tType').value;
  teams.push({ id: nextTeamId(type), name, type, lat: Number(lat), lng: Number(lng), status: 'Available', incidentId: null });
  $('#teamForm').reset(); saveData(); renderAll(); toast(`Team ${name} added.`);
}
function openTeam(id) {
  const t = getTeam(id); if (!t) return;
  openTeamId = id; openId = null;
  const inc = getInc(t.incidentId);
  $('#modalBox').innerHTML = `<div class="modal-head"><div><small class="muted">${esc(t.id)}</small><h2 style="font-size:21px">Edit team</h2></div><span class="badge ${t.status}">${t.status}</span></div>
    <div class="manage" style="grid-template-columns:1fr 1fr">
      <div class="field"><label for="tmName">Team name</label><input id="tmName" value="${esc(t.name)}" maxlength="40"></div>
      <div class="field"><label for="tmType">Response category</label><select id="tmType" ${t.incidentId ? 'disabled' : ''}>${options(TEAM_TYPES, t.type)}</select></div>
      <div class="field"><label for="tmLat">Current latitude</label><input id="tmLat" value="${t.lat}" ${t.incidentId ? 'disabled' : ''}></div>
      <div class="field"><label for="tmLng">Current longitude</label><input id="tmLng" value="${t.lng}" ${t.incidentId ? 'disabled' : ''}></div>
      <div class="field"><label for="tmStatus">Availability</label><select id="tmStatus" ${inc ? 'disabled' : ''}>${options(['Available', 'Busy'], t.status)}</select></div>
    </div>
    <p class="muted">${inc ? `Assigned to <a href="#" data-open="${inc.id}">${esc(inc.title)}</a>. Status changes automatically with the incident.${t.incidentId ? ' The response category and current location are locked while the team is assigned.' : ''}` : 'Not assigned to any incident.'}</p>
    <small class="err" id="err-tm"></small>
    <div class="modal-actions" style="margin-top:14px"><button class="btn danger" id="tmDelete">Delete team</button><div><button class="btn red" id="tmSave">Save changes</button> <button class="btn ghost-dark" id="mClose">Close</button></div></div>`;
  $('#modal').classList.remove('hidden');
}
function saveTeam() {
  const t = getTeam(openTeamId), name = $('#tmName').value.trim(), lat = $('#tmLat').value.trim(), lng = $('#tmLng').value.trim();
  const nextType = $('#tmType').value;
  let err = '';
  if (name.length < 3) err = 'Team name must have at least 3 characters.';
  else if (teams.some(x => x.id !== t.id && x.name.toLowerCase() === name.toLowerCase())) err = 'Another team already uses this name.';
  else if (t.incidentId && nextType !== t.type) err = 'The response category is locked while this team is assigned to an incident.';
  else if (t.incidentId && (!$('#tmLat').disabled || !$('#tmLng').disabled)) err = 'The team location is locked while it is assigned to an incident.';
  else if (!validCoord(lat, 90) || !validCoord(lng, 180)) err = 'Enter valid latitude and longitude.';
  if (err) { $('#err-tm').textContent = err; return; }
  t.name = name; t.type = nextType; if (!t.incidentId) { t.lat = Number(lat); t.lng = Number(lng); }
  if (!t.incidentId) t.status = $('#tmStatus').value;
  saveData(); closeModal(); renderAll(); toast('Team updated.');
}
function deleteTeam() {
  const t = getTeam(openTeamId); if (!t || !confirm('Delete this team? Any incident it is handling will return to Reported.')) return;
  const inc = getInc(t.incidentId);
  if (inc) {
    releaseTeam(inc, false);
    if (inc.status !== 'Resolved') inc.status = 'Reported';
    logEvt(inc, t.name + ' removed from the system, incident needs a new team');
  }
  teams = teams.filter(x => x.id !== t.id);
  saveData(); closeModal(); renderAll(); toast('Team deleted.');
}

/* ---------- 10. CSV export ---------- */
function exportCSV() {
  if (!incidents.length) { toast('There are no incidents to export.', true); return; }
  const head = ['ID', 'Title', 'Description', 'Category', 'Location', 'Latitude', 'Longitude', 'People affected', 'Contact', 'Severity', 'Priority score', 'Status', 'Assigned team', 'Dispatch distance km', 'Reported at'];
  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = incidents.map(i => {
    const t = getTeam(i.teamId);
    const last = getLatestAssignment(i);
    const teamName = t ? t.name : last ? last.teamName : '';
    return [i.id, i.title, i.description, i.category, i.location, i.lat, i.lng, i.people, i.contact, i.severity, priority(i).score, i.status, teamName, i.dispatchKm != null ? i.dispatchKm.toFixed(2) : '', new Date(i.created).toISOString()].map(cell).join(',');
  });
  const blob = new Blob(['\uFEFF' + [head.map(cell).join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'incident-report-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href); toast('CSV downloaded.');
}

/* ---------- 11. Navigation and init ---------- */
const TITLES = { dashboard: 'Command dashboard', report: 'Report an emergency', incidents: 'Incident management', teams: 'Response teams', map: 'Operations map', analytics: 'Analytics' };
function showView(v) {
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('hidden', s.id !== 'view-' + v));
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $('#pageTitle').textContent = TITLES[v]; $('#sidebar').classList.remove('open');
  if (v === 'report') renderPickMap();
  window.scrollTo(0, 0);
}
function syncFilters() {
  $('#searchInput').value = filters.q; $('#filterCat').value = filters.cat; $('#filterSev').value = filters.sev;
  $('#filterStatus').value = filters.status; $('#sortSel').value = filters.sort;
}
function init() {
  if (!loadData()) { demoData(); saveData(); }
  let auto = true; try { auto = localStorage.getItem(KEY_AUTO) !== 'off'; } catch (e) { /* default on */ }
  $('#autoDispatch').checked = auto;
  const zoneOpts = ZONES.map(z => `<option>${z[0]}</option>`).join('');
  $('#category').insertAdjacentHTML('beforeend', options(CATEGORIES));
  $('#filterCat').insertAdjacentHTML('beforeend', options(CATEGORIES));
  $('#filterSev').insertAdjacentHTML('beforeend', options(SEVERITIES));
  $('#filterStatus').insertAdjacentHTML('beforeend', options(STATUSES));
  $('#zone').insertAdjacentHTML('beforeend', zoneOpts); $('#tZone').insertAdjacentHTML('beforeend', zoneOpts);
  $('#tType').innerHTML = options(TEAM_TYPES);

  document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#quickReport').addEventListener('click', () => showView('report'));
  $('#exportBtn').addEventListener('click', exportCSV);
  $('#autoDispatch').addEventListener('change', e => { try { localStorage.setItem(KEY_AUTO, e.target.checked ? 'on' : 'off'); } catch (x) { /* ignore */ } toast('Auto-dispatch ' + (e.target.checked ? 'enabled' : 'disabled') + '.'); });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Reset all incidents and teams to the demo data? Your changes will be removed.')) return;
    demoData(); bannerDismissed = false; saveData(); closeModal(); renderAll(); toast('Demo data restored.');
  });
  $('#bannerClose').addEventListener('click', () => { bannerDismissed = true; renderBanner(); });
  $('#bannerView').addEventListener('click', () => { filters = { q: '', cat: '', sev: 'Critical', status: '', sort: 'priority' }; syncFilters(); renderIncidents(); showView('incidents'); });
  $('#autoAllBtn').addEventListener('click', () => {
    let done = 0, missed = 0;
    byPriority().filter(i => !i.teamId).forEach(i => autoAssign(i) ? done++ : missed++);
    saveData(); renderAll(); toast(done ? `${done} incident${done > 1 ? 's' : ''} assigned the nearest suitable team.${missed ? ' ' + missed + ' had no team available.' : ''}` : (missed ? 'No suitable teams are available.' : 'All open incidents already have a team.'), !done && missed > 0);
  });

  $('#reportForm').addEventListener('submit', submitReport);
  $('#reportForm').addEventListener('input', updatePreview);
  ['lat', 'lng'].forEach(k => $('#' + k).addEventListener('input', renderPickMap));
  $('#zone').addEventListener('change', e => { fillZone(e.target, 'lat', 'lng', 'location'); updatePreview(); renderPickMap(); });
  $('#tZone').addEventListener('change', e => fillZone(e.target, 'tLat', 'tLng'));
  $('#clearForm').addEventListener('click', clearForm);
  $('#geoBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('Location is not supported in this browser.', true); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      $('#lat').value = pos.coords.latitude.toFixed(5); $('#lng').value = pos.coords.longitude.toFixed(5);
      if (!$('#location').value.trim()) $('#location').value = 'My current location';
      updatePreview(); renderPickMap(); toast('Location captured.');
    }, () => toast('Could not get your location. Allow location access or enter coordinates.', true), { timeout: 8000 });
  });
  $('#teamForm').addEventListener('submit', submitTeam);

  $('#searchInput').addEventListener('input', e => { filters.q = e.target.value; renderIncidents(); });
  $('#filterCat').addEventListener('change', e => { filters.cat = e.target.value; renderIncidents(); });
  $('#filterSev').addEventListener('change', e => { filters.sev = e.target.value; renderIncidents(); });
  $('#filterStatus').addEventListener('change', e => { filters.status = e.target.value; renderIncidents(); });
  $('#sortSel').addEventListener('change', e => { filters.sort = e.target.value; renderIncidents(); });
  $('#clearFilters').addEventListener('click', () => { filters = { q: '', cat: '', sev: '', status: '', sort: 'priority' }; syncFilters(); renderIncidents(); });

  // One delegated click handler for rows, map markers, buttons and modal controls
  document.addEventListener('click', e => {
    const T = e.target, pick = T.closest('svg[data-map="pick"]');
    if (pick) { // drop a pin on the report-form map
      const r = pick.getBoundingClientRect(), [la, lo] = maps.pick.ll((e.clientX - r.left) * MAP_W / r.width, (e.clientY - r.top) * MAP_H / r.height);
      $('#lat').value = la.toFixed(5); $('#lng').value = lo.toFixed(5); $('#zone').value = '';
      const loc = $('#location'); if (!loc.value.trim() || loc.value.startsWith('Map pin')) loc.value = `Map pin (${la.toFixed(3)}, ${lo.toFixed(3)})`;
      updatePreview(); renderPickMap(); return;
    }
    let el;
    if ((el = T.closest('[data-del]'))) return deleteIncident(el.dataset.del);
    if ((el = T.closest('[data-tedit]'))) return openTeam(el.dataset.tedit);
    if ((el = T.closest('[data-ttoggle]'))) {
      const t = getTeam(el.dataset.ttoggle); if (t && !t.incidentId) { t.status = t.status === 'Available' ? 'Busy' : 'Available'; saveData(); renderAll(); toast(`${t.name} marked ${t.status.toLowerCase()}.`); }
      return;
    }
    if ((el = T.closest('[data-auto]'))) {
      const inc = getInc(el.dataset.auto), ok = autoAssign(inc);
      if (ok) afterChange(`${getTeam(inc.teamId).name} assigned (${inc.dispatchKm.toFixed(1)} km away).`); else toast('No suitable team is available for this incident.', true);
      return;
    }
    if ((el = T.closest('[data-assign]'))) {
      const inc = getInc(openId), t = getTeam(el.dataset.assign);
      if (inc && t && assignTeam(inc, t, false)) afterChange(`${t.name} assigned to ${inc.id}.`); else toast('That team is no longer available.', true);
      return;
    }
    if ((el = T.closest('[data-open]'))) { e.preventDefault(); return openModal(el.dataset.open); }
    if ((el = T.closest('[data-team]'))) return openTeam(el.dataset.team);
    if (T.id === 'mClose' || T.id === 'modal') closeModal();
    if (T.id === 'mDelete') deleteIncident(openId);
    if (T.id === 'tmSave') saveTeam();
    if (T.id === 'tmDelete') deleteTeam();
    if (T.id === 'mReopen') {
      const inc = getInc(openId);
      if (inc) reopenForReassignment(inc);
      return;
    }
    if (T.id === 'mMarkArrived') {
      const inc = getInc(openId);
      if (inc) markTeamArrived(inc);
      return;
    }
    if (T.id === 'mUnassign') {
      const inc = getInc(openId), t = getTeam(inc.teamId);
      releaseTeam(inc, false); if (inc.status !== 'Resolved') inc.status = 'Reported';
      logEvt(inc, (t ? t.name : 'Team') + ' unassigned'); afterChange('Team unassigned and set to available.');
    }
    if (T.id === 'mRevert') { const inc = getInc(openId); inc.severity = inc.autoSeverity; inc.manual = false; logEvt(inc, 'Automatic severity restored'); afterChange('Automatic severity restored.'); }
  });
  document.addEventListener('change', e => {
    if (!openId) return;
    const inc = getInc(openId);
    if (e.target.id === 'mStatus') {
      const err = setStatus(inc, e.target.value);
      err ? (toast(err, true), openModal(openId)) : afterChange('Status updated to ' + inc.status + '.');
    }
    if (e.target.id === 'mSev') {
      inc.manual = e.target.value !== inc.autoSeverity; inc.severity = e.target.value;
      logEvt(inc, 'Severity set to ' + inc.severity + (inc.manual ? ' manually' : ' (automatic)')); afterChange('Severity set to ' + inc.severity + '.');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (openId || openTeamId)) closeModal();
    if (e.key === 'Enter' && e.target.matches && e.target.matches('.row')) openModal(e.target.dataset.open);
  });
  setInterval(() => { renderAll(); if (openId) openModal(openId); }, 60000); // keeps waiting-time priority current
  renderAll(); updatePreview(); renderPickMap();
}
init();
