/*
 * PharmaRemise — SSO Clerk (front statique) — v2 (anti-boucle)
 * ------------------------------------------------------------------
 * Corrige le clignotement index.html <-> app.html :
 *   - v1 redirigeait vers /app.html AVANT d'avoir posé le token, or app.html
 *     fait `if(!TOKEN) location.href='/index.html'` -> boucle infinie.
 *   - v2 pose un token SYNCHRONEMENT (sentinelle) avant que la garde d'app.html
 *     s'exécute, attend vraiment le chargement de Clerk, puis remplace la
 *     sentinelle par le vrai jeton, et ne redirige qu'UNE fois (drapeau).
 *
 * Actif UNIQUEMENT sur remise.pharmagestion.fr. Ailleurs : ne fait rien
 * (login email/mot de passe historique intact).
 */
(function () {
  'use strict';

  var PUBLISHABLE_KEY = 'pk_live_Y2xlcmsucGhhcm1hZ2VzdGlvbi5mciQ';
  var CLERK_FRONTEND_API = 'clerk.pharmagestion.fr';
  var HUB = 'https://pharmagestion.fr';
  var SSO_HOSTS = ['remise.pharmagestion.fr'];
  var API_HOSTS = ['web-production-2202b.up.railway.app'];

  // Valeur "sentinelle" : neutralise la garde `if(!TOKEN)` d'app.html le temps
  // que Clerk charge. Le bridge fetch la remplace par un vrai jeton Clerk.
  var SENTINEL = '__clerk_pending__';

  if (SSO_HOSTS.indexOf(location.hostname) === -1) return; // domaine non-SSO : no-op

  var p = location.pathname.replace(/\/+$/, '');
  var isLanding = (p === '' || p === '/index' || p === '/index.html');

  // ------------------------------------------------------------------
  // 1) NEUTRALISER LA BOUCLE (synchrone, avant le script de la page)
  //    Sur app.html : si aucun token, on pose la sentinelle pour que la garde
  //    `if(!TOKEN) -> /index.html` ne se déclenche pas.
  // ------------------------------------------------------------------
  if (!isLanding) {
    try {
      if (!localStorage.getItem('pharmaremise_token')) {
        localStorage.setItem('pharmaremise_token', SENTINEL);
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------
  // 2) BRIDGE FETCH : injecte un jeton Clerk frais sur les appels API.
  //    Tant que Clerk n'est pas prêt (ou token = sentinelle), on n'envoie
  //    pas d'Authorization bidon : on laisse partir sans (l'app gèrera),
  //    et dès que Clerk est prêt on injecte le vrai jeton.
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
  // 3) Chargement de Clerk
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

  function goOnce(key, dest) {
    // Anti-boucle : une redirection donnée n'a lieu qu'une fois par onglet.
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
    } catch (e) {}
    window.location.replace(dest);
    return true;
  }

  function boot() {
    loadClerk()
      .then(function (Clerk) { return Clerk.load().then(function () { return Clerk; }); })
      .then(function (Clerk) {
        _clerkReady = true;

        if (isLanding) {
          if (Clerk.user && Clerk.session) {
            // On récupère le jeton AVANT de partir vers app.html (fin de la boucle).
            Clerk.session.getToken().then(function (t) {
              if (t) {
                localStorage.setItem('pharmaremise_token', t);
                window.location.replace('/app.html');
              } else {
                goOnce('clerk_signin', HUB + '/sign-in?redirect_url=' +
                  encodeURIComponent(location.origin + '/app.html'));
              }
            });
          } else {
            goOnce('clerk_signin', HUB + '/sign-in?redirect_url=' +
              encodeURIComponent(location.origin + '/app.html'));
          }
        } else {
          // Mode app.html
          if (!Clerk.user) {
            // Pas connecté : on nettoie la sentinelle et on renvoie à la landing UNE fois.
            try {
              if (localStorage.getItem('pharmaremise_token') === SENTINEL) {
                localStorage.removeItem('pharmaremise_token');
              }
            } catch (e) {}
            goOnce('clerk_toindex', '/');
            return;
          }
          // Connecté : on remplace la sentinelle par un vrai jeton tout de suite.
          if (Clerk.session) {
            Clerk.session.getToken().then(function (t) {
              if (t) localStorage.setItem('pharmaremise_token', t);
            });
          }
        }
      })
      .catch(function (err) {
        console.error('[clerk-sso] chargement Clerk impossible :', err);
        // On retire la sentinelle pour ne pas laisser l'app dans un état bâtard.
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
