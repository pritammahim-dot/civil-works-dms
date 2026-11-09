/**
 * File Movement Register — Google Apps Script backend (glue).
 *
 * This Apps Script project needs TWO script files:
 *   Code.gs  -> this file
 *   Core.gs  -> paste the whole of register-core.js (the register rules)
 *
 * Storage: Drive folder "Civil File Register" -> db.json, plus backups/ (see dailyBackup).
 * Deploy:  Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone.
 * Paste the /exec URL into API_URL in register.html. Full steps: SETUP-REGISTER.md.
 */

var FOLDER_NAME = 'Civil File Register';
var SESSION_HOURS = 8;
var BACKUPS_TO_KEEP = 60;

var ENV = {
  now: function () { return Utilities.formatDate(new Date(), 'Asia/Dhaka', "yyyy-MM-dd'T'HH:mm"); },
  uuid: function () { return Utilities.getUuid(); },
  hash: function (pass, salt) { return hash_(pass, salt); },
  randomPass: function () { return randomPass_(); },
};

// ---------------------------------------------------------------- entry points

function doGet() {
  return json_({ ok: true, app: 'civil-file-register', time: new Date().toISOString() });
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
  var action = String(req.action || '');
  if (action === 'login') return login_(req);

  var cache = CacheService.getScriptCache();
  var uid = req.token ? cache.get('tok:' + req.token) : null;
  if (!uid) return { ok: false, error: 'Session expired. Please sign in again.', code: 'AUTH' };

  if (action === 'logout') {
    cache.remove('tok:' + req.token);
    return { ok: true };
  }

  if (action === 'load') {
    var db = readDb_();
    var me = RegisterCore.findUser(db, uid);
    if (!RegisterCore.isActive(me)) { cache.remove('tok:' + req.token); return { ok: false, error: 'Account not active.', code: 'AUTH' }; }
    return RegisterCore.view(db, me);
  }

  if (RegisterCore.MUTATIONS.indexOf(action) === -1) return { ok: false, error: 'Unknown action: ' + action };

  return withDb_(function (db) {
    var me = RegisterCore.findUser(db, uid);
    if (!RegisterCore.isActive(me)) return { ok: false, error: 'Account not active.', code: 'AUTH' };
    return RegisterCore.dispatch(db, me, action, req, ENV);
  });
}

function login_(req) {
  var id = String(req.id || '').trim().toLowerCase();
  if (!id || !req.pass) return { ok: false, error: 'User ID and password are required.' };
  var cache = CacheService.getScriptCache();
  var failKey = 'fail:' + id;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= 10) return { ok: false, error: 'Too many failed attempts. Try again in 10 minutes.' };

  var res = RegisterCore.login(readDb_(), id, req.pass, ENV);
  if (!res.ok) {
    cache.put(failKey, String(fails + 1), 600);
    return res;
  }
  cache.remove(failKey);
  var token = Utilities.getUuid();
  cache.put('tok:' + token, res.user.id, SESSION_HOURS * 3600);
  res.token = token;
  return res;
}

// ---------------------------------------------------------------- backup

/**
 * Copies db.json into backups/ with a timestamp and keeps the newest BACKUPS_TO_KEEP copies.
 * Set it to run daily: Triggers (clock icon) -> Add Trigger -> dailyBackup -> Time-driven -> Day timer.
 * You can also run it by hand from the editor at any time.
 */
function dailyBackup() {
  var root = rootFolder_();
  var it = root.getFoldersByName('backups');
  var folder = it.hasNext() ? it.next() : root.createFolder('backups');
  var stamp = Utilities.formatDate(new Date(), 'Asia/Dhaka', 'yyyy-MM-dd_HHmm');
  folder.createFile('db_' + stamp + '.json', dbFile_().getBlob().getDataAsString(), 'application/json');

  var files = [];
  var fit = folder.getFiles();
  while (fit.hasNext()) files.push(fit.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  for (var i = BACKUPS_TO_KEEP; i < files.length; i++) files[i].setTrashed(true);
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

function dbFile_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DB_FILE_ID');
  if (id) {
    try { return DriveApp.getFileById(id); } catch (e) { /* recreate below */ }
  }
  var root = rootFolder_();
  var it = root.getFilesByName('db.json');
  var file = it.hasNext() ? it.next() : root.createFile('db.json', JSON.stringify(RegisterCore.freshDb(ENV)), 'application/json');
  props.setProperty('DB_FILE_ID', file.getId());
  return file;
}

function readDb_() { return JSON.parse(dbFile_().getBlob().getDataAsString()); }
function writeDb_(db) { dbFile_().setContent(JSON.stringify(db)); }

// ---------------------------------------------------------------- helpers

function hash_(pass, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pass, Utilities.Charset.UTF_8);
  return digest.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function randomPass_() {
  var chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  var out = '';
  for (var i = 0; i < 10; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
