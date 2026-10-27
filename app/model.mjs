export const SAMPLE_ID = 'sample';
export const TAGS = ['note', 'mistake', 'good', 'objective'];
export const fmt = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, '0')}`;
export const clamp = (n, max) => Math.max(0, Math.min(max, n));
export const color = team => team === 0 ? '#e7ae58' : '#87b2e7';

export function parseTimestamp(value, duration) {
  if (!Number.isFinite(duration)) throw new Error('Wait for the match to load.');
  if (!/^\d+:[0-5]\d$/.test(value.trim())) throw new Error('Enter a timestamp as minutes:seconds, e.g. 12:40.');
  const [minutes, seconds] = value.trim().split(':').map(Number);
  const t = minutes * 60 + seconds;
  if (!Number.isFinite(t) || t > duration) throw new Error(`Timestamp must be between 0:00 and ${fmt(duration)}.`);
  return t;
}

export function playbackTime(state, duration, now = Date.now()) {
  return clamp(state.t + (state.playing ? Math.max(0, now - state.at) / 1000 * state.speed : 0), duration);
}

export function position(player, t) {
  const path = player.path;
  if (!path?.x?.length || !path.y?.length || !(path.interval > 0)) return null;
  const index = t / path.interval;
  const last = Math.min(path.x.length, path.y.length) - 1;
  if (index < 0 || index > last) return null;
  const i = Math.floor(index), j = Math.min(i + 1, last), f = index - i;
  const x = path.x[i] + (path.x[j] - path.x[i]) * f;
  const y = path.y[i] + (path.y[j] - path.y[i]) * f;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function healthAt(player, t) {
  const path = player.path;
  if (!path || !(path.interval > 0)) return null;
  const health = path.health?.[Math.floor(t / path.interval)];
  return Number.isFinite(health) && health >= 0 && health <= 100 ? health : null;
}

export function snapshot(player, t) {
  return player.stats.filter(s => s.t <= t).at(-1) || { t: null, net_worth: null, kills: null, deaths: null, assists: null };
}

export const itemsAt = (player, t) => player.items.filter(item => item.t <= t && !(item.sold > 0 && item.sold <= t));

export function sampleMatch() {
  const names = ['Abrams', 'Haze', 'Seven', 'Dynamo', 'Paradox', 'Ivy', 'Infernus', 'Wraith', 'Bebop', 'McGinnis', 'Vindicta', 'Kelvin'];
  const duration = 1520;
  const players = names.map((name, slot) => {
    const team = slot < 6 ? 0 : 1;
    const lane = slot % 3;
    const x = [], y = [];
    for (let t = 0; t <= duration; t++) {
      const progress = .15 + .7 * (.5 + .5 * Math.sin(t / (95 + slot * 4) + slot * .65));
      const bend = Math.sin(Math.PI * progress) * (lane - 1) * 165;
      x.push(85 + 405 * progress + bend + Math.sin(t / 22 + slot) * 12);
      y.push(515 - 425 * progress + bend + Math.cos(t / 28 + slot) * 12);
    }
    const stats = Array.from({ length: 10 }, (_, i) => ({ t: i * 180, net_worth: Math.round(i * (2150 + slot * 115)), kills: Math.floor(i * (slot % 3 + 1) / 2), deaths: Math.floor(i / 2), assists: i, player_damage: i * (1800 + slot * 240), creep_kills: i * (17 + slot) })).filter(s => s.t <= duration);
    const items = ['Extra Health', 'Sprint Boots', 'Mystic Burst', 'Bullet Armor', 'Improved Spirit', 'Unstoppable'].map((name, i) => ({ t: 50 + i * 220 + slot * 9, name, sold: i === 0 ? 960 + slot * 9 : 0, icon: '', cost: [500, 500, 500, 1250, 1250, 6300][i] }));
    return { slot, team, name, person: `Sample player ${slot + 1}`, icon: '', stats, items, path: { x, y, interval: 1 } };
  });
  const kills = Array.from({ length: 30 }, (_, i) => {
    const victim = i % 12, killer = (victim + 6 + i % 3) % 12;
    const t = 100 + i * 45;
    return { t, victim, killer, duration: 22 + Math.floor(t / 75), pos: position(players[victim], t) };
  });
  const objectives = [320, 540, 820, 1060, 1380, 1500].map((t, i) => ({ t, team: i % 2, name: ['Guardian', 'Guardian', 'Walker', 'Walker', 'Shrine', 'Patron'][i], pos: { x: 150 + i * 55, y: 460 - i * 61 } }));
  for (const p of players) for (const s of p.stats) { s.kills = kills.filter(d => d.t <= s.t && d.killer === p.slot).length; s.deaths = kills.filter(d => d.t <= s.t && d.victim === p.slot).length; }
  return { id: SAMPLE_ID, label: 'Sample match', duration, sample: true, players, kills, objectives, map: null, warnings: [] };
}

export function normalizeMatch(id, raw, assets) {
  const info = raw?.match_info;
  if (!info || !Number.isFinite(info.duration_s) || info.duration_s <= 0 || !info.players?.length) throw new Error('Match metadata is missing duration or players.');
  const heroes = new Map((assets.heroes || []).map(h => [h.id, h]));
  const items = new Map((assets.items || []).map(i => [i.id, i]));
  const profiles = new Map((assets.profiles || []).map(p => [p.account_id, p.personaname]));
  const radius = assets.map?.radius || 10752;
  const project = pos => pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? { x: (pos.x / radius + 1) * 300, y: (1 - pos.y / radius) * 300 } : null;
  const paths = info.match_paths;
  const players = info.players.map(p => {
    const hero = heroes.get(p.hero_id);
    const path = paths?.paths?.find(path => path.player_slot === p.player_slot);
    let converted = null;
    if (path && paths.x_resolution > 0 && paths.y_resolution > 0 && paths.interval_s > 0 && Array.isArray(path.x_pos) && Array.isArray(path.y_pos)) {
      converted = { interval: paths.interval_s, health: Array.isArray(path.health) ? path.health : [], x: path.x_pos.map(x => (1 + (path.x_min + x / paths.x_resolution * (path.x_max - path.x_min)) / radius) * 300), y: path.y_pos.map(y => (1 - (path.y_min + y / paths.y_resolution * (path.y_max - path.y_min)) / radius) * 300) };
    }
    return { slot: p.player_slot, team: p.team, account: p.account_id, name: hero?.name || `Hero ${p.hero_id}`, person: profiles.get(p.account_id) || `Account ${p.account_id}`, icon: hero?.images?.minimap_image || '', path: converted,
      stats: (p.stats || []).map(s => ({ ...s, t: s.time_stamp_s })).sort((a, b) => a.t - b.t),
      items: (p.items || []).filter(i => items.get(i.item_id)?.type === 'upgrade').map(i => ({ t: i.game_time_s, sold: i.sold_time_s, name: items.get(i.item_id).name, icon: items.get(i.item_id).image || '', cost: items.get(i.item_id).cost || 0 })) };
  });
  const kills = info.players.flatMap(p => (p.death_details || []).map(d => ({ t: d.game_time_s, victim: p.player_slot, killer: d.killer_player_slot, duration: d.death_duration_s || 0, pos: project(d.death_pos) }))).sort((a, b) => a.t - b.t);
  const objectives = (info.objectives || []).filter(o => o.destroyed_time_s > 0).map(o => ({ t: o.destroyed_time_s, team: o.team, name: objectiveName(o.team_objective_id), pos: null })).sort((a, b) => a.t - b.t);
  const warnings = [];
  if (players.some(p => !p.path)) warnings.push('Some movement paths are unavailable.');
  if (players.some(p => p.path && Math.min(p.path.x.length, p.path.y.length) <= Math.floor(info.duration_s / p.path.interval))) warnings.push('Some movement paths end early; missing positions are hidden.');
  if (!assets.items?.length) warnings.push('Item assets unavailable; purchase classification omitted.');
  if (!assets.heroes?.length) warnings.push('Hero assets unavailable; showing hero IDs.');
  if (!assets.map) warnings.push('Map asset unavailable; schematic background only.');
  return { id: String(id), label: `Match #${id}`, duration: info.duration_s, sample: false, players, kills, objectives, map: assets.map?.images?.minimap || null, warnings };
}

// ECitadelTeamObjective: SteamDatabase/Protobufs/deadlock/citadel_gcmessages_common.proto.
function objectiveName(id) {
  if (id === 0) return 'Patron core';
  if (id >= 1 && id <= 4) return `Guardian · Lane ${id}`;
  if (id >= 5 && id <= 8) return `Walker · Lane ${id - 4}`;
  if (id === 9) return 'Patron';
  if (id === 10 || id === 11) return `Shield generator ${id - 9}`;
  if (id >= 12 && id <= 15) return `Base guardian · Lane ${id - 11}`;
  return `Objective ${id}`;
}
