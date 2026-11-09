/**
 * File Movement Register — core rules (single source of truth).
 *
 * Used in two places:
 *   1. register.html loads this file directly (demo mode runs the rules in the browser).
 *   2. Google Apps Script: paste this whole file into a script file named "Core.gs"
 *      next to apps-script/register/Code.gs (live mode runs the same rules on the server).
 *
 * No browser or Apps Script APIs are used here. Everything environment-specific
 * (clock, hashing, ids) comes in through the `env` argument:
 *   env.now()        -> current Dhaka time as 'YYYY-MM-DDTHH:mm'
 *   env.hash(p, s)   -> password hash
 *   env.uuid()       -> random id (salt)
 *   env.randomPass() -> temporary password
 *
 * History entries are only ever appended; nothing in this file edits or removes one.
 */
var RegisterCore = (function () {
  'use strict';

  var ROLES = ['XEN', 'SDE', 'AE', 'SAE', 'Staff'];
  var DESIG = {
    XEN: 'Executive Engineer (Civil)',
    SDE: 'Sub-Divisional Engineer (Civil)',
    AE: 'Assistant Engineer (Civil)',
    SAE: 'Sub-Assistant Engineer (Civil)',
    Staff: 'Office Staff (Receiving)',
  };
  var MUTATIONS = ['changePassword', 'registerFile', 'sendFile', 'confirmReceipt', 'recallFile', 'closeFile', 'reopenFile', 'correctFile', 'addUser', 'resetUserPass', 'setUserActive'];
  var FIELD_LABEL = { ref: 'Reference / File No.', subject: 'Subject', from: 'Received from', receivedAt: 'Date and time received' };
  var DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

  // ------------------------------------------------------------ helpers

  function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }
  function err(msg, code) { var r = { ok: false, error: msg }; if (code) r.code = code; return r; }

  function findUser(db, id) {
    for (var i = 0; i < db.users.length; i++) if (db.users[i].id === id) return db.users[i];
    return null;
  }
  function findFile(db, sl) {
    var n = Number(sl);
    for (var i = 0; i < db.files.length; i++) if (db.files[i].sl === n) return db.files[i];
    return null;
  }
  function isActive(u) { return !!u && u.active !== false; }
  function pub(u) { return { id: u.id, name: u.name, desig: u.desig, role: u.role, active: isActive(u) }; }
  function canSeeAll(u) { return u.role === 'Admin' || u.role === 'XEN'; }
  function canRegister(u) { return u.role === 'XEN' || u.role === 'Staff'; }
  function canClose(u) { return u.role === 'XEN' || u.role === 'Staff'; }
  function canReopen(u) { return u.role === 'XEN'; }
  function canCorrect(u) { return u.role === 'XEN' || u.role === 'Admin'; }
  function isOpenWith(f, uid) { return !f.closed && (f.holder === uid || f.pendingTo === uid); }

  function findRef(db, ref, exceptSl) {
    var key = ref.toLowerCase();
    for (var i = 0; i < db.files.length; i++) {
      if (db.files[i].sl !== exceptSl && db.files[i].ref.toLowerCase() === key) return db.files[i];
    }
    return null;
  }
  function involved(f, uid) {
    if (f.holder === uid || f.pendingTo === uid || f.pendingFrom === uid) return true;
    for (var i = 0; i < f.history.length; i++) {
      var e = f.history[i];
      if (e.from === uid || e.to === uid || e.by === uid) return true;
    }
    return false;
  }
  function nameOf(db, id) { var u = findUser(db, id); return u ? u.name : id; }
  function validDT(s) { return typeof s === 'string' && DT.test(s); }

  // ------------------------------------------------------------ setup

  function freshDb(env) {
    var salt = env.uuid();
    return {
      version: 1,
      users: [{
        id: 'admin', name: 'System Administrator', desig: 'Register administrator', role: 'Admin', active: true,
        salt: salt, hash: env.hash('admin123', salt), mustChange: true,
      }],
      files: [],
      seq: { sl: 1 },
    };
  }

  // ------------------------------------------------------------ read

  function login(db, id, pass, env) {
    var u = findUser(db, str(id, 40).toLowerCase());
    if (!isActive(u) || env.hash(String(pass || ''), u.salt) !== u.hash) return err('Invalid user ID or password.');
    return { ok: true, user: pub(u), mustChange: !!u.mustChange };
  }

  function view(db, me) {
    var all = canSeeAll(me);
    return {
      ok: true,
      user: pub(me),
      mustChange: !!me.mustChange,
      users: db.users.map(pub),
      files: db.files.filter(function (f) { return all || involved(f, me.id); }),
    };
  }

  // ------------------------------------------------------------ file movement

  function registerFile(db, me, req, env) {
    if (!canRegister(me)) return err('Only XEN or the receiving office can register incoming files.');
    var ref = str(req.ref, 80), subject = str(req.subject, 300);
    var from = str(req.from, 120) || 'SE, P&D';
    var now = env.now();
    var at = req.receivedAt ? String(req.receivedAt) : now;
    if (!ref) return err('Reference / file number is required.');
    if (!subject) return err('Subject is required.');
    if (!validDT(at)) return err('Enter a valid receiving date and time.');
    if (at > now) return err('Receiving time cannot be in the future.');
    if (!req.allowDuplicate) {
      var dup = findRef(db, ref, null);
      if (dup) return { ok: false, code: 'DUPLICATE', dupSl: dup.sl, error: 'Reference "' + ref + '" is already registered as Sl. ' + dup.sl + '.' };
    }
    var markTo = str(req.markTo, 40);
    if (markTo) {
      var t = sendTargetError(db, me, markTo);
      if (t) return err(t);
    }
    var f = {
      sl: db.seq.sl, ref: ref, subject: subject, from: from, receivedAt: at,
      createdBy: me.id, createdAt: now,
      holder: me.id, pendingTo: '', pendingFrom: '', pendingAt: '',
      history: [{ type: 'inward', from: from, to: me.id, at: at, by: me.id, recAt: now, note: str(req.note, 500) }],
    };
    db.seq.sl++;
    db.files.push(f);
    if (markTo) applySend(db, me, f, markTo, str(req.markNote, 500), now);
    return { ok: true, file: f };
  }

  function sendTargetError(db, me, toId) {
    var to = findUser(db, toId);
    if (!isActive(to) || to.role === 'Admin') return 'Select an active officer to send the file to.';
    if (to.id === me.id) return 'You cannot send a file to yourself.';
    return '';
  }

  // XEN sending = "marked". Anyone else: "returned" when the recipient has held
  // this file before (sending it back), otherwise "forwarded".
  function moveType(me, to, f) {
    if (me.role === 'XEN') return 'marked';
    for (var i = 0; i < f.history.length; i++) {
      var e = f.history[i];
      if ((e.type === 'inward' || e.type === 'receipt') && e.to === to.id) return 'returned';
    }
    return 'forwarded';
  }

  function applySend(db, me, f, toId, note, now) {
    var to = findUser(db, toId);
    var type = moveType(me, to, f);
    f.pendingTo = to.id; f.pendingFrom = me.id; f.pendingAt = now;
    f.history.push({ type: type, from: me.id, to: to.id, at: now, by: me.id, recAt: now, note: note });
  }

  function sendFile(db, me, req, env) {
    var f = findFile(db, req.sl);
    if (!f) return err('File not found.');
    if (f.closed) return err('This file is closed. It must be reopened before it can be sent.');
    if (f.pendingTo) return err('This file is awaiting receipt by ' + nameOf(db, f.pendingTo) + '. It cannot be sent again until that is confirmed or recalled.');
    if (f.holder !== me.id) return err('Only the officer currently holding this file can send it.');
    var t = sendTargetError(db, me, str(req.to, 40));
    if (t) return err(t);
    applySend(db, me, f, str(req.to, 40), str(req.note, 500), env.now());
    return { ok: true, file: f };
  }

  function confirmReceipt(db, me, req, env) {
    var f = findFile(db, req.sl);
    if (!f) return err('File not found.');
    if (f.pendingTo !== me.id) return err('This file is not awaiting your receipt.');
    var now = env.now();
    var at = req.at ? String(req.at) : now;
    if (!validDT(at)) return err('Enter a valid receipt date and time.');
    if (at > now) return err('Receipt time cannot be in the future.');
    if (at < f.pendingAt) return err('Receipt time cannot be earlier than the time the file was sent.');
    f.history.push({ type: 'receipt', from: f.pendingFrom, to: me.id, at: at, by: me.id, recAt: now, note: str(req.note, 500) });
    f.holder = me.id; f.pendingTo = ''; f.pendingFrom = ''; f.pendingAt = '';
    return { ok: true, file: f };
  }

  function recallFile(db, me, req, env) {
    var f = findFile(db, req.sl);
    if (!f) return err('File not found.');
    if (!f.pendingTo || f.pendingFrom !== me.id) return err('Only the sender can recall a file that is still awaiting receipt.');
    var now = env.now();
    f.history.push({ type: 'recalled', from: me.id, to: f.pendingTo, at: now, by: me.id, recAt: now, note: str(req.note, 500) });
    f.pendingTo = ''; f.pendingFrom = ''; f.pendingAt = '';
    return { ok: true, file: f };
  }

  // The file leaves the department (e.g. sent back to SE). Its record stays in the register.
  function closeFile(db, me, req, env) {
    var f = findFile(db, req.sl);
    if (!f) return err('File not found.');
    if (!canClose(me)) return err('Only XEN or the receiving office can close a file.');
    if (f.closed) return err('This file is already closed.');
    if (f.pendingTo) return err('This file is awaiting receipt by ' + nameOf(db, f.pendingTo) + '. Recall it before closing.');
    if (f.holder !== me.id) return err('Only the officer currently holding this file can close it.');
    var now = env.now();
    var to = str(req.to, 120) || 'SE, P&D';
    var ref = str(req.ref, 80);
    f.history.push({ type: 'closed', from: me.id, to: to, at: now, by: me.id, recAt: now, ref: ref, note: str(req.note, 500) });
    f.closed = true; f.closedAt = now; f.closedTo = to; f.closedBy = me.id; f.closedRef = ref;
    return { ok: true, file: f };
  }

  // The file has come back (or was closed by mistake). XEN takes it back on the desk.
  function reopenFile(db, me, req, env) {
    var f = findFile(db, req.sl);
    if (!f) return err('File not found.');
    if (!canReopen(me)) return err('Only XEN can reopen a closed file.');
    if (!f.closed) return err('This file is not closed.');
    var reason = str(req.note, 500);
    if (!reason) return err('Give a reason for reopening (e.g. file returned by SE).');
    var now = env.now();
    f.history.push({ type: 'reopened', from: f.closedTo || '', to: me.id, at: now, by: me.id, recAt: now, note: reason });
    f.closed = false; f.closedAt = ''; f.closedTo = ''; f.closedBy = ''; f.closedRef = '';
    f.holder = me.id; f.pendingTo = ''; f.pendingFrom = ''; f.pendingAt = '';
    return { ok: true, file: f };
  }

  // Corrects a registration typo. The old and new values are kept in the history entry.
  function correctFile(db, me, req, env) {
    var f = findFile(db, req.sl);
    if (!f) return err('File not found.');
    if (!canCorrect(me)) return err('Only XEN or the administrator can correct registration details.');
    var reason = str(req.reason, 500);
    var now = env.now();
    var next = {
      ref: req.ref == null ? f.ref : str(req.ref, 80),
      subject: req.subject == null ? f.subject : str(req.subject, 300),
      from: req.from == null ? f.from : (str(req.from, 120) || 'SE, P&D'),
      receivedAt: req.receivedAt == null ? f.receivedAt : String(req.receivedAt),
    };
    if (!next.ref) return err('Reference / file number is required.');
    if (!next.subject) return err('Subject is required.');
    if (!validDT(next.receivedAt)) return err('Enter a valid receiving date and time.');
    if (next.receivedAt > now) return err('Receiving time cannot be in the future.');
    var firstMove = f.history[1];
    if (firstMove && next.receivedAt > firstMove.at) return err('Receiving time cannot be later than the first movement of the file.');
    var changes = [];
    ['ref', 'subject', 'from', 'receivedAt'].forEach(function (k) {
      if (next[k] !== f[k]) changes.push({ field: k, label: FIELD_LABEL[k], old: f[k], val: next[k] });
    });
    if (!changes.length) return err('Nothing was changed.');
    if (!reason) return err('Give a reason for the correction.');
    if (next.ref.toLowerCase() !== f.ref.toLowerCase() && !req.allowDuplicate) {
      var dup = findRef(db, next.ref, f.sl);
      if (dup) return { ok: false, code: 'DUPLICATE', dupSl: dup.sl, error: 'Reference "' + next.ref + '" is already registered as Sl. ' + dup.sl + '.' };
    }
    changes.forEach(function (c) { f[c.field] = c.val; });
    f.history.push({ type: 'corrected', from: me.id, to: '', at: now, by: me.id, recAt: now, note: reason, changes: changes });
    return { ok: true, file: f };
  }

  // ------------------------------------------------------------ accounts

  function changePassword(db, me, req, env) {
    var oldPass = String(req.oldPass || ''), newPass = String(req.newPass || '');
    if (env.hash(oldPass, me.salt) !== me.hash) return err('Current password is incorrect.');
    if (newPass.length < 8) return err('New password must be at least 8 characters.');
    if (newPass === oldPass) return err('New password must be different from the current one.');
    me.salt = env.uuid();
    me.hash = env.hash(newPass, me.salt);
    me.mustChange = false;
    return { ok: true, user: pub(me) };
  }

  function addUser(db, me, req, env) {
    if (me.role !== 'Admin') return err('Only the administrator can manage officer accounts.');
    var u = req.user || {};
    var id = str(u.id, 40).toLowerCase();
    var role = str(u.role, 10);
    var name = str(u.name, 120);
    var pass = String(u.pass || '');
    if (!name) return err('Officer name is required.');
    if (!/^[a-z0-9._-]{2,30}$/.test(id)) return err('User ID must be 2 to 30 characters: lowercase letters, digits, dot, dash or underscore.');
    if (ROLES.indexOf(role) === -1) return err('Select a valid role.');
    if (pass.length < 8) return err('Temporary password must be at least 8 characters.');
    if (findUser(db, id)) return err('User ID "' + id + '" already exists.');
    var salt = env.uuid();
    var nu = {
      id: id, name: name, desig: str(u.desig, 120) || DESIG[role], role: role, active: true,
      salt: salt, hash: env.hash(pass, salt), mustChange: true,
    };
    db.users.push(nu);
    return { ok: true, user: pub(nu) };
  }

  function resetUserPass(db, me, req, env) {
    if (me.role !== 'Admin') return err('Only the administrator can manage officer accounts.');
    var u = findUser(db, str(req.id, 40));
    if (!u) return err('User not found.');
    if (u.role === 'Admin') return err('The administrator password must be changed from that account.');
    var temp = env.randomPass();
    u.salt = env.uuid();
    u.hash = env.hash(temp, u.salt);
    u.mustChange = true;
    return { ok: true, user: pub(u), tempPass: temp };
  }

  function setUserActive(db, me, req) {
    if (me.role !== 'Admin') return err('Only the administrator can manage officer accounts.');
    var u = findUser(db, str(req.id, 40));
    if (!u) return err('User not found.');
    if (u.role === 'Admin') return err('The administrator account cannot be deactivated.');
    var active = !!req.active;
    if (!active) {
      var held = db.files.filter(function (f) { return isOpenWith(f, u.id); }).length;
      if (held) return err(u.name + ' is holding or due to receive ' + held + ' file(s). Those files must move to another officer first.');
    }
    u.active = active;
    return { ok: true, user: pub(u) };
  }

  // ------------------------------------------------------------ router

  function dispatch(db, me, action, req, env) {
    if (MUTATIONS.indexOf(action) === -1) return err('Unknown action: ' + action);
    if (me.mustChange && action !== 'changePassword') return err('Change your temporary password first.', 'PASSWORD_CHANGE_REQUIRED');
    switch (action) {
      case 'changePassword': return changePassword(db, me, req, env);
      case 'registerFile':   return registerFile(db, me, req, env);
      case 'sendFile':       return sendFile(db, me, req, env);
      case 'confirmReceipt': return confirmReceipt(db, me, req, env);
      case 'recallFile':     return recallFile(db, me, req, env);
      case 'closeFile':      return closeFile(db, me, req, env);
      case 'reopenFile':     return reopenFile(db, me, req, env);
      case 'correctFile':    return correctFile(db, me, req, env);
      case 'addUser':        return addUser(db, me, req, env);
      case 'resetUserPass':  return resetUserPass(db, me, req, env);
      case 'setUserActive':  return setUserActive(db, me, req, env);
    }
    return err('Unknown action: ' + action);
  }

  return {
    ROLES: ROLES, DESIG: DESIG, MUTATIONS: MUTATIONS,
    freshDb: freshDb, findUser: findUser, findFile: findFile, isActive: isActive,
    login: login, view: view, dispatch: dispatch,
    canSeeAll: canSeeAll, canRegister: canRegister, canClose: canClose, canReopen: canReopen, canCorrect: canCorrect,
  };
})();
