const firebaseConfig = {
  apiKey: "AIzaSyD_N3nY6CCHriTKE5iAxngg4Ew3GUdlFjw",
  authDomain: "bioscom-ca01a.firebaseapp.com",
  databaseURL: "https://bioscom-ca01a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bioscom-ca01a",
  storageBucket: "bioscom-ca01a.firebasestorage.app",
  messagingSenderId: "444090528057",
  appId: "1:444090528057:web:47479e518bf9722a6738e8"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
db.INTERNAL.forceLongPolling();
const auth = firebase.auth();

var currentGroupId = null;
var currentUserProfile = null;
var currentGroupName = '';
function getDbRef() {
  if (!currentGroupId) return db.ref('inventory_sandbox');
  return db.ref('inventories/' + currentGroupId);
}

function logHistory(action, targetGroupId = null) {
  if (db && currentGroupId) {
    let userName = 'Unknown User';
    if (currentUserProfile && currentUserProfile.name) {
      userName = currentUserProfile.name;
    } else if (auth && auth.currentUser) {
      userName = auth.currentUser.displayName || auth.currentUser.email || 'Unknown User';
    }
    db.ref('history/' + currentGroupId).push({
      timestamp: Date.now(),
      user: userName,
      action: action
    });
    
    // Log to shared container owner group if a targetGroupId is explicitly provided and is different
    if (targetGroupId && targetGroupId !== currentGroupId) {
      db.ref('history/' + targetGroupId).push({
        timestamp: Date.now(),
        user: `${userName} (from Lab ${currentGroupName || 'Neighbor'})`,
        action: action
      });
    }
  }
}

let lastUserActivity = Date.now();
function recordUserActivity() {
  lastUserActivity = Date.now();
}
window.addEventListener('mousemove', recordUserActivity, { passive: true });
window.addEventListener('keydown', recordUserActivity, { passive: true });
window.addEventListener('click', recordUserActivity, { passive: true });
window.addEventListener('scroll', recordUserActivity, { passive: true });
window.addEventListener('touchstart', recordUserActivity, { passive: true });

function triggerBackupIfNeeded(data) {
  if (!db || !currentGroupId) return;
  const now = Date.now();
  
  // User activity check: only backup if user was active recently (last 30 minutes)
  if (now - lastUserActivity > 30 * 60 * 1000) return;
  
  const lockRef = db.ref('lastBackupTime/' + currentGroupId);
  lockRef.once('value', snap => {
    const dbLastBackupTime = snap.val() || 0;
    if (now - dbLastBackupTime >= 30 * 60 * 1000) {
      // Lock immediately to prevent multiple active user sessions from trigger duplicate concurrent backups
      lockRef.set(now).then(() => {
        const backupRef = db.ref('backups/' + currentGroupId).push();
        backupRef.set({
          timestamp: now,
          data: data
        }).then(() => {
          // Prune old backups (> 24 hours)
          const cutoff = now - 24 * 60 * 60 * 1000;
          db.ref('backups/' + currentGroupId).orderByChild('timestamp').endAt(cutoff).once('value', pruneSnap => {
            pruneSnap.forEach(child => {
              child.ref.remove();
            });
          });
        }).catch(e => { /* console.error("Backup failed", e); */ });
      });
    }
  });
}

// Background checker interval running every 5 minutes
window.backupIntervalId = setInterval(() => {
  if (!db || !currentGroupId) return;
  const now = Date.now();
  // Check if user was active within last 5 minutes
  if (now - lastUserActivity > 5 * 60 * 1000) return;
  
  db.ref('inventories/' + currentGroupId).once('value', snap => {
    const d = snap.val();
    if (d) {
      triggerBackupIfNeeded(d);
    }
  });
}, 5 * 60 * 1000);

// Normalize formula: convert any Unicode subscript digits back to normal digits
function normalizeFormula(formula) {
  if (!formula) return '';
  return formula.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => '₀₁₂₃₄₅₆₇₈₉'.indexOf(ch).toString());
}
// Legacy: kept for backward compat but now just normalizes (no more Unicode subscripts on save)
function formatFormula(formula) {
  return normalizeFormula(formula);
}
// Render formula as safe HTML with <sub> tags for display
function renderFormulaHtml(formula) {
  if (!formula) return '—';
  const norm = normalizeFormula(formula);
  // Escape HTML first, then wrap digit runs that follow a letter, ), or ] in <sub>
  const safe = escHtml(norm);
  return safe.replace(/([A-Za-z)\]])((\d)+)/g, (m, pre, digits) => pre + '<sub>' + digits + '</sub>');
}

const safeStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return this._mem[key] || null;
    }
  },
  setItem(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (e) {
      this._mem[key] = val;
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      delete this._mem[key];
    }
  },
  _mem: {}
};

const STORAGE_KEY='bioscom_data';
const CABINET_SHELVES=['Shelf A–D','Shelf E–L','Shelf M–P','Shelf Q–Z','Bottom shelf'];
function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function escHtml(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML}
function getFirstLetter(name) {
  if (!name) return '?';
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const match = normalized.match(/[A-Za-z]/);
  return match ? match[0].toUpperCase() : '?';
}
function cleanChemNameForSort(name) {
  if (!name) return '';
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/^[^A-Za-z]+/, '').toUpperCase();
}
function compareChemicalNames(a, b) {
  const nameA = a?.name || '';
  const nameB = b?.name || '';
  const cleanA = cleanChemNameForSort(nameA);
  const cleanB = cleanChemNameForSort(nameB);
  if (cleanA === cleanB) {
    return nameA.localeCompare(nameB);
  }
  return cleanA.localeCompare(cleanB);
}
function shelfForName(name){
  const c=getFirstLetter(name);
  if(c>='A'&&c<='D')return'Shelf A–D';
  if(c>='E'&&c<='L')return'Shelf E–L';
  if(c>='M'&&c<='P')return'Shelf M–P';
  if(c>='Q'&&c<='Z')return'Shelf Q–Z';
  return'Bottom shelf';
}
function loadData(){
  try{const r=safeStorage.getItem(STORAGE_KEY);if(r){let d=JSON.parse(r);return migrateData(d);}}catch(e){}
  return{rooms:[]};
}
function saveSharedContainerData(c) {
  if (!c || !c.ownerGroupId || c.ownerGroupId === currentGroupId) {
    console.warn('[saveShared] SKIPPED:', { hasC: !!c, owner: c && c.ownerGroupId, current: currentGroupId });
    return Promise.resolve();
  }
  console.warn('[saveShared] START saving container', c.id, 'to owner group', c.ownerGroupId);
  const targetRef = db.ref(`inventories/${c.ownerGroupId}`);
  return targetRef.once('value').then(snapshot => {
    const ownerData = snapshot.val();
    if (ownerData && ownerData.rooms) {
      let roomIdx = -1;
      let containerIdx = -1;
      ownerData.rooms.forEach((room, ri) => {
        if (room.containers) {
          const ci = room.containers.findIndex(cont => cont.id === c.id);
          if (ci !== -1) {
            roomIdx = ri;
            containerIdx = ci;
          }
        }
      });
      if (roomIdx !== -1 && containerIdx !== -1) {
        const targetRef = db.ref(`inventories/${c.ownerGroupId}`);
        const cleanC = { ...c };
        delete cleanC.isSharedAsset;
        delete cleanC.originalRoomName;
        delete cleanC.originalGroupId;
        delete cleanC.ownerGroupName;
        const pathKey = `rooms/${roomIdx}/containers/${containerIdx}`;
        console.warn('[saveShared] UPDATING container at', pathKey);
        const pending = targetRef.update({ [pathKey]: cleanC });
        setTimeout(() => console.warn('[saveShared] UPDATE still pending after 3s'), 3000);
        return pending.then(() => console.warn('[saveShared] UPDATE OK for group', c.ownerGroupId)).catch(e => { console.error('[saveShared] UPDATE FAILED:', e); throw e; });
      }
      console.warn('[saveShared] Container id not found in owner data:', c.id);
    } else {
      console.warn('[saveShared] Owner data has no rooms:', c.ownerGroupId);
    }
  }).catch(e => {
    console.error('[saveShared] Error:', e);
    throw e;
  });
}

function saveData(d){
  try {
    safeStorage.setItem(STORAGE_KEY,JSON.stringify(d));
  } catch(e) {
    console.error(e);
  }
  if(db && currentGroupId) {
    const cont = (typeof currentContainerId !== 'undefined' && currentContainerId) ? getContainer(currentRoomId, currentContainerId) : null;
    if (cont && cont.ownerGroupId && cont.ownerGroupId !== currentGroupId) {
      console.warn('[saveData] SHARED path for container', cont.id, 'owner', cont.ownerGroupId, 'current', currentGroupId);
      saveSharedContainerData(cont).catch(e => console.error('Error saving shared container:', e));
    } else {
      console.warn('[saveData] OWN path for group', currentGroupId, 'db=', !!db);
      getDbRef().set(d).then(() => {
        console.warn('[saveData] OWN write succeeded for group', currentGroupId);
        triggerBackupIfNeeded(d);
      }).catch(e=>console.error('[saveData] OWN write error:', e));
    }
  } else {
    console.warn('[saveData] SKIPPED: no db or currentGroupId', { db: !!db, currentGroupId });
  }
}
function migrateData(data){
  const nameMap={'Police A–D':'Shelf A–D','Police E–L':'Shelf E–L','Police M–P':'Shelf M–P','Police Q–Z':'Shelf Q–Z','Spodní police':'Bottom shelf'};
  (data.rooms||[]).forEach(room=>{
    if(room.cabinets&&!room.containers){
      room.containers=room.cabinets.map(cab=>{
        const shelves=CABINET_SHELVES.map(n=>({id:genId(),name:n,chemicals:[]}));
        (cab.chemicals||[]).forEach(ch=>{
          const sn=shelfForName(ch.name);
          const shelf=shelves.find(s=>s.name===sn)||shelves[4];
          shelf.chemicals.push(ch);
        });
        shelves.forEach(s=>s.chemicals.sort(compareChemicalNames));
        return{id:cab.id,name:cab.name,description:cab.description,type:'cabinet',shelves};
      });
      delete room.cabinets;
    }
    // Translate existing Czech shelf names and re-distribute cabinet chemicals dynamically
    (room.containers||[]).forEach(cont=>{
      (cont.shelves||[]).forEach(sh=>{
        if(nameMap[sh.name])sh.name=nameMap[sh.name];
      });

      if (cont.type === 'cabinet') {
        (cont.shelves || []).forEach(sh => {
          if (sh.chemicals) {
            sh.chemicals.sort(compareChemicalNames);
          }
        });
      }

      // Assign static, permanent position property to all existing chemicals that don't have it
      const all = [];
      (cont.shelves || []).forEach(sh => {
        (sh.chemicals || []).forEach(ch => {
          all.push(ch);
        });
      });
      all.sort(compareChemicalNames);
      const letterCount = {};
      all.forEach(ch => {
        if (!ch.position) {
          if (ch.customPosition) {
            ch.position = ch.customPosition;
          } else {
            const L = getFirstLetter(ch.name);
            letterCount[L] = (letterCount[L] || 0) + 1;
            ch.position = L + letterCount[L];
          }
        } else {
          const pos = ch.position;
          if (pos.length >= 2) {
            const L = pos[0];
            const num = parseInt(pos.slice(1), 10);
            if (!isNaN(num)) {
              letterCount[L] = Math.max(letterCount[L] || 0, num);
            }
          }
        }
      });
    });
  });
  if(!data.protocols) {
    data.protocols = [
      {id:genId(), title: "50x TAE (1 L)", content: "TRIS 242 g (2 M)\n0.5 M EDTA pH 8 100 ml (50 mM)\nglacial CH3COOH 57,1 ml (1 M)\nDissolve TRIS, add acid and EDTA, bring the volume to 1 L, do not adjust pH, filter"},
      {id:genId(), title: "5x TBE (2 L)", content: "TRIS 108 g\nboric acid 55 g\n0,5 m EDTA pH 8 40 ml\ndo not adjust pH, filter"},
      {id:genId(), title: "1 M Na2HPO4 (1 L)", content: "Mr = 141,96 g/mol\nweigh, dissolve, add MiliQ water to a final volume of 1 L, filter using filtration paper, autoclave"},
      {id:genId(), title: "1 M NaH2PO4 (1 L)", content: "Mr = 156 g/mol NaH2PO4∙2H2O\nweigh, dissolve (warm it up), add MiliQ water to a final volume of 1 L, filter through filtration paper, autoclave"},
      {id:genId(), title: "0,5 M EDTA pH 8 (1 L)", content: "- weigh 186,1 g of EDTA, slighly heat it up\n- add approximately 20 g of NaOH (pH 8)\n- add distilled water to a final volume of 1 L, paper filtration, autoclave"},
      {id:genId(), title: "1 M Tris-HCl (1 L)", content: "Mr = 121,14 g/mol\nweigh, dissolve adjust pH to 8.0"},
      {id:genId(), title: "1 M NaOH (0,5 L)", content: "Dissolve 20 g of NaOH in deionized water. (Filter)"},
      {id:genId(), title: "1 M DTT", content: "Weigh 1.545 g of DTT, dissolve the powder in approximately 8 mL 0.01 M sodium acetate, pH 5.2, make up the volume to 10 mL, filter, make 1 ml aliquots\n\nAdd 133 ul of 3 M sodium acetate to 40 ml, adjust volume to 5,2"},
      {id:genId(), title: "PMSF 100mM", content: "add 0,348 g of PMSF to 20 ml of isopropanol"},
      {id:genId(), title: "TB medium (1 l)", content: "Mix 12 g of tryptone, 24 g of yeast extract, 4 ml of glycerol and add 900 ml of MiliQ water"},
      {id:genId(), title: "TB salts", content: "weigh 23,1 g of KH2PO4 and 125,4 g of K2HPO4 and fill it up to 1 L with ddH2O →autoclave"},
      {id:genId(), title: "LB medium (1L)", content: "Add 10 g of tryptone, 5 g of yeast extract, and 10 g of NaCl\nDissolve in 900 ml of MiliQ\nAdjust pH to 7.0 with 1 M NaOH\nFill up to 1 L → autoclave"},
      {id:genId(), title: "LB agar", content: "For 1 L add 15 g of agar to prepared LB medium →autoclave"},
      {id:genId(), title: "1 M IPTG", content: "Mr = 238,31 g/mol"},
      {id:genId(), title: "Ampicilin (100mg/ml)", content: "Dissolve 3 g in MiliQ water, make 1 ml aliquots"},
      {id:genId(), title: "10x TANK (2 L)", content: "Tris 60,56 g\nGlycin 288,56 g\nSDS 20 g\nweigh, dissolve, add MiliQ water to 2 L, do not filter, do not adjust pH"},
      {id:genId(), title: "4x Running buffer", content: "1.5 M TRIS HCl, pH 8,8\nweigh (36 g for 200 ml), dissolve, adjust pH to 8.8, add MiliQ water to a final volume, 0,2 um filter"},
      {id:genId(), title: "4x Stacking buffer", content: "0.5 M TRIS HCl, pH 6,8\nweigh (12 g for 200 ml), dissolve, adjust pH to 6.8, add MiliQ water to a final volume, 0,2 um filter"},
      {id:genId(), title: "30% APS", content: "Dissolve 7,5 g of APS in 25 ml ddH2O; make 250 ul aliquots"},
      {id:genId(), title: "20% SDS", content: "add 40 g of SDS powder to MiliQ water while stirring, heat it to roughly 60°C on a hot plate if necessary."},
      {id:genId(), title: "4x SDS loading dye", content: "0.25 M Tris, 8% SDS, 40% glycerol, 0.4 M DTT, 0.04% bromophenol blue, pH 6.8"},
      {id:genId(), title: "Coomassie brilliant blue G-250", content: "50 mg G-250, 3 ml of acetic acid, add distilled water to a final volume of 1 L"},
      {id:genId(), title: "3% Skim milk for blocking", content: "Add 100 ml TBS-T to 3 g of skim milk powder"},
      {id:genId(), title: "10x TBS", content: "(200 mM Tris and 1500 mM NaCl for 1 L)\n24 g Tris base (formula weight: 121.1 g)\n88 g NaCl (formula weight: 58.4 g)\nDissolve in 900 mL of distilled water\npH to 10,5 with concentrated HCl\nAdd distilled water to a final volume of 1 L, filtration, autoclave"},
      {id:genId(), title: "TBS-T (1 L)", content: "100 ml 10x TBS\n1 ml Tween 20\n900 ml ddH2O"}
    ];
  }
  if(!data.assets) {
    data.assets = [];
  }
  if(!data.instruments) {
    data.instruments = [];
  }
  if(!data.printCatalog) {
    data.printCatalog = [];
  }
  if(!data.printRequests) {
    data.printRequests = [];
  }
  return data;
}
function getRoom(id){
  if (id === 'shared-assets') {
    return {
      id: 'shared-assets',
      name: 'Shared Assets',
      description: 'Shared from neighboring laboratories',
      containers: window.sharedContainersList || []
    };
  }
  return appData.rooms.find(r=>r.id===id);
}
function getContainer(rid,cid){
  const r=getRoom(rid);
  if (r && r.containers) {
    const c = r.containers.find(x=>x.id===cid);
    if (c) return c;
  }
  return (window.sharedContainersList || []).find(x=>x.id===cid);
}
var currentUserRole = null;
function getCurrentRole(){return currentUserRole;}

function isUserAdmin(){const r=getCurrentRole();return r==='admin'||r==='superadmin';}
function isUserReader(){return getCurrentRole()==='reader';}
function isContainerOwnerLab(cont){return !cont || !cont.ownerGroupId || cont.ownerGroupId === currentGroupId;}
function isContainerSharedWithCurrentLab(cont){return !!(cont && cont.sharedWithGroupIds && currentGroupId && cont.sharedWithGroupIds.includes(currentGroupId));}
function canManageContainerContents(cont){
  const r=getCurrentRole();
  if(r==='superadmin')return true;
  return r==='admin' && (isContainerOwnerLab(cont) || isContainerSharedWithCurrentLab(cont));
}
function canDeleteContainer(cont){
  const r=getCurrentRole();
  if(r==='superadmin')return true;
  return r==='admin' && isContainerOwnerLab(cont);
}
function canAdjustChemicalQuantity(cont){
  const r=getCurrentRole();
  if(r==='admin' || r==='superadmin')return true;
  return r==='reader' && isContainerSharedWithCurrentLab(cont);
}

function countChems(cont){return(cont.shelves||[]).reduce((s,sh)=>s+(sh.chemicals||[]).length,0)}
function countAllChems(room){return(room.containers||[]).reduce((s,c)=>s+countChems(c),0)}
function showToast(msg,type='success'){
  const icons={success:'✅',error:'❌',info:'ℹ️'};
  const t=document.createElement('div');t.className=`toast ${type}`;
  t.innerHTML=`<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(()=>{t.style.animation='toastOut 0.3s ease forwards';setTimeout(()=>t.remove(),300)},2500);
}
let modalCb=null;
function openModal(title,body,btnText,cb){
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-body').innerHTML=body;
  
  const confirmBtn = document.getElementById('modal-confirm');
  const modalFooter = document.querySelector('#modal-overlay .modal-footer');
  
  if (btnText) {
    confirmBtn.textContent = btnText;
    confirmBtn.style.display = 'inline-flex';
    if (modalFooter) modalFooter.style.display = 'flex';
  } else {
    confirmBtn.style.display = 'none';
    if (modalFooter) modalFooter.style.display = 'none';
  }
  
  modalCb=cb;
  document.getElementById('modal-overlay').classList.add('active');
  const fi=document.querySelector('#modal-body input,#modal-body select,#modal-body textarea');
  if(fi)setTimeout(()=>fi.focus(),100);
}
function closeModal(){
  document.getElementById('modal-overlay').classList.remove('active');
  document.getElementById('modal-body').innerHTML = ''; // clear innerHTML to remove any dynamic styles or handlers
  modalCb=null;
}
