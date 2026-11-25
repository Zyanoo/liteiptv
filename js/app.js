(function () {
  'use strict';

  var STORAGE_KEY = 'liteiptv.settings.v1';
  var LAST_CHANNEL_KEY = 'liteiptv.lastChannelIndex';

  var videoEl = document.getElementById('video');
  var panelEl = document.getElementById('panel');
  var listEl = document.getElementById('channel-list');
  var bannerEl = document.getElementById('banner');
  var bannerNameEl = document.getElementById('banner-name');
  var bannerHintEl = document.getElementById('banner-hint');
  var channelCountEl = document.getElementById('channel-count');
  var modalEl = document.getElementById('settings-modal');
  var statusEl = document.getElementById('settings-status');

  var channels = [];
  var currentIndex = -1;
  var focusedIndex = 0;
  var panelOpen = false;
  var mpegtsPlayer = null;
  var bannerTimer = null;
  var panelCloseTimer = null;

  // ---------- Settings persistence ----------

  function loadSettings() {
    var defaults = {
      m3uUrl: 'https://raw.githubusercontent.com/kingchibihkgit/iptvmx/refs/heads/main/iptv.m3u',
      udpxyBase: '',
      startMode: 'last',
      fontScale: 1
    };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      var parsed = JSON.parse(raw);
      return {
        m3uUrl: parsed.m3uUrl || '',
        udpxyBase: parsed.udpxyBase || '',
        startMode: parsed.startMode || 'last',
        fontScale: parsed.fontScale || 1
      };
    } catch (e) {
      return defaults;
    }
  }

  function applyFontScale() {
    document.documentElement.style.setProperty('--ui-scale', settings.fontScale || 1);
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  var settings = loadSettings();

  // ---------- Playlist loading ----------

  function loadPlaylist(url, cb) {
    if (!url) {
      cb(new Error('No M3U URL configured'));
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var parsed = parseM3U(xhr.responseText);
            cb(null, parsed);
          } catch (e) {
            cb(e);
          }
        } else {
          cb(new Error('HTTP ' + xhr.status + ' fetching playlist'));
        }
      }
    };
    xhr.onerror = function () {
      cb(new Error('Network error fetching playlist'));
    };
    xhr.send();
  }

  function renderChannelList() {
    listEl.innerHTML = '';
    channelCountEl.textContent = channels.length + ' channels';
    channels.forEach(function (ch, idx) {
      var li = document.createElement('li');
      li.dataset.index = idx;
      if (idx === currentIndex) li.classList.add('active');
      if (idx === focusedIndex) li.classList.add('focused');

      if (ch.logo) {
        var img = document.createElement('img');
        img.className = 'channel-logo';
        img.src = ch.logo;
        img.alt = '';
        img.onerror = function () {
          // broken/missing logo: replace with a blank placeholder box
          img.onerror = null;
          img.classList.add('channel-logo-missing');
          img.removeAttribute('src');
        };
        li.appendChild(img);
      } else {
        var placeholder = document.createElement('span');
        placeholder.className = 'channel-logo channel-logo-missing';
        li.appendChild(placeholder);
      }

      var nameSpan = document.createElement('span');
      nameSpan.className = 'channel-name';
      nameSpan.textContent = ch.name;
      li.appendChild(nameSpan);

      li.addEventListener('click', function () {
        playChannel(idx);
        closePanel();
      });
      listEl.appendChild(li);
    });
  }

  function updateFocusHighlight() {
    var items = listEl.querySelectorAll('li');
    items.forEach(function (li, idx) {
      li.classList.toggle('focused', idx === focusedIndex);
    });
    var focusedLi = items[focusedIndex];
    if (focusedLi) focusedLi.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Playback ----------

  function destroyMpegts() {
    if (mpegtsPlayer) {
      try {
        mpegtsPlayer.pause();
        mpegtsPlayer.unload();
        mpegtsPlayer.detachMediaElement();
        mpegtsPlayer.destroy();
      } catch (e) { /* ignore */ }
      mpegtsPlayer = null;
    }
  }

  function playChannel(idx) {
    if (idx < 0 || idx >= channels.length) return;
    currentIndex = idx;
    localStorage.setItem(LAST_CHANNEL_KEY, String(idx));

    var ch = channels[idx];
    var playUrl = ch.url;
    if (isMulticastUrl(playUrl)) {
      playUrl = convertToProxy(playUrl, settings.udpxyBase);
    }

    destroyMpegts();
    videoEl.removeAttribute('src');
    videoEl.load();

    // Multicast with no udpxy proxy: hand the udp:// / rtp:// URL straight to the
    // TV's native player (what SS IPTV does). mpegts.js cannot open udp://.
    var nativeMulticast = isMulticastUrl(playUrl);

    var looksLikeTS = !nativeMulticast && (/\.ts(\?|$)/i.test(playUrl) || isMulticastUrl(ch.url));
    var looksLikeHLS = /\.m3u8(\?|$)/i.test(playUrl);

    if (looksLikeTS && window.mpegts && mpegts.isSupported()) {
      mpegtsPlayer = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: playUrl
      }, {
        enableWorker: true,
        liveBufferLatencyChasing: true
      });
      mpegtsPlayer.attachMediaElement(videoEl);
      mpegtsPlayer.load();
      mpegtsPlayer.play();
    } else {
      // Native playback: HLS (webOS has native HLS support) or progressive/direct HTTP.
      videoEl.src = playUrl;
      videoEl.play().catch(function () { /* autoplay may need a user gesture on first run */ });
    }

    showBanner(ch.name, nativeMulticast ? 'Native UDP' : (looksLikeHLS ? 'HLS stream' : (looksLikeTS ? 'MPEG-TS stream' : 'Direct stream')));
    renderChannelList();
  }

  function nextChannel() {
    if (!channels.length) return;
    var idx = (currentIndex + 1) % channels.length;
    playChannel(idx);
  }

  function prevChannel() {
    if (!channels.length) return;
    var idx = (currentIndex - 1 + channels.length) % channels.length;
    playChannel(idx);
  }

  function showBanner(name, hint) {
    bannerNameEl.textContent = name;
    bannerHintEl.textContent = hint;
    bannerEl.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () {
      bannerEl.classList.remove('show');
    }, 3000);
  }

  // ---------- Panel open/close ----------

  var PANEL_AUTO_HIDE_MS = 3000;

  function scheduleAutoHide() {
    clearTimeout(panelCloseTimer);
    panelCloseTimer = setTimeout(closePanel, PANEL_AUTO_HIDE_MS);
  }

  function openPanel() {
    panelOpen = true;
    focusedIndex = currentIndex >= 0 ? currentIndex : 0;
    panelEl.classList.add('open');
    updateFocusHighlight();
    scheduleAutoHide();
  }

  function closePanel() {
    panelOpen = false;
    panelEl.classList.remove('open');
    clearTimeout(panelCloseTimer);
  }

  function togglePanel() {
    if (panelOpen) closePanel(); else openPanel();
  }

  panelEl.addEventListener('mouseenter', function () {
    clearTimeout(panelCloseTimer);
  });
  panelEl.addEventListener('mousemove', function () {
    scheduleAutoHide();
  });
  panelEl.addEventListener('mouseleave', function () {
    scheduleAutoHide();
  });
  document.getElementById('hoverzone').addEventListener('mouseenter', openPanel);

  // ---------- Settings modal ----------

  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('close-btn').addEventListener('click', closeSettings);
  document.getElementById('save-btn').addEventListener('click', onSaveSettings);

  function openSettings() {
    document.getElementById('m3u-url').value = settings.m3uUrl;
    document.getElementById('udpxy-base').value = settings.udpxyBase;
    document.getElementById('start-mode').value = settings.startMode;
    document.getElementById('font-scale').value = String(settings.fontScale || 1);
    statusEl.textContent = '';
    modalEl.classList.remove('hidden');
  }

  function closeSettings() {
    modalEl.classList.add('hidden');
  }

  function onSaveSettings() {
    settings.m3uUrl = document.getElementById('m3u-url').value.trim();
    settings.udpxyBase = document.getElementById('udpxy-base').value.trim();
    settings.startMode = document.getElementById('start-mode').value;
    settings.fontScale = parseFloat(document.getElementById('font-scale').value) || 1;
    saveSettings(settings);
    applyFontScale();
    statusEl.textContent = 'Loading playlist...';

    loadPlaylist(settings.m3uUrl, function (err, parsed) {
      if (err) {
        statusEl.textContent = 'Error: ' + err.message;
        return;
      }
      channels = parsed;
      statusEl.textContent = 'Loaded ' + channels.length + ' channels.';
      renderChannelList();
      closeSettings();
      startPlayback();
    });
  }

  // ---------- Startup ----------

  function startPlayback() {
    if (!channels.length) return;
    var startIdx = 0;
    if (settings.startMode === 'last') {
      var saved = parseInt(localStorage.getItem(LAST_CHANNEL_KEY), 10);
      if (!isNaN(saved) && saved >= 0 && saved < channels.length) {
        startIdx = saved;
      }
    }
    playChannel(startIdx);
  }

  function init() {
    applyFontScale();
    if (!settings.m3uUrl) {
      bannerNameEl.textContent = 'Welcome to Lite IPTV';
      bannerHintEl.textContent = 'Open Settings (left panel) to add your M3U playlist';
      bannerEl.classList.add('show');
      return;
    }
    loadPlaylist(settings.m3uUrl, function (err, parsed) {
      if (err) {
        bannerNameEl.textContent = 'Could not load playlist';
        bannerHintEl.textContent = err.message;
        bannerEl.classList.add('show');
        return;
      }
      channels = parsed;
      renderChannelList();
      startPlayback();
    });
  }

  // ---------- Remote control ----------
  // webOS remote key codes:
  //  38 Up, 40 Down, 37 Left, 39 Right, 13 Enter/OK
  //  461 Back, 406 Blue
  //  33 Channel Up (Page Up), 34 Channel Down (Page Down)

  document.addEventListener('keydown', function (e) {
    var code = e.keyCode;

    if (!modalEl.classList.contains('hidden')) {
      // settings modal is open; let native inputs behave, only handle Back to close
      if (code === 461 || code === 27) {
        closeSettings();
        e.preventDefault();
      }
      return;
    }

    if (panelOpen) {
      switch (code) {
        case 38: // Up - move focus
          focusedIndex = (focusedIndex - 1 + channels.length) % Math.max(channels.length, 1);
          updateFocusHighlight();
          scheduleAutoHide();
          e.preventDefault();
          break;
        case 40: // Down - move focus
          focusedIndex = (focusedIndex + 1) % Math.max(channels.length, 1);
          updateFocusHighlight();
          scheduleAutoHide();
          e.preventDefault();
          break;
        case 37: // Left - already open, just keep it alive
          scheduleAutoHide();
          e.preventDefault();
          break;
        case 13: // Enter - select
          playChannel(focusedIndex);
          closePanel();
          e.preventDefault();
          break;
        case 461: // Back - close panel
        case 27:
          closePanel();
          e.preventDefault();
          break;
        case 406: // Blue - settings
          openSettings();
          e.preventDefault();
          break;
      }
      return;
    }

    // panel closed: normal viewing mode
    switch (code) {
      case 38: // Up - next channel
        nextChannel();
        e.preventDefault();
        break;
      case 40: // Down - previous channel
        prevChannel();
        e.preventDefault();
        break;
      case 33: // Channel Up
        nextChannel();
        e.preventDefault();
        break;
      case 34: // Channel Down
        prevChannel();
        e.preventDefault();
        break;
      case 461: // Back - open panel
      case 27:
      case 37: // Left - open panel
        openPanel();
        e.preventDefault();
        break;
      case 406: // Blue - settings
        openSettings();
        e.preventDefault();
        break;
    }
  });

  init();
})();
