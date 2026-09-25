/* ============================================================================
   LOT_RFA / LOT_GROUPEMENT / LOT_DATES — écrans RFA et Remise groupement,
   modale « à partir de quand », liste des factures déposées.

   Chargé après le script principal d'app.html : on y reprend ses globales
   (API, TOKEN, MODULES, CURRENT_ANNEE, eur, toast, uploadDepot, lockedHTML).
   ============================================================================ */

const MOIS_NOMS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
const MOIS_COURTS = ['Janv.','Févr.','Mars','Avr.','Mai','Juin','Juil.','Août','Sept.','Oct.','Nov.','Déc.']
const BASE_LIBELLE = { brut: 'prix brut HT (avant remise)', net: 'prix net remisé HT' }
const BASE_COURT = { brut: 'sur brut', net: 'sur net' }

function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])) }
function jsArg(s) { return h(JSON.stringify(String(s))) }

/** fetch JSON qui lève une erreur lisible (le detail de l'API) si la réponse n'est pas OK. */
async function apiSend(method, path, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}` } }
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body) }
  const r = await fetch(`${API}${path}`, opts)
  let data = null
  try { data = await r.json() } catch (e) {}
  if (!r.ok) {
    let msg = data && data.detail
    if (Array.isArray(msg)) msg = msg.map(d => d.msg).join(' ; ')
    throw new Error(msg || `Erreur ${r.status}`)
  }
  return data
}

/** 'AAAA-MM-JJ' → 'mars 2026' */
function moisLisible(iso) {
  if (!iso) return '—'
  const [a, m] = String(iso).split('-').map(Number)
  return `${MOIS_NOMS[m - 1].toLowerCase()} ${a}`
}
function dateFr(iso) {
  if (!iso) return '—'
  const [a, m, j] = String(iso).split('-')
  return `${j}/${m}/${a}`
}
function pctFr(n) { return (parseFloat(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' %' }

/* ---------------------------------------------------------------------------
   Historique des versions (affiché sous une fiche ou un contrat)
   --------------------------------------------------------------------------- */
function historiqueVersionsHTML(versions, resume) {
  if (!versions || versions.length < 2) return ''
  const lignes = versions.slice().reverse().map(v => `
    <li><strong>${v.date_effet <= '2000-01-01' ? 'À l\'origine' : 'Depuis ' + moisLisible(v.date_effet)}</strong> : ${h(resume(v))}</li>`).join('')
  return `<details style="margin-top:8px;font-size:12px;color:var(--sub)">
    <summary style="cursor:pointer">Historique des conditions (${versions.length} versions)</summary>
    <ul style="margin:6px 0 0 18px;padding:0;line-height:1.7">${lignes}</ul></details>`
}

/* ---------------------------------------------------------------------------
   LOT_DATES — « À partir de quand ? » + « Recalculer la période concernée »
   Renvoie une Promise : { date_effet: 'AAAA-MM', recalculer } ou null (annulé).
   --------------------------------------------------------------------------- */
function demanderDateEffet(opts) {
  opts = opts || {}
  return new Promise(resolve => {
    const now = new Date()
    const courant = { a: now.getFullYear(), m: now.getMonth() + 1 }
    let options = ''
    for (let a = courant.a - 3; a <= courant.a + 1; a++) {
      for (let m = 1; m <= 12; m++) {
        const sel = (a === courant.a && m === courant.m) ? ' selected' : ''
        options += `<option value="${a}-${String(m).padStart(2, '0')}"${sel}>${MOIS_NOMS[m - 1]} ${a}</option>`
      }
    }
    const o = document.createElement('div')
    o.className = 'modal-overlay open'
    o.innerHTML = `
      <div class="modal-box" style="width:480px">
        <div style="font-size:16px;font-weight:700;margin-bottom:4px">${h(opts.titre || 'Modifier les conditions')}</div>
        <div style="font-size:12px;color:var(--sub);margin-bottom:16px">À partir de quand appliquer ces changements ?</div>
        <label style="font-size:12px;color:var(--sub);display:block;margin-bottom:6px">Appliquer à partir de</label>
        <select class="de-mois" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;margin-bottom:12px">${options}</select>
        <div class="de-passe" style="display:none">
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;cursor:pointer;padding:10px;background:#F8F9FA;border-radius:8px">
            <input type="checkbox" class="de-recalc" checked style="width:16px;height:16px;margin-top:2px;accent-color:var(--green)"/>
            <span>Recalculer la période concernée <span class="de-periode" style="color:var(--sub)"></span></span>
          </label>
          <div class="de-note" style="font-size:12px;color:var(--sub);margin-top:8px"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
          <button class="btn btn-outline btn-sm de-annuler">Annuler</button>
          <button class="btn btn-green btn-sm de-ok"><i class=ic-save></i> Appliquer</button>
        </div>
      </div>`
    document.body.appendChild(o)
    const sel = o.querySelector('.de-mois'), recalc = o.querySelector('.de-recalc')
    const maj = () => {
      const [a, m] = sel.value.split('-').map(Number)
      const passe = a * 12 + m < courant.a * 12 + courant.m
      o.querySelector('.de-passe').style.display = passe ? '' : 'none'
      o.querySelector('.de-periode').textContent = `(de ${MOIS_NOMS[m - 1].toLowerCase()} ${a} à aujourd'hui)`
      o.querySelector('.de-note').innerHTML = recalc.checked
        ? `Les mois depuis ${MOIS_NOMS[m - 1].toLowerCase()} ${a} seront recalculés avec les nouvelles conditions.`
        : `Les mois passés gardent les anciennes conditions : le changement s'appliquera à partir de <strong>${MOIS_NOMS[courant.m - 1].toLowerCase()} ${courant.a}</strong>.`
    }
    sel.onchange = maj; recalc.onchange = maj; maj()
    const fin = v => { o.remove(); resolve(v) }
    o.querySelector('.de-annuler').onclick = () => fin(null)
    o.onclick = e => { if (e.target === o) fin(null) }
    o.querySelector('.de-ok').onclick = () => fin({ date_effet: sel.value, recalculer: recalc.checked })
  })
}
window.demanderDateEffet = demanderDateEffet

/* ---------------------------------------------------------------------------
   Factures déposées dans une zone (Direct labo, RFA, Groupement)
   --------------------------------------------------------------------------- */
async function renderListeDepots(containerId, opts) {
  const el = document.getElementById(containerId)
  if (!el) return
  el.innerHTML = '<div style="font-size:12px;color:var(--sub)">Chargement...</div>'
  const q = new URLSearchParams({ source: opts.source })
  if (opts.fiche_id) q.set('fiche_id', opts.fiche_id)
  let factures
  try { factures = await apiSend('GET', `/depots/factures?${q}`) }
  catch (e) { el.innerHTML = `<div style="font-size:12px;color:var(--red)">${h(e.message)}</div>`; return }
  if (!factures.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--sub);padding:8px 0">Aucune facture déposée pour l\'instant.</div>'
    return
  }
  el.innerHTML = `
    <table style="width:100%;font-size:12px;border-collapse:collapse">
      <thead><tr style="color:var(--sub);font-size:10px;text-transform:uppercase;text-align:left">
        <th style="padding:6px">Mois</th><th style="padding:6px">Fournisseur</th><th style="padding:6px">N° facture</th>
        <th style="padding:6px">Fichier</th><th style="padding:6px;text-align:right">Lignes</th>
        <th style="padding:6px;text-align:right">Total HT</th><th></th></tr></thead>
      <tbody>${factures.map(f => `
        <tr style="border-top:1px solid var(--border)">
          <td style="padding:6px">${MOIS_COURTS[f.mois - 1]} ${f.annee}</td>
          <td style="padding:6px">${h(f.labo)}</td>
          <td style="padding:6px;font-family:'DM Mono',monospace">${h(f.numero_facture || '—')}</td>
          <td style="padding:6px;color:var(--sub)">${h(f.filename)}</td>
          <td style="padding:6px;text-align:right">${f.nb_lignes}</td>
          <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(f.total_ht)}</td>
          <td style="padding:6px;text-align:right">
            <button class="btn btn-outline btn-sm" title="Supprimer cette facture"
              onclick="supprimerDepot(${jsArg(f.id)}, ${jsArg(f.filename)}, ${jsArg(containerId)}, ${h(JSON.stringify(opts))})"><i class=ic-trash></i></button>
          </td>
        </tr>`).join('')}</tbody>
    </table>`
}

async function supprimerDepot(id, filename, containerId, opts) {
  if (!confirm(`Supprimer la facture « ${filename} » ?\nSes chiffres disparaîtront des calculs.`)) return
  try {
    await apiSend('DELETE', `/depots/factures/${id}`)
    toast('Facture supprimée', 'green')
    if (opts.source === 'rfa') chargerFicheRFA(opts.fiche_id)
    else if (opts.source === 'groupement') chargerFicheGroupement(opts.fiche_id)
    else renderListeDepots(containerId, opts)
  } catch (e) { toast(e.message, 'red') }
}

/** Zone de glisser-déposer propre à une fiche. */
function zoneDepotHTML(source, ficheId) {
  const id = `${source}-${ficheId}`
  return `
    <div class="upload-zone" style="padding:18px;min-height:0" onclick="document.getElementById('fi-${id}').click()"
      ondragover="event.preventDefault();this.style.borderColor='var(--green)'" ondragleave="this.style.borderColor='var(--border)'"
      ondrop="event.preventDefault();this.style.borderColor='var(--border)';deposerFichiers(event.dataTransfer.files, '${source}', '${ficheId}')">
      <input type="file" id="fi-${id}" accept=".pdf,.xml" multiple style="display:none" onchange="deposerFichiers(this.files, '${source}', '${ficheId}');this.value=''"/>
      <div style="font-size:13px;font-weight:600"><i class=ic-upload></i> Déposer des factures dans cette fiche</div>
      <div style="font-size:11px;color:var(--sub);margin-top:2px">PDF ou facture électronique (Factur-X / XML) — plusieurs fichiers acceptés</div>
    </div>
    <div id="q-${id}" style="margin-top:8px"></div>`
}

function deposerFichiers(files, source, ficheId) {
  Array.from(files || []).forEach(f => {
    if (!/\.(pdf|xml)$/i.test(f.name)) { toast(`${f.name} : PDF ou XML uniquement`, 'red'); return }
    uploadDepot(f, {
      source, fiche_id: ficheId, queueId: `q-${source}-${ficheId}`,
      onSaved: () => source === 'rfa' ? chargerFicheRFA(ficheId) : chargerFicheGroupement(ficheId),
    })
  })
}

/* Petits éléments de formulaire */
const INPUT_STYLE = 'width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px'
function champ(label, html, aide) {
  return `<div style="margin-bottom:12px"><label style="font-size:12px;color:var(--sub);display:block;margin-bottom:4px">${label}</label>${html}${aide ? `<div style="font-size:11px;color:var(--sub);margin-top:4px">${aide}</div>` : ''}</div>`
}
function choixBase(name, valeur) {
  return `<div style="display:flex;gap:8px;flex-wrap:wrap">${['brut', 'net'].map(b => `
    <label style="flex:1;min-width:160px;display:flex;gap:8px;align-items:flex-start;padding:10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px">
      <input type="radio" name="${name}" value="${b}" ${valeur === b ? 'checked' : ''} style="margin-top:2px;accent-color:var(--green)"/>
      <span><strong>${b === 'brut' ? 'Prix brut' : 'Prix net'}</strong><br><span style="font-size:11px;color:var(--sub)">${b === 'brut' ? 'Total avant remise (prix catalogue)' : 'Total net remisé'}</span></span>
    </label>`).join('')}</div>`
}
function ouvrirModale(html, largeur) {
  const o = document.createElement('div')
  o.className = 'modal-overlay open'
  o.innerHTML = `<div class="modal-box" style="width:${largeur || 520}px;max-height:90vh;overflow-y:auto">${html}</div>`
  o.onclick = e => { if (e.target === o) o.remove() }
  document.body.appendChild(o)
  return o
}
function kpi(label, valeur, classe, sous) {
  return `<div class="kpi-card"><div class="kpi-lbl">${label}</div><div class="kpi-val ${classe || ''}">${valeur}</div>${sous ? `<div style="font-size:10px;color:var(--sub);margin-top:2px">${sous}</div>` : ''}</div>`
}

/** Saisie « € reçu » : même comportement dans RFA et Groupement. */
function inputRecu(module, ficheId, a, m, valeur) {
  return `<input type="number" step="0.01" placeholder="—" value="${valeur == null ? '' : valeur}"
    onchange="enregistrerRecu('${module}', '${ficheId}', ${a}, ${m}, this.value)"
    style="width:96px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;text-align:right;font-family:'DM Mono',monospace"/>`
}
async function enregistrerRecu(module, ficheId, annee, mois, valeur) {
  try {
    await apiSend('PUT', `/${module}/fiches/${ficheId}/recus`,
      { annee, mois, montant: valeur === '' ? null : parseFloat(String(valeur).replace(',', '.')) })
    toast('Montant reçu enregistré', 'green')
    module === 'rfa' ? chargerFicheRFA(ficheId) : chargerFicheGroupement(ficheId)
  } catch (e) { toast(e.message, 'red') }
}
function ecartHTML(ecart) {
  if (ecart == null) return '<span style="color:var(--sub)">—</span>'
  const c = ecart < -0.005 ? 'var(--red)' : 'var(--green)'
  return `<span style="color:${c};font-family:'DM Mono',monospace">${ecart > 0 ? '+' : ''}${eur(ecart)}</span>`
}

/* ============================================================================
   RFA
   ============================================================================ */
let _RFA_FICHES = {}         // id -> détail
let _RFA_OUVERT = {}         // id -> détail mensuel déplié

async function loadRFA() {
  const el = document.getElementById('rfa-content')
  if (!MODULES.includes('rfa')) { el.innerHTML = lockedHTML('rfa'); return }
  el.innerHTML = '<div class="loading-center"><div class="spinner"></div> Chargement...</div>'
  try {
    const liste = await apiSend('GET', '/rfa/fiches')
    const details = await Promise.all(liste.map(f => apiSend('GET', `/rfa/fiches/${f.id}`)))
    _RFA_FICHES = {}
    details.forEach(d => { _RFA_FICHES[d.id] = d })
    renderRFA()
  } catch (e) {
    el.innerHTML = `<div class="loading-center" style="color:var(--red)">${h(e.message)}</div>`
  }
}

function renderRFA() {
  const el = document.getElementById('rfa-content')
  const fiches = Object.values(_RFA_FICHES).sort((a, b) => a.nom.localeCompare(b.nom))
  const tot = fiches.reduce((t, f) => ({
    attendu: t.attendu + f.totaux.remise_attendue, recu: t.recu + f.totaux.recu,
  }), { attendu: 0, recu: 0 })
  const entete = `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <div class="card-title" style="margin:0">Remises de fin d'année (RFA)</div>
        <div style="font-size:12px;color:var(--sub);margin-top:4px">Une fiche par labo ou groupement : sa période, son % de remise, et ses propres factures.</div>
      </div>
      <button class="btn btn-green" onclick="ouvrirCreationRFA()"><i class=ic-plus></i> Créer un labo ou un groupement</button>
    </div>`
  if (!fiches.length) {
    el.innerHTML = entete + `
      <div class="card" style="text-align:center;padding:40px;color:var(--sub)">
        <div style="font-size:36px"><i class=ic-euro></i></div>
        <div style="margin-top:10px;font-size:14px">Aucune fiche RFA</div>
        <div style="font-size:12px;margin-top:4px">Créez un labo (ou un groupement), puis déposez ses factures dans sa fiche : la remise espérée se calcule toute seule.</div>
      </div>`
    return
  }
  el.innerHTML = entete + `
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      ${kpi('Remise espérée (toutes fiches)', eur(tot.attendu), 'green')}
      ${kpi('Reçu', eur(tot.recu))}
      ${kpi('Reste à recevoir', eur(tot.attendu - tot.recu), tot.attendu - tot.recu > 0.005 ? 'blue' : '')}
    </div>` + fiches.map(f => `<div id="rfa-fiche-${f.id}">${ficheRFAHTML(f)}</div>`).join('')
  // Les listes de factures ne se chargent que pour les fiches dépliées.
  Object.keys(_RFA_OUVERT).filter(id => _RFA_OUVERT[id] && _RFA_FICHES[id])
    .forEach(id => renderListeDepots(`rfa-depots-${id}`, { source: 'rfa', fiche_id: id }))
}

async function chargerFicheRFA(id) {
  try {
    _RFA_FICHES[id] = await apiSend('GET', `/rfa/fiches/${id}`)
    renderRFA()
  } catch (e) { toast(e.message, 'red') }
}

function ficheRFAHTML(f) {
  const c = f.conditions || {}
  const t = f.totaux
  const ouvert = !!_RFA_OUVERT[f.id]
  const badge = f.type_fiche === 'groupement'
    ? '<span style="padding:3px 9px;background:#0891B2;color:#fff;border-radius:4px;font-size:11px;font-weight:600">Groupement</span>'
    : '<span style="padding:3px 9px;background:var(--green);color:#fff;border-radius:4px;font-size:11px;font-weight:600">Labo</span>'
  const moisRows = f.mois.map(m => `
    <tr style="border-top:1px solid var(--border)">
      <td style="padding:6px">${MOIS_NOMS[m.mois - 1]} ${m.annee}</td>
      <td style="padding:6px;text-align:right;color:var(--sub)">${m.nb_factures || ''}</td>
      <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(m.total_brut)}</td>
      <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(m.total_remise)}</td>
      <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(m.total_net)}</td>
      <td style="padding:6px;text-align:right;color:var(--sub)">${m.taux_pct != null ? `${pctFr(m.taux_pct)} ${BASE_COURT[m.base]}` : '—'}</td>
      <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace;color:var(--green);font-weight:600">${eur(m.remise_attendue)}</td>
      <td style="padding:6px;text-align:right">${inputRecu('rfa', f.id, m.annee, m.mois, m.recu)}</td>
      <td style="padding:6px;text-align:right">${ecartHTML(m.ecart)}</td>
    </tr>`).join('')
  return `
    <div class="card" style="border-left:3px solid ${f.type_fiche === 'groupement' ? '#0891B2' : 'var(--green)'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div>
          <div style="display:flex;align-items:center;gap:8px">${badge}<span style="font-size:16px;font-weight:700">${h(f.nom)}</span></div>
          <div style="font-size:12px;color:var(--sub);margin-top:4px">
            Période du ${dateFr(f.periode_debut)} au ${dateFr(f.periode_fin)} ·
            <strong>${pctFr(c.taux_pct)}</strong> sur le ${BASE_LIBELLE[c.base] || '—'}
          </div>
          ${historiqueVersionsHTML(f.versions, v => `${pctFr(v.taux_pct)} ${BASE_COURT[v.base]}`)}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" onclick="ouvrirConditionsRFA('${f.id}')"><i class=ic-pencil></i> Modifier les conditions</button>
          <button class="btn btn-outline btn-sm" onclick="ouvrirEditionRFA('${f.id}')"><i class=ic-settings></i> Fiche</button>
          <button class="btn btn-outline btn-sm" onclick="supprimerFicheRFA('${f.id}')" title="Supprimer la fiche"><i class=ic-trash></i></button>
        </div>
      </div>
      <div class="kpi-grid" style="margin:14px 0 0">
        ${kpi('Total prix catalogue', eur(t.total_brut))}
        ${kpi('Total remise', eur(t.total_remise))}
        ${kpi('Total net remisé', eur(t.total_net))}
        ${kpi('Remise espérée', eur(t.remise_attendue), 'green', `Reçu ${eur(t.recu)} · reste ${eur(t.reste_a_recevoir)}`)}
      </div>
      ${f.nb_factures_hors_periode ? `<div class="alert alert-amber" style="margin-top:10px;font-size:12px"><i class=ic-alert></i> ${f.nb_factures_hors_periode} facture(s) datée(s) hors de la période : elles ne comptent pas.</div>` : ''}
      <button class="btn btn-outline btn-sm" style="margin-top:12px" onclick="_RFA_OUVERT['${f.id}']=!_RFA_OUVERT['${f.id}'];renderRFA()">
        ${ouvert ? '▲ Masquer' : '▼ Détail mensuel, € reçus et factures'}
      </button>
      <div style="display:${ouvert ? 'block' : 'none'};margin-top:12px">
        <div style="overflow-x:auto">
        <table style="width:100%;font-size:12px;border-collapse:collapse;min-width:760px">
          <thead><tr style="background:#F8FAFC;color:var(--sub);font-size:10px;text-transform:uppercase">
            <th style="padding:6px;text-align:left">Mois</th><th style="padding:6px;text-align:right">Fact.</th>
            <th style="padding:6px;text-align:right">Prix catalogue</th><th style="padding:6px;text-align:right">Remise</th>
            <th style="padding:6px;text-align:right">Net remisé</th><th style="padding:6px;text-align:right">Condition</th>
            <th style="padding:6px;text-align:right">Remise espérée</th><th style="padding:6px;text-align:right">€ reçu</th>
            <th style="padding:6px;text-align:right">Écart</th></tr></thead>
          <tbody>${moisRows}</tbody>
          <tfoot><tr style="border-top:2px solid var(--border);font-weight:700">
            <td style="padding:6px">Total</td><td></td>
            <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(t.total_brut)}</td>
            <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(t.total_remise)}</td>
            <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(t.total_net)}</td><td></td>
            <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace;color:var(--green)">${eur(t.remise_attendue)}</td>
            <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(t.recu)}</td>
            <td style="padding:6px;text-align:right">${ecartHTML(t.recu - t.remise_attendue)}</td></tr></tfoot>
        </table>
        </div>
        <div style="font-size:12px;font-weight:600;color:var(--sub);text-transform:uppercase;letter-spacing:.4px;margin:16px 0 6px">Factures de la fiche</div>
        ${zoneDepotHTML('rfa', f.id)}
        <div id="rfa-depots-${f.id}" style="margin-top:8px"></div>
      </div>
    </div>`
}

function ouvrirCreationRFA() {
  const a = new Date().getFullYear()
  const o = ouvrirModale(`
    <div style="font-size:16px;font-weight:700;margin-bottom:14px">Créer une fiche RFA</div>
    ${champ('Type', `<div style="display:flex;gap:8px">
        <label style="flex:1;display:flex;gap:8px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:8px;cursor:pointer"><input type="radio" name="rfa-type" value="labo" checked style="accent-color:var(--green)"/> Un labo</label>
        <label style="flex:1;display:flex;gap:8px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:8px;cursor:pointer"><input type="radio" name="rfa-type" value="groupement" style="accent-color:var(--green)"/> Un groupement</label>
      </div>`)}
    ${champ('Nom', `<input class="rfa-nom" placeholder="Ex. : Pierre Fabre" style="${INPUT_STYLE}"/>`)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${champ('Début de période', `<input type="date" class="rfa-debut" value="${a}-01-01" style="${INPUT_STYLE}"/>`)}
      ${champ('Fin de période', `<input type="date" class="rfa-fin" value="${a}-12-31" style="${INPUT_STYLE}"/>`)}
    </div>
    ${champ('% de remise', `<input type="number" class="rfa-taux" step="0.01" min="0" max="100" placeholder="Ex. : 3" style="${INPUT_STYLE}"/>`)}
    ${champ('Calculé sur', choixBase('rfa-base', 'net'))}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
      <button class="btn btn-outline btn-sm" onclick="this.closest('.modal-overlay').remove()">Annuler</button>
      <button class="btn btn-green btn-sm rfa-ok"><i class=ic-save></i> Créer</button>
    </div>`)
  o.querySelector('.rfa-nom').focus()
  o.querySelector('.rfa-ok').onclick = async () => {
    const body = {
      type_fiche: o.querySelector('input[name=rfa-type]:checked').value,
      nom: o.querySelector('.rfa-nom').value,
      periode_debut: o.querySelector('.rfa-debut').value,
      periode_fin: o.querySelector('.rfa-fin').value,
      taux_pct: parseFloat(o.querySelector('.rfa-taux').value),
      base: o.querySelector('input[name=rfa-base]:checked').value,
    }
    if (isNaN(body.taux_pct)) { toast('Indiquez le % de remise', 'red'); return }
    try {
      const f = await apiSend('POST', '/rfa/fiches', body)
      o.remove()
      _RFA_FICHES[f.id] = f
      _RFA_OUVERT[f.id] = true
      renderRFA()
      toast('Fiche créée : déposez-y ses factures', 'green')
    } catch (e) { toast(e.message, 'red') }
  }
}

function ouvrirEditionRFA(id) {
  const f = _RFA_FICHES[id]
  const o = ouvrirModale(`
    <div style="font-size:16px;font-weight:700;margin-bottom:14px">Fiche ${h(f.nom)}</div>
    ${champ('Type', `<select class="rfa-type" style="${INPUT_STYLE}">
      <option value="labo" ${f.type_fiche === 'labo' ? 'selected' : ''}>Labo</option>
      <option value="groupement" ${f.type_fiche === 'groupement' ? 'selected' : ''}>Groupement</option></select>`)}
    ${champ('Nom', `<input class="rfa-nom" value="${h(f.nom)}" style="${INPUT_STYLE}"/>`)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${champ('Début de période', `<input type="date" class="rfa-debut" value="${f.periode_debut}" style="${INPUT_STYLE}"/>`)}
      ${champ('Fin de période', `<input type="date" class="rfa-fin" value="${f.periode_fin}" style="${INPUT_STYLE}"/>`)}
    </div>
    <div style="font-size:11px;color:var(--sub)">Pour changer le % ou la base de calcul, utilisez « Modifier les conditions » : on vous demandera à partir de quand.</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-outline btn-sm" onclick="this.closest('.modal-overlay').remove()">Annuler</button>
      <button class="btn btn-green btn-sm rfa-ok"><i class=ic-save></i> Enregistrer</button>
    </div>`)
  o.querySelector('.rfa-ok').onclick = async () => {
    try {
      _RFA_FICHES[id] = await apiSend('PUT', `/rfa/fiches/${id}`, {
        type_fiche: o.querySelector('.rfa-type').value, nom: o.querySelector('.rfa-nom').value,
        periode_debut: o.querySelector('.rfa-debut').value, periode_fin: o.querySelector('.rfa-fin').value,
      })
      o.remove(); renderRFA(); toast('Fiche enregistrée', 'green')
    } catch (e) { toast(e.message, 'red') }
  }
}

function ouvrirConditionsRFA(id) {
  const f = _RFA_FICHES[id], c = f.conditions || {}
  const o = ouvrirModale(`
    <div style="font-size:16px;font-weight:700;margin-bottom:14px">Conditions — ${h(f.nom)}</div>
    ${champ('% de remise', `<input type="number" class="rfa-taux" step="0.01" min="0" max="100" value="${c.taux_pct ?? ''}" style="${INPUT_STYLE}"/>`)}
    ${champ('Calculé sur', choixBase('rfa-base-edit', c.base || 'net'))}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
      <button class="btn btn-outline btn-sm" onclick="this.closest('.modal-overlay').remove()">Annuler</button>
      <button class="btn btn-green btn-sm rfa-ok">Continuer</button>
    </div>`)
  o.querySelector('.rfa-ok').onclick = async () => {
    const taux = parseFloat(o.querySelector('.rfa-taux').value)
    if (isNaN(taux)) { toast('Indiquez le % de remise', 'red'); return }
    const base = o.querySelector('input[name=rfa-base-edit]:checked').value
    o.remove()
    const quand = await demanderDateEffet({ titre: `Nouvelles conditions — ${f.nom}` })
    if (!quand) return
    try {
      const r = await apiSend('PUT', `/rfa/fiches/${id}/conditions`, { taux_pct: taux, base, ...quand })
      _RFA_FICHES[id] = r
      renderRFA()
      toast(`Conditions appliquées à partir de ${moisLisible(r.applique_a_partir_de)}`, 'green')
    } catch (e) { toast(e.message, 'red') }
  }
}

async function supprimerFicheRFA(id) {
  const f = _RFA_FICHES[id]
  if (!confirm(`Supprimer la fiche « ${f.nom} » ?\n\nSes ${f.nb_factures} facture(s) déposée(s) et les montants reçus saisis seront supprimés.`)) return
  try {
    await apiSend('DELETE', `/rfa/fiches/${id}`)
    delete _RFA_FICHES[id]
    renderRFA(); toast('Fiche supprimée', 'green')
  } catch (e) { toast(e.message, 'red') }
}

/* ============================================================================
   REMISE GROUPEMENT
   ============================================================================ */
let _GRP_FICHES = {}
let _GRP_OUVERT = {}
let _GRP_OPTIONS = null
let _GRP_ANNEE = null

const GRP_AVERTISSEMENT = `
  <div class="alert alert-amber" style="font-size:13px">
    <i class=ic-alert></i>
    <div><strong>Attention :</strong> le travail sur les conditions groupement ne concerne que les conditions
    <strong>génériques et biosimilaires</strong>. Les RFA labos sont suivies dans le module
    <a href="#" onclick="goTo('rfa', document.getElementById('nav-rfa'));return false" style="color:inherit;text-decoration:underline">RFA</a>.</div>
  </div>`

async function loadGroupement() {
  const el = document.getElementById('groupement-content')
  if (!MODULES.includes('generiqueur')) { el.innerHTML = lockedHTML('generiqueur'); return }
  if (_GRP_ANNEE === null) _GRP_ANNEE = CURRENT_ANNEE
  el.innerHTML = '<div class="loading-center"><div class="spinner"></div> Chargement...</div>'
  try {
    const [opts, liste] = await Promise.all([
      apiSend('GET', '/groupement/options'),
      apiSend('GET', `/groupement/fiches?annee=${_GRP_ANNEE}`),
    ])
    _GRP_OPTIONS = opts
    const details = await Promise.all(liste.map(f => apiSend('GET', `/groupement/fiches/${f.id}?annee=${_GRP_ANNEE}`)))
    _GRP_FICHES = {}
    details.forEach(d => { _GRP_FICHES[d.id] = d })
    renderGroupement()
  } catch (e) {
    el.innerHTML = `<div class="loading-center" style="color:var(--red)">${h(e.message)}</div>`
  }
}

function renderGroupement() {
  const el = document.getElementById('groupement-content')
  const fiches = Object.values(_GRP_FICHES).sort((a, b) => a.nom.localeCompare(b.nom))
  const annees = []
  for (let a = new Date().getFullYear() + 1; a >= new Date().getFullYear() - 3; a--) annees.push(a)
  const entete = GRP_AVERTISSEMENT + `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <div class="card-title" style="margin:0">Remise groupement</div>
        <div style="font-size:12px;color:var(--sub);margin-top:4px">Remises supplémentaires accordées par votre groupement sur vos achats de génériques et de biosimilaires.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <select onchange="_GRP_ANNEE=parseInt(this.value);loadGroupement()" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px">
          ${annees.map(a => `<option value="${a}" ${a === _GRP_ANNEE ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
        <button class="btn btn-green" onclick="ouvrirFicheGroupement(null)"><i class=ic-plus></i> Créer une fiche groupement</button>
      </div>
    </div>`
  if (!fiches.length) {
    el.innerHTML = entete + `
      <div class="card" style="text-align:center;padding:40px;color:var(--sub)">
        <div style="font-size:36px"><i class=ic-shop></i></div>
        <div style="margin-top:10px;font-size:14px">Aucune fiche groupement</div>
        <div style="font-size:12px;margin-top:4px">Créez la fiche de votre groupement : ses % supplémentaires se calculent sur vos achats génériques et biosimilaires.</div>
      </div>`
    return
  }
  el.innerHTML = entete + fiches.map(f => `<div id="grp-fiche-${f.id}">${ficheGroupementHTML(f)}</div>`).join('')
  Object.keys(_GRP_OUVERT).filter(id => _GRP_OUVERT[id] && _GRP_FICHES[id] && _GRP_FICHES[id].zone_depot)
    .forEach(id => renderListeDepots(`grp-depots-${id}`, { source: 'groupement', fiche_id: id }))
}

async function chargerFicheGroupement(id) {
  try {
    _GRP_FICHES[id] = await apiSend('GET', `/groupement/fiches/${id}?annee=${_GRP_ANNEE}`)
    renderGroupement()
  } catch (e) { toast(e.message, 'red') }
}

/** « Générique 1 — Biogaran », « Biosimilaire 1 — SANDOZ »… */
function libellesRegles(regles) {
  const n = { generique: 0, biosimilaire: 0 }
  return regles.map(r => `${r.type === 'generique' ? 'Générique' : 'Biosimilaire'} ${++n[r.type]} — ${r.labo}`)
}

function ficheGroupementHTML(f) {
  const ouvert = !!_GRP_OUVERT[f.id]
  const libs = libellesRegles(f.regles)
  const sourceBadge = (on, txt) => `<span style="padding:2px 8px;border-radius:999px;font-size:11px;background:${on ? 'var(--green-l)' : '#F3F4F6'};color:${on ? 'var(--green-d)' : 'var(--sub)'}">${on ? '✓' : '✗'} ${txt}</span>`
  const reglesRows = f.regles.map((r, i) => `
    <tr style="border-top:1px solid var(--border)">
      <td style="padding:6px;font-weight:600">${h(libs[i])}</td>
      <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(r.total_brut)}</td>
      <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(r.total_net)}</td>
      <td style="padding:6px;text-align:right">${r.taux_pct != null ? `${pctFr(r.taux_pct)} <span style="color:var(--sub)">${BASE_COURT[r.base]}</span>` : '—'}</td>
      <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace;color:var(--green);font-weight:600">${eur(r.remise)}</td>
    </tr>`).join('')
  const moisRows = f.mois.map(m => `
    <tr style="border-top:1px solid var(--border);${m.actif ? '' : 'color:var(--sub)'}">
      <td style="padding:6px">${MOIS_NOMS[m.mois - 1]}</td>
      ${m.regles.map(r => `<td style="padding:6px;text-align:right;font-family:'DM Mono',monospace" title="${h(r.labo)} : brut ${eur(r.total_brut)} / net ${eur(r.total_net)}${r.taux_pct != null ? ` · ${pctFr(r.taux_pct)} ${BASE_COURT[r.base]}` : ' · hors accord ce mois'}">${r.taux_pct != null ? eur(r.remise) : '—'}</td>`).join('')}
      <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace;color:var(--green);font-weight:600">${m.actif ? eur(m.remise_attendue) : 'avant début'}</td>
      <td style="padding:6px;text-align:right">${inputRecu('groupement', f.id, m.annee, m.mois, m.recu)}</td>
      <td style="padding:6px;text-align:right">${ecartHTML(m.ecart)}</td>
    </tr>`).join('')
  return `
    <div class="card" style="border-left:3px solid #0891B2">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div>
          <div style="font-size:16px;font-weight:700">${h(f.nom)}</div>
          <div style="font-size:12px;color:var(--sub);margin:4px 0 6px">Depuis le ${dateFr(f.date_debut)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${sourceBadge(f.prise_en_compte_grossiste, 'Chiffres grossiste')}${sourceBadge(f.zone_depot, 'Zone de dépôt groupement')}</div>
          ${historiqueVersionsHTML(f.versions, v => [...(v.generique || []), ...(v.biosimilaire || [])].map(r => `${r.labo} ${pctFr(r.taux_pct)} ${BASE_COURT[r.base]}`).join(', '))}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" onclick="ouvrirReglesGroupement('${f.id}')"><i class=ic-pencil></i> Modifier les règles</button>
          <button class="btn btn-outline btn-sm" onclick="ouvrirFicheGroupement('${f.id}')"><i class=ic-settings></i> Fiche</button>
          <button class="btn btn-outline btn-sm" onclick="supprimerFicheGroupement('${f.id}')" title="Supprimer la fiche"><i class=ic-trash></i></button>
        </div>
      </div>
      ${f.aucune_source ? `<div class="alert" style="margin-top:12px;background:#FEF2F2;color:#B91C1C;border-left:3px solid #DC2626;font-size:13px"><i class=ic-alert></i>
        <div><strong>Aucun chiffre à exploiter.</strong> Ni les chiffres grossiste ni une zone de dépôt ne sont pris en compte pour ce groupement : modifiez la fiche pour en activer au moins un.</div></div>` : ''}
      <div style="font-size:12px;font-weight:600;color:var(--sub);text-transform:uppercase;letter-spacing:.4px;margin:14px 0 6px">Règles de calcul — ${_GRP_ANNEE}</div>
      <div style="overflow-x:auto">
      <table style="width:100%;font-size:13px;border-collapse:collapse;min-width:560px">
        <thead><tr style="background:#F8FAFC;color:var(--sub);font-size:10px;text-transform:uppercase">
          <th style="padding:6px;text-align:left">Règle</th><th style="padding:6px;text-align:right">Total brut HT</th>
          <th style="padding:6px;text-align:right">Total net remisé HT</th><th style="padding:6px;text-align:right">% remise groupement</th>
          <th style="padding:6px;text-align:right">€ remise groupement</th></tr></thead>
        <tbody>${reglesRows}</tbody>
      </table>
      </div>
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin:14px 0 0">
        ${kpi(`Remise groupement attendue ${_GRP_ANNEE}`, eur(f.totaux.remise_attendue), 'green')}
        ${kpi('Reçu', eur(f.totaux.recu))}
        ${kpi('Reste à recevoir', eur(f.totaux.reste_a_recevoir), f.totaux.reste_a_recevoir > 0.005 ? 'blue' : '')}
      </div>
      <button class="btn btn-outline btn-sm" style="margin-top:12px" onclick="_GRP_OUVERT['${f.id}']=!_GRP_OUVERT['${f.id}'];renderGroupement()">
        ${ouvert ? '▲ Masquer' : `▼ Détail mensuel et € reçus${f.zone_depot ? ', factures' : ''}`}
      </button>
      <div style="display:${ouvert ? 'block' : 'none'};margin-top:12px">
        <div style="overflow-x:auto">
        <table style="width:100%;font-size:12px;border-collapse:collapse;min-width:${420 + 110 * f.regles.length}px">
          <thead><tr style="background:#F8FAFC;color:var(--sub);font-size:10px;text-transform:uppercase">
            <th style="padding:6px;text-align:left">Mois</th>
            ${libs.map(l => `<th style="padding:6px;text-align:right">${h(l)}</th>`).join('')}
            <th style="padding:6px;text-align:right">Remise attendue</th><th style="padding:6px;text-align:right">€ reçu</th>
            <th style="padding:6px;text-align:right">Écart</th></tr></thead>
          <tbody>${moisRows}</tbody>
          <tfoot><tr style="border-top:2px solid var(--border);font-weight:700">
            <td style="padding:6px">Total</td>
            ${f.regles.map(r => `<td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(r.remise)}</td>`).join('')}
            <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace;color:var(--green)">${eur(f.totaux.remise_attendue)}</td>
            <td style="padding:6px;text-align:right;font-family:'DM Mono',monospace">${eur(f.totaux.recu)}</td>
            <td style="padding:6px;text-align:right">${ecartHTML(f.totaux.recu - f.totaux.remise_attendue)}</td></tr></tfoot>
        </table>
        </div>
        ${f.zone_depot ? `
          <div style="font-size:12px;font-weight:600;color:var(--sub);text-transform:uppercase;letter-spacing:.4px;margin:16px 0 6px">Factures du groupement</div>
          <div style="font-size:11px;color:var(--sub);margin-bottom:8px">Ces achats comptent aussi dans l'onglet Génériqueur (ligne « Groupement »).</div>
          ${zoneDepotHTML('groupement', f.id)}
          <div id="grp-depots-${f.id}" style="margin-top:8px"></div>` : ''}
      </div>
    </div>`
}

/* --- Éditeur de règles (création de fiche et modification datée) -------- */
function ligneRegleHTML(type, r) {
  const labos = type === 'generique' ? _GRP_OPTIONS.generiqueurs : _GRP_OPTIONS.labos_biosimilaires
  return `
    <div class="grp-regle" data-type="${type}" style="display:grid;grid-template-columns:1.6fr .8fr 1fr auto;gap:6px;margin-bottom:6px;align-items:center">
      <select class="grp-labo" style="${INPUT_STYLE}">${labos.map(l => `<option value="${h(l)}" ${l === r.labo ? 'selected' : ''}>${h(l)}${type === 'generique' && l === _GRP_OPTIONS.generiqueur_numero_1 ? ' (n°1)' : ''}</option>`).join('')}</select>
      <input type="number" class="grp-taux" step="0.01" min="0" max="100" value="${r.taux_pct ?? ''}" placeholder="%" style="${INPUT_STYLE}"/>
      <select class="grp-base" style="${INPUT_STYLE}">
        <option value="brut" ${r.base === 'brut' ? 'selected' : ''}>sur brut HT</option>
        <option value="net" ${r.base !== 'brut' ? 'selected' : ''}>sur net remisé HT</option>
      </select>
      <button class="btn btn-outline btn-sm" title="Retirer" onclick="this.closest('.grp-regle').remove()"><i class=ic-x></i></button>
    </div>`
}

/** Nouvelle ligne : on reprend % et base de la première, le labo suivant non utilisé. */
function ajouterRegle(bouton, type) {
  const bloc = bouton.closest('.grp-bloc')
  const lignes = bloc.querySelectorAll('.grp-regle')
  const premiere = lignes[0]
  const pris = [...lignes].map(l => l.querySelector('.grp-labo').value)
  const labos = type === 'generique' ? _GRP_OPTIONS.generiqueurs : _GRP_OPTIONS.labos_biosimilaires
  const r = {
    labo: labos.find(l => !pris.includes(l)) || labos[0],
    taux_pct: premiere ? premiere.querySelector('.grp-taux').value : '',
    base: premiere ? premiere.querySelector('.grp-base').value : 'net',
  }
  bloc.querySelector('.grp-lignes').insertAdjacentHTML('beforeend', ligneRegleHTML(type, r))
}

function editeurReglesHTML(conditions) {
  const gen = (conditions && conditions.generique && conditions.generique.length) ? conditions.generique
    : [{ labo: _GRP_OPTIONS.generiqueur_numero_1 || _GRP_OPTIONS.generiqueurs[0], taux_pct: '', base: 'net' }]
  const bio = (conditions && conditions.biosimilaire) || []
  return `
    <div class="grp-bloc" style="padding:12px;background:#F8FAFC;border-radius:10px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;margin-bottom:2px">Conditions génériques</div>
      <div style="font-size:11px;color:var(--sub);margin-bottom:8px">% de remise supplémentaire, le prix sur lequel il s'applique, et le(s) génériqueur(s) concerné(s). Le n°1 de vos Paramètres est proposé par défaut.</div>
      <div class="grp-lignes">${gen.map(r => ligneRegleHTML('generique', r)).join('')}</div>
      <button class="btn btn-outline btn-sm" onclick="ajouterRegle(this, 'generique')"><i class=ic-plus></i> Ajouter un génériqueur</button>
    </div>
    <div class="grp-bloc" style="padding:12px;background:#F8FAFC;border-radius:10px;margin-bottom:12px">
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;font-weight:700;cursor:pointer">
        <input type="checkbox" class="grp-bio-on" ${bio.length ? 'checked' : ''} onchange="this.closest('.grp-bloc').querySelector('.grp-bio-zone').style.display=this.checked?'':'none'" style="width:16px;height:16px;accent-color:var(--green)"/>
        Avez-vous des accords biosimilaires ?
      </label>
      <div class="grp-bio-zone" style="${bio.length ? '' : 'display:none'};margin-top:8px">
        <div style="font-size:11px;color:var(--sub);margin-bottom:8px">Même principe, par labo de biosimilaires (le référentiel classe déjà chaque biosimilaire par labo).</div>
        <div class="grp-lignes">${(bio.length ? bio : [{ labo: _GRP_OPTIONS.labos_biosimilaires[0], taux_pct: '', base: 'net' }]).map(r => ligneRegleHTML('biosimilaire', r)).join('')}</div>
        <button class="btn btn-outline btn-sm" onclick="ajouterRegle(this, 'biosimilaire')"><i class=ic-plus></i> Ajouter un labo</button>
      </div>
    </div>`
}

function lireRegles(o) {
  const out = { generique: [], biosimilaire: [] }
  const bioOn = o.querySelector('.grp-bio-on').checked
  o.querySelectorAll('.grp-regle').forEach(l => {
    const type = l.dataset.type
    if (type === 'biosimilaire' && !bioOn) return
    const taux = parseFloat(String(l.querySelector('.grp-taux').value).replace(',', '.'))
    out[type].push({ labo: l.querySelector('.grp-labo').value, taux_pct: isNaN(taux) ? null : taux, base: l.querySelector('.grp-base').value })
  })
  if ([...out.generique, ...out.biosimilaire].some(r => r.taux_pct === null)) throw new Error('Indiquez le % de chaque règle')
  return out
}

function sourcesHTML(f) {
  const oui = (name, on) => `
    <label style="display:inline-flex;gap:4px;align-items:center;margin-right:12px"><input type="radio" name="${name}" value="1" ${on ? 'checked' : ''} style="accent-color:var(--green)"/> Oui</label>
    <label style="display:inline-flex;gap:4px;align-items:center"><input type="radio" name="${name}" value="0" ${!on ? 'checked' : ''} style="accent-color:var(--green)"/> Non</label>`
  return `
    <div style="padding:12px;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;font-size:13px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <span>Prise en compte des chiffres grossiste</span><span>${oui('grp-gross', f.prise_en_compte_grossiste)}</span>
      </div>
      <div style="font-size:11px;color:var(--sub);margin:-4px 0 10px">Certains groupements ne comptent pas les génériques achetés chez le grossiste, même en dépannage pendant une rupture.</div>
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <span>Création d'une zone de dépôt de factures spécifique au groupement</span><span>${oui('grp-depot', f.zone_depot)}</span>
      </div>
      <div class="grp-double-non alert" style="display:none;margin-top:10px;background:#FEF2F2;color:#B91C1C;border-left:3px solid #DC2626;font-size:12px">
        <i class=ic-alert></i> Double « non » : il n'y aura aucun chiffre à exploiter pour ce groupement.
      </div>
    </div>`
}
function brancherSources(o) {
  const maj = () => {
    const g = o.querySelector('input[name=grp-gross]:checked').value === '1'
    const d = o.querySelector('input[name=grp-depot]:checked').value === '1'
    o.querySelector('.grp-double-non').style.display = (!g && !d) ? 'flex' : 'none'
  }
  o.querySelectorAll('input[name=grp-gross], input[name=grp-depot]').forEach(i => { i.onchange = maj })
  maj()
}

/** Création (id = null) ou modification de la fiche elle-même. */
function ouvrirFicheGroupement(id) {
  const f = id ? _GRP_FICHES[id] : { nom: '', date_debut: `${new Date().getFullYear()}-01-01`, prise_en_compte_grossiste: true, zone_depot: false }
  const o = ouvrirModale(`
    <div style="font-size:16px;font-weight:700;margin-bottom:14px">${id ? `Fiche ${h(f.nom)}` : 'Créer ma fiche groupement'}</div>
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px">
      ${champ('Nom du groupement', `<input class="grp-nom" value="${h(f.nom)}" placeholder="Ex. : Giphar" style="${INPUT_STYLE}"/>`)}
      ${champ('Date de début', `<input type="date" class="grp-debut" value="${f.date_debut}" style="${INPUT_STYLE}"/>`)}
    </div>
    ${id ? '<div style="font-size:11px;color:var(--sub);margin:-4px 0 12px">Pour changer les %, utilisez « Modifier les règles » : on vous demandera à partir de quand.</div>' : editeurReglesHTML(null)}
    ${sourcesHTML(f)}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-outline btn-sm" onclick="this.closest('.modal-overlay').remove()">Annuler</button>
      <button class="btn btn-green btn-sm grp-ok"><i class=ic-save></i> ${id ? 'Enregistrer' : 'Créer la fiche'}</button>
    </div>`, 640)
  brancherSources(o)
  o.querySelector('.grp-ok').onclick = async () => {
    try {
      const body = {
        nom: o.querySelector('.grp-nom').value,
        date_debut: o.querySelector('.grp-debut').value,
        prise_en_compte_grossiste: o.querySelector('input[name=grp-gross]:checked').value === '1',
        zone_depot: o.querySelector('input[name=grp-depot]:checked').value === '1',
      }
      if (!id) Object.assign(body, lireRegles(o))
      const r = id
        ? await apiSend('PUT', `/groupement/fiches/${id}`, body)
        : await apiSend('POST', '/groupement/fiches', body)
      o.remove()
      _GRP_OUVERT[r.id] = _GRP_OUVERT[r.id] || !id
      toast(id ? 'Fiche enregistrée' : 'Fiche groupement créée', 'green')
      chargerFicheGroupement(r.id)
    } catch (e) { toast(e.message, 'red') }
  }
}

function ouvrirReglesGroupement(id) {
  const f = _GRP_FICHES[id]
  const o = ouvrirModale(`
    <div style="font-size:16px;font-weight:700;margin-bottom:14px">Règles — ${h(f.nom)}</div>
    ${editeurReglesHTML(f.conditions)}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-outline btn-sm" onclick="this.closest('.modal-overlay').remove()">Annuler</button>
      <button class="btn btn-green btn-sm grp-ok">Continuer</button>
    </div>`, 640)
  o.querySelector('.grp-ok').onclick = async () => {
    let regles
    try { regles = lireRegles(o) } catch (e) { toast(e.message, 'red'); return }
    o.remove()
    const quand = await demanderDateEffet({ titre: `Nouvelles règles — ${f.nom}` })
    if (!quand) return
    try {
      const r = await apiSend('PUT', `/groupement/fiches/${id}/conditions`, { ...regles, ...quand })
      toast(`Règles appliquées à partir de ${moisLisible(r.applique_a_partir_de)}`, 'green')
      chargerFicheGroupement(id)
    } catch (e) { toast(e.message, 'red') }
  }
}

async function supprimerFicheGroupement(id) {
  const f = _GRP_FICHES[id]
  if (!confirm(`Supprimer la fiche « ${f.nom} » ?\n\nLes factures déposées dans sa zone et les montants reçus saisis seront supprimés.`)) return
  try {
    await apiSend('DELETE', `/groupement/fiches/${id}`)
    delete _GRP_FICHES[id]
    renderGroupement(); toast('Fiche supprimée', 'green')
  } catch (e) { toast(e.message, 'red') }
}
