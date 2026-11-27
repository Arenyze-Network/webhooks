'use strict';
// Event catalogue of Arenyze webhooks (docs.arenyze.com/webhooks#events).
// `sample` is a realistic `data` object, used by createTestEvent().

const R6_URL = 'https://r6.arenyze.com/stats?username=Shaiiko&platform=uplay';
const TF_URL = 'https://thefinals.arenyze.com/player/Balise%232431';
const EF_URL = 'https://arknightsendfield.arenyze.com/player/4243406084';

const r6Base = { player: 'uplay:shaiiko', display: 'Shaiiko', url: R6_URL };
const tfBase = { player: 'balise#2431', display: 'Balise#2431', url: TF_URL };
const efBase = { player: '4243406084', display: 'Endministrator', url: EF_URL };

/** @type {Record<string, { game: string, description: string, player: string, sample: Record<string, unknown>, text: (d: any) => string }>} */
const EVENTS = {
  'r6.rank_changed': {
    game: 'r6',
    description: 'The ranked tier changed (e.g. Emerald → Diamond).',
    player: 'uplay:shaiiko',
    sample: { ...r6Base, from: { rank: 'Emerald I', rp: 3980 }, to: { rank: 'Diamond V', rp: 4012, kd: '1.21' }, delta: 32 },
    text: (d) => `${d.display} moved from ${d.from?.rank} to ${d.to?.rank}.`,
  },
  'r6.rp_changed': {
    game: 'r6',
    description: 'RP changed: a ranked match was played.',
    player: 'uplay:shaiiko',
    sample: { ...r6Base, from: { rank: 'Gold II', rp: 2710 }, to: { rank: 'Gold II', rp: 2734, kd: '1.05' }, delta: 24 },
    text: (d) => `${d.display} ${d.delta >= 0 ? 'gained' : 'lost'} ${Math.abs(d.delta)} RP (${d.to?.rp} RP).`,
  },
  'thefinals.rank_changed': {
    game: 'thefinals',
    description: 'Position or score on the live Ranked board changed.',
    player: 'balise#2431',
    sample: { ...tfBase, from: { rank: 61, score: 53210 }, to: { rank: 47, score: 54011, league: 'Diamond 1' }, rankDelta: 14 },
    text: (d) => `${d.display} is now #${d.to?.rank} with ${d.to?.score} RS.`,
  },
  'thefinals.league_changed': {
    game: 'thefinals',
    description: 'League changed. `direction` is 1 up, -1 down.',
    player: 'balise#2431',
    sample: { ...tfBase, from: 'Diamond 2', to: 'Diamond 1', direction: 1, rank: 47, score: 54011 },
    text: (d) => `${d.display} moved from ${d.from} to ${d.to}.`,
  },
  'thefinals.club_changed': {
    game: 'thefinals',
    description: 'Joined, left or switched club (`null` = no club).',
    player: 'balise#2431',
    sample: { ...tfBase, from: 'BERGR', to: 'VGG' },
    text: (d) => (d.to ? `${d.display} joined club ${d.to}.` : `${d.display} left club ${d.from}.`),
  },
  'thefinals.renamed': {
    game: 'thefinals',
    description: 'Embark name changed. Watched players, or every rename with the global feed.',
    player: 'balise#2431',
    sample: { ...tfBase, from: 'Balise#9424', to: 'Balise#2431', global: true },
    text: (d) => `${d.from} is now ${d.to}.`,
  },
  'thefinals.ban_detected': {
    game: 'thefinals',
    description: 'Removed from the leaderboards. Watched players, or the global feed.',
    player: 'cheater#0001',
    sample: {
      player: 'cheater#0001', display: 'Cheater#0001', url: 'https://thefinals.arenyze.com/player/Cheater%230001',
      banType: 'removed', banTypeLabel: 'Removed from the leaderboard', status: 'suspected',
      lastRank: 6647, lastLeague: 'Platinum 2', season: 's12', global: true,
    },
    text: (d) => `${d.display} was removed from the leaderboard (last rank #${d.lastRank}).`,
  },
  'endfield.level_changed': {
    game: 'endfield',
    description: 'Authority level changed.',
    player: '4243406084',
    sample: { ...efBase, from: 52, to: 53 },
    text: (d) => `${d.display} reached authority level ${d.to}.`,
  },
  'endfield.world_level_changed': {
    game: 'endfield',
    description: 'World level changed.',
    player: '4243406084',
    sample: { ...efBase, from: 5, to: 6 },
    text: (d) => `${d.display} reached world level ${d.to}.`,
  },
  'endfield.operators_changed': {
    game: 'endfield',
    description: 'Number of operators on the account changed.',
    player: '4243406084',
    sample: { ...efBase, from: 21, to: 22 },
    text: (d) => `${d.display} now has ${d.to} operators.`,
  },
  'arenyze.test': {
    game: 'arenyze',
    description: 'Test event sent from the Workbench ("Send test event").',
    player: 'test',
    sample: { display: 'Arenyze' },
    text: () => 'Test event from Arenyze.',
  },
};

const EVENT_TYPES = Object.freeze(Object.keys(EVENTS));

/**
 * Does `type` match `pattern`? Patterns: exact type, `*`, or a game wildcard (`thefinals.*`).
 * @param {string} pattern
 * @param {string} type
 */
function matches(pattern, type) {
  if (pattern === '*' || pattern === type) return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  return false;
}

module.exports = { EVENTS, EVENT_TYPES, matches };
