/* PharmaRemise : animations légères (chargement, apparition, défilement).
   Ce fichier ne change ni la structure ni les données : il habille ce que
   l'appli affiche déjà. Sans effet si le poste demande moins d'animations
   (réglage d'accessibilité « réduire les animations »). Styles : refonte.css,
   section REFONTE_P9_ANIM. */
(function () {
  'use strict'
  var calme = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)
  if (!calme) document.documentElement.classList.add('pr-anim')
  var zone = document.querySelector('.content')

  /* 1. Fine barre de chargement sous l'en-tête, tant qu'un appel réseau dure
     plus de 150 ms (rien ne clignote pour les réponses instantanées). */
  var barre = document.createElement('div')
  barre.id = 'pr-barre'
  var rail = document.createElement('div')
  rail.id = 'pr-rail'
  rail.setAttribute('aria-hidden', 'true')
  rail.appendChild(barre)
  var entete = document.querySelector('.topbar')
  if (entete) entete.insertAdjacentElement('afterend', rail)
  else { rail.className = 'pr-rail-haut'; document.body.appendChild(rail) }
  var enCours = 0, minuteur = null, visible = false
  function debut() {
    if (enCours++ > 0) return
    clearTimeout(minuteur)
    minuteur = setTimeout(function () {
      barre.className = ''
      void barre.offsetWidth
      barre.className = 'go'
      visible = true
    }, 150)
  }
  function fin() {
    if (--enCours > 0) return
    enCours = 0
    clearTimeout(minuteur)
    if (!visible) return
    visible = false
    barre.className = 'fin'
    minuteur = setTimeout(function () { barre.className = '' }, 500)
  }
  var fetchAvant = window.fetch
  if (fetchAvant) {
    window.fetch = function () {
      debut()
      var p
      try { p = fetchAvant.apply(this, arguments) } catch (e) { fin(); throw e }
      p.then(fin, fin)
      return p
    }
    window.fetch.__pmckV290Patched = fetchAvant.__pmckV290Patched
  }

  if (calme || !zone) return

  /* 2. Squelette animé pendant le chargement d'un écran, à la place d'un
     simple « Chargement... » perdu au milieu du vide. */
  var AVEC_CHIFFRES = /^(accueil|grossiste|generiqueur|rfa|groupement|biosim|comparateur|admin-dashboard)-content$/
  function estEcran(el) {
    return el && el.nodeType === 1 && /-content$/.test(el.id || '') && !!el.closest('.screen')
  }
  function habiller(lc) {
    if (lc.classList.contains('pr-squelette')) return
    var hote = lc.parentElement
    lc.classList.add('pr-squelette')
    lc.insertAdjacentHTML('beforeend', '<div class="pr-skel" aria-hidden="true">' +
      (AVEC_CHIFFRES.test(hote.id) ? '<div class="pr-skel-kpis"><i></i><i></i><i></i></div>' : '') +
      '<div class="pr-skel-carte"><b style="width:34%"></b><b></b><b style="width:88%"></b><b style="width:72%"></b><b style="width:56%"></b></div></div>')
    hote._prCharge = true
  }

  /* 3. Arrivée des données : les blocs montent l'un après l'autre, les
     montants comptent jusqu'à leur valeur, les jauges se remplissent. */
  var NOMBRE = /-?\d{1,3}(?:[   ]\d{3})*(?:,\d+)?(?!\d)|-?\d+(?:,\d+)?/
  var MONTANTS = '.kpi-val, .eq-value, .admin-kpi-value, .v311-stat-value'
  function compter(el) {
    if (el._prCompte) return
    el._prCompte = true
    var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), tn
    while ((tn = tw.nextNode()) && !/\d/.test(tn.nodeValue)) { /* cherche le premier nombre */ }
    if (!tn) return
    var texte = tn.nodeValue, m = texte.match(NOMBRE)
    if (!m) return
    var brut = m[0]
    var cible = parseFloat(brut.replace(/[   ]/g, '').replace(',', '.'))
    if (!isFinite(cible) || Math.abs(cible) < 1) return
    var sep = (brut.match(/[   ]/) || [' '])[0]
    var dec = (brut.split(',')[1] || '').length
    var avant = texte.slice(0, m.index), apres = texte.slice(m.index + brut.length)
    var t0 = 0, duree = 700, ecrit = texte
    function format(v) {
      var p = Math.abs(v).toFixed(dec).split('.')
      return (v < 0 ? '-' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, sep) + (dec ? ',' + p[1] : '')
    }
    function pas(t) {
      if (!tn.isConnected || tn.nodeValue !== ecrit) return /* l'appli a réécrit la case : on s'efface */
      if (!t0) t0 = t
      var k = Math.min(1, (t - t0) / duree)
      ecrit = k < 1 ? avant + format(cible * (1 - Math.pow(1 - k, 3))) + apres : texte
      tn.nodeValue = ecrit
      if (k < 1) requestAnimationFrame(pas)
    }
    ecrit = avant + format(0) + apres
    tn.nodeValue = ecrit
    requestAnimationFrame(pas)
  }
  /* bas : ne compter que ce qui est déjà à l'écran (le reste comptera en apparaissant) */
  function animerDans(racine, bas) {
    racine.querySelectorAll(MONTANTS).forEach(function (el) {
      if (!el.offsetParent || el.closest('.pr-cache')) return
      if (bas !== undefined && el.getBoundingClientRect().top >= bas) return
      compter(el)
    })
    racine.querySelectorAll('[style*="height:100%"][style*="width:"]').forEach(function (b) {
      var piste = b.parentElement
      if (!b.closest('.pr-cache') && piste && piste.offsetHeight > 0 && piste.offsetHeight <= 14) b.classList.add('pr-pousse')
    })
  }

  /* 4. Défilement : les cartes sous la ligne de flottaison apparaissent en
     glissant quand on les atteint, une seule fois. */
  var guetteur = window.IntersectionObserver ? new IntersectionObserver(function (vus) {
    vus.forEach(function (v) {
      if (!v.isIntersecting) return
      var c = v.target
      guetteur.unobserve(c)
      c.classList.add('pr-vu')
      c.classList.remove('pr-cache')
      animerDans(c)
      setTimeout(function () { c.classList.remove('pr-vu') }, 600)
    })
  }, { root: zone, rootMargin: '0px 0px -30px 0px', threshold: 0.02 }) : null

  function entree(hote) {
    var bas = zone.getBoundingClientRect().bottom
    if (guetteur) {
      hote.querySelectorAll('.card, .admin-section').forEach(function (c) {
        if (c.parentElement.closest('.pr-cache') || !c.offsetParent) return
        if (c.getBoundingClientRect().top > bas - 20) { c.classList.add('pr-cache'); guetteur.observe(c) }
      })
    }
    var cadre = hote
    for (var i = 0; i < 3 && cadre.children.length === 1; i++) cadre = cadre.children[0]
    cadre.classList.add('pr-entre')
    setTimeout(function () { cadre.classList.remove('pr-entre') }, 1000)
    animerDans(hote, bas)
  }

  function surveiller(liste) {
    for (var i = 0; i < liste.length; i++) {
      var r = liste[i], hote = r.target
      if (!r.addedNodes.length || !estEcran(hote)) continue
      var premier = hote.firstElementChild
      if (premier && premier.classList.contains('loading-center')) habiller(premier)
      else if (hote._prCharge && premier) { hote._prCharge = false; entree(hote) }
    }
  }
  new MutationObserver(surveiller).observe(zone, { childList: true, subtree: true })
  zone.querySelectorAll('.screen [id$="-content"] > .loading-center:first-child').forEach(habiller)

  /* 5. L'en-tête prend une ombre douce dès qu'on a défilé. */
  var defile = false
  zone.addEventListener('scroll', function () {
    var d = zone.scrollTop > 4
    if (d !== defile) { defile = d; document.body.classList.toggle('pr-defile', d) }
  }, { passive: true })
})()
