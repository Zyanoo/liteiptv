// Lite IPTV phone-settings server.
// Launched on the TV (via Homebrew Channel's exec service) so a phone on the
// same network can edit settings through a plain web form, and the TV app
// can poll the same settings over local HTTP.
//
// Run manually for testing:  node settings-server.js

var http = require('http');
var os = require('os');
var fs = require('fs');
var url = require('url');
var querystring = require('querystring');

var PORT = 9881;
var SETTINGS_FILE = '/media/developer/liteiptv-settings.json';

function readSettings() {
  try {
    var raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { m3uUrl: '', udpxyBase: '', startMode: 'last', fontScale: 1 };
  }
}

function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

function getLanIps() {
  var ifaces = os.networkInterfaces();
  var ips = [];
  Object.keys(ifaces).forEach(function (name) {
    ifaces[name].forEach(function (iface) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    });
  });
  return ips;
}

function renderForm(settings, message) {
  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Lite IPTV Settings</title>' +
    '<style>' +
    'body{font-family:Arial,sans-serif;background:#0c0d10;color:#fff;padding:24px;max-width:480px;margin:0 auto}' +
    'h1{font-size:22px}' +
    'label{display:block;margin:18px 0 6px;font-size:14px;opacity:.85}' +
    'input,select{width:100%;padding:10px;font-size:16px;border-radius:8px;border:1px solid #444;background:#1a1b20;color:#fff;box-sizing:border-box}' +
    'button{margin-top:22px;width:100%;padding:14px;font-size:16px;border:none;border-radius:8px;background:#2e9fff;color:#000;font-weight:bold}' +
    '.msg{margin-top:16px;padding:10px;border-radius:8px;background:#1d3b24;color:#8ef0a0;font-size:14px}' +
    '</style></head><body>' +
    '<h1>Lite IPTV &mdash; Settings</h1>' +
    (message ? '<div class="msg">' + esc(message) + '</div>' : '') +
    '<form method="POST" action="/">' +
    '<label>M3U Playlist URL</label>' +
    '<input name="m3uUrl" type="text" value="' + esc(settings.m3uUrl) + '">' +
    '<label>UDPXY Proxy Base</label>' +
    '<input name="udpxyBase" type="text" value="' + esc(settings.udpxyBase) + '">' +
    '<label>On App Start</label>' +
    '<select name="startMode">' +
    '<option value="last"' + (settings.startMode === 'last' ? ' selected' : '') + '>Resume last played channel</option>' +
    '<option value="first"' + (settings.startMode === 'first' ? ' selected' : '') + '>Always play first channel</option>' +
    '</select>' +
    '<label>Font Size</label>' +
    '<select name="fontScale">' +
    '<option value="0.8"' + (settings.fontScale == 0.8 ? ' selected' : '') + '>Small</option>' +
    '<option value="1"' + (settings.fontScale == 1 ? ' selected' : '') + '>Medium</option>' +
    '<option value="1.25"' + (settings.fontScale == 1.25 ? ' selected' : '') + '>Large</option>' +
    '<option value="1.5"' + (settings.fontScale == 1.5 ? ' selected' : '') + '>Extra Large</option>' +
    '</select>' +
    '<button type="submit">Save</button>' +
    '</form>' +
    '<p style="margin-top:24px;font-size:12px;opacity:.5">Changes apply on the TV within a few seconds.</p>' +
    '</body></html>';
}

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url);

  if (parsed.pathname === '/api/settings' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(readSettings()));
    return;
  }

  if (parsed.pathname === '/api/settings' && req.method === 'POST') {
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
      try {
        var incoming = JSON.parse(body);
        var current = readSettings();
        var merged = {
          m3uUrl: incoming.m3uUrl != null ? incoming.m3uUrl : current.m3uUrl,
          udpxyBase: incoming.udpxyBase != null ? incoming.udpxyBase : current.udpxyBase,
          startMode: incoming.startMode || current.startMode,
          fontScale: incoming.fontScale != null ? incoming.fontScale : current.fontScale
        };
        writeSettings(merged);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(merged));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (parsed.pathname === '/api/ip' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ips: getLanIps(), port: PORT }));
    return;
  }

  if (parsed.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderForm(readSettings(), null));
    return;
  }

  if (parsed.pathname === '/' && req.method === 'POST') {
    var fbody = '';
    req.on('data', function (chunk) { fbody += chunk; });
    req.on('end', function () {
      var fields = querystring.parse(fbody);
      var merged = {
        m3uUrl: fields.m3uUrl || '',
        udpxyBase: fields.udpxyBase || '',
        startMode: fields.startMode || 'last',
        fontScale: parseFloat(fields.fontScale) || 1
      };
      writeSettings(merged);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderForm(merged, 'Saved! You can close this page.'));
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('Lite IPTV settings server listening on port ' + PORT);
});
