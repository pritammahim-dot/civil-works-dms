/**
 * Civil Works DMS — Google Apps Script backend
 * Storage: db.json in Drive folder "Civil Works DMS" (+ attachments/ subfolder).
 * Deploy: New deployment → Web app → Execute as: Me → Who has access: Anyone.
 * Paste the /exec URL into API_URL in index.html.
 */

var FOLDER_NAME = 'Civil Works DMS';
var SESSION_HOURS = 8;
var SHARE_ATTACHMENTS = true; // anyone with the link can VIEW attachment files

// ---------------------------------------------------------------- entry points

function doGet() {
  return json_({ ok: true, app: 'civil-works-dms', time: new Date().toISOString() });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  try {
    return json_(route_(req));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function route_(req) {
  var action = req.action;
  if (action === 'login') return login_(req);

  // every other action needs a valid session token
  var me = sessionUser_(req.token);
  if (!me) return { ok: false, error: 'Session expired. Please sign in again.', code: 'AUTH' };

  switch (action) {
    case 'logout':          return logout_(req);
    case 'load':            return load_(me);
    case 'changePassword':  return changePassword_(me, req);
    case 'createFile':      return withDb_(function (db) { return createFile_(db, me, req); });
    case 'forwardFile':     return withDb_(function (db) { return forwardFile_(db, me, req); });
    case 'setFileStatus':   return withDb_(function (db) { return setFileStatus_(db, me, req); });
    case 'linkApp':         return withDb_(function (db) { return linkApp_(db, me, req); });
    case 'addAtt':          return withDb_(function (db) { return addAtt_(db, me, req); });
    case 'uploadAtt':       return withDb_(function (db) { return uploadAtt_(db, me, req); });
    case 'addAppItem':      return withDb_(function (db) { return addAppItem_(db, me, req); });
    case 'advanceAppItem':  return withDb_(function (db) { return advanceAppItem_(db, me, req); });
    case 'addCat':          return withDb_(function (db) { return addCat_(db, me, req); });
    case 'removeCat':       return withDb_(function (db) { return removeCat_(db, me, req); });
    case 'addUser':         return withDb_(function (db) { return addUser_(db, me, req); });
    case 'resetUserPass':   return withDb_(function (db) { return resetUserPass_(db, me, req); });
    case 'removeUser':      return withDb_(function (db) { return removeUser_(db, me, req); });
    default:                return { ok: false, error: 'Unknown action: ' + action };
  }
}

// ---------------------------------------------------------------- auth

function login_(req) {
  var id = String(req.id || '').trim().toLowerCase();
  var pass = String(req.pass || '');
  if (!id || !pass) return { ok: false, error: 'User ID and password are required.' };

  var cache = CacheService.getScriptCache();
  var failKey = 'fail:' + id;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= 10) return { ok: false, error: 'Too many failed attempts. Try again in 10 minutes.' };

  var db = readDb_();
  var u = findUser_(db, id);
  if (!u || hash_(pass, u.salt) !== u.hash) {
    cache.put(failKey, String(fails + 1), 600);
    return { ok: false, error: 'Invalid user ID or password.' };
  }
  cache.remove(failKey);

  var token = Utilities.getUuid();
  cache.put('tok:' + token, u.id, SESSION_HOURS * 3600);
  return { ok: true, token: token, user: publicUser_(u), mustChange: !!u.mustChange };
}

function logout_(req) {
  CacheService.getScriptCache().remove('tok:' + req.token);
  return { ok: true };
}

function sessionUser_(token) {
  if (!token) return null;
  var id = CacheService.getScriptCache().get('tok:' + token);
  if (!id) return null;
  var u = findUser_(readDb_(), id);
  return u || null;
}

function changePassword_(me, req) {
  var oldPass = String(req.oldPass || '');
  var newPass = String(req.newPass || '');
  if (newPass.length < 4) return { ok: false, error: 'New password must be at least 4 characters.' };
  return withDb_(function (db) {
    var u = findUser_(db, me.id);
    if (hash_(oldPass, u.salt) !== u.hash) return { ok: false, error: 'Current password is incorrect.' };
    u.salt = Utilities.getUuid();
    u.hash = hash_(newPass, u.salt);
    u.mustChange = false;
    return { ok: true };
  });
}

function hash_(pass, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pass, Utilities.Charset.UTF_8);
  return digest.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function isManager_(u) { return u.role === 'Admin' || u.role === 'XEN'; }

function publicUser_(u) {
  return { id: u.id, name: u.name, desig: u.desig, role: u.role, reportsTo: u.reportsTo || '' };
}

// ---------------------------------------------------------------- data actions

function load_(me) {
  var db = readDb_();
  return {
    ok: true,
    user: publicUser_(findUser_(db, me.id)),
    users: db.users.map(publicUser_),
    files: db.files, appItems: db.appItems, cats: db.cats,
  };
}

function createFile_(db, me, req) {
  var f = req.file || {};
  if (!String(f.subject || '').trim()) return { ok: false, error: 'Subject is required.' };
  var year = new Date().getFullYear();
  var isIn = f.type === 'Incoming';
  var source = String(f.source || '').trim() || (isIn ? 'Unknown' : 'Civil Works (self-initiated)');
  var nf = {
    id: db.seq.file,
    no: 'WZPDCL/CW/' + year + '/' + pad3_(db.seq.file),
    inNo: isIn ? 'IN-' + year + '-' + pad3_(db.seq.inward) : '',
    outNo: '',
    type: String(f.type || 'Incoming'), cat: String(f.cat || ''), subject: String(f.subject).trim(),
    source: source, created: today_(), due: String(f.due || ''), status: 'Pending',
    holder: me.id, appId: '', att: [],
    moves: [{ from: isIn ? source : me.id, to: me.id, date: today_(), note: isIn ? 'Received and registered.' : 'File opened.' }],
  };
  db.seq.file++;
  if (isIn) db.seq.inward++;
  db.files.push(nf);
  return { ok: true, file: nf };
}

function forwardFile_(db, me, req) {
  var f = getFile_(db, req.id);
  if (!f) return { ok: false, error: 'File not found.' };
  if (!req.to || !findUser_(db, req.to)) return { ok: false, error: 'Forward target not found.' };
  f.holder = req.to;
  if (req.due) f.due = String(req.due);
  f.moves.push({ from: me.id, to: req.to, date: today_(), note: String(req.note || '').trim() });
  return { ok: true, file: f };
}

function setFileStatus_(db, me, req) {
  var f = getFile_(db, req.id);
  if (!f) return { ok: false, error: 'File not found.' };
  if (req.op === 'dispose') {
    f.status = 'Disposed';
    f.moves.push({ from: me.id, to: 'Record', date: today_(), note: 'Disposed and sent to record.' });
  } else if (req.op === 'despatch') {
    var outNo = 'OUT-' + new Date().getFullYear() + '-' + pad3_(db.seq.outward);
    db.seq.outward++;
    f.status = 'Despatched';
    f.outNo = outNo;
    f.moves.push({ from: me.id, to: 'Despatch', date: today_(), note: 'Despatched vide ' + outNo + '.' });
  } else if (req.op === 'reopen') {
    f.status = 'Pending';
    f.holder = me.id;
    f.moves.push({ from: me.id, to: me.id, date: today_(), note: 'File reopened.' });
  } else {
    return { ok: false, error: 'Unknown op: ' + req.op };
  }
  return { ok: true, file: f };
}

function linkApp_(db, me, req) {
  var f = getFile_(db, req.id);
  if (!f) return { ok: false, error: 'File not found.' };
  f.appId = String(req.appId || '');
  return { ok: true, file: f };
}

function addAtt_(db, me, req) {
  var f = getFile_(db, req.id);
  if (!f) return { ok: false, error: 'File not found.' };
  var name = String(req.name || '').trim();
  if (!name) return { ok: false, error: 'Attachment name is required.' };
  f.att.push({ name: name, by: me.id });
  return { ok: true, file: f };
}

function uploadAtt_(db, me, req) {
  var f = getFile_(db, req.id);
  if (!f) return { ok: false, error: 'File not found.' };
  var name = String(req.name || '').trim();
  var data = String(req.data || ''); // base64
  if (!name || !data) return { ok: false, error: 'Attachment name and data are required.' };
  if (data.length > 14000000) return { ok: false, error: 'Attachment too large (max ~10 MB).' };
  var bytes = Utilities.base64Decode(data);
  var blob = Utilities.newBlob(bytes, req.mime || 'application/octet-stream', name);
  var att = attachmentsFolder_().createFile(blob);
  if (SHARE_ATTACHMENTS) att.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var entry = { name: name, by: me.id, driveId: att.getId(), url: 'https://drive.google.com/file/d/' + att.getId() + '/view' };
  f.att.push(entry);
  return { ok: true, file: f };
}

function addAppItem_(db, me, req) {
  var it = req.item || {};
  if (!String(it.pkg || '').trim() || !String(it.desc || '').trim()) return { ok: false, error: 'Package no. and description are required.' };
  var item = {
    id: 'p' + db.seq.app, pkg: String(it.pkg).trim(), desc: String(it.desc).trim(),
    method: String(it.method || 'OTM'), est: String(it.est || '').trim() || '—',
    qtr: String(it.qtr || 'Q1'), status: 'Planned',
  };
  db.seq.app++;
  db.appItems.push(item);
  return { ok: true, item: item };
}

function advanceAppItem_(db, me, req) {
  var stages = ['Planned', 'Approved', 'Tendered', 'Awarded', 'Completed'];
  var item = null;
  for (var i = 0; i < db.appItems.length; i++) if (db.appItems[i].id === req.id) item = db.appItems[i];
  if (!item) return { ok: false, error: 'Procurement item not found.' };
  var idx = stages.indexOf(item.status);
  if (idx >= 0 && idx < stages.length - 1) item.status = stages[idx + 1];
  return { ok: true, item: item };
}

function addCat_(db, me, req) {
  var c = String(req.name || '').trim();
  if (c && db.cats.indexOf(c) === -1) db.cats.push(c);
  return { ok: true, cats: db.cats };
}

function removeCat_(db, me, req) {
  db.cats = db.cats.filter(function (c) { return c !== req.name; });
  return { ok: true, cats: db.cats };
}

// ---------------------------------------------------------------- user management (Admin / XEN)

function addUser_(db, me, req) {
  if (!isManager_(me)) return { ok: false, error: 'Only Admin or XEN can manage users.' };
  var u = req.user || {};
  var id = String(u.id || '').trim().toLowerCase();
  if (!id || !String(u.name || '').trim() || !String(u.pass || '')) return { ok: false, error: 'Name, user ID and password are required.' };
  if (findUser_(db, id)) return { ok: false, error: 'User ID "' + id + '" already exists.' };
  var salt = Utilities.getUuid();
  var nu = {
    id: id, name: String(u.name).trim(),
    desig: String(u.desig || u.role || ''), role: String(u.role || 'SAE'), reportsTo: String(u.reportsTo || ''),
    salt: salt, hash: hash_(String(u.pass), salt), mustChange: true,
  };
  db.users.push(nu);
  return { ok: true, user: publicUser_(nu) };
}

function resetUserPass_(db, me, req) {
  if (!isManager_(me)) return { ok: false, error: 'Only Admin or XEN can manage users.' };
  var u = findUser_(db, req.id);
  if (!u) return { ok: false, error: 'User not found.' };
  u.salt = Utilities.getUuid();
  u.hash = hash_('1234', u.salt);
  u.mustChange = true;
  return { ok: true, tempPass: '1234' };
}

function removeUser_(db, me, req) {
  if (!isManager_(me)) return { ok: false, error: 'Only Admin or XEN can manage users.' };
  if (req.id === 'admin' || req.id === me.id) return { ok: false, error: 'This account cannot be removed.' };
  db.users = db.users.filter(function (u) { return u.id !== req.id; });
  return { ok: true };
}

// ---------------------------------------------------------------- storage

function withDb_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = readDb_();
    var res = fn(db);
    if (res && res.ok) writeDb_(db);
    return res;
  } finally {
    lock.releaseLock();
  }
}

function rootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ }
  }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function attachmentsFolder_() {
  var root = rootFolder_();
  var it = root.getFoldersByName('attachments');
  return it.hasNext() ? it.next() : root.createFolder('attachments');
}

function dbFile_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DB_FILE_ID');
  if (id) {
    try { return DriveApp.getFileById(id); } catch (e) { /* recreate below */ }
  }
  var root = rootFolder_();
  var it = root.getFilesByName('db.json');
  var file = it.hasNext() ? it.next() : root.createFile('db.json', JSON.stringify(freshDb_()), 'application/json');
  props.setProperty('DB_FILE_ID', file.getId());
  return file;
}

function readDb_() {
  return JSON.parse(dbFile_().getBlob().getDataAsString());
}

function writeDb_(db) {
  dbFile_().setContent(JSON.stringify(db));
}

function freshDb_() {
  var salt = Utilities.getUuid();
  return {
    users: [{
      id: 'admin', name: 'System Administrator', desig: 'Admin, Civil Works DMS', role: 'Admin', reportsTo: '',
      salt: salt, hash: hash_('admin123', salt), mustChange: true,
    }],
    files: [],
    appItems: [],
    cats: ['Repair & Maintenance', 'Estimates & Bills', 'Tender & Procurement', 'Administration', 'Correspondence'],
    seq: { file: 1, inward: 1, outward: 1, app: 1 },
  };
}

// ---------------------------------------------------------------- helpers

function findUser_(db, id) {
  for (var i = 0; i < db.users.length; i++) if (db.users[i].id === id) return db.users[i];
  return null;
}

function getFile_(db, id) {
  for (var i = 0; i < db.files.length; i++) if (db.files[i].id === id) return db.files[i];
  return null;
}

function today_() {
  return Utilities.formatDate(new Date(), 'Asia/Dhaka', 'yyyy-MM-dd');
}

function pad3_(n) { return ('000' + n).slice(-3); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
