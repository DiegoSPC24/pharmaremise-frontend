/* PharmaRemise — SSO Clerk — v7 (fetch mis en attente de Clerk : plus de 401 au demarrage) */
(function () {
  'use strict';
  var PK = 'pk_live_Y2xlcmsucGhhcm1hZ2VzdGlvbi5mciQ';
  var FAPI = 'clerk.pharmagestion.fr';
  var HUB = 'https://pharmagestion.fr';
  var API_HOST = 'web-production-2202b.up.railway.app';
  if (location.hostname !== 'remise.pharmagestion.fr') return;

  var isLanding = /(^\/$|\/index\.html$)/.test(location.pathname) || location.pathname === '';

  var _resolveReady;
  var clerkReady = new Promise(function (r) { _resolveReady = r; });

  // Bridge fetch : TOUT appel API attend Clerk. Sans ca, app.html appelle
  // /auth/me avec `Bearer null` des le chargement -> 401 -> son handler fait
  // localStorage.clear() + retour /index.html ("2 secondes puis login").
  var of = window.fetch.bind(window);
  window.fetch = async function (i, init) {
    init = init || {};
    try {
      var u = typeof i === 'string' ? i : (i && i.url) ? i.url : '';
      if (u.indexOf(API_HOST) !== -1) {
        var C = await clerkReady;
        if (C && C.session) {
          var t = await C.session.getToken();
          if (t) {
            var h = new Headers(init.headers || (i && i.headers) || {});
            h.set('Authorization', 'Bearer ' + t);
            init.headers = h;
            try { localStorage.setItem('pharmaremise_token', t); } catch (e) {}
          }
        }
      }
    } catch (e) { console.error('[clerk-sso] bridge', e); }
    return of(i, init);
  };

  function load() {
    return new Promise(function (res, rej) {
      if (window.Clerk) return res();
      var s = document.createElement('script');
      s.async = true; s.crossOrigin = 'anonymous';
      s.setAttribute('data-clerk-publishable-key', PK);
      s.src = 'https://' + FAPI + '/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  function waitSession(C) {
    return new Promise(function (res) {
      var n = 0;
      (function tick() {
        if (C.user && C.session) return res(true);
        if (++n > 50) return res(false);
        setTimeout(tick, 100);
      })();
    });
  }

  function once(k) {
    try { if (sessionStorage.getItem(k)) return false; sessionStorage.setItem(k, '1'); } catch (e) {}
    return true;
  }

  load()
    .then(function () { return window.Clerk.load(); })
    .then(async function () {
      var C = window.Clerk;
      var signed = await waitSession(C);

      if (signed) {
        console.log('[clerk-sso] session OK :', C.user.primaryEmailAddress && C.user.primaryEmailAddress.emailAddress);
        var t = await C.session.getToken();
        if (t) { try { localStorage.setItem('pharmaremise_token', t); } catch (e) {} }
        _resolveReady(C);
        if (isLanding && once('go_app')) location.replace('/app.html');
        return;
      }

      console.warn('[clerk-sso] aucune session Clerk detectee');
      _resolveReady(null);
      try { localStorage.removeItem('pharmaremise_token'); } catch (e) {}
      if (once('go_hub')) {
        location.replace(HUB + '/sign-in?redirect_url=' +
          encodeURIComponent('https://remise.pharmagestion.fr/app.html'));
      }
    })
    .catch(function (e) {
      console.error('[clerk-sso] echec chargement Clerk', e);
      _resolveReady(null);
    });
})();
