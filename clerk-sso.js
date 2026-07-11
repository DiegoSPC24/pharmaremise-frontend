/*
 * PharmaRemise — SSO Clerk (front statique) — v3 (arrêt total de la boucle)
 * ------------------------------------------------------------------
 * Approche : sur le host SSO, on PREND LE CONTRÔLE de la navigation.
 *  - On gèle toute redirection tant que Clerk n'a pas tranché (verrou).
 *  - On neutralise les redirections legacy des pages (app.html: if(!TOKEN)->index,
 *    index.html: setTimeout(...location='/app.html')) en interceptant les
 *    assignations de window.location pendant la phase de décision.
 *  - Décision Clerk UNE fois :
 *      • connecté  -> pose le vrai jeton puis va sur /app.html (si on est sur index)
 *      • pas connecté -> va au hub /sign-in UNE fois, et on y reste.
 *
 * Actif UNIQUEMENT sur remise.pharmagestion.fr. Ailleurs : no-op total.
 */
(function () {
  'use strict';

  var PUBLISHABLE_KEY = 'pk_live_Y2xlcmsucGhhcm1hZ2VzdGlvbi5mciQ';
  var CLERK_FRONTEND_API = 'clerk.pharmagestion.fr';
  var HUB = 'https://pharmagestion.fr';
  var SSO_HOSTS = ['remise.pharmagestion.fr'];
  var API_HOSTS = ['web-production-2202b.up.railway.app'];
  var SENTINEL = '__clerk_pending__';

  if (SSO_HOSTS.indexOf(location.hostname) === -1) return; // domaine non-SSO : rien

  var p = location.pathname.replace(/\/+$/, '');
  var isLanding = (p === '' || p === '/index' || p === '/index.html');

  // ------------------------------------------------------------------
  // 0) VERROU DE NAVIGATION — empêche TOUTE redirection interne au sous-domaine
  //    tant que Clerk n'a pas décidé. On laisse passer uniquement :
  //      - les navigations hors du sous-domaine (vers le hub),
  //      - la navigation que NOUS déclenchons (flag _weNavigate).
  //    Ça tue la boucle index<->app à la racine, quelle que soit la page.
  // ------------------------------------------------------------------
  var _decision = false;      // Clerk a tranché ?
  var _weNavigate = false;    // c'est nous qui redirigeons ?

  function sameSubdomainTarget(url) {
    try {
      var u = new URL(url, location.href);
      return u.hostname === location.hostname; // reste sur remise.pharmagestion.fr
    } catch (e) { return false; }
  }

  // Intercepte window.location.href = ... et window.location.assign/replace
  var _loc = window.location;
  function guard(origFn) {
    return function (url) {
      // Avant décision : on bloque tout saut interne au sous-domaine (la boucle).
      if (!_decision && !_weNavigate && sameSubdomainTarget(url)) {
        return; // ignoré : on ne bouge pas tant que Clerk n'a pas parlé
      }
      return origFn.call(_loc, url);
    };
  }
  try {
    var _assign = _loc.assign.bind(_loc);
    var _replace = _loc.replace.bind(_loc);
    _loc.assign = guard(_assign);
    _loc.replace = guard(_replace);
    // href = ... : on redéfinit le setter
    var hrefDesc = Object.getOwnPropertyDescriptor(window.Location.prototype, 'href') ||
                   Object.getOwnPropertyDescriptor(_loc, 'href');
    if (hrefDesc && hrefDesc.set) {
      Object.defineProperty(_loc, 'href', {
        configurable: true,
        get: function () { return hrefDesc.get.call(_loc); },
        set: function (url) {
          if (!_decision && !_weNavigate && sameSubdomainTarget(url)) return;
          hrefDesc.set.call(_loc, url);
        }
      });
    }
  } catch (e) { /* si l'interception échoue, la logique goOnce ci-dessous limite quand même */ }

  function navTo(dest) {
    _weNavigate = true;
    try { _replace ? _replace(dest) : (window.location.href = dest); }
    catch (e) { window.location.href = dest; }
  }

  // ------------------------------------------------------------------
  // 1) Neutralise la garde token d'app.html : on pose une sentinelle si vide.
  // ------------------------------------------------------------------
  if (!isLanding) {
    try {
      if (!localStorage.getItem('pharmaremise_token')) {
        localStorage.setItem('pharmaremise_token', SENTINEL);
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------
  // 2) Bridge fetch : jeton Clerk frais sur les appels API.
  // ------------------------------------------------------------------
  var _clerkReady = false;
  if (!isLanding) {
    var _origFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      init = init || {};
      try {
        var url = typeof input === 'string' ? input
                : (input && input.url) ? input.url : String(input || '');
        if (API_HOSTS.some(function (h) { return url.indexOf(h) !== -1; })) {
          var token = null;
          if (_clerkReady && window.Clerk && window.Clerk.session) {
            try { token = await window.Clerk.session.getToken(); } catch (e) {}
          }
          if (!token) {
            var stored = localStorage.getItem('pharmaremise_token');
            if (stored && stored !== SENTINEL) token = stored;
          }
          if (token) {
            var headers = new Headers(
              (init && init.headers) ||
              (typeof input !== 'string' && input && input.headers) || {}
            );
            headers.set('Authorization', 'Bearer ' + token);
            init.headers = headers;
          }
        }
      } catch (e) {}
      return _origFetch(input, init);
    };
  }

  // ------------------------------------------------------------------
  // 3) Clerk
  // ------------------------------------------------------------------
  function loadClerk() {
    return new Promise(function (resolve, reject) {
      if (window.Clerk) { resolve(window.Clerk); return; }
      var s = document.createElement('script');
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.setAttribute('data-clerk-publishable-key', PUBLISHABLE_KEY);
      s.src = 'https://' + CLERK_FRONTEND_API + '/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
      s.addEventListener('load', function () { resolve(window.Clerk); });
      s.addEventListener('error', function () { reject(new Error('Clerk load error')); });
      document.head.appendChild(s);
    });
  }

  function boot() {
    loadClerk()
      .then(function (Clerk) { return Clerk.load().then(function () { return Clerk; }); })
      .then(function (Clerk) {
        _clerkReady = true;
        _decision = true; // à partir d'ici, la navigation est de nouveau autorisée

        var signedIn = !!(Clerk.user && Clerk.session);

        if (!signedIn) {
          // Pas de session hub : on nettoie et on part au hub UNE fois. On y reste.
          try {
            if (localStorage.getItem('pharmaremise_token') === SENTINEL) {
              localStorage.removeItem('pharmaremise_token');
            }
          } catch (e) {}
          navTo(HUB + '/sign-in?redirect_url=' +
                encodeURIComponent('https://' + location.hostname + '/app.html'));
          return;
        }

        // Connecté au hub : on récupère un vrai jeton.
        Clerk.session.getToken().then(function (t) {
          if (t) {
            try { localStorage.setItem('pharmaremise_token', t); } catch (e) {}
          }
          if (isLanding) {
            navTo('/app.html'); // on entre dans l'app
          }
          // si on est déjà sur app.html : on ne bouge pas, le bridge fetch gère les appels
        });
      })
      .catch(function (err) {
        console.error('[clerk-sso] chargement Clerk impossible :', err);
        _decision = true;
        try {
          if (localStorage.getItem('pharmaremise_token') === SENTINEL) {
            localStorage.removeItem('pharmaremise_token');
          }
        } catch (e) {}
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
