/*
 * PharmaRemise — SSO Clerk (front statique)
 * ------------------------------------------------------------------
 * Ce script est ADDITIF et sûr :
 *   • Il ne s'active QUE sur le sous-domaine SSO (remise.pharmagestion.fr).
 *   • Sur pharmaremise.fr (ou en local), il ne fait RIEN : la connexion
 *     email/mot de passe historique continue de fonctionner à l'identique.
 *
 * Deux comportements selon la page :
 *   • Landing (index.html)  -> "handshake" : si l'utilisateur est déjà connecté
 *     au hub (session Clerk partagée entre sous-domaines), on récupère un jeton,
 *     on le stocke comme 'pharmaremise_token' (contrat inchangé pour l'app) et on
 *     redirige vers /app.html. Sinon on l'envoie se connecter sur le hub.
 *   • App (app.html)        -> "bridge" : on monkey-patch window.fetch pour injecter
 *     un jeton Clerk FRAIS sur chaque appel API (couvre les 43 fetch d'un coup).
 *     Tant que Clerk n'est pas chargé, on retombe sur le jeton déjà stocké.
 */
(function () {
  'use strict';

  // --- Configuration ------------------------------------------------
  var PUBLISHABLE_KEY = 'pk_live_Y2xlcmsucGhhcm1hZ2VzdGlvbi5mciQ';
  var CLERK_FRONTEND_API = 'clerk.pharmagestion.fr';
  var HUB = 'https://pharmagestion.fr';
  // Hôtes sur lesquels le SSO s'active (le reste = comportement legacy).
  var SSO_HOSTS = ['remise.pharmagestion.fr'];
  // Hôte(s) de l'API PharmaRemise (Railway) : seuls ces appels reçoivent le jeton Clerk.
  var API_HOSTS = ['web-production-2202b.up.railway.app'];

  var host = location.hostname;
  if (SSO_HOSTS.indexOf(host) === -1) {
    // Domaine non-SSO : on ne touche à rien.
    return;
  }

  // --- Détection de la page ----------------------------------------
  var p = location.pathname.replace(/\/+$/, '');
  var isLanding = (p === '' || p === '/index' || p === '/index.html');

  // --- Bridge fetch (installé SYNCHRONEMENT, avant le script de l'app) ---
  var _clerkReady = false;
  if (!isLanding) {
    var _origFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      init = init || {};
      try {
        var url = typeof input === 'string'
          ? input
          : (input && input.url) ? input.url : String(input || '');
        var targetsApi = API_HOSTS.some(function (h) { return url.indexOf(h) !== -1; });
        if (targetsApi) {
          var token = null;
          if (_clerkReady && window.Clerk && window.Clerk.session) {
            try { token = await window.Clerk.session.getToken(); } catch (e) { token = null; }
          }
          if (!token) {
            token = localStorage.getItem('pharmaremise_token'); // repli (encore valide ~1 min)
          }
          if (token) {
            var headers = new Headers(
              (init && init.headers) ||
              (typeof input !== 'string' && input && input.headers) ||
              {}
            );
            headers.set('Authorization', 'Bearer ' + token);
            init.headers = headers;
          }
        }
      } catch (e) { /* on n'empêche jamais la requête de partir */ }
      return _origFetch(input, init);
    };
  }

  // --- Chargement de Clerk ------------------------------------------
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

        if (isLanding) {
          // Handshake : déjà connecté au hub ?
          if (Clerk.user && Clerk.session) {
            Clerk.session.getToken().then(function (t) {
              if (t) {
                localStorage.setItem('pharmaremise_token', t);
                window.location.replace('/app.html');
              } else {
                window.location.replace(HUB + '/sign-in');
              }
            });
          } else {
            // Pas de session : on envoie l'utilisateur se connecter sur le hub.
            window.location.replace(HUB + '/sign-in?redirect_url=' + encodeURIComponent(location.origin + '/app.html'));
          }
        } else {
          // Mode app : si pas de session Clerk, retour landing pour (re)faire le handshake.
          if (!Clerk.user) {
            window.location.replace('/');
            return;
          }
          // Rafraîchit le jeton stocké tout de suite (pour les tout premiers appels).
          if (Clerk.session) {
            Clerk.session.getToken().then(function (t) {
              if (t) localStorage.setItem('pharmaremise_token', t);
            });
          }
        }
      })
      .catch(function (err) {
        // En cas d'échec de chargement Clerk, on ne bloque pas : l'app tentera
        // avec le jeton stocké, et à défaut redirigera via sa logique 401 habituelle.
        console.error('[clerk-sso] chargement Clerk impossible :', err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
