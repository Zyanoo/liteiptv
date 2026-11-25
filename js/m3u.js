// Minimal M3U / M3U8 playlist parser.
// Returns an array of { name, url } in playlist order.
function parseM3U(text) {
  var lines = text.split(/\r?\n/);
  var channels = [];
  var pendingName = null;
  var pendingLogo = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    if (line.indexOf('#EXTINF') === 0) {
      // #EXTINF:-1 tvg-id="..." tvg-logo="http://.../logo.png" group-title="...",Channel Name
      var comma = line.lastIndexOf(',');
      pendingName = comma >= 0 ? line.slice(comma + 1).trim() : 'Unnamed channel';

      var logoMatch = /tvg-logo="([^"]*)"/i.exec(line);
      pendingLogo = logoMatch ? logoMatch[1] : null;
    } else if (line.indexOf('#') === 0) {
      // other directive lines (#EXTM3U, #EXTGRP, etc.) - ignore
      continue;
    } else {
      // a URL line
      channels.push({
        name: pendingName || line,
        logo: pendingLogo || null,
        url: line
      });
      pendingName = null;
      pendingLogo = null;
    }
  }
  return channels;
}

// Rewrites udp:// and rtp:// multicast URLs into udpxy HTTP URLs.
// e.g. convertToProxy("udp://239.1.1.1:1234", "http://192.168.1.50:4022")
//   -> "http://192.168.1.50:4022/udp/239.1.1.1:1234"
function convertToProxy(url, proxyBase) {
  if (!proxyBase) return url;
  var match = /^(udp|rtp):\/\/(.+)$/i.exec(url.trim());
  if (!match) return url;
  var scheme = match[1].toLowerCase();
  var hostPort = match[2].replace(/\/$/, '').replace(/^@/, '');
  var base = proxyBase.replace(/\/$/, '');
  return base + '/' + scheme + '/' + hostPort;
}

function isMulticastUrl(url) {
  return /^(udp|rtp):\/\//i.test(url.trim());
}
