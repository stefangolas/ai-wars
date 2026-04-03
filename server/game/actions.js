// Server-side action handlers.
// Each handler receives (playerId, payload) and returns { ok, village?, error? }.
// The WebSocket handler calls these and broadcasts the result.

import { db, loadVillage, saveVillage, WORLD_SPEED } from '../db/database.js';
import { enqueueUpgrade }   from '../../clone/src/engine/construction.js';
import { enqueueTraining }  from '../../clone/src/engine/training.js';
import { simulateBattle }   from '../../clone/src/engine/combat.js';
import { travelTime }       from '../../clone/src/engine/combat.js';
import { UNITS }            from '../../clone/src/data/units.js';
import { MARKET_MERCHANTS } from '../../clone/src/data/buildings.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function getPlayerVillage(playerId, villageId = null) {
  const row = villageId
    ? db.prepare('SELECT id FROM villages WHERE id = ? AND player_id = ?').get(villageId, playerId)
    : db.prepare('SELECT id FROM villages WHERE player_id = ? ORDER BY id LIMIT 1').get(playerId);
  if (!row) return null;
  return loadVillage(row.id);
}

function ok(village, extra = {}) {
  saveVillage(village);
  return { ok: true, village: publicVillage(village), ...extra };
}

function err(message) {
  return { ok: false, error: message };
}

// Strip internal fields before sending to client
function publicVillage(v) {
  return {
    id: v.id, name: v.name, x: v.x, y: v.y, playerId: v.playerId,
    wood: v.wood, clay: v.clay, iron: v.iron,
    lastTick: v.lastTick,
    loyalty: v.loyalty ?? 100,
    militiaActiveUntil: v.militiaActiveUntil ?? null,
    buildings: v.buildings, units: v.units,
    buildQueue: v.buildQueue, trainQueue: v.trainQueue,
    points: v.points,
    outgoingCommands:  getOutgoingCommands(v.id),
    incomingCommands:  getIncomingCommands(v.id),
    stationedSupport:  getStationedSupport(v.id),
    incomingSupport:   getIncomingSupport(v.id),
    tradeOffers: getVillageTradeOffers(v.id),
  };
}

function getOutgoingCommands(villageId) {
  return db.prepare(`
    SELECT c.id, c.to_village_id, c.units, c.type, c.arrival_time, c.return_time, c.status,
           v.name as target_name, v.x as target_x, v.y as target_y
    FROM commands c JOIN villages v ON v.id = c.to_village_id
    WHERE c.from_village_id = ? AND c.status IN ('traveling','returning')
  `).all(villageId).map(r => ({
    id: r.id, toVillageId: r.to_village_id, units: JSON.parse(r.units),
    type: r.type, arrivalTime: r.arrival_time, returnTime: r.return_time,
    status: r.status, targetName: r.target_name, targetX: r.target_x, targetY: r.target_y,
  }));
}

function getVillageTradeOffers(villageId) {
  return db.prepare(
    'SELECT * FROM trade_offers WHERE village_id = ?'
  ).all(villageId).map(r => ({
    id: r.id, offerRes: r.offer_res, offerAmt: r.offer_amt,
    wantRes: r.want_res, wantAmt: r.want_amt, merchants: r.merchants,
  }));
}

function getIncomingCommands(villageId) {
  return db.prepare(`
    SELECT c.id, c.from_village_id, c.type, c.arrival_time,
           v.name as origin_name, v.x as origin_x, v.y as origin_y
    FROM commands c JOIN villages v ON v.id = c.from_village_id
    WHERE c.to_village_id = ? AND c.status = 'traveling' AND c.type = 'attack'
  `).all(villageId).map(r => ({
    id: r.id, fromVillageId: r.from_village_id, type: r.type,
    arrivalTime: r.arrival_time, originName: r.origin_name,
    originX: r.origin_x, originY: r.origin_y,
  }));
}

// Support troops currently stationed AT this village (defending it)
function getStationedSupport(villageId) {
  return db.prepare(`
    SELECT c.id, c.from_village_id, c.units,
           v.name as origin_name, p.name as player_name
    FROM commands c
    JOIN villages v ON v.id = c.from_village_id
    LEFT JOIN players p ON p.id = v.player_id
    WHERE c.to_village_id = ? AND c.type = 'support' AND c.status = 'stationed'
  `).all(villageId).map(r => ({
    id: r.id, fromVillageId: r.from_village_id,
    units: JSON.parse(r.units), originName: r.origin_name, playerName: r.player_name,
  }));
}

// Support troops en route TO this village
function getIncomingSupport(villageId) {
  return db.prepare(`
    SELECT c.id, c.from_village_id, c.arrival_time,
           v.name as origin_name, p.name as player_name
    FROM commands c
    JOIN villages v ON v.id = c.from_village_id
    LEFT JOIN players p ON p.id = v.player_id
    WHERE c.to_village_id = ? AND c.type = 'support' AND c.status = 'traveling'
  `).all(villageId).map(r => ({
    id: r.id, fromVillageId: r.from_village_id,
    arrivalTime: r.arrival_time, originName: r.origin_name, playerName: r.player_name,
  }));
}

// ── World constants ────────────────────────────────────────────────────────────

export const TRIBE_MAX_MEMBERS = 25;

// ── Broadcast injection (avoids circular import with ws/handler.js) ───────────

let _broadcast = null;
export function setBroadcast(fn) { _broadcast = fn; }

// ── Action handlers ────────────────────────────────────────────────────────────

export const ACTIONS = {

  ENQUEUE_UPGRADE({ playerId, building, villageId = null }) {
    const village = getPlayerVillage(playerId, villageId);
    if (!village) return err('Village not found');
    const result = enqueueUpgrade(village, building, WORLD_SPEED);
    if (!result.ok) return err(result.reason);
    return ok({ ...result.village, id: village.id });
  },

  ENQUEUE_TRAINING({ playerId, unit, count, villageId = null }) {
    count = parseInt(count, 10);
    if (!count || count <= 0 || count > 9999) return err('Invalid count');
    const village = getPlayerVillage(playerId, villageId);
    if (!village) return err('Village not found');
    const result = enqueueTraining(village, unit, count, WORLD_SPEED);
    if (!result.ok) return err(result.reason);
    return ok({ ...result.village, id: village.id });
  },

  SEND_ATTACK({ playerId, toVillageId, units, catapultTarget = null, villageId = null }) {
    const fromVillage = getPlayerVillage(playerId, villageId);
    if (!fromVillage) return err('Village not found');

    const target = db.prepare('SELECT id, x, y, is_npc FROM villages WHERE id = ?').get(toVillageId);
    if (!target) return err('Target village not found');
    if (target.id === fromVillage.id) return err('Cannot attack your own village');
    if (!(fromVillage.buildings.place >= 1)) return err('Rally Point required to send attacks');

    // Validate units
    const sendUnits = {};
    for (const [uid, count] of Object.entries(units)) {
      const n = parseInt(count, 10);
      if (!n || n <= 0) continue;
      if ((fromVillage.units[uid] ?? 0) < n) return err(`Not enough ${uid}`);
      sendUnits[uid] = n;
    }
    if (Object.keys(sendUnits).length === 0) return err('Select at least one unit');

    // Deduct units
    const newUnits = { ...fromVillage.units };
    for (const [uid, n] of Object.entries(sendUnits)) newUnits[uid] -= n;

    const unitIds = Object.keys(sendUnits);
    const travel  = travelTime(fromVillage, target, unitIds, WORLD_SPEED);
    const arrival = Date.now() + travel * 1000;

    const cmdId = db.prepare(`
      INSERT INTO commands (from_village_id, to_village_id, units, type, arrival_time, catapult_target)
      VALUES (?, ?, ?, 'attack', ?, ?)
    `).run(fromVillage.id, target.id, JSON.stringify(sendUnits), arrival, catapultTarget).lastInsertRowid;

    const updated = { ...fromVillage, units: newUnits };
    return ok(updated, { commandId: cmdId, arrivalTime: arrival });
  },

  SEND_SUPPORT({ playerId, toVillageId, units, villageId = null }) {
    const fromVillage = getPlayerVillage(playerId, villageId);
    if (!fromVillage) return err('Village not found');
    const target = db.prepare('SELECT id, x, y, player_id FROM villages WHERE id = ?').get(toVillageId);
    if (!target) return err('Target village not found');
    if (target.id === fromVillage.id) return err('Cannot support your own village this way');
    if (!(fromVillage.buildings.place >= 1)) return err('Rally Point required');

    const sendUnits = {};
    for (const [uid, count] of Object.entries(units)) {
      const n = parseInt(count, 10);
      if (!n || n <= 0) continue;
      if ((fromVillage.units[uid] ?? 0) < n) return err(`Not enough ${uid}`);
      sendUnits[uid] = n;
    }
    if (Object.keys(sendUnits).length === 0) return err('Select at least one unit');

    const newUnits = { ...fromVillage.units };
    for (const [uid, n] of Object.entries(sendUnits)) newUnits[uid] -= n;

    const unitIds = Object.keys(sendUnits);
    const travel  = travelTime(fromVillage, target, unitIds, WORLD_SPEED);
    const arrival = Date.now() + travel * 1000;

    db.prepare(`
      INSERT INTO commands (from_village_id, to_village_id, units, type, arrival_time)
      VALUES (?, ?, ?, 'support', ?)
    `).run(fromVillage.id, target.id, JSON.stringify(sendUnits), arrival);

    const updated = { ...fromVillage, units: newUnits };
    return ok(updated);
  },

  RECALL_SUPPORT({ playerId, commandId }) {
    // Verify the command belongs to one of this player's villages (not a specific one)
    const cmd = db.prepare(`
      SELECT c.* FROM commands c
      JOIN villages v ON v.id = c.from_village_id
      WHERE c.id = ? AND v.player_id = ? AND c.type = 'support' AND c.status = 'stationed'
    `).get(commandId, playerId);
    if (!cmd) return err('Support command not found');

    const travelSecs = Math.round((cmd.arrival_time - cmd.created_at) / 1000);
    const returnTime = Date.now() + travelSecs * 1000;
    db.prepare("UPDATE commands SET status='returning', return_time=? WHERE id=?").run(returnTime, cmd.id);
    return { ok: true };
  },

  ACTIVATE_MILITIA({ playerId, villageId = null }) {
    const village = getPlayerVillage(playerId, villageId);
    if (!village) return err('Village not found');
    const farmLevel = village.buildings.farm ?? 0;
    if (farmLevel === 0) return err('Farm required to call militia');

    const now = Date.now();
    // Don't allow re-activation while militia is already active
    if (village.militiaActiveUntil && village.militiaActiveUntil > now) {
      return err('Militia already active');
    }

    const milCount    = farmLevel * 20;
    const expiresAt   = now + Math.round(6 * 3600 * 1000 / WORLD_SPEED); // 3h at 2× speed
    const newUnits    = { ...village.units, militia: milCount };

    db.prepare('UPDATE villages SET militia_active_until = ? WHERE id = ?').run(expiresAt, village.id);

    const updated = { ...village, units: newUnits, militiaActiveUntil: expiresAt };
    saveVillage(updated);
    return ok(updated);
  },

  CANCEL_TRADE({ playerId, offerId, villageId = null }) {
    const village = getPlayerVillage(playerId, villageId);
    if (!village) return err('Village not found');
    const offer = db.prepare(
      'SELECT * FROM trade_offers WHERE id = ? AND village_id = ?'
    ).get(offerId, village.id);
    if (!offer) return err('Offer not found');

    db.prepare('DELETE FROM trade_offers WHERE id = ?').run(offerId);
    const updated = {
      ...village,
      wood: village.wood + (offer.offer_res === 'wood' ? offer.offer_amt : 0),
      clay: village.clay + (offer.offer_res === 'clay' ? offer.offer_amt : 0),
      iron: village.iron + (offer.offer_res === 'iron' ? offer.offer_amt : 0),
    };
    return ok(updated);
  },

  POST_TRADE({ playerId, offerRes, offerAmt, wantRes, wantAmt, villageId = null }) {
    offerAmt = parseInt(offerAmt, 10);
    wantAmt  = parseInt(wantAmt, 10);
    if (!offerAmt || offerAmt <= 0) return err('Invalid offer amount');
    if (!wantAmt  || wantAmt  <= 0) return err('Invalid want amount');
    if (offerRes === wantRes) return err('Cannot trade a resource for itself');

    const village = getPlayerVillage(playerId, villageId);
    if (!village) return err('Village not found');
    if (village.buildings.market < 1) return err('Market not built');
    if (village[offerRes] < offerAmt) return err('Insufficient resources');

    const maxMerchants  = MARKET_MERCHANTS[village.buildings.market ?? 0];
    const usedMerchants = db.prepare(
      'SELECT COALESCE(SUM(merchants),0) as n FROM trade_offers WHERE village_id = ?'
    ).get(village.id).n;
    const needed = Math.ceil(offerAmt / 1000);
    if (usedMerchants + needed > maxMerchants) return err('Not enough merchants');

    db.prepare(
      'INSERT INTO trade_offers (village_id,offer_res,offer_amt,want_res,want_amt,merchants) VALUES (?,?,?,?,?,?)'
    ).run(village.id, offerRes, offerAmt, wantRes, wantAmt, needed);

    const updated = { ...village, [offerRes]: village[offerRes] - offerAmt };
    return ok(updated);
  },

  ACCEPT_TRADE({ playerId, offerId, villageId = null }) {
    const buyer = getPlayerVillage(playerId, villageId);
    if (!buyer) return err('Village not found');

    const offer = db.prepare(`
      SELECT o.*, v.player_id as seller_player_id
      FROM trade_offers o JOIN villages v ON v.id = o.village_id
      WHERE o.id = ?
    `).get(offerId);
    if (!offer) return err('Offer no longer available');
    if (offer.seller_player_id === playerId) return err('Cannot accept your own offer');
    if (buyer[offer.want_res] < offer.want_amt) return err(`Need ${offer.want_amt} ${offer.want_res}`);

    const sellerVillage = loadVillage(offer.village_id);

    // Execute trade
    db.prepare('DELETE FROM trade_offers WHERE id = ?').run(offerId);

    const updatedBuyer = {
      ...buyer,
      [offer.want_res]:  buyer[offer.want_res]  - offer.want_amt,
      [offer.offer_res]: buyer[offer.offer_res] + offer.offer_amt,
    };
    const updatedSeller = {
      ...sellerVillage,
      [offer.want_res]: sellerVillage[offer.want_res] + offer.want_amt,
    };

    saveVillage(updatedSeller);
    return ok(updatedBuyer, { sellerVillageId: sellerVillage.id });
  },

  CREATE_TRIBE({ playerId, name, tag, description }) {
    name = name?.trim(); tag = tag?.trim().toUpperCase();
    if (!name || !tag) return err('Name and tag required');
    if (tag.length > 8) return err('Tag max 8 characters');

    const existing = db.prepare('SELECT tribe_id FROM players WHERE id = ?').get(playerId);
    if (existing?.tribe_id) return err('Already in a tribe — leave first');

    let tribeId;
    try {
      tribeId = db.prepare(
        'INSERT INTO tribes (name, tag, description) VALUES (?, ?, ?)'
      ).run(name, tag, description ?? '').lastInsertRowid;
    } catch {
      return err('Tribe name or tag already taken');
    }

    db.prepare('UPDATE players SET tribe_id = ?, tribe_role = ? WHERE id = ?').run(tribeId, 'leader', playerId);
    return { ok: true, tribe: getTribe(tribeId) };
  },

  INVITE_TO_TRIBE({ playerId, targetPlayerId }) {
    const player = db.prepare('SELECT tribe_id, tribe_role, name FROM players WHERE id = ?').get(playerId);
    if (!player?.tribe_id)           return err('Not in a tribe');
    if (player.tribe_role !== 'leader') return err('Only tribe leaders can send invites');

    const target = db.prepare('SELECT id, name, tribe_id FROM players WHERE id = ?').get(targetPlayerId);
    if (!target)           return err('Player not found');
    if (target.tribe_id)   return err('Player is already in a tribe');

    const memberCount = db.prepare('SELECT COUNT(*) as n FROM players WHERE tribe_id = ?').get(player.tribe_id).n;
    if (memberCount >= TRIBE_MAX_MEMBERS) return err(`Tribe is full (max ${TRIBE_MAX_MEMBERS})`);

    const tribe = db.prepare('SELECT name, tag FROM tribes WHERE id = ?').get(player.tribe_id);
    try {
      db.prepare('INSERT INTO tribe_invites (tribe_id, inviter_id, invitee_id) VALUES (?, ?, ?)')
        .run(player.tribe_id, playerId, targetPlayerId);
    } catch {
      return err('Already invited this player');
    }

    // Notify the invitee by message
    db.prepare('INSERT INTO messages (from_player_id, to_player_id, subject, text) VALUES (?, ?, ?, ?)')
      .run(playerId, targetPlayerId,
        `Tribe invitation: [${tribe.tag}] ${tribe.name}`,
        `${player.name} has invited you to join [${tribe.tag}] ${tribe.name}. Check your pending invites and use accept_invite to join.`
      );

    return { ok: true };
  },

  ACCEPT_INVITE({ playerId, inviteId }) {
    const existing = db.prepare('SELECT tribe_id FROM players WHERE id = ?').get(playerId);
    if (existing?.tribe_id) return err('Already in a tribe — leave first');

    const invite = db.prepare('SELECT * FROM tribe_invites WHERE id = ? AND invitee_id = ?').get(inviteId, playerId);
    if (!invite) return err('Invite not found');

    const memberCount = db.prepare('SELECT COUNT(*) as n FROM players WHERE tribe_id = ?').get(invite.tribe_id).n;
    if (memberCount >= TRIBE_MAX_MEMBERS) return err('Tribe is now full');

    db.prepare('UPDATE players SET tribe_id = ?, tribe_role = ? WHERE id = ?').run(invite.tribe_id, 'member', playerId);
    db.prepare('DELETE FROM tribe_invites WHERE invitee_id = ?').run(playerId);
    return { ok: true, tribe: getTribe(invite.tribe_id) };
  },

  DECLINE_INVITE({ playerId, inviteId }) {
    db.prepare('DELETE FROM tribe_invites WHERE id = ? AND invitee_id = ?').run(inviteId, playerId);
    return { ok: true };
  },

  KICK_MEMBER({ playerId, targetPlayerId }) {
    const player = db.prepare('SELECT tribe_id, tribe_role FROM players WHERE id = ?').get(playerId);
    if (!player?.tribe_id)              return err('Not in a tribe');
    if (player.tribe_role !== 'leader') return err('Only leaders can kick members');
    if (targetPlayerId === playerId)    return err('Cannot kick yourself — use leave_tribe');

    const target = db.prepare('SELECT tribe_id FROM players WHERE id = ?').get(targetPlayerId);
    if (!target || target.tribe_id !== player.tribe_id) return err('Player is not in your tribe');

    db.prepare('UPDATE players SET tribe_id = NULL, tribe_role = NULL WHERE id = ?').run(targetPlayerId);
    return { ok: true, tribe: getTribe(player.tribe_id) };
  },

  PROMOTE_MEMBER({ playerId, targetPlayerId }) {
    const player = db.prepare('SELECT tribe_id, tribe_role FROM players WHERE id = ?').get(playerId);
    if (!player?.tribe_id)              return err('Not in a tribe');
    if (player.tribe_role !== 'leader') return err('Only leaders can promote members');

    const target = db.prepare('SELECT tribe_id FROM players WHERE id = ?').get(targetPlayerId);
    if (!target || target.tribe_id !== player.tribe_id) return err('Player is not in your tribe');

    db.prepare('UPDATE players SET tribe_role = ? WHERE id = ?').run('leader', targetPlayerId);
    return { ok: true, tribe: getTribe(player.tribe_id) };
  },

  LEAVE_TRIBE({ playerId }) {
    const player = db.prepare('SELECT tribe_id, tribe_role FROM players WHERE id = ?').get(playerId);
    if (!player?.tribe_id) return err('Not in a tribe');

    const tribeId = player.tribe_id;
    db.prepare('UPDATE players SET tribe_id = NULL, tribe_role = NULL WHERE id = ?').run(playerId);

    if (player.tribe_role === 'leader') {
      const otherLeaders = db.prepare(
        'SELECT COUNT(*) as n FROM players WHERE tribe_id = ? AND tribe_role = ?'
      ).get(tribeId, 'leader').n;

      if (!otherLeaders) {
        const firstMember = db.prepare(
          'SELECT id FROM players WHERE tribe_id = ? ORDER BY id LIMIT 1'
        ).get(tribeId);

        if (firstMember) {
          db.prepare('UPDATE players SET tribe_role = ? WHERE id = ?').run('leader', firstMember.id);
        } else {
          // No members remain — disband
          db.prepare('DELETE FROM tribes WHERE id = ?').run(tribeId);
        }
      }
    }

    return { ok: true, tribe: null };
  },

  SET_DIPLOMACY({ playerId, targetTribeId, status }) {
    const player = db.prepare('SELECT tribe_id, tribe_role FROM players WHERE id = ?').get(playerId);
    if (!player?.tribe_id)              return err('Not in a tribe');
    if (player.tribe_role !== 'leader') return err('Only tribe leaders can set diplomacy');
    if (!['ally', 'nap', 'war'].includes(status) && status !== null)
      return err('Status must be ally, nap, war, or null');
    if (targetTribeId === player.tribe_id) return err('Cannot set diplomacy with your own tribe');
    const targetTribe = db.prepare('SELECT id FROM tribes WHERE id = ?').get(targetTribeId);
    if (!targetTribe) return err('Target tribe not found');

    if (status === null || status === undefined) {
      db.prepare('DELETE FROM diplomacy WHERE tribe_id = ? AND target_tribe_id = ?')
        .run(player.tribe_id, targetTribeId);
    } else {
      db.prepare(`
        INSERT INTO diplomacy (tribe_id, target_tribe_id, status)
        VALUES (?, ?, ?)
        ON CONFLICT(tribe_id, target_tribe_id) DO UPDATE SET status = excluded.status
      `).run(player.tribe_id, targetTribeId, status);
    }
    return { ok: true, tribe: getTribe(player.tribe_id) };
  },

  POST_FORUM({ playerId, text }) {
    text = text?.trim();
    if (!text || text.length > 2000) return err('Invalid post');
    const player = db.prepare('SELECT name, tribe_id FROM players WHERE id = ?').get(playerId);
    if (!player?.tribe_id) return err('Not in a tribe');
    db.prepare(
      'INSERT INTO tribe_forum (tribe_id, player_id, player_name, text) VALUES (?, ?, ?, ?)'
    ).run(player.tribe_id, playerId, player.name, text);
    return { ok: true, tribe: getTribe(player.tribe_id) };
  },

  RENAME_VILLAGE({ playerId, name, villageId = null }) {
    name = name?.trim();
    if (!name || name.length > 30) return err('Invalid name');
    const row = villageId
      ? db.prepare('SELECT id FROM villages WHERE id = ? AND player_id = ?').get(villageId, playerId)
      : db.prepare('SELECT id FROM villages WHERE player_id = ? ORDER BY id LIMIT 1').get(playerId);
    if (!row) return err('Village not found');
    db.prepare('UPDATE villages SET name = ? WHERE id = ?').run(name, row.id);
    const village = loadVillage(row.id);
    return ok(village);
  },

  GET_MAP({ playerId, cx = 250, cy = 250, radius = 30 }) {
    const villages = db.prepare(`
      SELECT v.id, v.name, v.x, v.y, v.points, v.is_npc,
             p.id as player_id, p.name as player_name,
             t.tag as tribe_tag
      FROM villages v
      LEFT JOIN players p ON p.id = v.player_id
      LEFT JOIN tribes  t ON t.id = p.tribe_id
      WHERE v.x BETWEEN ? AND ? AND v.y BETWEEN ? AND ?
    `).all(cx - radius, cx + radius, cy - radius, cy + radius);
    return { ok: true, villages };
  },

  GET_REPORTS({ playerId, offset = 0 }) {
    const reports = db.prepare(
      'SELECT * FROM reports WHERE player_id = ? ORDER BY created_at DESC LIMIT 20 OFFSET ?'
    ).all(playerId, offset);
    db.prepare(
      'UPDATE reports SET read = 1 WHERE player_id = ? AND read = 0'
    ).run(playerId);
    return { ok: true, reports: reports.map(r => ({ ...r, data: JSON.parse(r.data) })) };
  },

  GET_VILLAGE({ playerId }) {
    const rows = db.prepare('SELECT id FROM villages WHERE player_id = ? ORDER BY id').all(playerId);
    if (!rows.length) return err('Village not found');
    const myVillages = rows.map(r => publicVillage(loadVillage(r.id))).filter(Boolean);
    const player = db.prepare('SELECT tribe_id FROM players WHERE id = ?').get(playerId);
    const tribe  = player?.tribe_id ? getTribe(player.tribe_id) : null;
    const unreadMessages = db.prepare(
      'SELECT COUNT(*) as n FROM messages WHERE to_player_id = ? AND read = 0'
    ).get(playerId).n;
    const pendingInvites = db.prepare(`
      SELECT ti.id, ti.tribe_id, t.name as tribe_name, t.tag as tribe_tag, p.name as inviter_name
      FROM tribe_invites ti
      JOIN tribes  t ON t.id = ti.tribe_id
      JOIN players p ON p.id = ti.inviter_id
      WHERE ti.invitee_id = ?
    `).all(playerId);
    return { ok: true, myVillages, tribe, unreadMessages, pendingInvites };
  },

  GET_TRIBE({ playerId }) {
    const player = db.prepare('SELECT tribe_id FROM players WHERE id = ?').get(playerId);
    const tribe  = player?.tribe_id ? getTribe(player.tribe_id) : null;
    return { ok: true, tribe };
  },

  SEND_MESSAGE({ playerId, toPlayerId, subject, text }) {
    text    = text?.trim();
    subject = subject?.trim() ?? '';
    if (!text || text.length > 5000)   return err('Message text is required (max 5000 chars)');
    if (!toPlayerId || toPlayerId === playerId) return err('Invalid recipient');

    const sender    = db.prepare('SELECT name FROM players WHERE id = ?').get(playerId);
    const recipient = db.prepare('SELECT id   FROM players WHERE id = ?').get(toPlayerId);
    if (!sender)    return err('Sender not found');
    if (!recipient) return err('Recipient not found');

    const msgId = db.prepare(
      'INSERT INTO messages (from_player_id, to_player_id, subject, text) VALUES (?, ?, ?, ?)'
    ).run(playerId, toPlayerId, subject, text).lastInsertRowid;

    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);

    // Push to recipient if online
    _broadcast?.(toPlayerId, {
      type:    'MESSAGE_RECEIVED',
      message: formatMessage(msg, sender.name),
    });

    return { ok: true, messageId: msgId };
  },

  GET_MESSAGES({ playerId, folder = 'inbox', offset = 0 }) {
    const limit = 20;
    let messages;

    if (folder === 'sent') {
      messages = db.prepare(`
        SELECT m.*, p.name as other_name
        FROM messages m
        JOIN players p ON p.id = m.to_player_id
        WHERE m.from_player_id = ?
        ORDER BY m.created_at DESC LIMIT ? OFFSET ?
      `).all(playerId, limit, offset);
    } else {
      messages = db.prepare(`
        SELECT m.*, p.name as other_name
        FROM messages m
        JOIN players p ON p.id = m.from_player_id
        WHERE m.to_player_id = ?
        ORDER BY m.created_at DESC LIMIT ? OFFSET ?
      `).all(playerId, limit, offset);

      // Mark fetched messages as read
      db.prepare(
        'UPDATE messages SET read = 1 WHERE to_player_id = ? AND read = 0 AND id IN (SELECT id FROM messages WHERE to_player_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?)'
      ).run(playerId, playerId, limit, offset);
    }

    const unread = db.prepare(
      'SELECT COUNT(*) as n FROM messages WHERE to_player_id = ? AND read = 0'
    ).get(playerId).n;

    return { ok: true, messages: messages.map(m => ({
      id:         m.id,
      fromId:     m.from_player_id,
      toId:       m.to_player_id,
      otherName:  m.other_name,
      subject:    m.subject,
      text:       m.text,
      read:       !!m.read,
      createdAt:  m.created_at,
    })), unread };
  },

  GET_PLAYERS({ playerId }) {
    const players = db.prepare(
      'SELECT p.id, p.name, t.tag as tribe_tag FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id WHERE p.id != ? ORDER BY p.name'
    ).all(playerId);
    return { ok: true, players };
  },

  GET_TRADE_OFFERS({ playerId }) {
    const offers = db.prepare(`
      SELECT o.*, v.name as village_name, p.name as player_name, t.tag as tribe_tag
      FROM trade_offers o
      JOIN villages v ON v.id = o.village_id
      LEFT JOIN players p ON p.id = v.player_id
      LEFT JOIN tribes  t ON t.id = p.tribe_id
      WHERE v.player_id != ?
      ORDER BY o.created_at DESC
      LIMIT 50
    `).all(playerId);
    return { ok: true, offers };
  },
};

function formatMessage(m, senderName) {
  return {
    id: m.id, fromId: m.from_player_id, toId: m.to_player_id,
    otherName: senderName, subject: m.subject, text: m.text,
    read: !!m.read, createdAt: m.created_at,
  };
}

// ── Tribe loader ───────────────────────────────────────────────────────────────

export function getTribe(tribeId) {
  if (!tribeId) return null;
  try {
    const tribe = db.prepare('SELECT * FROM tribes WHERE id = ?').get(tribeId);
    if (!tribe) return null;

    const members = db.prepare(
      'SELECT p.id, p.name, p.tribe_role as role FROM players p WHERE p.tribe_id = ?'
    ).all(tribeId);

    let diplomacy = {};
    try {
      diplomacy = db.prepare(
        'SELECT target_tribe_id, status FROM diplomacy WHERE tribe_id = ?'
      ).all(tribeId).reduce((acc, r) => { acc[r.target_tribe_id] = r.status; return acc; }, {});
    } catch {}

    let forum = [];
    try {
      forum = db.prepare(
        'SELECT * FROM tribe_forum WHERE tribe_id = ? ORDER BY created_at DESC LIMIT 10'
      ).all(tribeId);
    } catch {}

    const otherTribes = db.prepare('SELECT id, name, tag FROM tribes WHERE id != ?').all(tribeId);

    return { ...tribe, members, diplomacy, forum, otherTribes };
  } catch (e) {
    console.error('[getTribe] Failed to load tribe', tribeId, e.message);
    return null;
  }
}
