let appData=loadData(),currentRoomId=null,currentContainerId=null,searchQuery='',openShelves=new Set();
let isRegistering = false;
let selectedDeepFreezerRack = null;
let selectedDeepFreezerBox = null;
let currentUserId = null;
let currentHistoryGroupId = null;
let sharedNotices = [];
let sharedInstruments = [];
let sharedPrintCatalog = [];
let sharedPrintRequests = [];
let activeSharedNoticesListener = null;
let activeSharedInstrumentsListener = null;
let activeSharedPrintCatalogListener = null;
let activeSharedPrintRequestsListener = null;
let activeCatalogCategory = 'all';
let activePrintTab = 'catalog';
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
function safeSetHtml(el, html) {
  el.innerHTML = '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  while (tmp.firstChild) el.appendChild(tmp.firstChild);
}

// Position: returns a map of chemical positions (custom or permanent static)
function computePositions(cont){
  const map={};
  (cont.shelves||[]).forEach(sh=>(sh.chemicals||[]).forEach(ch=>{
    map[ch.id] = ch.customPosition || ch.position || '—';
  }));
  return map;
}

// Generate the next available static position code for a given chemical name
function generateNextPositionCode(cont, name) {
  const L = getFirstLetter(name);
  let maxNum = 0;
  (cont.shelves || []).forEach(sh => {
    (sh.chemicals || []).forEach(ch => {
      const pos = ch.position || ch.customPosition || '';
      if (pos.startsWith(L)) {
        const numPart = parseInt(pos.slice(1), 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
    });
  });
  return L + (maxNum + 1);
}

function generateSequentialBoxPosition(shelf) {
  const occupied = new Set();
  (shelf.chemicals || []).forEach(ch => {
    const pos = (ch.position || ch.customPosition || '').trim().toUpperCase();
    const m = pos.match(/^([A-Z])(\d+)$/);
    if (m) occupied.add(pos);
  });
  
  for (let charCode = 65; charCode <= 90; charCode++) {
    const letter = String.fromCharCode(charCode);
    for (let num = 1; num <= 9; num++) {
      const candidate = letter + num;
      if (!occupied.has(candidate)) return candidate;
    }
  }
  return 'A1';
}

// Highlight match
function hl(text,q){
  if(!q)return escHtml(text);
  const i=text.toLowerCase().indexOf(q.toLowerCase());
  if(i<0)return escHtml(text);
  return escHtml(text.slice(0,i))+'<mark>'+escHtml(text.slice(i,i+q.length))+'</mark>'+escHtml(text.slice(i+q.length));
}

function countWords(str) {
  if (!str) return 0;
  return str.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// Modal wiring
$('#modal-close').addEventListener('click',closeModal);
$('#modal-cancel').addEventListener('click',closeModal);
$('#modal-overlay').addEventListener('click',e=>{if(e.target.id==='modal-overlay')closeModal()});
$('#modal-confirm').addEventListener('click',()=>{if(modalCb)modalCb()});
if ($('#btn-group-members')) $('#btn-group-members').addEventListener('click',()=>showView('members'));
if ($('#btn-edit-profile')) $('#btn-edit-profile').addEventListener('click', editProfile);

function editProfile() {
  if (!auth || !auth.currentUser) {
    showToast('You must be signed in to edit profile', 'error');
    return;
  }
  
  const pName = currentUserProfile ? currentUserProfile.name || '' : '';
  const pAvatar = currentUserProfile ? currentUserProfile.avatar || '' : '';
  const pStatus = currentUserProfile ? currentUserProfile.status || '' : '';
  
  const html = `
    <div class="form-group">
      <label class="form-label">Display Name</label>
      <input class="form-input" id="f-prof-name" value="${escHtml(pName)}" placeholder="e.g. Dr. Jane Doe">
    </div>
    <div class="form-group">
      <label class="form-label">Status / Bio</label>
      <input class="form-input" id="f-prof-status" value="${escHtml(pStatus)}" placeholder="e.g. In the lab until 5 PM">
    </div>
    <div class="form-group">
      <label class="form-label">Avatar Image</label>
      <input type="file" class="form-input" id="f-prof-avatar-file" accept="image/*" style="cursor: pointer;">
      <div id="prof-avatar-preview-wrap" style="margin-top: 0.75rem; display: flex; align-items: center; gap: 0.75rem;">
        <img id="f-prof-avatar-preview" src="${pAvatar || ''}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; display: ${pAvatar ? 'block' : 'none'}; border: 1px solid var(--border-subtle);">
        <button type="button" class="btn-inline danger" id="f-prof-avatar-remove" style="display: ${pAvatar ? 'inline-block' : 'none'}; font-size: 0.75rem;" onclick="window.removeProfAvatarPreview()">Remove Avatar</button>
      </div>
      <input type="hidden" id="f-prof-avatar" value="${escHtml(pAvatar)}">
    </div>
  `;
  
  window.removeProfAvatarPreview = function() {
    const preview = $('#f-prof-avatar-preview');
    const removeBtn = $('#f-prof-avatar-remove');
    const avatarInput = $('#f-prof-avatar');
    const fileInput = $('#f-prof-avatar-file');
    if (preview) preview.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'none';
    if (avatarInput) avatarInput.value = '';
    if (fileInput) fileInput.value = '';
  };
  
  openModal('Edit Profile', html, 'Save', () => {
    const name = $('#f-prof-name').value.trim();
    const status = $('#f-prof-status').value.trim();
    const avatar = $('#f-prof-avatar').value.trim();
    
    if (countWords(name) > 300 || countWords(status) > 300) {
      showToast('Name or bio exceeds the 300-word limit!', 'error');
      return;
    }
    
    if (typeof db !== 'undefined') {
      db.ref('users/' + auth.currentUser.uid).update({
        name: name,
        status: status,
        avatar: avatar
      }).then(() => {
        if (currentUserProfile) {
          currentUserProfile.name = name;
          currentUserProfile.status = status;
          currentUserProfile.avatar = avatar;
        }
        if ($('#user-badge-name')) $('#user-badge-name').textContent = name || auth.currentUser.email;
        if ($('#user-badge-lab')) $('#user-badge-lab').textContent = status || (currentUserProfile.role === 'superadmin' ? 'Super Admin' : 'Member');
        if ($('#btn-user-menu') && avatar) {
          $('#btn-user-menu').innerHTML = `<img src="${escHtml(avatar)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">`;
        } else if ($('#btn-user-menu')) {
          $('#btn-user-menu').innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
        }
        showToast('Profile updated');
        closeModal();
      }).catch(err => {
        showToast('Error updating profile', 'error');
      });
    } else {
      showToast('Offline mode', 'error');
    }
  });
  
  const fileInput = $('#f-prof-avatar-file');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 96;
          canvas.height = 96;
          const ctx = canvas.getContext('2d');
          const size = Math.min(img.width, img.height);
          const sx = (img.width - size) / 2;
          const sy = (img.height - size) / 2;
          ctx.drawImage(img, sx, sy, size, size, 0, 0, 96, 96);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          
          const preview = $('#f-prof-avatar-preview');
          const removeBtn = $('#f-prof-avatar-remove');
          const avatarInput = $('#f-prof-avatar');
          if (preview) {
            preview.src = dataUrl;
            preview.style.display = 'block';
          }
          if (removeBtn) removeBtn.style.display = 'inline-block';
          if (avatarInput) avatarInput.value = dataUrl;
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if($('#modal-overlay').classList.contains('active'))closeModal();else closeAutocomplete();}
  if(e.key==='Enter'&&$('#modal-overlay').classList.contains('active')&&document.activeElement.tagName!=='TEXTAREA'){e.preventDefault();if(modalCb)modalCb();}
});

// Navigation
// Navigation & Hash Routing
function handleHashChange() {
  const hash = window.location.hash;
  if (!auth || !auth.currentUser || !getCurrentRole()) {
    return;
  }
  
  if (!hash || hash === '#' || hash === '#rooms') {
    currentRoomId = null;
    currentContainerId = null;
    showView('rooms');
  } else if (hash.startsWith('#containers/')) {
    const parts = hash.split('/');
    currentRoomId = parts[1];
    currentContainerId = null;
    showView('containers');
  } else if (hash.startsWith('#detail/')) {
    const parts = hash.split('/');
    currentRoomId = parts[1];
    currentContainerId = parts[2];
    
    selectedDeepFreezerRack = null;
    selectedDeepFreezerBox = null;
    if (parts.length >= 5 && parts[3] === 'rack' && parts[4]) {
      selectedDeepFreezerRack = decodeURIComponent(parts[4]);
      if (parts.length >= 7 && parts[5] === 'box' && parts[6]) {
        selectedDeepFreezerBox = decodeURIComponent(parts[6]);
      }
    }
    showView('detail');
  } else {
    const viewName = hash.replace('#', '');
    const topViews = ['rooms','protocols','assets','noticeboard','instruments','printing','history','minigames'];
    if (topViews.includes(viewName)) {
      showView(viewName);
    } else {
      currentRoomId = null;
      currentContainerId = null;
      showView('rooms');
    }
  }
}

window.addEventListener('hashchange', handleHashChange);

function showView(v){
  if (v !== 'detail') {
    selectedDeepFreezerRack = null;
    selectedDeepFreezerBox = null;
  }
  if (v === 'assets' && getCurrentRole() === 'reader') {
    showToast('Access Denied', 'error');
    navigateTo('rooms');
    return;
  }
  $$('.view').forEach(el=>el.classList.remove('active'));
  $('#view-'+v).classList.add('active');
  
  const topViews = ['rooms','protocols','assets','noticeboard','instruments','printing','history','minigames'];
  
  const mainNav = $('.main-nav');
  if (topViews.includes(v)) {
    $('#breadcrumb').style.display = 'none';
    if (mainNav) mainNav.style.display = 'flex';
  } else {
    $('#breadcrumb').style.display = 'flex';
    if (mainNav) mainNav.style.display = 'none';
  }
  
  const tabMap = {
    rooms: 'tab-inventory',
    containers: 'tab-inventory',
    detail: 'tab-inventory',
    protocols: 'tab-protocols',
    assets: 'tab-assets',
    noticeboard: 'tab-noticeboard',
    instruments: 'tab-instruments',
    printing: 'tab-printing',
    history: 'tab-history',
    minigames: 'tab-minigames'
  };
  
  $$('.nav-tab').forEach(item => item.classList.remove('active'));
  const activeTabId = tabMap[v] || 'tab-inventory';
  const activeTab = $('#' + activeTabId);
  if(activeTab) {
    activeTab.classList.add('active');
  }

  $('.search-wrap').style.opacity = '1';
  $('.search-wrap').style.pointerEvents = 'auto';

  if(v==='rooms') renderRooms();
  else if(v==='containers') {
    const r = getRoom(currentRoomId);
    if (r) {
      $('#containers-title').textContent = 'Room: ' + r.name;
      $('#containers-subtitle').textContent = r.description || '';
      const isVirtual = (currentRoomId === 'shared-assets');
      $('#btn-add-cabinet').style.display = isVirtual ? 'none' : 'inline-flex';
      $('#btn-add-fridge').style.display = isVirtual ? 'none' : 'inline-flex';
      $('#btn-add-freezer').style.display = isVirtual ? 'none' : 'inline-flex';
      if ($('#btn-edit-room')) $('#btn-edit-room').style.display = isVirtual ? 'none' : 'inline-flex';
      if ($('#btn-delete-room')) $('#btn-delete-room').style.display = isVirtual ? 'none' : 'inline-flex';
    }
    renderContainers();
  }
  else if(v==='detail') {
    const cont = getContainer(currentRoomId, currentContainerId);
    if (cont) {
      const canManage = canManageContainerContents(cont);
      const canDelete = canDeleteContainer(cont);
      
      const em = cont.emoji ? `<span style="margin-right:0.5rem;">${escHtml(cont.emoji)}</span>` : '';
      safeSetHtml($('#detail-title'), em);
      $('#detail-title').appendChild(document.createTextNode(cont.name || 'Detail'));
      
      if (cont.ownerGroupName && cont.ownerGroupId !== currentGroupId) {
        const subtitle = `Shared from Lab: ${cont.ownerGroupName} (Room: ${cont.originalRoomName || '—'}) → ${cont.name}`;
        $('#detail-subtitle').textContent = subtitle;
      } else {
        const subtitle = `${(getRoom(currentRoomId)||{}).name || 'Room'} → ${cont.name}`;
        if (cont.sharedWithGroupIds && cont.sharedWithGroupIds.length > 0 && typeof db !== 'undefined' && db) {
          db.ref('groups').once('value', snap => {
            const groups = snap.val() || {};
            const sharedNames = cont.sharedWithGroupIds.map(gid => (groups[gid] && groups[gid].name) || gid).join(', ');
            $('#detail-subtitle').textContent = `${subtitle} | 🔗 Shared to: ${sharedNames}`;
          });
        } else {
          $('#detail-subtitle').textContent = subtitle;
        }
      }
      
      $('#btn-add-shelf').style.display = (canManage && cont.type !== 'deepfreezer') ? 'inline-flex' : 'none';
      $('#btn-edit-container').style.display = canDelete ? 'inline-flex' : 'none';
      $('#btn-delete-container').style.display = canDelete ? 'inline-flex' : 'none';
    }
    renderDetail();
  }
  else if(v==='protocols') renderProtocols();
  else if(v==='assets') renderAssets();
  else if(v==='noticeboard') renderNoticeboard();
  else if(v==='instruments') renderInstruments();
  else if(v==='printing') renderPrintCatalog();
  else if(v==='history') renderHistory();
  else if(v==='minigames') renderMinigames();
  
  updateBreadcrumb(v);
  enforceRolePermissions();
}

function navigateTo(v){
  if (v === 'assets' && getCurrentRole() === 'reader') {
    showToast('Access Denied', 'error');
    navigateTo('rooms');
    return;
  }
  if (v === 'rooms') {
    window.location.hash = '#rooms';
  } else if (v === 'containers') {
    window.location.hash = `#containers/${currentRoomId}`;
  } else if (v === 'detail') {
    let hash = `#detail/${currentRoomId}/${currentContainerId}`;
    if (selectedDeepFreezerRack) {
      hash += `/rack/${encodeURIComponent(selectedDeepFreezerRack)}`;
      if (selectedDeepFreezerBox) {
        hash += `/box/${encodeURIComponent(selectedDeepFreezerBox)}`;
      }
    }
    window.location.hash = hash;
  } else {
    window.location.hash = '#' + v;
  }
}
function updateBreadcrumb(v){
  let h=`<span class="breadcrumb-item ${v==='rooms'?'active':''}" onclick="navigateTo('rooms')">Rooms</span>`;
  if(v==='containers'||v==='detail'){const r=getRoom(currentRoomId);if(r)h+=`<span class="breadcrumb-separator">›</span><span class="breadcrumb-item ${v==='containers'?'active':''}" onclick="navigateTo('containers')">${escHtml(r.name)}</span>`;}
  if(v==='detail'){const c=getContainer(currentRoomId,currentContainerId);if(c)h+=`<span class="breadcrumb-separator">›</span><span class="breadcrumb-item active">${escHtml(c.name)}</span>`;}
  $('#breadcrumb').innerHTML=h;
}

let sharedContainersList = [];

function getSharedGroupsOptionsHtml(currentGroupId, checkedGroupIds = []) {
  return new Promise((resolve) => {
    if (typeof db === 'undefined' || !db) {
      resolve('<div style="font-size: 0.8rem; color: var(--text-muted); padding: 0.25rem 0.5rem;">No other groups found</div>');
      return;
    }
    db.ref('groups').once('value', snapshot => {
      const groups = snapshot.val();
      let html = '';
      if (groups) {
        const currentGroupName = groups[currentGroupId] ? groups[currentGroupId].name.toLowerCase().trim() : '';
        
        Object.keys(groups).forEach(id => {
          const groupName = groups[id].name ? groups[id].name.toLowerCase().trim() : '';
          // Filter out the exact ID and any groups with the exact same name (to prevent duplicate confusion)
          if (id !== currentGroupId && groupName !== currentGroupName) {
            const isChecked = checkedGroupIds.includes(id);
            html += `
              <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none; font-size: 0.85rem; color: var(--text-secondary); padding: 0.25rem 0.5rem; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                <input type="checkbox" name="c-shared-group-item" value="${id}" style="width: 15px; height: 15px; cursor: pointer; accent-color: var(--primary);" ${isChecked ? 'checked' : ''}>
                <span>${escHtml(groups[id].name)}</span>
              </label>
            `;
          }
        });
      }
      if (!html) {
        html = '<div style="font-size: 0.8rem; color: var(--text-muted); padding: 0.25rem 0.5rem;">No other groups found</div>';
      }
      resolve(html);
    });
  });
}

function getSharedContainers() {
  return sharedContainersList || [];
}

// Render Rooms
function renderRooms(){
  const rooms=appData.rooms||[];
  const shared = sharedContainersList || [];
  
  if(!rooms.length && !shared.length){$('#rooms-grid').style.display='none';$('#rooms-empty').style.display='block';return;}
  $('#rooms-empty').style.display='none';$('#rooms-grid').style.display='grid';
  
  let html = rooms.map(r=>{
    const cc=(r.containers||[]).length;
    let ch=countAllChems(r);
    
    const matchingShared = shared.filter(sc => sc.originalRoomName && sc.originalRoomName.toLowerCase() === r.name.toLowerCase());
    const totalCc = cc + matchingShared.length;
    matchingShared.forEach(sc => {
      ch += countChems(sc);
    });
    
    return`<div class="card" onclick="openRoom('${r.id}')"><div class="card-icon room">🏠</div><div class="card-title">${escHtml(r.name)}</div><div class="card-description">${escHtml(r.description||'Room')}</div><div class="card-stats"><div class="card-stat">🗄️ <span class="card-stat-value">${totalCc}</span> containers</div><div class="card-stat">🧪 <span class="card-stat-value">${ch}</span> chemicals</div></div></div>`;
  }).join('');
  
  if (shared.length > 0) {
    const totalSharedChems = shared.reduce((acc, c) => acc + countChems(c), 0);
    html += `
      <div class="card" onclick="openRoom('shared-assets')" style="background: linear-gradient(135deg, rgba(34, 197, 94, 0.05), rgba(59, 130, 246, 0.03)); border-color: rgba(34, 197, 94, 0.25);">
        <div class="card-icon" style="background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.05));">🤝</div>
        <div class="card-title" style="color: var(--accent-green);">Shared Assets</div>
        <div class="card-description">Shared from neighboring laboratories</div>
        <div class="card-stats">
          <div class="card-stat">🗄️ <span class="card-stat-value">${shared.length}</span> containers</div>
          <div class="card-stat">🧪 <span class="card-stat-value">${totalSharedChems}</span> chemicals</div>
        </div>
      </div>
    `;
  }
  
  $('#rooms-grid').innerHTML = html;
}

function openRoom(id){
  currentRoomId=id;
  navigateTo('containers');
}

// Render Containers
function renderContainers(){
  const room=getRoom(currentRoomId);if(!room)return;
  let conts=[...(room.containers||[])];
  
  let groupNamesMap = {};
  if (allGroupsData) {
    Object.keys(allGroupsData).forEach(gid => groupNamesMap[gid] = allGroupsData[gid].name);
  }
  
  const shared = sharedContainersList || [];
  if (shared && shared.length) {
    shared.forEach(sc => {
      if (currentRoomId === 'shared-assets') {
        if (!conts.find(c => c.id === sc.id)) {
          conts.push({
            ...sc,
            isSharedAsset: true
          });
        }
      }
    });
  }
  
  if(!conts.length){$('#containers-split').style.display='none';$('#containers-empty').style.display='block';return;}
  $('#containers-empty').style.display='none';$('#containers-split').style.display='flex';
  
  const cabs=conts.filter(c=>c.type==='cabinet');
  const frid=conts.filter(c=>c.type==='fridge');
  const freez=conts.filter(c=>c.type==='freezer' || c.type==='deepfreezer');
  
  const renderCard=(c,typeName,icon,cls)=>{
    const ch=countChems(c);
    const isFromOtherLab = c.isSharedAsset && c.ownerGroupId && c.ownerGroupId !== currentGroupId;
    const isMySharedContainer = !isFromOtherLab && c.sharedWithGroupIds && c.sharedWithGroupIds.length > 0;
    
    const finalIcon = c.emoji || icon;
    const sharedTag = isFromOtherLab ? ` (Shared)` : '';
    const sharedBadge = isFromOtherLab ? `<span style="font-size: 0.7rem; background: rgba(34, 197, 94, 0.15); color: var(--accent-green); padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; margin-top: 0.4rem; font-weight: 600;">🔗 Shared from: ${escHtml(c.ownerGroupName || '—')} (Room: ${escHtml(c.originalRoomName || '—')})</span>` : '';
    
    // Show sharing info for owner's own containers that are shared with others
    let ownerSharedBadge = '';
    if (isMySharedContainer) {
      const otherGroupIds = c.sharedWithGroupIds.filter(gid => gid !== currentGroupId);
      if (otherGroupIds.length > 0) {
        const sharedLabNames = otherGroupIds.map(gid => groupNamesMap[gid] || 'Unknown Lab').join(', ');
        ownerSharedBadge = `<span style="font-size: 0.7rem; background: rgba(59, 130, 246, 0.12); color: var(--accent-blue); padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; margin-top: 0.4rem; font-weight: 600;">🔗 Shared to: ${escHtml(sharedLabNames)}</span>`;
      }
    }
    
    const cardBorderStyle = isMySharedContainer ? ' style="border: 2px solid var(--accent-blue); box-shadow: 0 0 12px rgba(59, 130, 246, 0.25);"' : '';
    
    const displayTypeName = c.type === 'deepfreezer' ? 'Deep Freezer' : typeName;
    return`<div class="card ${cls}-card"${cardBorderStyle} onclick="openContainer('${c.id}')"><span class="card-type-badge ${cls}-badge">${displayTypeName}</span><div class="card-icon ${cls}">${finalIcon}</div><div class="card-title">${escHtml(c.name)}${escHtml(sharedTag)}</div><div class="card-description">${escHtml(c.description||'')}<br>${sharedBadge}${ownerSharedBadge}</div><div class="card-stats"><div class="card-stat">📁 <span class="card-stat-value">${(c.shelves||[]).length}</span> shelves</div><div class="card-stat">🧪 <span class="card-stat-value">${ch}</span> chemicals</div></div></div>`;
  };
  
  if(!cabs.length){$('#cabinets-grid').innerHTML='';$('#cabinets-empty').style.display='block';}
  else{$('#cabinets-empty').style.display='none';$('#cabinets-grid').innerHTML=cabs.map(c=>renderCard(c,'Cabinet','🗄️','cabinet')).join('');}
  
  if(!frid.length){$('#fridges-grid').innerHTML='';$('#fridges-empty').style.display='block';}
  else{$('#fridges-empty').style.display='none';$('#fridges-grid').innerHTML=frid.map(c=>renderCard(c,'Fridge','❄️','fridge')).join('');}
  
  if(!freez.length){$('#freezers-grid').innerHTML='';$('#freezers-empty').style.display='block';}
  else{$('#freezers-empty').style.display='none';$('#freezers-grid').innerHTML=freez.map(c=>renderCard(c,'Freezer','🧊','freezer')).join('');}
}

function openContainer(id){
  currentContainerId=id;openShelves.clear();searchQuery='';$('#search-input').value='';closeAutocomplete();
  selectedDeepFreezerRack = null;
  selectedDeepFreezerBox = null;
  navigateTo('detail');
}

// Render Detail
// Deep Freezer Helpers and Bindings
function parseDeepFreezerShelf(sh) {
  if (!sh) return { rack: 'Other', box: 'Other' };
  if (typeof sh === 'string') {
    const regex = /Rack\s+(.+?)\s*\/\s*Box\s+(.+)/i;
    const match = sh.match(regex);
    if (match) return { rack: match[1].trim(), box: match[2].trim() };
    const parts = sh.split('/');
    if (parts.length === 2) return { rack: parts[0].trim(), box: parts[1].trim() };
    return { rack: 'Other', box: sh };
  }
  
  // It's a shelf object
  let rack = sh.rackName;
  let box = sh.boxName;
  if (!rack || !box) {
    // Fallback to parsing from name
    const parsed = parseDeepFreezerShelf(sh.name || '');
    rack = rack || parsed.rack;
    box = box || parsed.box;
  }
  return { rack: rack.trim(), box: box.trim() };
}

window.selectDeepFreezerRack = function(rack) {
  selectedDeepFreezerRack = rack;
  selectedDeepFreezerBox = null;
  navigateTo('detail');
};

window.selectDeepFreezerBox = function(box) {
  selectedDeepFreezerBox = box;
  navigateTo('detail');
};

window.resetDeepFreezerSelection = function() {
  selectedDeepFreezerRack = null;
  selectedDeepFreezerBox = null;
  navigateTo('detail');
};

window.selectDeepFreezerRackAndBox = function(rack, box) {
  selectedDeepFreezerRack = rack;
  selectedDeepFreezerBox = box;
  navigateTo('detail');
};

window.handleRackDragStart = function(event, rackName, fromSlot) {
  event.dataTransfer.setData('text/plain', JSON.stringify({ rackName, fromSlot }));
  event.dataTransfer.effectAllowed = 'move';
};

window.handleRackDragEnd = function(event) {
};

window.handleRackDragOver = function(event) {
  event.preventDefault();
  event.currentTarget.classList.add('drag-over');
};

window.handleRackDragLeave = function(event) {
  event.currentTarget.classList.remove('drag-over');
};

window.handleRackDrop = function(event, toSlot) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont) return;
  if (!canManageContainerContents(cont)) {
    showToast('Access Denied', 'error');
    return;
  }
  
  try {
    const rawData = event.dataTransfer.getData('text/plain');
    if (!rawData) return;
    const { rackName, fromSlot } = JSON.parse(rawData);
    if (fromSlot === toSlot) return;
    
    if (!cont.rackPositions) cont.rackPositions = {};
    
    // Check if there is another rack at toSlot
    const swapRackName = Object.keys(cont.rackPositions).find(rk => cont.rackPositions[rk] === toSlot);
    if (swapRackName) {
      cont.rackPositions[swapRackName] = fromSlot;
    }
    cont.rackPositions[rackName] = toSlot;
    
    saveData(appData);
    renderDetail();
    logHistory(`Relocated rack "${rackName}" to Slot ${toSlot + 1} in deep freezer "${cont.name}"`, cont.ownerGroupId);
    showToast(`Rack "${rackName}" relocated`);
  } catch (e) {
    console.error('Error handling rack drop:', e);
  }
};

// Render Detail
function renderDetail(){
  const cont=getContainer(currentRoomId,currentContainerId);if(!cont)return;
  const shelves=cont.shelves||[];
  const posMap=computePositions(cont);
  const q=searchQuery.toLowerCase();
  
  if (cont.type === 'deepfreezer') {
    // Group shelves by rack and box
    const racks = {};
    shelves.forEach(sh => {
      const { rack, box } = parseDeepFreezerShelf(sh);
      if (!racks[rack]) racks[rack] = {};
      racks[rack][box] = sh;
    });

    // Tiered explorer implementation
    const rackKeys = Object.keys(racks).sort((a, b) => {
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });

    // Make sure cont.rackPositions is set up
    let rackPosChanged = false;
    if (!cont.rackPositions) {
      cont.rackPositions = {};
      rackPosChanged = true;
    }
    // Clean up deleted racks
    for (let r in cont.rackPositions) {
      if (!rackKeys.includes(r)) {
        delete cont.rackPositions[r];
        rackPosChanged = true;
      }
    }
    // Collect occupied slots to avoid collisions
    const occupiedSlots = {};
    rackKeys.forEach(rk => {
      const pos = cont.rackPositions[rk];
      if (pos !== undefined && pos >= 0 && pos < 32 && occupiedSlots[pos] === undefined) {
        occupiedSlots[pos] = rk;
      } else {
        cont.rackPositions[rk] = undefined;
      }
    });
    // Assign any undefined racks to the first available slot
    rackKeys.forEach(rk => {
      if (cont.rackPositions[rk] === undefined) {
        let freeSlot = 0;
        while (freeSlot < 32 && occupiedSlots[freeSlot] !== undefined) {
          freeSlot++;
        }
        cont.rackPositions[rk] = freeSlot;
        occupiedSlots[freeSlot] = rk;
        rackPosChanged = true;
      }
    });
    if (rackPosChanged) {
      saveData(appData);
    }

    if (q) {
      // If there is an active search query, render all matching chemicals from all racks/boxes
      let matchingChems = [];
      shelves.forEach(sh => {
        const { rack, box } = parseDeepFreezerShelf(sh);
        (sh.chemicals || []).forEach(ch => {
          if ((ch.name||'').toLowerCase().includes(q) || normalizeFormula(ch.formula||'').toLowerCase().includes(q) || (ch.cas||'').toLowerCase().includes(q)) {
            matchingChems.push({ chem: ch, shelfId: sh.id, shelfName: sh.name, rack, box });
          }
        });
      });

      if (!matchingChems.length) {
        $('#shelves-container').innerHTML = `<div class="shelf-empty">No results found for "${escHtml(searchQuery)}" in this deep freezer</div>`;
        $('#detail-empty').style.display = 'none';
        return;
      }

      matchingChems.sort((a, b) => {
        const posA = posMap[a.chem.id] || '';
        const posB = posMap[b.chem.id] || '';
        return posA.localeCompare(posB, undefined, { numeric: true, sensitivity: 'base' });
      });

      let html = `<div class="deepfreezer-explorer">
        <div class="deepfreezer-nav">
          <div class="deepfreezer-nav-item">
            <span class="deepfreezer-nav-text">🔍 Search Results inside Deep Freezer: ${matchingChems.length} items found</span>
          </div>
        </div>
        <table class="chemicals-table">
          <thead>
            <tr>
              <th>Location</th>
              <th>Pos.</th>
              <th>Name</th>
              <th>Formula</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Conc.</th>
              <th>CAS</th>
              <th>Note</th>
              <th style="width:80px;text-align:center">Actions</th>
            </tr>
          </thead>
          <tbody>`;

      matchingChems.forEach(({ chem: ch, shelfId, rack, box }) => {
        const qty = parseFloat(ch.quantity) || 0;
        let qc = 'ok';
        if (qty <= 0) qc = 'low';
        else if (qty < 10) qc = 'medium';
        const pos = posMap[ch.id] || '—';
        const conc = ch.concentration !== null && ch.concentration !== undefined ? escHtml(ch.concentration + ' ' + (ch.concUnit || '')) : '—';
        const deleteBtnHtml = getCurrentRole() !== 'reader' ? `<button class="btn-inline danger" onclick="deleteChemical('${shelfId}','${ch.id}')" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : '';
        
        html += `<tr class="fade-in" data-chemid="${ch.id}">
          <td>
            <button class="deepfreezer-nav-btn" onclick="window.selectDeepFreezerRackAndBox('${escHtml(rack)}','${escHtml(box)}')" title="Go to Box" style="margin: 0; background: rgba(59, 130, 246, 0.15); border-color: rgba(59, 130, 246, 0.3); color: var(--accent-blue); font-weight: 600;">
              Rack ${escHtml(rack)} / Box ${escHtml(box)}
            </button>
          </td>
          <td><span class="chem-pos fridge">${escHtml(pos)}</span></td>
          <td class="chem-name">${hl(ch.name || '', q)}</td>
          <td class="chem-formula">${renderFormulaHtml(ch.formula)}</td>
          <td>
            <div class="qty-adjuster">
              <button class="btn-qty" onclick="event.stopPropagation();adjustQty('${shelfId}','${ch.id}',-1)">−</button>
              <span class="chem-quantity ${qc}">${escHtml(String(ch.quantity || 0))}</span>
              <button class="btn-qty" onclick="event.stopPropagation();adjustQty('${shelfId}','${ch.id}',1)">+</button>
            </div>
          </td>
          <td>${escHtml(ch.unit || 'pcs')}</td>
          <td style="white-space:nowrap">${conc}</td>
          <td>${escHtml(ch.cas || '—')}</td>
          <td>${escHtml(ch.note || '—')}</td>
          <td>
            <div class="row-actions">
              <button class="btn-inline" onclick="editChemical('${shelfId}','${ch.id}')" title="Edit">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              ${deleteBtnHtml}
            </div>
          </td>
        </tr>`;
      });

      html += `</tbody></table></div>`;
      $('#shelves-container').innerHTML = html;
      $('#detail-empty').style.display = 'none';
      return;
    }

    let explorerHtml = `<div class="deepfreezer-explorer">`;

    if (selectedDeepFreezerRack === null) {
      // Level 1: Racks (8x4 Grid layout)
      explorerHtml += `
        <div class="deepfreezer-nav">
          <div class="deepfreezer-nav-item" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div>
              <span class="deepfreezer-nav-text">❄️ Deep Freezer Explorer</span>
              <span class="deepfreezer-nav-separator">/</span>
              <span class="deepfreezer-nav-text" style="color: var(--text-muted);">Select a Rack</span>
            </div>
            ${getCurrentRole() !== 'reader' ? `
              <button class="btn-primary" onclick="window.addDeepFreezerRack()" style="font-size: 0.8rem; padding: 0.4rem 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem; margin: 0;">
                ➕ Add Rack
              </button>
            ` : ''}
          </div>
        </div>
        <div class="deepfreezer-grid-8x4">`;

      for (let i = 0; i < 32; i++) {
        const rk = Object.keys(cont.rackPositions).find(name => cont.rackPositions[name] === i);
        if (rk && rackKeys.includes(rk)) {
          const boxesCount = Object.keys(racks[rk]).length;
          let totalItemsInRack = 0;
          Object.keys(racks[rk]).forEach(bk => {
            totalItemsInRack += (racks[rk][bk].chemicals || []).length;
          });

          const isReader = getCurrentRole() === 'reader';
          const draggableAttr = !isReader ? `draggable="true" ondragstart="window.handleRackDragStart(event, '${escHtml(rk)}', ${i})" ondragend="window.handleRackDragEnd(event)"` : '';
          const dragOverHandlers = !isReader ? `ondragover="window.handleRackDragOver(event)" ondragleave="window.handleRackDragLeave(event)" ondrop="window.handleRackDrop(event, ${i})"` : '';

          explorerHtml += `
            <div class="deepfreezer-grid-cell" data-slot="${i}" ${dragOverHandlers}>
              <div class="deepfreezer-card rack-card" ${draggableAttr} onclick="window.selectDeepFreezerRack('${escHtml(rk)}')">
                <div class="deepfreezer-card-icon">🗄️</div>
                <div class="deepfreezer-card-title">Rack ${escHtml(rk)}</div>
                <div class="deepfreezer-card-subtitle">${boxesCount} Boxes (${totalItemsInRack} samples)</div>
                ${!isReader ? `
                  <div class="deepfreezer-card-actions" onclick="event.stopPropagation();">
                    <button class="card-action-btn" onclick="window.renameDeepFreezerRack('${escHtml(rk)}')" title="Rename Rack">✏️</button>
                    <button class="card-action-btn danger" onclick="window.deleteDeepFreezerRack('${escHtml(rk)}')" title="Delete Rack">🗑️</button>
                  </div>
                ` : ''}
              </div>
            </div>`;
        } else {
          const dragOverHandlers = getCurrentRole() !== 'reader' ? `ondragover="window.handleRackDragOver(event)" ondragleave="window.handleRackDragLeave(event)" ondrop="window.handleRackDrop(event, ${i})"` : '';
          explorerHtml += `
            <div class="deepfreezer-grid-cell" data-slot="${i}" ${dragOverHandlers}>
              <div class="deepfreezer-grid-empty-slot">Slot ${i + 1}</div>
            </div>`;
        }
      }

      explorerHtml += `</div>`;
    } 
    else if (selectedDeepFreezerBox === null) {
      // Level 2: Boxes in Rack (Stacked physical column tower layout)
      explorerHtml += `
        <div class="deepfreezer-nav">
          <div class="deepfreezer-nav-item" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div>
              <span class="deepfreezer-nav-link" onclick="window.resetDeepFreezerSelection()">❄️ Deep Freezer Explorer</span>
              <span class="deepfreezer-nav-separator">›</span>
              <span class="deepfreezer-nav-text">Rack ${escHtml(selectedDeepFreezerRack)}</span>
              <button class="deepfreezer-nav-btn" onclick="window.resetDeepFreezerSelection()">Change Rack</button>
              <span class="deepfreezer-nav-separator">/</span>
              <span class="deepfreezer-nav-text" style="color: var(--text-muted);">Select a Box</span>
            </div>
            ${getCurrentRole() !== 'reader' ? `
              <button class="btn-primary" onclick="window.addDeepFreezerBox()" style="font-size: 0.8rem; padding: 0.4rem 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem; margin: 0;">
                ➕ Add Box
              </button>
            ` : ''}
          </div>
        </div>
        <div class="deepfreezer-boxes-column">`;

      const boxesMap = racks[selectedDeepFreezerRack] || {};
      const boxKeys = Object.keys(boxesMap).sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.localeCompare(b);
      });

      boxKeys.forEach(bk => {
        const activeShelf = boxesMap[bk];
        const sampleCount = (activeShelf.chemicals || []).length;
        const boxColor = activeShelf.color || '#3b82f6';
        const customColorClass = activeShelf.color ? 'has-custom-color' : '';
        const customColorStyle = activeShelf.color ? `style="--custom-bg: ${boxColor}2d; --custom-border: ${boxColor}; --custom-bg-hover: ${boxColor}4d;"` : '';

        explorerHtml += `
          <div class="deepfreezer-card box-card ${customColorClass}" ${customColorStyle} onclick="window.selectDeepFreezerBox('${escHtml(bk)}')">
            <div class="deepfreezer-card-icon" style="color: ${boxColor};">📦</div>
            <div class="deepfreezer-card-title">Box ${escHtml(bk)}</div>
            <div class="deepfreezer-card-subtitle">${sampleCount} samples</div>
            ${getCurrentRole() !== 'reader' ? `
              <div class="deepfreezer-card-actions" onclick="event.stopPropagation();">
                <button class="card-action-btn" onclick="window.renameDeepFreezerBox('${escHtml(bk)}', '${activeShelf.id}')" title="Rename Box">✏️</button>
                <button class="card-action-btn" onclick="window.changeDeepFreezerBoxColor('${activeShelf.id}')" title="Change Color">🎨</button>
                <button class="card-action-btn danger" onclick="window.deleteDeepFreezerBox('${activeShelf.id}')" title="Delete Box">🗑️</button>
              </div>
            ` : ''}
          </div>`;
      });

      explorerHtml += `</div>`;
    } 
    else {
      // Level 3: Chemicals in Box
      const activeShelf = racks[selectedDeepFreezerRack]?.[selectedDeepFreezerBox];
      if (!activeShelf) {
        selectedDeepFreezerBox = null;
        renderDetail();
        return;
      }

      explorerHtml += `
        <div class="deepfreezer-nav">
          <div class="deepfreezer-nav-item">
            <span class="deepfreezer-nav-link" onclick="window.resetDeepFreezerSelection()">❄️ Deep Freezer Explorer</span>
            <span class="deepfreezer-nav-separator">›</span>
            <span class="deepfreezer-nav-link" onclick="window.selectDeepFreezerRack('${escHtml(selectedDeepFreezerRack)}')">Rack ${escHtml(selectedDeepFreezerRack)}</span>
            <button class="deepfreezer-nav-btn" onclick="window.resetDeepFreezerSelection()">Change Rack</button>
            <span class="deepfreezer-nav-separator">›</span>
            <span class="deepfreezer-nav-text">Box ${escHtml(selectedDeepFreezerBox)}</span>
            <button class="deepfreezer-nav-btn" onclick="window.selectDeepFreezerRack('${escHtml(selectedDeepFreezerRack)}')">Change Box</button>
          </div>
        </div>
        <div class="shelf-section open" data-sid="${activeShelf.id}">
          <div class="shelf-header" style="cursor: default;">
            <div class="shelf-info">
              <span class="shelf-icon" style="color: ${activeShelf.color || '#3b82f6'};">🧊</span>
              <span class="shelf-name">Rack ${escHtml(selectedDeepFreezerRack)} / Box ${escHtml(selectedDeepFreezerBox)}</span>
              <span class="shelf-count">${(activeShelf.chemicals || []).length} chemicals</span>
            </div>
            <div class="shelf-actions">`;
      
      if (getCurrentRole() !== 'reader') {
        explorerHtml += `<button class="btn-inline danger" title="Delete Box" onclick="event.stopPropagation();deleteShelf('${activeShelf.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
      }
      
      explorerHtml += `</div>
          </div>
          <div class="shelf-body">`;

      let chems = [...(activeShelf.chemicals || [])];
      chems.sort((a, b) => {
        const posA = posMap[a.id] || '';
        const posB = posMap[b.id] || '';
        return posA.localeCompare(posB, undefined, { numeric: true, sensitivity: 'base' });
      });

      if (chems.length) {
        explorerHtml += `<table class="chemicals-table">
          <thead>
            <tr>
              <th>Pos.</th>
              <th>Name</th>
              <th>Formula</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Conc.</th>
              <th>CAS</th>
              <th>Note</th>
              <th style="width:80px;text-align:center">Actions</th>
            </tr>
          </thead>
          <tbody>`;

        chems.forEach(ch => {
          const qty = parseFloat(ch.quantity) || 0;
          let qc = 'ok';
          if (qty <= 0) qc = 'low';
          else if (qty < 10) qc = 'medium';
          const pos = posMap[ch.id] || '—';
          const conc = ch.concentration !== null && ch.concentration !== undefined ? escHtml(ch.concentration + ' ' + (ch.concUnit || '')) : '—';
          const deleteBtnHtml = getCurrentRole() !== 'reader' ? `<button class="btn-inline danger" onclick="deleteChemical('${activeShelf.id}','${ch.id}')" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : '';

          explorerHtml += `<tr class="fade-in" data-chemid="${ch.id}">
            <td><span class="chem-pos fridge">${escHtml(pos)}</span></td>
            <td class="chem-name">${hl(ch.name || '', q)}</td>
            <td class="chem-formula">${renderFormulaHtml(ch.formula)}</td>
            <td>
              <div class="qty-adjuster">
                <button class="btn-qty" onclick="event.stopPropagation();adjustQty('${activeShelf.id}','${ch.id}',-1)">−</button>
                <span class="chem-quantity ${qc}">${escHtml(String(ch.quantity || 0))}</span>
                <button class="btn-qty" onclick="event.stopPropagation();adjustQty('${activeShelf.id}','${ch.id}',1)">+</button>
              </div>
            </td>
            <td>${escHtml(ch.unit || 'pcs')}</td>
            <td style="white-space:nowrap">${conc}</td>
            <td>${escHtml(ch.cas || '—')}</td>
            <td>${escHtml(ch.note || '—')}</td>
            <td>
              <div class="row-actions">
                <button class="btn-inline" onclick="editChemical('${activeShelf.id}','${ch.id}')" title="Edit">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                ${deleteBtnHtml}
              </div>
            </td>
          </tr>`;
        });

        explorerHtml += `</tbody></table>`;
      } 
      else {
        explorerHtml += `<div class="shelf-empty">Empty box</div>`;
      }

      explorerHtml += `</div></div>`;
    }

    explorerHtml += `</div>`;
    $('#shelves-container').innerHTML = explorerHtml;
    $('#detail-empty').style.display = 'none';
    return;
  }

  // Standard renderer
  // Auto-open shelves with search results
  if(q){
    shelves.forEach(sh=>{
      if((sh.chemicals||[]).some(c=>(c.name||'').toLowerCase().includes(q)||normalizeFormula(c.formula||'').toLowerCase().includes(q)||(c.cas||'').toLowerCase().includes(q))) {
        openShelves.add(sh.id);
        if (sh.parentShelfId) {
          openShelves.add(sh.parentShelfId);
        }
      }
    });
  }
  const total=shelves.reduce((s,sh)=>s+(sh.chemicals||[]).length,0);
  if(!total&&!shelves.length){$('#shelves-container').innerHTML='';$('#detail-empty').style.display='block';return;}
  $('#detail-empty').style.display='none';
  
  let html='';
  const parentShelves = shelves.filter(s => !s.parentShelfId);
  
  parentShelves.forEach(sh=>{
    let chems=[...(sh.chemicals||[])];
    if(q)chems=chems.filter(c=>(c.name||'').toLowerCase().includes(q)||normalizeFormula(c.formula||'').toLowerCase().includes(q)||(c.cas||'').toLowerCase().includes(q));
    chems.sort((a, b) => {
      const posA = posMap[a.id] || '';
      const posB = posMap[b.id] || '';
      return posA.localeCompare(posB, undefined, { numeric: true, sensitivity: 'base' });
    });
    const isOpen=openShelves.has(sh.id)||!!q;
    const isFreezer = (cont.type === 'freezer' || cont.type === 'deepfreezer');
    const isFridgeOrFreezer = (cont.type === 'fridge' || isFreezer);
    const icon = isFridgeOrFreezer ? (sh.name.startsWith('Door') ? '🚪' : (isFreezer ? '🧊' : '❄️')) : '📁';
    
    // Add box and rename options inside standard fridges, freezers, and cabinets
    let actionsHtml = '';
    if (getCurrentRole() !== 'reader') {
      actionsHtml += `<button class="btn-inline" title="Rename Shelf" onclick="event.stopPropagation();window.renameShelf('${sh.id}')">✏️</button>`;
      if (cont.type === 'fridge' || cont.type === 'freezer') {
        actionsHtml += `<button class="btn-inline" title="Add Box" onclick="event.stopPropagation();window.addBoxToShelf('${sh.id}')">➕ Box</button>`;
      }
      if (cont.type !== 'deepfreezer') {
        actionsHtml += `<button class="btn-inline" title="Add Chemical to Shelf" onclick="event.stopPropagation();window.addChemical('${sh.id}')">➕ Chem</button>`;
      }
      actionsHtml += `<button class="btn-inline danger" title="Delete shelf" onclick="event.stopPropagation();deleteShelf('${sh.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
    }
    
    html+=`<div class="shelf-section ${isOpen?'open':''}" data-sid="${sh.id}">
      <div class="shelf-header" onclick="toggleShelf('${sh.id}')">
        <div class="shelf-info">
          <span class="shelf-icon">${icon}</span>
          <span class="shelf-name">${escHtml(sh.name)}</span>
          <span class="shelf-count">${chems.length} chemicals</span>
        </div>
        <div class="shelf-actions">
          ${actionsHtml}
          <span class="shelf-toggle">▼</span>
        </div>
      </div>
      <div class="shelf-body">`;
    
    const boxes = shelves.filter(s => s.parentShelfId === sh.id);
    if (boxes.length > 0) {
      // Sub-boxes Visual Grid
      html += `<div class="deepfreezer-grid" style="margin-bottom: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; padding: 0.25rem;">`;
      boxes.forEach(box => {
        const sampleCount = (box.chemicals || []).length;
        const boxColor = box.color || '#3b82f6';
        const customColorClass = box.color ? 'has-custom-color' : '';
        const customColorStyle = box.color ? `style="--custom-bg: ${boxColor}2d; --custom-border: ${boxColor}; --custom-bg-hover: ${boxColor}4d; padding: 1.25rem 0.75rem;"` : 'style="padding: 1.25rem 0.75rem;"';
        const isBoxOpen = openShelves.has(box.id);
        const activeClass = isBoxOpen ? 'active-box' : '';
        
        html += `
          <div class="deepfreezer-card box-card ${customColorClass} ${activeClass}" ${customColorStyle} onclick="event.stopPropagation();window.toggleShelf('${box.id}')" style="min-height: auto;">
            <div class="deepfreezer-card-icon" style="color: ${boxColor}; font-size: 1.8rem; margin-bottom: 0.25rem;">📦</div>
            <div class="deepfreezer-card-title" style="font-size: 0.85rem;">${escHtml(box.name)}</div>
            <div class="deepfreezer-card-subtitle" style="font-size: 0.7rem;">${sampleCount} samples</div>
            ${getCurrentRole() !== 'reader' ? `
              <div class="deepfreezer-card-actions" onclick="event.stopPropagation();" style="margin-top: 0.35rem;">
                <button class="card-action-btn" onclick="window.renameBoxDirect('${box.id}')" title="Rename Box" style="padding: 2px 4px; font-size: 0.7rem;">✏️</button>
                <button class="card-action-btn" onclick="window.changeDeepFreezerBoxColor('${box.id}')" title="Change Color" style="padding: 2px 4px; font-size: 0.7rem;">🎨</button>
                <button class="card-action-btn danger" onclick="window.deleteBoxDirect('${box.id}')" title="Delete Box" style="padding: 2px 4px; font-size: 0.7rem;">🗑️</button>
              </div>
            ` : ''}
          </div>`;
      });
      html += `</div>`;
      
      // Collapsible chemical tables for open sub-boxes
      boxes.forEach(box => {
        if (openShelves.has(box.id) || !!q) {
          let boxChems = [...(box.chemicals || [])];
          if (q) boxChems = boxChems.filter(c => (c.name || '').toLowerCase().includes(q) || normalizeFormula(c.formula || '').toLowerCase().includes(q) || (c.cas || '').toLowerCase().includes(q));
          boxChems.sort((a, b) => {
            const posA = posMap[a.id] || '';
            const posB = posMap[b.id] || '';
            return posA.localeCompare(posB, undefined, { numeric: true, sensitivity: 'base' });
          });

          html += `<div class="box-chemicals-section" style="border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.25rem; background: rgba(255,255,255,0.015); box-shadow: inset 0 0 10px rgba(0,0,0,0.1);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;">
              <h4 style="margin: 0; color: var(--text-primary); font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
                <span style="color: ${box.color || '#3b82f6'};">📦</span> ${escHtml(box.name)} Chemicals
              </h4>
              ${getCurrentRole() !== 'reader' ? `
                <button class="btn-primary" onclick="window.addChemicalToBoxDirect('${box.id}')" style="font-size: 0.75rem; padding: 0.35rem 0.7rem; margin: 0; height: auto; display: inline-flex; align-items: center; gap: 0.25rem;">
                  ➕ Add Chemical
                </button>
              ` : ''}
            </div>`;

          if (boxChems.length) {
            html += `<table class="chemicals-table"><thead><tr><th>Pos.</th><th>Name</th><th>Formula</th><th>Qty</th><th>Unit</th><th>Conc.</th><th>CAS</th><th>Note</th><th style="width:80px;text-align:center">Actions</th></tr></thead><tbody>`;
            boxChems.forEach(ch => {
              const qty = parseFloat(ch.quantity) || 0;
              let qc = 'ok';
              if (qty <= 0) qc = 'low';
              else if (qty < 10) qc = 'medium';
              const pos = posMap[ch.id] || '—';
              const conc = ch.concentration !== null && ch.concentration !== undefined ? escHtml(ch.concentration + ' ' + (ch.concUnit || '')) : '—';
              const deleteBtnHtml = getCurrentRole() !== 'reader' ? `<button class="btn-inline danger" onclick="deleteChemical('${box.id}','${ch.id}')" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : '';
              html += `<tr class="fade-in" data-chemid="${ch.id}"><td><span class="chem-pos fridge">${escHtml(pos)}</span></td><td class="chem-name">${hl(ch.name || '', q)}</td><td class="chem-formula">${renderFormulaHtml(ch.formula)}</td><td><div class="qty-adjuster"><button class="btn-qty" onclick="event.stopPropagation();adjustQty('${box.id}','${ch.id}',-1)">−</button><span class="chem-quantity ${qc}">${escHtml(String(ch.quantity || 0))}</span><button class="btn-qty" onclick="event.stopPropagation();adjustQty('${box.id}','${ch.id}',1)">+</button></div></td><td>${escHtml(ch.unit || 'pcs')}</td><td style="white-space:nowrap">${conc}</td><td>${escHtml(ch.cas || '—')}</td><td>${escHtml(ch.note || '—')}</td><td><div class="row-actions"><button class="btn-inline" onclick="editChemical('${box.id}','${ch.id}')" title="Edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>${deleteBtnHtml}</div></td></tr>`;
            });
            html += `</tbody></table>`;
          } else {
            html += `<div class="shelf-empty">${q ? 'No results' : 'Empty box'}</div>`;
          }
          html += `</div>`;
        }
      });
    }
    
    // Direct chemicals (fallback if boxes empty or for flat shelf chemicals)
    if (chems.length > 0) {
      if (boxes.length > 0) {
        html += `<h4 style="margin: 0.75rem 0 0.5rem 0; color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;">Direct Shelf Chemicals</h4>`;
      }
      html+=`<table class="chemicals-table"><thead><tr><th>Pos.</th><th>Name</th><th>Formula</th><th>Qty</th><th>Unit</th><th>Conc.</th><th>CAS</th><th>Note</th><th style="width:80px;text-align:center">Actions</th></tr></thead><tbody>`;
      chems.forEach(ch=>{
        const qty=parseFloat(ch.quantity)||0;let qc='ok';if(qty <= 0)qc='low';else if(qty<10)qc='medium';
        const pos=posMap[ch.id]||'—';
        const conc=ch.concentration!==null&&ch.concentration!==undefined?escHtml(ch.concentration+' '+(ch.concUnit||'')):'—';
        const deleteBtnHtml = getCurrentRole() !== 'reader' ? `<button class="btn-inline danger" onclick="deleteChemical('${sh.id}','${ch.id}')" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : '';
        html+=`<tr class="fade-in" data-chemid="${ch.id}"><td><span class="chem-pos ${isFridgeOrFreezer?'fridge':''}">${escHtml(pos)}</span></td><td class="chem-name">${hl(ch.name||'',q)}</td><td class="chem-formula">${renderFormulaHtml(ch.formula)}</td><td><div class="qty-adjuster"><button class="btn-qty" onclick="event.stopPropagation();adjustQty('${sh.id}','${ch.id}',-1)">−</button><span class="chem-quantity ${qc}">${escHtml(String(ch.quantity||0))}</span><button class="btn-qty" onclick="event.stopPropagation();adjustQty('${sh.id}','${ch.id}',1)">+</button></div></td><td>${escHtml(ch.unit||'pcs')}</td><td style="white-space:nowrap">${conc}</td><td>${escHtml(ch.cas||'—')}</td><td>${escHtml(ch.note||'—')}</td><td><div class="row-actions"><button class="btn-inline" onclick="editChemical('${sh.id}','${ch.id}')" title="Edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>${deleteBtnHtml}</div></td></tr>`;
      });
      html+=`</tbody></table>`;
    } else if (boxes.length === 0) {
      html+=`<div class="shelf-empty">${q?'No results':'Empty shelf'}</div>`;
    }
    
    html+=`</div></div>`;
  });
  $('#shelves-container').innerHTML=html;
}
function toggleShelf(sid){if(openShelves.has(sid))openShelves.delete(sid);else openShelves.add(sid);renderDetail();}

// Autocomplete
// Autocomplete
function closeAutocomplete(){const ac=$('#autocomplete-list');if(ac)ac.classList.remove('open');}

window.viewExternalChemical = function(tempId) {
  const match = window.externalSearchRegistry ? window.externalSearchRegistry[tempId] : null;
  if (!match) return;
  
  closeAutocomplete();
  $('#search-input').value = '';
  
  db.ref('users').once('value', snap => {
    const users = snap.val();
    let contactInfo = 'No contact registered.';
    if (users) {
      Object.keys(users).forEach(uid => {
        const u = users[uid];
        if (u.groupId === match.gid && (u.role === 'admin' || u.role === 'superadmin')) {
          contactInfo = `<strong>${escHtml(u.name)}</strong> (<a href="mailto:${u.email}" style="color: var(--accent-blue);">${u.email}</a>)`;
        }
      });
    }
    
    const html = `
      <div style="margin-top: 1rem; line-height: 1.6;">
        <div style="background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.5rem;">
          <h3 style="margin-top: 0; color: var(--accent-green); font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
            <span>📍</span> Available in Laboratory: ${escHtml(match.groupName)}
          </h3>
          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0;">This chemical is available in a neighboring laboratory. You can request to borrow it by contacting them.</p>
        </div>
        
        <table style="width: 100%; font-size: 0.85rem; border-collapse: collapse;">
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 0.5rem 0; color: var(--text-muted); width: 100px;">Formula:</td><td style="padding: 0.5rem 0; font-weight: 500;">${renderFormulaHtml(match.chem.formula)}</td></tr>
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 0.5rem 0; color: var(--text-muted);">CAS No:</td><td style="padding: 0.5rem 0; font-weight: 500;">${escHtml(match.chem.cas || '—')}</td></tr>
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 0.5rem 0; color: var(--text-muted);">Quantity:</td><td style="padding: 0.5rem 0; font-weight: 600; color: var(--accent-blue);">${escHtml(match.chem.quantity || '0')} ${escHtml(match.chem.unit || 'pcs')}</td></tr>
        </table>
        
        <div style="margin-top: 1.5rem; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem;">
          <h4 style="margin-top: 0; color: var(--text-primary); font-size: 0.9rem;">📬 Contact Laboratory Admin:</h4>
          <p style="margin-bottom: 0; font-size: 0.85rem; color: var(--text-secondary);">${contactInfo}</p>
        </div>
      </div>
    `;
    
    openModal(`Borrow Chemical: ${escHtml(match.chem.name)}`, html, 'Close', () => closeModal());
  });
};

let currentSearchId = 0;
function buildAutocomplete(q){
  const ac=$('#autocomplete-list');if(!ac)return;
  currentSearchId++;
  const searchId = currentSearchId;
  
  if(!q){closeAutocomplete();return;}
  const ql=q.toLowerCase();
  const results=[];
  
  // 1. Search Chemicals
  (appData.rooms||[]).forEach(room=>{
    (room.containers||[]).forEach(cont=>{
      const posMap=computePositions(cont);
      (cont.shelves||[]).forEach(sh=>(sh.chemicals||[]).forEach(ch=>{
        if((ch.name||'').toLowerCase().includes(ql)||normalizeFormula(ch.formula||'').toLowerCase().includes(ql)||(ch.cas||'').toLowerCase().includes(ql)){
          results.push({
            type: 'chemical',
            name: ch.name || '',
            formula: ch.formula || '',
            roomId: room.id,
            contId: cont.id,
            chemId: ch.id,
            roomName: room.name,
            contName: cont.name,
            shelfName: sh.name,
            pos: posMap[ch.id]||'?'
          });
        }
      }));
    });
  });
  
  // 2. Search Protocols
  (appData.protocols||[]).forEach(p=>{
    if((p.title||'').toLowerCase().includes(ql)||(p.content||'').toLowerCase().includes(ql)){
      results.push({
        type: 'protocol',
        name: p.title || '',
        content: p.content || '',
        protId: p.id
      });
    }
  });

  // 3. Search Assets
  (appData.assets||[]).forEach(a=>{
    if((a.name||'').toLowerCase().includes(ql)||(a.model||'').toLowerCase().includes(ql)||(a.description||'').toLowerCase().includes(ql)){
      results.push({
        type: 'asset',
        name: a.name || '',
        model: a.model || '',
        description: a.description || '',
        assetId: a.id
      });
    }
  });

  // 4. Search Instruments
  (sharedInstruments || []).forEach(inst => {
    if ((inst.name || '').toLowerCase().includes(ql) || 
        (inst.description || '').toLowerCase().includes(ql) || 
        (inst.location || '').toLowerCase().includes(ql) || 
        (inst.ownerLabName || '').toLowerCase().includes(ql)) {
      results.push({
        type: 'instrument',
        name: inst.name || '',
        description: inst.description || '',
        location: inst.location || '',
        ownerLabName: inst.ownerLabName || '',
        instId: inst.id
      });
    }
  });

  // 5. Search Print Catalog Items
  (sharedPrintCatalog || []).forEach(item => {
    if ((item.name || '').toLowerCase().includes(ql) || 
        (item.description || '').toLowerCase().includes(ql) || 
        (item.category || '').toLowerCase().includes(ql) || 
        (item.material || '').toLowerCase().includes(ql)) {
      results.push({
        type: 'printCatalog',
        name: item.name || '',
        description: item.description || '',
        category: item.category || '',
        material: item.material || '',
        itemId: item.id
      });
    }
  });

  // 6. Search Print Requests
  (sharedPrintRequests || []).forEach(r => {
    if ((r.catalogItemName || '').toLowerCase().includes(ql) || 
        (r.note || '').toLowerCase().includes(ql) || 
        (r.requestedBy || '').toLowerCase().includes(ql) || 
        (r.requestedByLabName || '').toLowerCase().includes(ql)) {
      results.push({
        type: 'printRequest',
        name: r.catalogItemName || '',
        note: r.note || '',
        requestedBy: r.requestedBy || '',
        requestedByLabName: r.requestedByLabName || '',
        reqId: r.id
      });
    }
  });

  results.sort(compareChemicalNames);
  
  if(!results.length){ac.innerHTML=`<div class="autocomplete-no-result">No results for "${escHtml(q)}"</div>`;ac.classList.add('open');}
  else {
    ac.innerHTML=results.slice(0,12).map(r=>{
      if (r.type === 'chemical') {
        return `<div class="autocomplete-item" onclick="selectAutocomplete('${r.roomId}','${r.contId}','${r.chemId}')">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="autocomplete-item-name">${hl(r.name,q)}</span>
            <span class="autocomplete-item-pos">${escHtml(r.pos)}</span>
          </div>
          <span class="autocomplete-item-shelf">${escHtml(r.roomName)} › ${escHtml(r.contName)} › ${escHtml(r.shelfName)}</span>
        </div>`;
      } else if (r.type === 'protocol') {
        const preview = r.content.replace(/\n/g, ' ').substring(0, 60) + (r.content.length > 60 ? '...' : '');
        return `<div class="autocomplete-item" onclick="selectProtocolAutocomplete('${r.protId}')">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="autocomplete-item-name">${hl(r.name,q)}</span>
            <span class="autocomplete-item-pos protocol-badge">📖 Protocol</span>
          </div>
          <span class="autocomplete-item-shelf">${escHtml(preview)}</span>
        </div>`;
      } else if (r.type === 'asset') {
        const modelInfo = r.model ? `${r.model}` : 'Asset';
        const descPreview = r.description ? ` | ${r.description.substring(0, 50)}` : '';
        return `<div class="autocomplete-item" onclick="selectAssetAutocomplete('${r.assetId}')">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="autocomplete-item-name">${hl(r.name,q)}</span>
            <span class="autocomplete-item-pos asset-badge">📦 Asset</span>
          </div>
          <span class="autocomplete-item-shelf">${escHtml(modelInfo)}${escHtml(descPreview)}</span>
        </div>`;
      } else if (r.type === 'instrument') {
        const descPreview = r.description ? ` | ${r.description.substring(0, 50)}` : '';
        return `<div class="autocomplete-item" onclick="selectInstrumentAutocomplete('${r.instId}')">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="autocomplete-item-name">${hl(r.name,q)}</span>
            <span class="autocomplete-item-pos instrument-badge" style="background:rgba(124,58,237,0.15);color:var(--accent-purple,#c084fc);border-radius:4px;padding:0.15rem 0.4rem;font-size:0.65rem;font-weight:600">🔬 Instrument</span>
          </div>
          <span class="autocomplete-item-shelf">${escHtml(r.location)} (${escHtml(r.ownerLabName)})${escHtml(descPreview)}</span>
        </div>`;
      } else if (r.type === 'printCatalog') {
        const descPreview = r.description ? ` | ${r.description.substring(0, 50)}` : '';
        return `<div class="autocomplete-item" onclick="selectPrintCatalogAutocomplete('${r.itemId}')">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="autocomplete-item-name">${hl(r.name,q)}</span>
            <span class="autocomplete-item-pos print-badge category" style="background:rgba(14,165,233,0.15);color:var(--accent-blue);border-radius:4px;padding:0.15rem 0.4rem;font-size:0.65rem;font-weight:600">🖨️ 3D Catalog</span>
          </div>
          <span class="autocomplete-item-shelf">${escHtml(r.category)} | ${escHtml(r.material)}${escHtml(descPreview)}</span>
        </div>`;
      } else if (r.type === 'printRequest') {
        const descPreview = r.note ? ` | ${r.note.substring(0, 50)}` : '';
        return `<div class="autocomplete-item" onclick="selectPrintRequestAutocomplete('${r.reqId}')">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="autocomplete-item-name">${hl(r.name,q)}</span>
            <span class="autocomplete-item-pos print-badge time" style="background:rgba(245,158,11,0.15);color:var(--accent-amber);border-radius:4px;padding:0.15rem 0.4rem;font-size:0.65rem;font-weight:600">🖨️ 3D Request</span>
          </div>
          <span class="autocomplete-item-shelf">Od: ${escHtml(r.requestedBy)} (${escHtml(r.requestedByLabName)})${escHtml(descPreview)}</span>
        </div>`;
      }
    }).join('');
    ac.classList.add('open');
  }

  // Asynchronous Cross-Lab Querying
  if (q.length >= 2 && currentGroupId && db) {
    db.ref('groups').once('value', groupsSnap => {
      const groups = groupsSnap.val() || {};
      db.ref('inventories').once('value', invsSnap => {
        if (searchId !== currentSearchId) return; // Prevent old searches from overwriting new ones
        
        const allInvs = invsSnap.val();
        if (!allInvs) return;
        
        const externalMatches = [];
        Object.keys(allInvs).forEach(gid => {
          if (gid !== currentGroupId) {
            const inv = allInvs[gid];
            if (inv && inv.rooms) {
              inv.rooms.forEach(room => {
                if (room.containers) {
                  room.containers.forEach(cont => {
                    const posMap = computePositions(cont);
                    if (cont.shelves) {
                      cont.shelves.forEach(sh => {
                        if (sh.chemicals) {
                          sh.chemicals.forEach(ch => {
                            if ((ch.name || '').toLowerCase().includes(ql) || normalizeFormula(ch.formula || '').toLowerCase().includes(ql) || (ch.cas || '').toLowerCase().includes(ql)) {
                              externalMatches.push({
                                gid,
                                groupName: groups[gid]?.name || 'Neighboring Lab',
                                chem: ch
        })
        .catch(error => {
          console.error('[BioSCom Auth] Group lookup error:', error);
          showToast('Failed to load laboratory data. Check your connection.', 'error');
          currentGroupName = 'Unknown Lab';
        });
                            }
                          });
                        }
                      });
                    }
                  });
                }
              });
            }
          }
        });
        
        if (externalMatches.length > 0) {
          let appendHtml = '';
          if (results.length > 0) {
            appendHtml += `<div style="border-top: 1px solid var(--border-subtle); margin: 0.5rem 0; padding: 0.5rem 0.75rem 0.25rem; font-size: 0.65rem; color: var(--accent-green); text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">Available in neighboring labs</div>`;
          } else {
            const noRes = $('.autocomplete-no-result');
            if (noRes) noRes.remove();
          }
          
          if (!window.externalSearchRegistry) {
            window.externalSearchRegistry = {};
          }
          
          externalMatches.slice(0, 5).forEach(match => {
            const tempId = 'ext_' + genId();
            window.externalSearchRegistry[tempId] = match;
            
            appendHtml += `
              <div class="autocomplete-item" style="border-left: 3px solid var(--accent-green); background: rgba(34, 197, 94, 0.03);" onclick="window.viewExternalChemical('${tempId}')">
                <div style="display:flex;align-items:center;gap:0.5rem">
                  <span class="autocomplete-item-name">${hl(match.chem.name, q)}</span>
                  <span class="autocomplete-item-pos" style="background: rgba(34, 197, 94, 0.15); color: var(--accent-green); border-radius: 4px; padding: 0.1rem 0.4rem; font-size: 0.65rem; font-weight: 600;">📍 ${escHtml(match.groupName)}</span>
                </div>
                <span class="autocomplete-item-shelf">Available: ${escHtml(String(match.chem.quantity || '0'))} ${escHtml(match.chem.unit || 'pcs')}</span>
              </div>
            `;
          });
          
          ac.innerHTML += appendHtml;
        }
      });
    });
  }
}
function selectAssetAutocomplete(assetId){
  $('#search-input').value = '';
  searchQuery = '';
  closeAutocomplete();
  navigateTo('assets');
  setTimeout(() => {
    const cards = $$('.asset-card');
    cards.forEach(card => {
      if (card.innerHTML.includes(`editAsset('${assetId}')`)) {
        card.style.transition = 'all 0.5s ease';
        card.style.boxShadow = '0 0 0 3px var(--primary)';
        card.style.transform = 'scale(1.02)';
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          card.style.boxShadow = '';
          card.style.transform = '';
        }, 3000);
      }
    });
  }, 150);
}
function selectAutocomplete(roomId,contId,chemId){
  currentRoomId=roomId;
  currentContainerId=contId;
  const cont=getContainer(roomId,contId);
  if(cont){
    openShelves.clear();
    (cont.shelves||[]).forEach(sh=>{
      if((sh.chemicals||[]).find(c=>c.id===chemId)) {
        openShelves.add(sh.id);
        if (sh.parentShelfId) {
          openShelves.add(sh.parentShelfId);
        }
        if (cont.type === 'deepfreezer') {
          const { rack, box } = parseDeepFreezerShelf(sh);
          selectedDeepFreezerRack = rack;
          selectedDeepFreezerBox = box;
        }
      }
    });
  }
  $('#search-input').value = '';
  searchQuery = '';
  closeAutocomplete();
  const em = cont?.emoji ? `<span style="margin-right:0.5rem;">${escHtml(cont.emoji)}</span>` : '';
  safeSetHtml($('#detail-title'), em);
  $('#detail-title').appendChild(document.createTextNode(cont?.name||'Detail'));
  $('#detail-subtitle').textContent=(getRoom(roomId)?.name||'')+' → '+(cont?.name||'');
  $('#btn-add-shelf').style.display=(cont && canManageContainerContents(cont) && cont.type !== 'deepfreezer')?'inline-flex':'none';
  navigateTo('detail');
  setTimeout(()=>{
    const row=document.querySelector(`[data-chemid="${chemId}"]`);
    if(row) {
      row.scrollIntoView({behavior:'smooth',block:'center'});
      row.classList.add('highlight-row');
      setTimeout(()=>row.classList.remove('highlight-row'), 2000);
    }
  },100);
}
function selectProtocolAutocomplete(protId){
  $('#search-input').value = '';
  searchQuery = '';
  closeAutocomplete();
  navigateTo('protocols');
  setTimeout(()=>{
    editProtocol(protId);
  }, 100);
}
function selectInstrumentAutocomplete(instId) {
  $('#search-input').value = '';
  searchQuery = '';
  closeAutocomplete();
  navigateTo('instruments');
  setTimeout(() => {
    viewInstrument(instId);
  }, 150);
}
function selectPrintCatalogAutocomplete(itemId) {
  $('#search-input').value = '';
  searchQuery = '';
  closeAutocomplete();
  navigateTo('printing');
  setTimeout(() => {
    switchPrintTab('catalog');
    filterCatalogCategory('all');
    setTimeout(() => {
      const card = document.querySelector(`.print-catalog-card[data-catalog-id="${itemId}"]`);
      if (card) {
        card.style.transition = 'all 0.5s ease';
        card.style.boxShadow = '0 0 0 3px var(--primary)';
        card.style.transform = 'scale(1.02)';
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          card.style.boxShadow = '';
          card.style.transform = '';
        }, 3000);
      }
    }, 150);
  }, 150);
}
function selectPrintRequestAutocomplete(reqId) {
  $('#search-input').value = '';
  searchQuery = '';
  closeAutocomplete();
  navigateTo('printing');
  setTimeout(() => {
    switchPrintTab('requests');
    setTimeout(() => {
      const card = document.querySelector(`.print-request-card[data-request-id="${reqId}"]`);
      if (card) {
        card.style.transition = 'all 0.5s ease';
        card.style.boxShadow = '0 0 0 3px var(--primary)';
        card.style.transform = 'scale(1.01)';
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          card.style.boxShadow = '';
          card.style.transform = '';
        }, 3000);
      }
    }, 150);
  }, 150);
}
function adjustQty(shelfId, chemId, delta){
  const cont = getContainer(currentRoomId, currentContainerId);
  if(!cont) return;
  if (!canAdjustChemicalQuantity(cont)) { showToast('Access Denied', 'error'); return; }
  const shelf = cont.shelves.find(s=>s.id === shelfId);
  if(!shelf) return;
  const chem = shelf.chemicals.find(c=>c.id === chemId);
  if(!chem) return;
  
  let newQty = (parseFloat(chem.quantity) || 0) + delta;
  if(newQty < 0) newQty = 0;
  
  // Format to avoid floating point inaccuracies (e.g. 0.1 + 0.2 = 0.30000000000000004)
  chem.quantity = parseFloat(newQty.toFixed(3));
  
  console.warn('[adjustQty] Changed', chem.name, 'to', chem.quantity, 'in container', cont.id, 'owner', cont.ownerGroupId, 'current', currentGroupId);
  saveData(appData);
  renderDetail();
  logHistory(`Updated quantity of chemical "${chem.name}" to ${chem.quantity} ${chem.unit}`, cont.ownerGroupId);
  showToast(`Quantity of ${chem.name} updated to ${chem.quantity} ${chem.unit}`);
}

// Search input
$('#search-input').addEventListener('input',e=>{searchQuery=e.target.value.trim();buildAutocomplete(searchQuery);if(currentContainerId)renderDetail();});
$('#search-input').addEventListener('focus',e=>{if(searchQuery)buildAutocomplete(searchQuery);});
document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))closeAutocomplete();});

// CRUD Rooms
function addRoom(){
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  openModal('Add Room',`<div class="form-group"><label class="form-label">Room name *</label><input class="form-input" id="f-rn" placeholder="e.g. A301"></div><div class="form-group"><label class="form-label">Description</label><input class="form-input" id="f-rd" placeholder="e.g. Organic chemistry"></div>`,'Add',()=>{
    const n=$('#f-rn').value.trim();
    if(!n || n.length > 50){showToast('Room name is required (max 50 chars)','error');return;}
    const desc = $('#f-rd').value.trim();
    if (countWords(n) > 300 || countWords(desc) > 300) {
      showToast('Text exceeds the 300-word limit!', 'error');
      return;
    }
    if (!appData.rooms) appData.rooms = [];
    appData.rooms.push({id:genId(),name:n,description:desc,containers:[]});saveData(appData);closeModal();renderRooms();logHistory(`Added room "${n}"`);showToast('Room "'+n+'" added');
  });
}
function editRoom(){
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  const r=getRoom(currentRoomId);if(!r)return;
  openModal('Edit Room',`<div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="f-rn" value="${escHtml(r.name)}"></div><div class="form-group"><label class="form-label">Description</label><input class="form-input" id="f-rd" value="${escHtml(r.description||'')}"></div>`,'Save',()=>{
    const n=$('#f-rn').value.trim();
    if(!n){showToast('Enter name','error');return;}
    const desc = $('#f-rd').value.trim();
    if (countWords(n) > 300 || countWords(desc) > 300) {
      showToast('Text exceeds the 300-word limit!', 'error');
      return;
    }
    const oldName=r.name;
    r.name=n;
    r.description=desc;
    saveData(appData);
    closeModal();
    logHistory(`Edited room "${oldName}"`);
    $('#containers-title').textContent='Room: '+r.name;
    updateBreadcrumb('containers');
    showToast('Saved');
  });
}
function deleteRoom(){
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  const r=getRoom(currentRoomId);if(!r)return;openModal('Delete Room',`<p>Delete <strong>${escHtml(r.name)}</strong> and all its contents?</p>`,'Delete',()=>{
    verifyCaptchaAndExecute(() => {
      appData.rooms=appData.rooms.filter(x=>x.id!==currentRoomId);saveData(appData);closeModal();navigateTo('rooms');logHistory(`Deleted room "${r.name}"`);showToast('Deleted');
    });
  });
}

// CRUD Containers
// CRUD Containers
window.createCustomRangeRow = function(type) {
  const container = $('#c-custom-ranges-container');
  if (!container) return;
  
  const rowId = 'range-row-' + Math.random().toString(36).substr(2, 9);
  let inputsHtml = '';
  
  if (type === 'alphabetical') {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const startOpts = alphabet.map(l => `<option value="${l}">${l}</option>`).join('');
    const endOpts = alphabet.map(l => `<option value="${l}">${l}</option>`).join('');
    inputsHtml = `
      <select class="form-select range-start" style="width: 75px; cursor: pointer; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 0.25rem;">${startOpts}</select>
      <span style="color: var(--text-muted); align-self: center; font-size: 0.85rem;">to</span>
      <select class="form-select range-end" style="width: 75px; cursor: pointer; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 0.25rem;">${endOpts}</select>
    `;
  } else {
    inputsHtml = `
      <input type="number" class="form-input range-start" min="1" max="999" value="1" style="width: 80px; padding: 0.25rem; font-size: 0.85rem;">
      <span style="color: var(--text-muted); align-self: center; font-size: 0.85rem;">to</span>
      <input type="number" class="form-input range-end" min="1" max="999" value="3" style="width: 80px; padding: 0.25rem; font-size: 0.85rem;">
    `;
  }
  
  const row = document.createElement('div');
  row.id = rowId;
  row.className = 'custom-range-row';
  row.style = 'display: flex; gap: 0.5rem; align-items: center; background: rgba(255,255,255,0.02); padding: 0.4rem; border-radius: 4px; border: 1px solid var(--border-subtle); margin-top: 0.25rem;';
  row.innerHTML = `
    ${inputsHtml}
    <button type="button" class="btn" onclick="this.parentElement.remove()" style="padding: 0.25rem 0.5rem; display: inline-flex; align-items: center; background: rgba(239,68,68,0.15); color: var(--accent-red); border: none; font-size: 0.8rem; margin-left: auto; border-radius: 4px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.15)'">
      🗑️
    </button>
  `;
  container.appendChild(row);
  
  // Smart next range generator
  const rows = container.querySelectorAll('.custom-range-row');
  if (rows.length > 1) {
    const lastRow = rows[rows.length - 2];
    const lastEnd = lastRow.querySelector('.range-end').value;
    const currentStart = row.querySelector('.range-start');
    const currentEnd = row.querySelector('.range-end');
    if (type === 'alphabetical') {
      const nextCode = lastEnd.charCodeAt(0) + 1;
      if (nextCode <= 90) {
        const nextL = String.fromCharCode(nextCode);
        currentStart.value = nextL;
        currentEnd.value = nextL;
      }
    } else {
      const nextNum = parseInt(lastEnd, 10) + 1;
      currentStart.value = nextNum;
      currentEnd.value = nextNum + 2;
    }
  }
};

function addAssetContainer(type) {
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  const typeLabel = type === 'cabinet' ? 'Cabinet' : (type === 'fridge' ? 'Fridge' : 'Freezer');
  getSharedGroupsOptionsHtml(currentGroupId).then(sharedOptions => {
    let cabinetOptionsHtml = '';
    if (type === 'cabinet') {
      cabinetOptionsHtml = `
        <div class="form-group">
          <label class="form-label">Cabinet Shelf Naming System *</label>
          <select class="form-select" id="c-system" style="cursor: pointer;">
            <option value="numerical">Numerical shelves</option>
            <option value="alphabetical">Alphabetical shelves (A, B, C...)</option>
            <option value="custom">Custom shelves & ranges</option>
          </select>
        </div>
        <div id="c-params-numerical" class="c-param-group">
          <div class="form-group">
            <label class="form-label">Number of Shelves *</label>
            <input class="form-input" id="c-count-num" type="number" min="1" max="25" value="4">
          </div>
        </div>
        <div id="c-params-alphabetical" class="c-param-group" style="display: none;">
          <div class="form-group">
            <label class="form-label">Number of Shelves (A, B, C...) *</label>
            <input class="form-input" id="c-count-alpha" type="number" min="1" max="25" value="4">
          </div>
        </div>
        <div id="c-params-custom" class="c-param-group" style="display: none;">
          <div class="form-group">
            <label class="form-label">Custom Shelf Range Type</label>
            <select class="form-select" id="c-custom-prefix" style="cursor: pointer;">
              <option value="alphabetical">Letters (A-Z)</option>
              <option value="numerical">Numbers (1-99)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" style="font-weight: 600; margin-bottom: 0.25rem;">Define Custom Ranges</label>
            <div id="c-custom-ranges-container" style="display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; background: rgba(0,0,0,0.15); padding: 0.5rem; border-radius: 6px; border: 1px solid var(--border-subtle); max-height: 200px; overflow-y: auto;">
              <!-- Dynamic rows added here -->
            </div>
            <button type="button" class="btn btn-secondary" id="btn-add-custom-range" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem; border-radius: 4px; cursor: pointer;">
              ➕ Add Range
            </button>
          </div>
          <div class="form-group" style="margin-top: 0.75rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none;">
              <input type="checkbox" id="c-custom-add-extra" style="cursor: pointer; width: 15px; height: 15px;">
              <span style="font-size: 0.85rem; color: var(--text-secondary);">Add extra custom-named shelves</span>
            </label>
          </div>
          <div class="form-group" id="c-custom-extra-wrap" style="display: none; margin-top: 0.5rem;">
            <label class="form-label">Extra Custom Shelf Names (One per line)</label>
            <textarea class="form-textarea" id="c-custom-extra-names" placeholder="e.g. Bottom shelf&#10;Special space" style="height: 60px;"></textarea>
          </div>
        </div>
      `;
    } else {
      cabinetOptionsHtml = `
        ${type === 'fridge' ? `
        <div class="form-group">
          <label class="form-label">Number of Shelves *</label>
          <input class="form-input" id="c-count" type="number" min="1" max="25" value="4">
        </div>
        <div class="form-group">
          <label class="form-label">Number of Door Shelves</label>
          <input class="form-input" id="c-door-count" type="number" min="0" max="10" value="2">
        </div>
        ` : ''}
        ${type === 'freezer' ? `
        <div class="form-group">
          <label class="form-label">Freezer Type</label>
          <select class="form-select" id="c-freezer-type" style="cursor: pointer;">
            <option value="standard">Standard Freezer</option>
            <option value="deepfreezer">Deep Freezer (-80°C)</option>
          </select>
        </div>
        <div id="c-freezer-standard-params">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Number of Shelves *</label>
              <input class="form-input" id="c-count" type="number" min="1" max="25" value="4">
            </div>
          </div>
        </div>
        <div id="c-freezer-deep-params" style="display: none;">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Number of Racks</label>
              <input class="form-input" id="c-rack-count" type="number" min="1" max="50" value="4">
            </div>
            <div class="form-group">
              <label class="form-label">Boxes per Rack</label>
              <input class="form-input" id="c-box-count" type="number" min="1" max="50" value="5">
            </div>
          </div>
        </div>
        ` : ''}
        ${type !== 'freezer' && type !== 'fridge' && type !== 'cabinet' ? `
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Number of Shelves *</label>
            <input class="form-input" id="c-count" type="number" min="1" max="25" value="4">
          </div>
        </div>
        ` : ''}
      `;
    }

    const html = `
      <div class="form-group">
        <label class="form-label">Name *</label>
        <input class="form-input" id="c-name" placeholder="e.g. ${typeLabel} 1">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input class="form-input" id="c-desc" placeholder="e.g. Acid storage or DNA samples">
      </div>
      <div class="form-group">
        <label class="form-label">Emoji Icon (optional)</label>
        <input class="form-input" id="c-emoji" placeholder="e.g. 🧪 or 🥶">
      </div>
      ${cabinetOptionsHtml}
      <div class="form-group" style="margin-top: 1rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem;">
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none;">
          <input type="checkbox" id="c-is-shared" style="cursor: pointer; width: 16px; height: 16px;">
          <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-primary);">Share this container with other laboratories</span>
        </label>
      </div>
      <div class="form-group" id="c-share-wrap" style="display: none; margin-top: 0.5rem;">
        <label class="form-label" style="font-weight: 600; margin-bottom: 0.5rem;">Select Laboratories to Share With</label>
        <div id="c-shared-groups-list" style="background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.5rem; max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem;">
          ${sharedOptions}
        </div>
      </div>
    `;
    
    openModal(`Add ${typeLabel}`, html, 'Add', () => {
      const name = $('#c-name').value.trim();
      if (!name || name.length > 50) { showToast('Container name is required (max 50 chars)', 'error'); return; }
      const allowedTypes = ['cabinet', 'fridge', 'freezer'];
      if (!allowedTypes.includes(type)) { showToast('Invalid container type', 'error'); return; }
      
      const desc = $('#c-desc').value.trim();
      const emoji = $('#c-emoji').value.trim();
      
      if (countWords(name) > 300 || countWords(desc) > 300 || countWords(emoji) > 300) {
        showToast('Name or description exceeds 300 words!', 'error');
        return;
      }
      const isShared = $('#c-is-shared').checked;
      const checkedGroups = isShared ? Array.from(document.querySelectorAll('input[name="c-shared-group-item"]:checked')).map(el => el.value) : [];
      
      const room = getRoom(currentRoomId);
      if (!room.containers) room.containers = [];
      
      const shelves = [];
      let cabinetMethod = 'numerical';
      let customRangeType = 'numerical';
      
      if (type === 'cabinet') {
        cabinetMethod = $('#c-system').value;
        if (cabinetMethod === 'numerical') {
          const count = parseInt($('#c-count-num').value) || 4;
          for (let i = 0; i < count; i++) {
            shelves.push({ id: genId(), name: 'Shelf ' + (i + 1), chemicals: [] });
          }
        } else if (cabinetMethod === 'alphabetical') {
          const count = parseInt($('#c-count-alpha').value) || 4;
          for (let i = 0; i < count; i++) {
            shelves.push({ id: genId(), name: 'Shelf ' + String.fromCharCode(65 + i), chemicals: [] });
          }
        } else if (cabinetMethod === 'custom') {
          customRangeType = $('#c-custom-prefix').value;
          const rows = Array.from(document.querySelectorAll('.custom-range-row'));
          rows.forEach((row, idx) => {
            const startVal = row.querySelector('.range-start').value;
            const endVal = row.querySelector('.range-end').value;
            const shelfName = 'Shelf ' + startVal + '–' + endVal;
            shelves.push({ 
              id: genId(), 
              name: shelfName, 
              chemicals: [],
              isRangeShelf: true,
              rangeStart: startVal,
              rangeEnd: endVal
            });
          });
          
          if ($('#c-custom-add-extra').checked) {
            const extraLines = $('#c-custom-extra-names').value.split('\n').map(l => l.trim()).filter(l => l !== '');
            extraLines.forEach(line => {
              shelves.push({ id: genId(), name: line, chemicals: [] });
            });
          }
        }
      } else {
        const actualType = (type === 'freezer' && $('#c-freezer-type') && $('#c-freezer-type').value === 'deepfreezer') ? 'deepfreezer' : type;
        
        if (actualType === 'deepfreezer') {
          const rackCount = parseInt($('#c-rack-count').value) || 4;
          const boxCount = parseInt($('#c-box-count').value) || 5;
          for (let r = 1; r <= rackCount; r++) {
            for (let b = 1; b <= boxCount; b++) {
              shelves.push({ id: genId(), name: `Rack ${r} / Box ${b}`, chemicals: [] });
            }
          }
        } else {
          const count = parseInt($('#c-count').value) || 4;
          for (let i = 0; i < count; i++) {
            shelves.push({ id: genId(), name: 'Shelf ' + (i + 1), chemicals: [] });
          }
          if (actualType === 'fridge') {
            const doorCount = parseInt($('#c-door-count').value) || 0;
            for (let i = 1; i <= doorCount; i++) {
              shelves.push({ id: genId(), name: 'Door shelf ' + i, chemicals: [] });
            }
          }
        }
      }
      
      const saveContainer = (ownerGroupName) => {
        const finalType = (type === 'freezer' && $('#c-freezer-type') && $('#c-freezer-type').value === 'deepfreezer') ? 'deepfreezer' : type;
        const containerData = {
          id: genId(),
          name,
          description: desc,
          type: finalType,
          shelves,
          ownerGroupId: currentGroupId || 'local',
          ownerGroupName: ownerGroupName,
          cabinetMethod,
          customRangeType,
          emoji: emoji
        };
        
        if (checkedGroups.length > 0) {
          containerData.sharedWithGroupIds = checkedGroups;
          containerData.sharedWithGroupId = checkedGroups[0]; // backwards compatible
        }
        
        room.containers.push(containerData);
        saveData(appData);
        closeModal();
        renderContainers();
        logHistory(`Added ${finalType === 'deepfreezer' ? 'deep freezer' : finalType.toLowerCase()} "${name}" to room "${room.name}"`);
        showToast(`${typeLabel} "${name}" added successfully`);
      };
      
      if (typeof db !== 'undefined' && db && currentGroupId) {
        db.ref(`groups/${currentGroupId}/name`).once('value', nameSnap => {
          saveContainer(nameSnap.val() || 'Owner Lab');
        }).catch(err => {
          console.error(err);
          saveContainer('Owner Lab');
        });
      } else {
        saveContainer('Local Lab');
      }
    });
    
    // Wire parameter changes and checkboxes
    setTimeout(() => {
      const initRanges = () => {
        const container = $('#c-custom-ranges-container');
        if (container) {
          container.innerHTML = '';
          const prefixType = $('#c-custom-prefix').value;
          createCustomRangeRow(prefixType);
        }
      };

      const sysSelect = $('#c-system');
      if (sysSelect) {
        sysSelect.addEventListener('change', e => {
          const val = e.target.value;
          $('#c-params-numerical').style.display = val === 'numerical' ? 'block' : 'none';
          $('#c-params-alphabetical').style.display = val === 'alphabetical' ? 'block' : 'none';
          $('#c-params-custom').style.display = val === 'custom' ? 'block' : 'none';
          if (val === 'custom') initRanges();
        });
      }

      const freezerSelect = $('#c-freezer-type');
      if (freezerSelect) {
        freezerSelect.addEventListener('change', e => {
          if ($('#c-freezer-standard-params')) $('#c-freezer-standard-params').style.display = e.target.value === 'standard' ? 'block' : 'none';
          if ($('#c-freezer-deep-params')) $('#c-freezer-deep-params').style.display = e.target.value === 'deepfreezer' ? 'block' : 'none';
        });
      }

      const prefixSelect = $('#c-custom-prefix');
      if (prefixSelect) {
        prefixSelect.addEventListener('change', e => {
          initRanges();
        });
      }

      const btnAddRange = $('#btn-add-custom-range');
      if (btnAddRange) {
        btnAddRange.addEventListener('click', () => {
          const prefixType = $('#c-custom-prefix').value;
          createCustomRangeRow(prefixType);
        });
      }

      const chkExtra = $('#c-custom-add-extra');
      if (chkExtra) {
        chkExtra.addEventListener('change', e => {
          $('#c-custom-extra-wrap').style.display = e.target.checked ? 'block' : 'none';
        });
      }

      const chkShared = $('#c-is-shared');
      if (chkShared) {
        chkShared.addEventListener('change', e => {
          $('#c-share-wrap').style.display = e.target.checked ? 'block' : 'none';
        });
      }
    }, 100);
  });
}

function editContainer(){
  const c = getContainer(currentRoomId, currentContainerId); if (!c) return;
  if (!canDeleteContainer(c)) {
    showToast('Cannot edit sharing settings of a container shared by another laboratory', 'error');
    return;
  }
  
  const typeLabel = c.type === 'cabinet' ? 'Cabinet' : (c.type === 'fridge' ? 'Fridge' : (c.type === 'deepfreezer' ? 'Deep Freezer' : 'Freezer'));
  const currentCheckedGroups = c.sharedWithGroupIds || (c.sharedWithGroupId ? [c.sharedWithGroupId] : []);
  const isShared = currentCheckedGroups.length > 0;
  
  getSharedGroupsOptionsHtml(currentGroupId, currentCheckedGroups).then(sharedOptions => {
    const html = `
      <div class="form-group">
        <label class="form-label">Name *</label>
        <input class="form-input" id="c-name" value="${escHtml(c.name)}">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input class="form-input" id="c-desc" value="${escHtml(c.description || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Emoji Icon (optional)</label>
        <input class="form-input" id="c-emoji" value="${escHtml(c.emoji || '')}" placeholder="e.g. 🧪 or 🥶">
      </div>
      <div class="form-group" style="margin-top: 1rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem;">
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none;">
          <input type="checkbox" id="c-is-shared" ${isShared ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px;">
          <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-primary);">Share this container with other laboratories</span>
        </label>
      </div>
      <div class="form-group" id="c-share-wrap" style="display: ${isShared ? 'block' : 'none'}; margin-top: 0.5rem;">
        <label class="form-label" style="font-weight:600;margin-bottom:0.5rem;">Select Laboratories to Share With</label>
        <div id="c-shared-groups-list" style="background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.5rem; max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem;">
          ${sharedOptions}
        </div>
      </div>
    `;
    
    openModal(`Edit ${typeLabel}`, html, 'Save', () => {
      const name = $('#c-name').value.trim();
      if (!name) { showToast('Enter name', 'error'); return; }
      
      const desc = $('#c-desc').value.trim();
      const emoji = $('#c-emoji').value.trim();
      
      if (countWords(name) > 300 || countWords(desc) > 300 || countWords(emoji) > 300) {
        showToast('Name or description exceeds 300 words!', 'error');
        return;
      }
      
      c.name = name;
      c.description = desc;
      c.emoji = emoji;
      
      const shareChecked = $('#c-is-shared').checked;
      if (shareChecked) {
        const checkedItems = Array.from(document.querySelectorAll('input[name="c-shared-group-item"]:checked')).map(el => el.value);
        c.sharedWithGroupIds = checkedItems;
        if (checkedItems.length > 0) {
          c.sharedWithGroupId = checkedItems[0];
        } else {
          delete c.sharedWithGroupId;
        }
        c.ownerGroupId = currentGroupId;
      } else {
        delete c.sharedWithGroupId;
        delete c.sharedWithGroupIds;
      }
      
      saveData(appData);
      closeModal();
      logHistory(`Edited container "${c.name}"`);
      const em = c.emoji ? `<span style="margin-right:0.5rem;">${escHtml(c.emoji)}</span>` : '';
      safeSetHtml($('#detail-title'), em);
      $('#detail-title').appendChild(document.createTextNode(c.name));
      $('#detail-subtitle').textContent = (getRoom(currentRoomId) || {}).name + ' → ' + c.name;
      updateBreadcrumb('detail');
      showToast('Saved successfully');
    });
    
    const chk = $('#c-is-shared');
    if (chk) {
      chk.addEventListener('change', e => {
        $('#c-share-wrap').style.display = e.target.checked ? 'block' : 'none';
      });
    }
  });
}

function deleteContainer(){
  const c=getContainer(currentRoomId,currentContainerId);if(!c)return;
  if (!canDeleteContainer(c)) {
    showToast('Cannot delete a container shared by another laboratory', 'error');
    return;
  }
  openModal('Delete',`<p>Delete <strong>${escHtml(c.name)}</strong> and all contents?</p>`,'Delete',()=>{
    verifyCaptchaAndExecute(() => {
      const room=getRoom(currentRoomId);room.containers=room.containers.filter(x=>x.id!==currentContainerId);saveData(appData);closeModal();navigateTo('containers');logHistory(`Deleted container "${c.name}"`);showToast('Deleted');
    });
  });
}

// Naming helpers & shelf position logic
function getFirstLetter(name) {
  if (!name) return 'X';
  const m = name.trim().match(/[\p{L}]/u);
  return m ? m[0].toUpperCase() : 'X';
}

function findRangeShelf(cont, chemName) {
  if (!cont.shelves || cont.shelves.length === 0) return null;
  const L = getFirstLetter(chemName);
  
  // First try range shelves with explicit start/end metadata
  const metaMatch = cont.shelves.find(s => {
    if (s.isRangeShelf && s.rangeStart && s.rangeEnd) {
      const start = s.rangeStart.toUpperCase();
      const end = s.rangeEnd.toUpperCase();
      if (L.localeCompare(start, 'cs') >= 0 && L.localeCompare(end, 'cs') <= 0) return true;
      return L >= start && L <= end;
    }
    return false;
  });
  if (metaMatch) return metaMatch;
  
  // Then try parsing range from shelf name (e.g. "Shelf A–D" or "A-D")
  const nameMatch = cont.shelves.find(s => {
    const rMatch = s.name.match(/(?:Shelf\s+)?([\p{L}])\s*(?:-|–)\s*([\p{L}])/iu);
    if (rMatch) {
      const start = rMatch[1].toUpperCase();
      const end = rMatch[2].toUpperCase();
      // Special logic for Czech/Slovak letters to sort mostly correctly (L >= start && L <= end usually works)
      if (L.localeCompare(start, 'cs') >= 0 && L.localeCompare(end, 'cs') <= 0) return true;
      if (L >= start && L <= end) return true;
    }
    return false;
  });
  if (nameMatch) return nameMatch;
  
  // Also try numerical range shelves (e.g. "Shelf 1–5") matching by first letter
  const numMatch = cont.shelves.find(s => {
    const rMatch = s.name.match(/Shelf\s+(\d+)(?:-|–)(\d+)/i);
    if (rMatch && s.isRangeShelf && s.rangeStart && s.rangeEnd) {
      // For numerical ranges, check if letter falls in the alphabetical equivalent
      const start = s.rangeStart.toUpperCase();
      const end = s.rangeEnd.toUpperCase();
      return L >= start && L <= end;
    }
    return false;
  });
  if (numMatch) return numMatch;
  
  // Fallback: last shelf (bottom) rather than first
  return cont.shelves[cont.shelves.length - 1];
}

function getOrCreatePosition(cont, chemId, chemName, shelf, chemObj) {
  if (chemObj && chemObj.position) {
    return chemObj.position;
  }
  
  if (cont.type === 'cabinet') {
    const isAlphabetical = cont.cabinetMethod === 'alphabetical' || (cont.cabinetMethod === 'custom' && cont.customRangeType === 'alphabetical');
    if (isAlphabetical) {
      let shelfLetter = 'A';
      const rangeMatch = shelf.name.match(/Shelf\s+([A-Za-z])(?:-|–)/i);
      if (rangeMatch) {
        shelfLetter = rangeMatch[1].toUpperCase();
      } else {
        const match = shelf.name.match(/Shelf\s+([A-Za-z])/i);
        if (match) {
          shelfLetter = match[1].toUpperCase();
        } else {
          shelfLetter = getFirstLetter(shelf.name);
        }
      }
      
      const L = getFirstLetter(chemName);
      const prefix = shelfLetter + L;
      
      let num = 1;
      const existingPositions = new Set();
      (cont.shelves || []).forEach(sh => {
        (sh.chemicals || []).forEach(ch => {
          if (ch.position) existingPositions.add(ch.position);
        });
      });
      while (existingPositions.has(prefix + num)) {
        num++;
      }
      return prefix + num;
    } else {
      let shelfNum = '1';
      const rangeMatch = shelf.name.match(/Shelf\s+(\d+)(?:-|–)/i);
      if (rangeMatch) {
        shelfNum = rangeMatch[1];
      } else {
        const match = shelf.name.match(/Shelf\s+(\d+)/i);
        if (match) {
          shelfNum = match[1];
        } else {
          const idx = cont.shelves.indexOf(shelf) + 1;
          shelfNum = String(idx);
        }
      }
      const L = getFirstLetter(chemName);
      return L + shelfNum;
    }
  } else if (cont.type === 'deepfreezer' || cont.type === 'freezer' || cont.type === 'fridge') {
    return generateSequentialBoxPosition(shelf);
  } else {
    return generateNextPositionCode(cont, chemName);
  }
}

// Shelves management
function addShelfToFridge(){
  const cont=getContainer(currentRoomId,currentContainerId);if(!cont)return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  if (cont.type === 'deepfreezer') { showToast('Access Denied', 'error'); return; }
  
  let html = '';
  if (cont.type === 'fridge') {
    html = `
      <div class="form-group">
        <label class="form-label">Type</label>
        <select class="form-select" id="f-st">
          <option value="shelf">Shelf</option>
          <option value="door">Door shelf</option>
          <option value="drawer">Drawer</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Number / Name suffix *</label>
        <input class="form-input" id="f-sn" type="text" value="1">
      </div>
    `;
  } else if (cont.type === 'freezer' || cont.type === 'deepfreezer') {
    html = `
      <div class="form-group">
        <label class="form-label">Custom Place Name *</label>
        <input class="form-input" id="f-sn" type="text" placeholder="e.g. Drawers A or Top Drawer" value="">
      </div>
    `;
  } else {
    const nextNum = (cont.shelves || []).length + 1;
    html = `
      <div class="form-group">
        <label class="form-label">Shelf Name *</label>
        <input class="form-input" id="f-sn" type="text" value="Shelf ${nextNum}">
      </div>
    `;
  }

  openModal('Add Shelf / Place', html, 'Add', () => {
    let name = '';
    if (cont.type === 'fridge') {
      const type = $('#f-st').value;
      const val = $('#f-sn').value.trim();
      if (!val) { showToast('Enter number/suffix', 'error'); return; }
      if (type === 'door') {
        name = 'Door shelf ' + val;
      } else if (type === 'drawer') {
        name = 'Drawer ' + val;
      } else {
        name = 'Shelf ' + val;
      }
    } else {
      name = $('#f-sn').value.trim();
    }
    
    if (!name) { showToast('Enter name', 'error'); return; }
    
    if (!cont.shelves) cont.shelves = [];
    cont.shelves.push({ id: genId(), name: name, chemicals: [] });
    saveData(appData);
    closeModal();
    renderDetail();
    logHistory(`Added shelf/place "${name}" to container "${cont.name}"`, cont.ownerGroupId);
    showToast(name + ' added');
  });
}

function deleteShelf(sid){
  const cont=getContainer(currentRoomId,currentContainerId);if(!cont)return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  const sh=cont.shelves.find(s=>s.id===sid);if(!sh)return;
  const isDF = cont.type === 'deepfreezer';
  const typeLabel = isDF ? 'Box' : 'Shelf';
  openModal(`Delete ${typeLabel}`,`<p>Delete <strong>${escHtml(sh.name)}</strong>?</p>`,'Delete',()=>{
    verifyCaptchaAndExecute(() => {
      cont.shelves=cont.shelves.filter(s=>s.id!==sid);
      if (isDF) {
        selectedDeepFreezerBox = null;
      }
      saveData(appData);closeModal();renderDetail();logHistory(`Deleted ${typeLabel.toLowerCase()} "${sh.name}" from container "${cont.name}"`, cont.ownerGroupId);showToast('Deleted');
    });
  });
}

// CRUD Chemicals
function chemFormHTML(chem={},cont=null){
  const units=['pcs','g','kg','ml','L','μL','mg'];
  const uOpts=units.map(u=>`<option value="${u}" ${chem.unit===u?'selected':''}>${u}</option>`).join('');
  const concUnits=['','mol/L','mmol/L','mol','mmol','%','g/L','mg/L','μg/L'];
  const cuOpts=concUnits.map(u=>`<option value="${u}" ${chem.concUnit===u?'selected':''}>${u}</option>`).join('');
  let shelfSel='';
  
  if(cont&&(cont.type==='fridge' || cont.type==='freezer' || cont.type==='deepfreezer')){
    let sOpts = '';
    if (cont.type === 'deepfreezer') {
      sOpts = (cont.shelves||[]).map(s=>`<option value="${s.id}" ${chem._shelfId===s.id?'selected':''}>${escHtml(s.name)}</option>`).join('');
    } else {
      const parentShelves = (cont.shelves || []).filter(s => !s.parentShelfId);
      sOpts = parentShelves.map(ps => {
        const boxes = (cont.shelves || []).filter(s => s.parentShelfId === ps.id);
        if (boxes.length > 0) {
          return `<optgroup label="${escHtml(ps.name)}">` + 
            `<option value="${ps.id}" ${chem._shelfId===ps.id?'selected':''}>Directly on ${escHtml(ps.name)} (no box)</option>` +
            boxes.map(box => `<option value="${box.id}" ${chem._shelfId===box.id?'selected':''}>📦 ${escHtml(box.name)}</option>`).join('') +
            `</optgroup>`;
        } else {
          return `<option value="${ps.id}" ${chem._shelfId===ps.id?'selected':''}>${escHtml(ps.name)}</option>`;
        }
      }).join('');
    }
    const labelText = cont.type === 'deepfreezer' ? 'Box *' : 'Shelf / Box *';
    shelfSel=`<div class="form-group"><label class="form-label">${labelText}</label><select class="form-select" id="f-shelf">${sOpts}</select></div>`;
  }
  
  if(cont&&cont.type==='cabinet'){
    const ov=chem._shelfOverride||'auto';
    const isAlphabetical = cont.cabinetMethod === 'alphabetical' || (cont.cabinetMethod === 'custom' && cont.customRangeType === 'alphabetical');
    const hasRangeShelves = (cont.shelves||[]).some(s => s.isRangeShelf);
    const canAuto = isAlphabetical || hasRangeShelves;
    
    let options = '';
    if (canAuto) {
      options += `<option value="auto" ${ov==='auto'?'selected':''}>Auto – alphabetically by first letter</option>`;
    }
    
    (cont.shelves||[]).forEach(s => {
      options += `<option value="${s.id}" ${ov===s.id?'selected':''}>Manual: ${escHtml(s.name)}</option>`;
    });
    
    shelfSel=`
      <div class="form-group">
        <label class="form-label">Shelf placement *</label>
        <select class="form-select" id="f-cab-shelf" style="cursor: pointer;">
          ${options}
        </select>
        <div class="form-hint">${canAuto ? 'Auto places the chemical alphabetically in the shelf matching its first letter. Manual options let you select the shelf explicitly.' : 'Select the shelf explicitly for the chemical.'}</div>
      </div>
    `;
  }
  
  const formulaVal = normalizeFormula(chem.formula || '');
  const formulaPreview = formulaVal ? renderFormulaHtml(formulaVal) : '';
  
  return`${shelfSel}<div class="form-group"><label class="form-label">Chemical name *</label><input class="form-input" id="f-cn2" placeholder="e.g. Hydrochloric acid" value="${escHtml(chem.name||'')}"></div><div class="form-group"><label class="form-label">Formula</label><input class="form-input" id="f-cf" placeholder="e.g. H2SO4, Na2CO3" value="${escHtml(formulaVal)}" oninput="document.getElementById('f-cf-preview').innerHTML=renderFormulaHtml(this.value)"><div id="f-cf-preview" style="margin-top:0.4rem;padding:0.4rem 0.6rem;font-size:1.1rem;color:var(--text-secondary);min-height:1.5em;letter-spacing:0.02em;font-style:italic;">${formulaPreview}</div></div><div class="form-group"><label class="form-label">Custom position code</label><input class="form-input" id="f-cpos" placeholder="e.g. M4-custom (leave blank for auto)" value="${escHtml(chem.customPosition||'')}"></div><div class="form-row"><div class="form-group"><label class="form-label">Quantity</label><input class="form-input" id="f-cq" type="number" step="any" min="0" value="${chem.quantity??''}"></div><div class="form-group"><label class="form-label">Unit</label><select class="form-select" id="f-cu">${uOpts}</select></div></div><div class="form-row"><div class="form-group"><label class="form-label">Concentration</label><input class="form-input" id="f-cconc" type="number" step="any" min="0" placeholder="e.g. 1.5" value="${chem.concentration??''}"></div><div class="form-group"><label class="form-label">Conc. Unit</label><select class="form-select" id="f-ccu">${cuOpts}</select></div></div><div class="form-group"><label class="form-label">CAS number</label><input class="form-input" id="f-cc" placeholder="e.g. 7647-01-0" value="${escHtml(chem.cas||'')}"></div><div class="form-group"><label class="form-label">Note</label><textarea class="form-textarea" id="f-cno" placeholder="Optional note">${escHtml(chem.note||'')}</textarea></div>`;
}

function getChemVals(){
  const name=$('#f-cn2').value.trim();
  if(!name || name.length > 100){showToast('Chemical name is required (max 100 chars)','error');return null;}
  const note=$('#f-cno').value.trim();
  const c=$('#f-cconc').value;
  const cabShelf = $('#f-cab-shelf');
  const customPos = $('#f-cpos');
  
  if (countWords(name) > 300 || countWords(note) > 300 || (customPos && countWords(customPos.value) > 300)) {
    showToast('Name, note or custom position exceeds 300 words!', 'error');
    return null;
  }

  const casVal = $('#f-cc').value.trim();
  if (casVal && !/^\d{1,7}-\d{2}-\d$/.test(casVal)) {
    showToast('Invalid CAS number format (e.g. 7647-01-0)', 'error');
    return null;
  }

  const qtyRaw = $('#f-cq').value.trim();
  if (qtyRaw && (isNaN(parseFloat(qtyRaw)) || parseFloat(qtyRaw) < 0)) {
    showToast('Quantity must be a non-negative number', 'error');
    return null;
  }

  const res = {
    name,
    formula:formatFormula($('#f-cf').value.trim()),
    quantity:parseFloat(qtyRaw)||0,
    unit:$('#f-cu').value||'pcs',
    concentration:c?parseFloat(c):null,
    concUnit:$('#f-ccu').value||'',
    cas: casVal,
    note: note
  };
  if(cabShelf) {
    res._shelfOverride = cabShelf.value;
  }
  if(customPos) {
    res.customPosition = customPos.value.trim();
  }
  return res;
}

window.addChemical = function(preSelectedShelfId){
  const cont=getContainer(currentRoomId,currentContainerId);if(!cont)return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  
  // Ask if they want music first!
  const musicPromptHTML = `
    <div style="text-align: center; padding: 1rem 0;">
      <div style="font-size: 3rem; margin-bottom: 1rem; animation: floatBlob 2s ease-in-out infinite alternate;">🎵</div>
      <h3 style="margin-bottom: 0.5rem; color: var(--text-primary);">Laboratory Background Radio</h3>
      <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1.5rem; max-width: 320px; margin-left: auto; margin-right: auto;">
        Would you like to play some background folk music while you add this chemical?
      </p>
      <div style="display: flex; flex-direction: column; gap: 0.75rem; max-width: 280px; margin: 0 auto;">
        <button class="btn-primary" onclick="window.startLabRadio('cechomor'); closeModal(); window.proceedWithAddChemical();" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.75rem; background: linear-gradient(135deg, var(--accent-blue), #3b82f6); border: none;">
          <span>🎻 Play Čechomor (String Folk)</span>
        </button>
        <button class="btn-primary" onclick="window.startLabRadio('moravanka'); closeModal(); window.proceedWithAddChemical();" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.75rem; background: linear-gradient(135deg, var(--accent-purple), #8b5cf6); border: none;">
          <span>🎺 Play Moravanka (Brass Band)</span>
        </button>
        <button class="btn-secondary" onclick="closeModal(); window.proceedWithAddChemical();" style="width: 100%; padding: 0.75rem;">
          <span>🔇 No music, thanks</span>
        </button>
      </div>
    </div>
  `;

  // Bind proceeding function on window so button callbacks can trigger it
  window.proceedWithAddChemical = function() {
    // Restore modal footer visibility
    const modalFooter = $('#modal-overlay .modal-footer');
    if (modalFooter) modalFooter.style.display = 'flex';

    let initialChem = {};
    if (preSelectedShelfId) {
      initialChem._shelfId = preSelectedShelfId;
    } else if (cont.type === 'deepfreezer' && selectedDeepFreezerRack && selectedDeepFreezerBox) {
      const parsedRacks = {};
      (cont.shelves || []).forEach(sh => {
        const { rack, box } = parseDeepFreezerShelf(sh);
        if (!parsedRacks[rack]) parsedRacks[rack] = {};
        parsedRacks[rack][box] = sh;
      });
      const activeShelf = parsedRacks[selectedDeepFreezerRack]?.[selectedDeepFreezerBox];
      if (activeShelf) {
        initialChem._shelfId = activeShelf.id;
      }
    }

    openModal('Add Chemical',chemFormHTML(initialChem,cont),'Add',()=>{
      const v=getChemVals();if(!v)return;
      // Re-fetch container from current appData to avoid stale closure reference
      // (Firebase listener may have replaced appData since the modal was opened)
      const freshCont = getContainer(currentRoomId, currentContainerId);
      if (!freshCont) { showToast('Container not found', 'error'); return; }
      let shelf;
      if(freshCont.type==='cabinet'){
        const isAlphabetical = freshCont.cabinetMethod === 'alphabetical' || (freshCont.cabinetMethod === 'custom' && freshCont.customRangeType === 'alphabetical');
        const hasRangeShelves = (freshCont.shelves||[]).some(s => s.isRangeShelf);
        const canAuto = isAlphabetical || hasRangeShelves;
        const override=$('#f-cab-shelf')?.value||'auto';
        if(override==='auto' && canAuto){
          const L = getFirstLetter(v.name);
          
          // 1. Try PERFECT exact match first (e.g. "A", "Shelf A")
          shelf = freshCont.shelves.find(s => {
            const n = s.name.toUpperCase().trim();
            return n === L || n === 'SHELF ' + L || n.endsWith(' ' + L);
          });
          
          // 2. Try permissive exact match (e.g. "A - chemicals", "Shelf A-A")
          if (!shelf) {
            shelf = freshCont.shelves.find(s => {
              const n = s.name.toUpperCase().trim();
              const regex = new RegExp(`(^|[^A-Z])${L}([^A-Z]|$)`);
              return regex.test(n) || n.startsWith(L + ' -') || n.startsWith(L + '–');
            });
          }
          
          // 3. Try range shelves
          if (!shelf) {
            shelf = findRangeShelf(freshCont, v.name) || freshCont.shelves[0];
          }
        } else {
          const sid=$('#f-cab-shelf')?.value;
          shelf=freshCont.shelves.find(s=>s.id===sid);
        }
      } else {
        const sid=$('#f-shelf')?.value;
        shelf=freshCont.shelves.find(s=>s.id===sid);
      }
      
      if(!shelf) { showToast('Select a shelf', 'error'); return; }
      if(!shelf.chemicals) shelf.chemicals=[];
      const pos = getOrCreatePosition(freshCont, null, v.name, shelf, {});
      shelf.chemicals.push({id:genId(), position: pos, ...v});
      shelf.chemicals.sort(compareChemicalNames);
      openShelves.add(shelf.id);saveData(appData);closeModal();renderDetail();
      logHistory(`Added chemical "${v.name}" to ${freshCont.name} (${shelf.name})`, freshCont.ownerGroupId);
      const msg=freshCont.type==='cabinet'?`"${v.name}" → ${shelf.name}`:`"${v.name}" added`;showToast(msg);
    });
  };

  // Hide the footer first
  const modalFooter = $('#modal-overlay .modal-footer');
  if (modalFooter) modalFooter.style.display = 'none';

  // Open music prompt modal
  openModal('Laboratory Radio', musicPromptHTML);
}

function editChemical(shelfId,chemId){
  const cont=getContainer(currentRoomId,currentContainerId);if(!cont)return;
  const shelf=cont.shelves.find(s=>s.id===shelfId);if(!shelf)return;
  const chem=shelf.chemicals.find(c=>c.id===chemId);if(!chem)return;
  openModal('Edit Chemical',chemFormHTML({...chem,_shelfId:shelfId,_shelfOverride:chem._shelfOverride},cont),'Save',()=>{
    const v=getChemVals();if(!v)return;
    // Re-fetch container and shelf from current appData to avoid stale closure reference
    const freshCont = getContainer(currentRoomId, currentContainerId);
    if (!freshCont) { showToast('Container not found', 'error'); return; }
    const freshShelf = freshCont.shelves.find(s=>s.id===shelfId);
    if (!freshShelf) { showToast('Shelf not found', 'error'); return; }
    if (getCurrentRole() === 'reader') {
      v.name = chem.name;
      v.formula = chem.formula;
      v.customPosition = chem.customPosition;
      v.unit = chem.unit;
      v.concentration = chem.concentration;
      v.concUnit = chem.concUnit;
      v.cas = chem.cas;
      if (v._shelfOverride) delete v._shelfOverride;
    }
    
    freshShelf.chemicals=freshShelf.chemicals.filter(c=>c.id!==chemId);
    let newShelf;
    if(freshCont.type==='cabinet'){
      const isAlphabetical = freshCont.cabinetMethod === 'alphabetical' || (freshCont.cabinetMethod === 'custom' && freshCont.customRangeType === 'alphabetical');
      const hasRangeShelves = (freshCont.shelves||[]).some(s => s.isRangeShelf);
      const canAuto = isAlphabetical || hasRangeShelves;
      const override=$('#f-cab-shelf')?.value||'auto';
      if(override==='auto' && canAuto){
        const L = getFirstLetter(v.name);
        
        // 1. Try PERFECT exact match first (e.g. "A", "Shelf A")
        newShelf = freshCont.shelves.find(s => {
          const n = s.name.toUpperCase().trim();
          return n === L || n === 'SHELF ' + L || n.endsWith(' ' + L);
        });
        
        // 2. Try permissive exact match (e.g. "A - chemicals", "Shelf A-A")
        if (!newShelf) {
          newShelf = freshCont.shelves.find(s => {
            const n = s.name.toUpperCase().trim();
            const regex = new RegExp(`(^|[^A-Z])${L}([^A-Z]|$)`);
            return regex.test(n) || n.startsWith(L + ' -') || n.startsWith(L + '–');
          });
        }
        
        // 3. Try range shelves
        if (!newShelf) {
          newShelf = findRangeShelf(freshCont, v.name) || freshShelf;
        }
      } else {
        newShelf = freshCont.shelves.find(s => s.id === override) || freshShelf;
      }
    } else {
      const sid=$('#f-shelf')?.value;
      newShelf=freshCont.shelves.find(s=>s.id===sid)||freshShelf;
    }
    
    if(!newShelf.chemicals) newShelf.chemicals=[];
    const pos = chem.position || getOrCreatePosition(freshCont, chemId, v.name, newShelf, chem);
    newShelf.chemicals.push({id:chemId, position: pos, ...v});
    newShelf.chemicals.sort(compareChemicalNames);
    openShelves.add(newShelf.id);saveData(appData);closeModal();renderDetail();
    logHistory(`Edited chemical "${v.name}" in ${freshCont.name}`, freshCont.ownerGroupId);
    showToast('Chemical updated');
  });
  if (getCurrentRole() === 'reader') {
    const toDisable = ['#f-shelf', '#f-cab-shelf', '#f-cn2', '#f-cf', '#f-cpos', '#f-cu', '#f-cconc', '#f-ccu', '#f-cc'];
    toDisable.forEach(sel => {
      const el = $(sel);
      if (el) el.disabled = true;
    });
  }
}
function deleteChemical(shelfId,chemId){
  const cont=getContainer(currentRoomId,currentContainerId);if(!cont)return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  const shelf=cont.shelves.find(s=>s.id===shelfId);if(!shelf)return;
  const chem=shelf.chemicals.find(c=>c.id===chemId);if(!chem)return;
  openModal('Delete Chemical',`<p>Delete <strong>${escHtml(chem.name)}</strong>?</p>`,'Delete',()=>{
    verifyCaptchaAndExecute(() => {
      // Re-fetch from current appData to avoid stale closure reference
      const freshCont = getContainer(currentRoomId, currentContainerId);
      if (!freshCont) { showToast('Container not found', 'error'); return; }
      const freshShelf = freshCont.shelves.find(s=>s.id===shelfId);
      if (!freshShelf) { showToast('Shelf not found', 'error'); return; }
      freshShelf.chemicals=freshShelf.chemicals.filter(c=>c.id!==chemId);saveData(appData);closeModal();renderDetail();
      logHistory(`Deleted chemical "${chem.name}" from ${freshCont.name}`, freshCont.ownerGroupId);
      showToast('Deleted');
    });
  });
}

// Export/Import JSON
if ($('#btn-export')) {
  $('#btn-export').addEventListener('click',()=>{
    if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
    const b=new Blob([JSON.stringify(appData,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='bioscom_'+new Date().toISOString().slice(0,10)+'.json';a.click();showToast('Data exported','info');
  });
}
if ($('#btn-import')) {
  $('#btn-import').addEventListener('click',()=>{
    if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
    $('#import-input').click();
  });
}
$('#import-input').addEventListener('change',e=>{
  if (getCurrentRole() === 'reader') return;
  const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const d=JSON.parse(ev.target.result);if(!d.rooms)throw 0;appData=migrateData(d);saveData(appData);navigateTo('rooms');showToast('Import successful');}catch(x){showToast('Invalid file','error');}};r.readAsText(f);e.target.value='';
});

// Export PDF
function exportPDF(){
  const posMapCache={};
  function getPosMap(cont){
    if(!posMapCache[cont.id])posMapCache[cont.id]=computePositions(cont);
    return posMapCache[cont.id];
  }
  let html=`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>BioSCom – Chemical Inventory</title><style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10pt;color:#111;padding:20px}
    h1{font-size:18pt;margin-bottom:4px}h2{font-size:13pt;margin:18px 0 4px;padding:6px 10px;background:#1a2035;color:#fff;border-radius:4px}
    h3{font-size:11pt;margin:12px 0 4px;padding:4px 8px;background:#e8ecf4;border-left:4px solid #3b82f6;color:#1a2035}
    h3.fridge{border-left-color:#06b6d4}
    h4{font-size:10pt;margin:8px 0 3px;color:#444;font-weight:600}
    table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9pt;table-layout:fixed}
    th{background:#f1f5f9;text-align:left;padding:4px 6px;border:1px solid #cbd5e1;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
    td{padding:4px 6px;border:1px solid #cbd5e1;vertical-align:middle;word-break:break-word}
    th:nth-child(1){width:6%}   /* Pos */
    th:nth-child(2){width:26%}  /* Name */
    th:nth-child(3){width:14%}  /* Formula */
    th:nth-child(4){width:7%}   /* Qty */
    th:nth-child(5){width:7%}   /* Unit */
    th:nth-child(6){width:12%}  /* Conc. */
    th:nth-child(7){width:12%}  /* CAS */
    th:nth-child(8){width:16%}  /* Note */
    tr:nth-child(even){background:#f8fafc}
    .pos{font-weight:700;color:#2563eb;font-size:8.5pt}
    .pos.fridge{color:#0891b2}
    .pos.freezer{color:#4f46e5}
    .qty-low{color:#dc2626;font-weight:700}.qty-med{color:#d97706;font-weight:700}.qty-ok{color:#16a34a}
    .meta{font-size:9pt;color:#64748b;margin-bottom:16px}
    .badge{display:inline-block;font-size:8pt;padding:1px 6px;border-radius:10px;margin-left:6px;vertical-align:middle}
    .badge.cabinet{background:#ede9fe;color:#7c3aed}.badge.fridge{background:#cffafe;color:#0e7490}.badge.freezer{background:#e0e7ff;color:#4f46e5}
    .shelf-empty{color:#94a3b8;font-style:italic;font-size:9pt;padding:4px 0}
    @media print{body{padding:10px}h2{break-before:page}h2:first-of-type{break-before:avoid}}
  </style></head><body>`;
  html+=`<h1>BioSCom – Chemical Inventory</h1><div class="meta">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; ${appData.rooms.length} room(s)</div>`;
  (appData.rooms||[]).forEach(room=>{
    const total=countAllChems(room);
    html+=`<h2>${escHtml(room.name)}${room.description?` <span style="font-weight:400;font-size:11pt">${escHtml(room.description)}</span>`:''}  <span style="font-size:10pt;font-weight:400;float:right">${total} chemical(s)</span></h2>`;
    (room.containers||[]).forEach(cont=>{
      const isFridge=cont.type==='fridge';
      const isFreezer=cont.type==='freezer' || cont.type==='deepfreezer';
      const isCooling = isFridge || isFreezer;
      const badgeCls = isFridge ? 'fridge' : (isFreezer ? 'freezer' : 'cabinet');
      const badgeLabel = isFridge ? 'Fridge' : (cont.type==='deepfreezer' ? 'Deep Freezer' : (isFreezer ? 'Freezer' : 'Cabinet'));
      const icon = isFridge ? '❄️' : (isFreezer ? '🧊' : '🗄️');
      const posMap=getPosMap(cont);
      html+=`<h3 class="${badgeCls}">  ${icon} ${escHtml(cont.name)}<span class="badge ${badgeCls}">${badgeLabel}</span>${cont.description?` – ${escHtml(cont.description)}`:''}</h3>`;
      (cont.shelves||[]).forEach(sh=>{
        const chems=[...(sh.chemicals||[])];
        chems.sort((a, b) => {
          const posA = posMap[a.id] || '';
          const posB = posMap[b.id] || '';
          return posA.localeCompare(posB, undefined, { numeric: true, sensitivity: 'base' });
        });
        const shelfIcon = isCooling ? (sh.name.startsWith('Door') ? '🚪' : (isFreezer ? '🧊' : '❄️')) : '📁';
        html+=`<h4>${shelfIcon} ${escHtml(sh.name)} (${chems.length})</h4>`;
        if(!chems.length){html+=`<div class="shelf-empty">Empty</div>`;return;}
        html+=`<table><thead><tr><th>Pos.</th><th>Name</th><th>Formula</th><th>Qty</th><th>Unit</th><th>Conc.</th><th>CAS</th><th>Note</th></tr></thead><tbody>`;
        chems.forEach(ch=>{
          const qty=parseFloat(ch.quantity)||0;
          const qc=qty<=0?'qty-low':qty<10?'qty-med':'qty-ok';
          const pos=posMap[ch.id]||'—';
          const conc=ch.concentration!==null&&ch.concentration!==undefined?escHtml(ch.concentration+' '+(ch.concUnit||'')):'—';
          html+=`<tr><td><span class="pos ${badgeCls}">${escHtml(pos)}</span></td><td>${escHtml(ch.name)}</td><td><em>${renderFormulaHtml(ch.formula)}</em></td><td class="${qc}">${escHtml(String(ch.quantity||0))}</td><td>${escHtml(ch.unit||'pcs')}</td><td style="white-space:nowrap">${conc}</td><td>${escHtml(ch.cas||'—')}</td><td>${escHtml(ch.note||'—')}</td></tr>`;
        });
        html+=`</tbody></table>`;
      });
    });
  });
  html+=`</body></html>`;
  const w=window.open('','_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(()=>w.print(),600);
  showToast('PDF ready – use browser Print dialog','info');
}

function exportContainerPDF(){
  const room = getRoom(currentRoomId);
  const cont = getContainer(currentRoomId, currentContainerId);
  if(!room || !cont) return;
  const posMap = computePositions(cont);
  const isFridge = cont.type === 'fridge';
  const isFreezer = cont.type === 'freezer' || cont.type === 'deepfreezer';
  const isCooling = isFridge || isFreezer;
  const badgeCls = isFridge ? 'fridge' : (isFreezer ? 'freezer' : 'cabinet');
  const badgeLabel = isFridge ? 'Fridge' : (cont.type === 'deepfreezer' ? 'Deep Freezer' : (isFreezer ? 'Freezer' : 'Cabinet'));
  const icon = isFridge ? '❄️' : (isFreezer ? '🧊' : '🗄️');
  const total = countChems(cont);

  let html=`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>BioSCom – ${escHtml(cont.name)} PDF</title><style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10pt;color:#111;padding:20px}
    h1{font-size:18pt;margin-bottom:4px}
    h2{font-size:13pt;margin:18px 0 4px;padding:6px 10px;background:#1a2035;color:#fff;border-radius:4px}
    h3{font-size:11pt;margin:12px 0 4px;padding:4px 8px;background:#e8ecf4;border-left:4px solid #3b82f6;color:#1a2035}
    h3.fridge{border-left-color:#06b6d4}
    h3.freezer{border-left-color:#6366f1}
    h4{font-size:10pt;margin:8px 0 3px;color:#444;font-weight:600}
    table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9pt;table-layout:fixed}
    th{background:#f1f5f9;text-align:left;padding:4px 6px;border:1px solid #cbd5e1;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
    td{padding:4px 6px;border:1px solid #cbd5e1;vertical-align:middle;word-break:break-word}
    th:nth-child(1){width:6%}   /* Pos */
    th:nth-child(2){width:26%}  /* Name */
    th:nth-child(3){width:14%}  /* Formula */
    th:nth-child(4){width:7%}   /* Qty */
    th:nth-child(5){width:7%}   /* Unit */
    th:nth-child(6){width:12%}  /* Conc. */
    th:nth-child(7){width:12%}  /* CAS */
    th:nth-child(8){width:16%}  /* Note */
    tr:nth-child(even){background:#f8fafc}
    .pos{font-weight:700;color:#2563eb;font-size:8.5pt}
    .pos.fridge{color:#0891b2}
    .pos.freezer{color:#4f46e5}
    .qty-low{color:#dc2626;font-weight:700}.qty-med{color:#d97706;font-weight:700}.qty-ok{color:#16a34a}
    .meta{font-size:9pt;color:#64748b;margin-bottom:16px}
    .badge{display:inline-block;font-size:8pt;padding:1px 6px;border-radius:10px;margin-left:6px;vertical-align:middle}
    .badge.cabinet{background:#ede9fe;color:#7c3aed}.badge.fridge{background:#cffafe;color:#0e7490}.badge.freezer{background:#e0e7ff;color:#4f46e5}
    .shelf-empty{color:#94a3b8;font-style:italic;font-size:9pt;padding:4px 0}
    @media print{body{padding:10px}}
  </style></head><body>`;
  
  html+=`<h1>BioSCom – Container Inventory</h1><div class="meta">Generated: ${new Date().toLocaleString()}</div>`;
  html+=`<h2>Room: ${escHtml(room.name)}${room.description?` (${escHtml(room.description)})`:''}</h2>`;
  html+=`<h3 class="${badgeCls}">  ${icon} ${escHtml(cont.name)}<span class="badge ${badgeCls}">${badgeLabel}</span>${cont.description?` – ${escHtml(cont.description)}`:''}  <span style="font-size:10pt;font-weight:400;float:right">${total} chemical(s)</span></h3>`;
  
  (cont.shelves||[]).forEach(sh=>{
    const chems=[...(sh.chemicals||[])];
    chems.sort((a, b) => {
      const posA = posMap[a.id] || '';
      const posB = posMap[b.id] || '';
      return posA.localeCompare(posB, undefined, { numeric: true, sensitivity: 'base' });
    });
    const shelfIcon = isCooling ? (sh.name.startsWith('Door') ? '🚪' : (isFreezer ? '🧊' : '❄️')) : '📁';
    html+=`<h4>${shelfIcon} ${escHtml(sh.name)} (${chems.length})</h4>`;
    if(!chems.length){html+=`<div class="shelf-empty">Empty</div>`;return;}
    html+=`<table><thead><tr><th>Pos.</th><th>Name</th><th>Formula</th><th>Qty</th><th>Unit</th><th>Conc.</th><th>CAS</th><th>Note</th></tr></thead><tbody>`;
    chems.forEach(ch=>{
      const qty=parseFloat(ch.quantity)||0;
      const qc=qty<=0?'qty-low':qty<10?'qty-med':'qty-ok';
      const pos=posMap[ch.id]||'—';
      const conc=ch.concentration!==null&&ch.concentration!==undefined?escHtml(ch.concentration+' '+(ch.concUnit||'')):'—';
      html+=`<tr><td><span class="pos ${badgeCls}">${escHtml(pos)}</span></td><td>${escHtml(ch.name)}</td><td><em>${renderFormulaHtml(ch.formula)}</em></td><td class="${qc}">${escHtml(String(ch.quantity||0))}</td><td>${escHtml(ch.unit||'pcs')}</td><td style="white-space:nowrap">${conc}</td><td>${escHtml(ch.cas||'—')}</td><td>${escHtml(ch.note||'—')}</td></tr>`;
    });
    html+=`</tbody></table>`;
  });
  
  html+=`</body></html>`;
  const w=window.open('','_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(()=>w.print(),600);
  showToast('PDF ready – use browser Print dialog','info');
}

// Event bindings

// ---------- Protocols ----------
function renderProtocols(){
  const container = $('#protocols-container');
  const list = appData.protocols || [];
  if(!list.length){
    container.innerHTML='';
    $('#protocols-empty').style.display='block';
    return;
  }
  $('#protocols-empty').style.display='none';
  container.innerHTML = list.map(p=>{
    const role = getCurrentRole();
    const canEditDelete = role !== 'reader';
    const onClickAttr = canEditDelete ? `onclick="editProtocol('${p.id}')" style="cursor:pointer;"` : '';
    const deleteBtn = canEditDelete ? `<button class="btn-inline danger" title="Delete" onclick="event.stopPropagation();deleteProtocol('${p.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : '';

    return `<div class="protocol-card" ${onClickAttr}>
      <div class="protocol-title">${escHtml(p.title)}</div>
      <div class="protocol-content">${escHtml(p.content)}</div>
      <div class="protocol-actions">
        ${deleteBtn}
      </div>
    </div>`;
  }).join('');
}

function addProtocol(){
  openModal('Add Protocol',`
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="p-title"></div>
    <div class="form-group"><label class="form-label">Content</label><textarea class="form-textarea" id="p-content" rows="6"></textarea></div>
  `,'Add',()=>{
    const title = $('#p-title').value.trim();
    if(!title){showToast('Enter title','error');return;}
    const content = $('#p-content').value;
    if (countWords(title) > 300 || countWords(content) > 300) {
      showToast('Title or content exceeds 300 words!', 'error');
      return;
    }
    const prot = {id:genId(), title, content};
    appData.protocols = appData.protocols || [];
    appData.protocols.push(prot);
    saveData(appData);
    closeModal();
    renderProtocols();
    logHistory(`Added protocol "${title}"`);
    showToast('Protocol added');
  });
}

function editProtocol(id){
  if (getCurrentRole() === 'reader') { showToast('Access Denied: Readers cannot edit protocols.', 'error'); return; }
  const prot = (appData.protocols||[]).find(p=>p.id===id);
  if(!prot)return;
  openModal('Edit Protocol',`
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="p-title" value="${escHtml(prot.title)}"></div>
    <div class="form-group"><label class="form-label">Content</label><textarea class="form-textarea" id="p-content" rows="6">${escHtml(prot.content)}</textarea></div>
  `,'Save',()=>{
    const title = $('#p-title').value.trim();
    if(!title){showToast('Enter title','error');return;}
    const content = $('#p-content').value;
    if (countWords(title) > 300 || countWords(content) > 300) {
      showToast('Title or content exceeds 300 words!', 'error');
      return;
    }
    prot.title = title;
    prot.content = content;
    saveData(appData);
    closeModal();
    renderProtocols();
    logHistory(`Edited protocol "${title}"`);
    showToast('Protocol saved');
  });
}

function deleteProtocol(id){
  if (getCurrentRole() === 'reader') { showToast('Access Denied: Readers cannot delete protocols.', 'error'); return; }
  const prot = (appData.protocols||[]).find(p=>p.id===id);
  if(!prot)return;
  openModal('Delete Protocol',`<p>Delete <strong>${escHtml(prot.title)}</strong>?</p>`,'Delete',()=>{
    verifyCaptchaAndExecute(() => {
      appData.protocols = (appData.protocols||[]).filter(p=>p.id!==id);
      saveData(appData);
      closeModal();
      renderProtocols();
      logHistory(`Deleted protocol "${prot.title}"`);
      showToast('Protocol deleted');
    });
  });
}

// ---------- Notice Board ----------
function renderNoticeboard(){
  const container = $('#noticeboard-container');
  const list = sharedNotices || [];
  if(!list.length){
    container.innerHTML='';
    $('#noticeboard-empty').style.display='block';
    return;
  }
  $('#noticeboard-empty').style.display='none';
  
  // Sort newest first
  const sorted = [...list].sort((a,b) => (b.timestamp||0) - (a.timestamp||0));
  
  const labHtml = n => n.authorLab ? `<span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 0.5rem;">${escHtml(n.authorLab)}</span>` : '';
  container.innerHTML = sorted.map(n => {
    const date = n.timestamp ? new Date(n.timestamp).toLocaleString() : '';
    const authorAvatarHtml = n.authorAvatar ? `<img src="${escHtml(n.authorAvatar)}" style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-subtle); margin-right: 0.35rem;" title="${escHtml(n.authorName)}">` : '';
    const authorHtml = n.authorName ? `<span style="font-weight: 600; color: var(--accent-blue); display: inline-flex; align-items: center;">${authorAvatarHtml}${escHtml(n.authorName)}</span>${labHtml(n)}` : '';
    const dateHtml = date ? `<span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 0.5rem;">${escHtml(date)}</span>` : '';
    const isSuperadmin = currentUserRole === 'superadmin';
    const isAuthor = n.authorUid === (auth.currentUser ? auth.currentUser.uid : '');
    const canDelete = isSuperadmin || isAuthor;
    const deleteBtnHtml = canDelete ? `<button class="btn-inline danger" title="Delete" onclick="event.stopPropagation();deleteNotice('${n.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : '';
    const editBtnHtml = canDelete ? `<button class="btn-inline" title="Edit" onclick="event.stopPropagation();editNotice('${n.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : '';
    
    const categoryColors = {
      suggestion: 'rgba(34, 197, 94, 0.15)',
      issue: 'rgba(239, 68, 68, 0.15)',
      info: 'rgba(59, 130, 246, 0.15)',
      general: 'rgba(255, 255, 255, 0.05)'
    };
    const categoryLabels = {
      suggestion: '💡 Suggestion',
      issue: '⚠️ Issue',
      info: 'ℹ️ Info',
      general: '📌 General'
    };
    const cat = n.category || 'general';
    const catBg = categoryColors[cat] || categoryColors.general;
    const catLabel = categoryLabels[cat] || categoryLabels.general;
    
    const reactionsObj = n.reactions || {};
    const reactions = Object.values(reactionsObj).sort((a,b) => (a.timestamp||0) - (b.timestamp||0));
    let reactionsHtml = '';
    if (reactions.length > 0) {
      reactionsHtml += '<div style="display:flex; flex-wrap:wrap; gap:0.4rem; margin-bottom: 0.5rem;">';
      reactions.forEach(r => {
        const isMyReaction = r.userId === (auth.currentUser ? auth.currentUser.uid : '');
        const delBtn = isMyReaction ? `<span onclick="deleteNoticeReaction('${n.id}', '${r.id}')" style="cursor:pointer; color:var(--text-muted); margin-left:0.3rem;" title="Remove">&times;</span>` : '';
        const rAvatarHtml = r.userAvatar ? `<img src="${escHtml(r.userAvatar)}" style="width: 16px; height: 16px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-subtle); margin-right: 0.25rem; vertical-align: middle;">` : '';
        reactionsHtml += `<div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-light); border-radius:12px; padding:0.15rem 0.5rem; font-size:0.75rem; display:flex; align-items:center;">
          ${rAvatarHtml}
          <span style="font-weight:600; color:var(--text-secondary); margin-right:0.3rem;">${escHtml(r.userName)}:</span>
          <span>${escHtml(r.text)}</span>
          ${delBtn}
        </div>`;
      });
      reactionsHtml += '</div>';
    }
    
    const reactionInputHtml = `
      <div style="display:flex; align-items:center; gap:0.4rem; margin-top:0.25rem;">
        <button class="btn-inline" style="padding:0.15rem; font-size:0.9rem;" title="Thumbs Up" onclick="addNoticeReaction('${n.id}', '👍')">👍</button>
        <button class="btn-inline" style="padding:0.15rem; font-size:0.9rem;" title="Heart" onclick="addNoticeReaction('${n.id}', '❤️')">❤️</button>
        <button class="btn-inline" style="padding:0.15rem; font-size:0.9rem;" title="Check" onclick="addNoticeReaction('${n.id}', '✅')">✅</button>
        <input type="text" id="reaction-input-${n.id}" placeholder="Type a comment..." style="flex:1; background:transparent; border:none; border-bottom:1px solid var(--border-subtle); color:var(--text-primary); outline:none; font-size:0.75rem; padding:0.15rem 0;" onkeydown="if(event.key==='Enter') addNoticeReaction('${n.id}')">
        <button class="btn-inline" style="padding:0.15rem 0.4rem; font-size:0.75rem; color:var(--accent-blue);" onclick="addNoticeReaction('${n.id}')">Send</button>
      </div>
    `;
    
    return `<div class="protocol-card fade-in" style="border-left: 4px solid ${cat === 'suggestion' ? 'var(--accent-green)' : cat === 'issue' ? 'var(--accent-red, #ef4444)' : cat === 'info' ? 'var(--accent-blue)' : 'var(--border-subtle)'};">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem;">
          <span style="font-size: 0.7rem; background: ${catBg}; padding: 0.15rem 0.4rem; border-radius: 3px; font-weight: 600; margin-right: 0.25rem;">${catLabel}</span>
          ${authorHtml}
          ${dateHtml}
        </div>
        <div style="display: flex; gap: 0.25rem;">${editBtnHtml}${deleteBtnHtml}</div>
      </div>
      <div class="protocol-title" style="margin-bottom: 0.35rem;">${escHtml(n.title)}</div>
      <div class="protocol-content" style="margin-bottom: 0.75rem;">${escHtml(n.content || '')}</div>
      <div class="notice-reactions-container" style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.5rem;">
        ${reactionsHtml}
        ${reactionInputHtml}
      </div>
    </div>`;
  }).join('');
}

window.addNoticeReaction = function(noticeId, emoji) {
  const inputEl = $('#reaction-input-' + noticeId);
  const text = emoji || (inputEl ? inputEl.value.trim() : '');
  if (!text) return;
  
  if (countWords(text) > 300) {
    showToast('Comment exceeds 300 words!', 'error');
    return;
  }
  
  const uid = auth.currentUser ? auth.currentUser.uid : 'anon';
  const name = currentUserProfile ? currentUserProfile.name || currentUserProfile.email : 'Unknown';
  const avatar = currentUserProfile ? currentUserProfile.avatar || '' : '';
  
  const notice = (sharedNotices || []).find(n => n.id === noticeId);
  const reactionsObj = notice ? notice.reactions || {} : {};
  const existingReaction = Object.values(reactionsObj).find(r => r.userId === uid);
  
  if (existingReaction) {
    if (existingReaction.text === text) {
      db.ref(`shared_notices/${noticeId}/reactions/${existingReaction.id}`).remove()
        .then(() => {
          if (inputEl && !emoji) inputEl.value = '';
          logHistory(`Removed reaction from notice "${notice ? notice.title : 'Notice'}"`);
        })
        .catch(e => showToast('Error removing reaction', 'error'));
    } else {
      db.ref(`shared_notices/${noticeId}/reactions/${existingReaction.id}`).update({
        text: text,
        timestamp: Date.now(),
        userAvatar: avatar
      }).then(() => {
        if (inputEl && !emoji) inputEl.value = '';
        logHistory(`Updated reaction on notice "${notice ? notice.title : 'Notice'}" to "${text}"`);
      }).catch(e => showToast('Error updating reaction', 'error'));
    }
  } else {
    const rid = db.ref(`shared_notices/${noticeId}/reactions`).push().key;
    db.ref(`shared_notices/${noticeId}/reactions/${rid}`).set({
      id: rid,
      text: text,
      userId: uid,
      userName: name,
      userAvatar: avatar,
      timestamp: Date.now()
    }).then(() => {
      if (inputEl && !emoji) inputEl.value = '';
      logHistory(`Added reaction to notice "${notice ? notice.title : 'Notice'}": "${text}"`);
    }).catch(e => showToast('Error adding reaction', 'error'));
  }
};

window.deleteNoticeReaction = function(noticeId, reactionId) {
  db.ref('shared_notices/' + noticeId + '/reactions/' + reactionId).remove()
    .then(() => {
      const notice = (sharedNotices || []).find(n => n.id === noticeId);
      const noticeTitle = notice ? notice.title : 'Notice';
      logHistory(`Removed comment/reaction from notice "${noticeTitle}"`);
    })
    .catch(e => showToast('Error removing reaction', 'error'));
};

function addNotice(){
  const html = `
    <div class="form-group">
      <label class="form-label">Category</label>
      <select class="form-select" id="n-category" style="cursor: pointer;">
        <option value="suggestion">💡 Suggestion</option>
        <option value="issue">⚠️ Issue</option>
        <option value="info">ℹ️ Info</option>
        <option value="general">📌 General</option>
      </select>
    </div>
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="n-title" placeholder="Brief summary"></div>
    <div class="form-group"><label class="form-label">Details</label><textarea class="form-textarea" id="n-content" rows="5" placeholder="Describe your suggestion, issue, or note..."></textarea></div>
  `;
  openModal('📝 Add Notice', html, 'Post', () => {
    const title = $('#n-title').value.trim();
    if(!title){showToast('Enter a title','error');return;}
    const content = $('#n-content').value.trim();
    const category = $('#n-category').value;
    
    if (countWords(title) > 300 || countWords(content) > 300) {
      showToast('Title or details exceeds 300 words!', 'error');
      return;
    }
    
    const user = auth.currentUser;
    const noticeId = genId();
    const notice = {
      id: noticeId,
      title,
      content,
      category,
      authorName: user ? (currentUserProfile?.name || user.displayName || user.email) : 'Anonymous',
      authorUid: user ? user.uid : '',
      authorLab: currentGroupName || '',
      authorAvatar: user ? (currentUserProfile?.avatar || '') : '',
      timestamp: Date.now()
    };
    db.ref('shared_notices/' + noticeId).set(notice)
      .then(() => {
        showToast('Notice posted');
        logHistory(`Added notice "${title}"`);
      })
      .catch(e => { showToast('Error posting notice', 'error'); });
    closeModal();
  });
}

function editNotice(id){
  const notice = (sharedNotices||[]).find(n=>n.id===id);
  if(!notice)return;
  const isSuperadmin = getCurrentRole() === 'superadmin';
  const isAuthor = auth.currentUser && (notice.authorUid === auth.currentUser.uid);
  if (!isSuperadmin && !isAuthor) {
    showToast('Access Denied: This post can only be edited by its author or a superadmin.', 'error');
    return;
  }
  const html = `
    <div class="form-group">
      <label class="form-label">Category</label>
      <select class="form-select" id="n-category" style="cursor: pointer;">
        <option value="suggestion" ${notice.category==='suggestion'?'selected':''}>💡 Suggestion</option>
        <option value="issue" ${notice.category==='issue'?'selected':''}>⚠️ Issue</option>
        <option value="info" ${notice.category==='info'?'selected':''}>ℹ️ Info</option>
        <option value="general" ${notice.category==='general'||!notice.category?'selected':''}>📌 General</option>
      </select>
    </div>
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="n-title" value="${escHtml(notice.title)}"></div>
    <div class="form-group"><label class="form-label">Details</label><textarea class="form-textarea" id="n-content" rows="5">${escHtml(notice.content||'')}</textarea></div>
  `;
  openModal('Edit Notice', html, 'Save', () => {
    const title = $('#n-title').value.trim();
    if(!title){showToast('Please enter a title','error');return;}
    const content = $('#n-content').value.trim();
    
    if (countWords(title) > 300 || countWords(content) > 300) {
      showToast('Title or details exceeds 300 words!', 'error');
      return;
    }
    
    const updatedNotice = {
      ...notice,
      title: title,
      content: content,
      category: $('#n-category').value,
      editedAt: Date.now()
    };
    db.ref('shared_notices/' + id).set(updatedNotice)
      .then(() => {
        closeModal();
        showToast('Notice updated successfully');
        logHistory(`Edited notice "${title}"`);
      })
      .catch(e => { showToast('Error updating notice', 'error'); });
  });
}

function deleteNotice(id){
  const notice = (sharedNotices||[]).find(n=>n.id===id);
  if(!notice)return;
  const isSuperadmin = getCurrentRole() === 'superadmin';
  const isAuthor = auth.currentUser && (notice.authorUid === auth.currentUser.uid);
  if (!isSuperadmin && !isAuthor) {
    showToast('Access Denied: This post can only be deleted by its author or a superadmin.', 'error');
    return;
  }
  openModal('Delete Notice',`<p>Are you sure you want to delete <strong>${escHtml(notice.title)}</strong>?</p>`,'Delete',()=>{
    verifyCaptchaAndExecute(() => {
      db.ref('shared_notices/' + id).remove()
        .then(() => {
          showToast('Notice deleted');
          logHistory(`Deleted notice "${notice.title}"`);
        })
        .catch(e => { showToast('Error deleting notice', 'error'); });
    });
  });
}

// ---------- Assets / Inventory ----------
function renderAssetCard(a) {
  let barcodeHTML = '';
  if (a.barcode && a.barcode.trim()) {
    barcodeHTML = `
      <div class="asset-barcode-card-view" style="text-align: center; margin: 10px 0;">
        <svg class="barcode-render" data-barcode="${escHtml(a.barcode.trim())}" style="width: 3.5in; height: 1.2in; display: block; margin: 0 auto; background: white; padding: 8px; border: 1px solid var(--border-subtle); box-sizing: border-box;"></svg>
      </div>
    `;
  }

  return `
    <div class="asset-card">
      <div class="asset-header">
        <div class="asset-title">${escHtml(a.name)}</div>
        ${a.model ? `<div class="asset-meta">${escHtml(a.model)}</div>` : ''}
      </div>
      ${a.description ? `<div class="asset-description">${escHtml(a.description)}</div>` : ''}
      ${barcodeHTML}
      <div class="asset-actions">
        <button class="btn-inline" onclick="editAsset('${a.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> <span>Edit</span></button>
        <button class="btn-inline danger" onclick="deleteAsset('${a.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> <span>Delete</span></button>
      </div>
    </div>
  `;
}

function renderAssets(){
  const query = $('#assets-search-input')?.value || '';
  const container = $('#assets-grid');
  let list = appData.assets || [];
  const q = query.toLowerCase().trim();
  if (q) {
    list = list.filter(a => 
      (a.name || '').toLowerCase().includes(q) || 
      (a.model || '').toLowerCase().includes(q) || 
      (a.description || '').toLowerCase().includes(q)
    );
  }
  const rooms = appData.assetRooms || [];
  if(!list.length){
    if (q) {
      container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1; padding: 3rem;"><div class="empty-icon">🔍</div><h2>No matching items found</h2><p>Try searching for a different name, brand, or model</p></div>`;
      $('#assets-empty').style.display = 'none';
      return;
    } else if (rooms.length === 0) {
      container.innerHTML = '';
      $('#assets-empty').style.display = 'block';
      return;
    }
  }
  $('#assets-empty').style.display='none';
  
  let finalHtml = '';
  
  // Render all available rooms first
  rooms.forEach(room => {
    const roomAssets = list.filter(a => a.roomId === room.id);
    let roomActions = '';
    if (getCurrentRole() !== 'reader') {
      roomActions = `
        <div style="display:flex; gap:0.5rem;">
          <button class="btn-inline" style="font-size:0.75rem;" onclick="editAssetRoom('${room.id}')">Edit Room</button>
          <button class="btn-inline danger" style="font-size:0.75rem;" onclick="deleteAssetRoom('${room.id}')">Delete</button>
        </div>
      `;
    }
    
    finalHtml += `<div style="grid-column: 1 / -1; margin-top: 1rem; margin-bottom: 0.5rem; border-bottom: 2px solid var(--border-subtle); padding-bottom: 0.25rem; display: flex; justify-content: space-between; align-items: center;">
      <h3 style="margin: 0; color: var(--text-primary); font-size: 1.1rem;">🚪 ${escHtml(room.name)}</h3>
      ${roomActions}
    </div>`;
    
    if (roomAssets.length === 0) {
      finalHtml += `<div style="grid-column: 1 / -1; color: var(--text-muted); font-size: 0.9rem; font-style: italic; padding: 1rem 0;">No assets in this room.</div>`;
    } else {
      finalHtml += roomAssets.map(a => renderAssetCard(a)).join('');
    }
  });

  // Render unassigned assets (if any)
  const validRoomIds = new Set(rooms.map(r => r.id));
  const unassignedAssets = list.filter(a => !a.roomId || a.roomId === 'unassigned' || !validRoomIds.has(a.roomId));
  
  if (unassignedAssets.length > 0) {
    finalHtml += `<div style="grid-column: 1 / -1; margin-top: 1rem; margin-bottom: 0.5rem; border-bottom: 2px solid var(--border-subtle); padding-bottom: 0.25rem; display: flex; justify-content: space-between; align-items: center;">
      <h3 style="margin: 0; color: var(--text-primary); font-size: 1.1rem;">🚪 No Room Assigned</h3>
    </div>`;
    finalHtml += unassignedAssets.map(a => renderAssetCard(a)).join('');
  }
  
  container.innerHTML = finalHtml;

  setTimeout(() => {
    $$('.barcode-render').forEach(el => {
      try {
        JsBarcode(el, el.dataset.barcode, {
          format: "CODE128",
          width: 2,
          height: 60,
          displayValue: true,
          fontSize: 16,
          margin: 10
        });
        const bbox = el.getBBox();
        if (bbox && bbox.width > 0 && bbox.height > 0) {
          el.setAttribute("viewBox", `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
          el.setAttribute("width", "100%");
          el.setAttribute("height", "100%");
        }
      } catch(e) {
        console.error("Barcode generation failed for", el.dataset.barcode, e);
      }
    });
  }, 10);
}

function addAssetRoom() {
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  openModal('Add Asset Room', `
    <div class="form-group"><label class="form-label">Room Name *</label><input class="form-input" id="ar-name" placeholder="e.g. Storage Room A"></div>
  `, 'Add', () => {
    const name = $('#ar-name').value.trim();
    if (!name) { showToast('Enter name', 'error'); return; }
    appData.assetRooms = appData.assetRooms || [];
    appData.assetRooms.push({ id: genId(), name });
    saveData(appData);
    closeModal();
    renderAssets();
    showToast('Asset room added');
  });
}

function editAssetRoom(id) {
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  const room = (appData.assetRooms || []).find(r => r.id === id);
  if (!room) return;
  openModal('Edit Asset Room', `
    <div class="form-group"><label class="form-label">Room Name *</label><input class="form-input" id="ar-name" value="${escHtml(room.name)}"></div>
  `, 'Save', () => {
    const name = $('#ar-name').value.trim();
    if (!name) { showToast('Enter name', 'error'); return; }
    room.name = name;
    saveData(appData);
    closeModal();
    renderAssets();
    showToast('Asset room updated');
  });
}

function deleteAssetRoom(id) {
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  openModal('Delete Asset Room', 'Are you sure you want to delete this room? Assets assigned to it will be unassigned.', 'Delete', () => {
    appData.assetRooms = (appData.assetRooms || []).filter(r => r.id !== id);
    (appData.assets || []).forEach(a => {
      if (a.roomId === id) a.roomId = '';
    });
    saveData(appData);
    closeModal();
    renderAssets();
    showToast('Asset room deleted');
  });
}

function addAsset(){
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  
  const roomOptions = (appData.assetRooms || []).map(r => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('');
  const roomSelectHtml = `<div class="form-group"><label class="form-label">Room</label><select class="login-input" id="a-room" style="padding:0.4rem;background:var(--bg-input);border:1px solid var(--border-subtle);color:var(--text-primary);border-radius:var(--radius-sm);width:100%;"><option value="">-- No Room Assigned --</option>${roomOptions}</select></div>`;
  
  openModal('Add Asset Item',`
    <div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="a-name" placeholder="e.g. Centrifuge 5424R"></div>
    <div class="form-group"><label class="form-label">Model / Brand</label><input class="form-input" id="a-model" placeholder="e.g. Eppendorf"></div>
    <div class="form-group"><label class="form-label">Barcode (optional)</label><input class="form-input" id="a-barcode" placeholder="e.g. 12345678"></div>
    ${roomSelectHtml}
    <div class="form-group"><label class="form-label">Description / Note</label><textarea class="form-textarea" id="a-desc" placeholder="Details about this asset..." rows="4"></textarea></div>
  `,'Add',()=>{
    const name = $('#a-name').value.trim();
    if(!name){showToast('Enter name','error');return;}
    const model = $('#a-model').value.trim();
    const barcode = $('#a-barcode').value.trim();
    const description = $('#a-desc').value.trim();
    const roomId = $('#a-room').value;
    const newItem = {id:genId(), name, model, barcode, description, roomId};
    appData.assets = appData.assets || [];
    appData.assets.push(newItem);
    saveData(appData);
    closeModal();
    logHistory(`Added asset "${name}"`);
    renderAssets();
    showToast('Asset added');
  });
}

function editAsset(id){
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  const asset = (appData.assets||[]).find(a=>a.id===id);
  if(!asset)return;
  
  const roomOptions = (appData.assetRooms || []).map(r => `<option value="${r.id}" ${r.id === asset.roomId ? 'selected' : ''}>${escHtml(r.name)}</option>`).join('');
  const roomSelectHtml = `<div class="form-group"><label class="form-label">Room</label><select class="login-input" id="a-room" style="padding:0.4rem;background:var(--bg-input);border:1px solid var(--border-subtle);color:var(--text-primary);border-radius:var(--radius-sm);width:100%;"><option value="">-- No Room Assigned --</option>${roomOptions}</select></div>`;
  
  openModal('Edit Asset Item',`
    <div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="a-name" value="${escHtml(asset.name)}"></div>
    <div class="form-group"><label class="form-label">Model / Brand</label><input class="form-input" id="a-model" value="${escHtml(asset.model||'')}"></div>
    <div class="form-group"><label class="form-label">Barcode (optional)</label><input class="form-input" id="a-barcode" value="${escHtml(asset.barcode||'')}"></div>
    ${roomSelectHtml}
    <div class="form-group"><label class="form-label">Description / Note</label><textarea class="form-textarea" id="a-desc" rows="4">${escHtml(asset.description||'')}</textarea></div>
  `,'Save',()=>{
    const name = $('#a-name').value.trim();
    if(!name){showToast('Enter name','error');return;}
    asset.name = name;
    asset.model = $('#a-model').value.trim();
    asset.barcode = $('#a-barcode').value.trim();
    asset.description = $('#a-desc').value.trim();
    asset.roomId = $('#a-room').value;
    saveData(appData);
    closeModal();
    logHistory(`Edited asset "${name}"`);
    renderAssets();
    showToast('Asset saved');
  });
}

function deleteAsset(id){
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  const asset = (appData.assets||[]).find(a=>a.id===id);
  if(!asset)return;
  openModal('Delete Asset',`<p>Delete <strong>${escHtml(asset.name)}</strong> from inventory?</p>`,'Delete',()=>{
    verifyCaptchaAndExecute(() => {
      appData.assets = (appData.assets||[]).filter(a=>a.id!==id);
      saveData(appData);
      closeModal();
      logHistory(`Deleted asset "${asset.name}"`);
      renderAssets();
      showToast('Asset deleted');
    });
  });
}

function uploadBarcode(id){
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  const asset = (appData.assets||[]).find(a=>a.id===id);
  if(!asset)return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = e => {
    const file = e.target.files[0];
    if(!file)return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 600;
        let w = img.width, h = img.height;
        if(w > maxDim || h > maxDim) {
          if(w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        asset.barcodeImg = canvas.toDataURL('image/png');
        saveData(appData);
        renderAssets();
        showToast('Barcode image uploaded');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function deleteBarcode(id){
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  const asset = (appData.assets||[]).find(a=>a.id===id);
  if(!asset)return;
  openModal('Remove Barcode',`<p>Remove barcode image from <strong>${escHtml(asset.name)}</strong>?</p>`,'Remove',()=>{
    verifyCaptchaAndExecute(() => {
      asset.barcodeImg = null;
      saveData(appData);
      closeModal();
      renderAssets();
      showToast('Barcode image removed');
    });
  });
}

function viewBarcode(id){
  const asset = (appData.assets||[]).find(a=>a.id===id);
  if(!asset || !asset.barcodeImg)return;
  openModal('Barcode Viewer', `
    <div style="text-align:center;">
      <p style="margin-bottom:1rem;color:var(--text-secondary);">Barcode for <strong>${escHtml(asset.name)}</strong></p>
      <img src="${asset.barcodeImg}" style="max-width:100%;max-height:60vh;display:block;margin:0 auto;background:white;padding:12px;border-radius:var(--radius-md);">
    </div>
  `, 'Close', closeModal);
}

$('#logo-home').addEventListener('click',()=>navigateTo('rooms'));
$('#btn-add-room').addEventListener('click',addRoom);
$$('.add-room-btn').forEach(b=>b.addEventListener('click',addRoom));
$('#btn-add-cabinet').addEventListener('click',()=>addAssetContainer('cabinet'));
$('#btn-add-fridge').addEventListener('click',()=>addAssetContainer('fridge'));
$('#btn-add-freezer').addEventListener('click',()=>addAssetContainer('freezer'));
if ($('#btn-add-deepfreezer')) $('#btn-add-deepfreezer').addEventListener('click',()=>addAssetContainer('deepfreezer'));
$('#btn-edit-room').addEventListener('click',editRoom);
$('#btn-delete-room').addEventListener('click',deleteRoom);
$('#btn-add-chemical').addEventListener('click',addChemical);
$$('.add-chem-btn').forEach(b=>b.addEventListener('click',addChemical));
$('#btn-edit-container').addEventListener('click',editContainer);
$('#btn-delete-container').addEventListener('click',deleteContainer);
$('#btn-add-shelf').addEventListener('click',addShelfToFridge);
$('#btn-export-pdf').addEventListener('click',exportPDF);
$('#btn-export-container-pdf').addEventListener('click',exportContainerPDF);

// Nav dropdown toggle
const navDropBtn = $('#nav-dropdown-btn');
const navDropContent = $('#nav-dropdown-content');
if (navDropBtn && navDropContent) {
  navDropBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navDropContent.classList.toggle('show');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#nav-dropdown-container')) {
      navDropContent.classList.remove('show');
    }
  });
}

// Tab navigation (unified)
const tabViewMap = {
  'tab-inventory': 'rooms',
  'tab-protocols': 'protocols',
  'tab-assets': 'assets',
  'tab-noticeboard': 'noticeboard',
  'tab-instruments': 'instruments',
  'tab-printing': 'printing',
  'tab-history': 'history',
  'tab-minigames': 'minigames'
};
Object.keys(tabViewMap).forEach(tabId => {
  const el = $('#'+tabId);
  if (el) {
    el.addEventListener('click', () => {
      if (navDropContent) navDropContent.classList.remove('show');
      if (tabId === 'tab-assets') {
        const si = $('#assets-search-input');
        if (si) si.value = '';
      }
      navigateTo(tabViewMap[tabId]);
    });
  }
});
if ($('#btn-add-asset-room')) $('#btn-add-asset-room').addEventListener('click', addAssetRoom);
$('#btn-add-asset').addEventListener('click',addAsset);
$('#btn-add-asset-empty').addEventListener('click',addAsset);
$('#btn-add-protocol').addEventListener('click',addProtocol);
$('#btn-add-notice').addEventListener('click',addNotice);
$('#btn-add-instrument').addEventListener('click',addInstrument);
$('#btn-add-instrument-empty').addEventListener('click',addInstrument);
$('#btn-add-catalog-item').addEventListener('click',addCatalogItem);
$('#btn-custom-print-request').addEventListener('click',submitCustomPrintRequest);
$('#instruments-search-input').addEventListener('input', () => { renderInstruments(); });

// Assets search box interaction
$('#assets-search-input').addEventListener('input', () => {
  renderAssets();
});

let activeDbListener = null;
let activeGroupsListener = null;
let activeChallengesListener = null;
let allInventoriesData = {};
let allGroupsData = {};
let gameChallenges = {};

// ---------- Firebase Authentication and Multi-Laboratory Portals ----------

function loadGroupOptions() {
  const select = $('#auth-lab-select');
  if (!select) return;
  select.innerHTML = '<option value="" disabled selected>Loading laboratories...</option>';

  function populateSelect(groups) {
    select.innerHTML = '<option value="" disabled selected>Choose a laboratory...</option>';
    if (groups) {
      Object.keys(groups).forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = groups[id].name;
        select.appendChild(opt);
      });
    }
    if (select.options.length <= 1) {
      select.innerHTML = '<option value="" disabled selected>No laboratories found</option>';
    }
  }

  function loadViaREST() {
    console.log('[BioSCom] loadGroupOptions: falling back to REST API');
    fetch(firebaseConfig.databaseURL + '/groups.json')
      .then(r => r.json())
      .then(groups => {
        console.log('[BioSCom] REST fallback succeeded, groups:', groups ? Object.keys(groups).length : 0);
        populateSelect(groups);
      })
      .catch(err => {
        console.error('[BioSCom] REST fallback also failed:', err);
        select.innerHTML = '<option value="" disabled selected>Connection error – try refreshing</option>';
      });
  }

  let resolved = false;
  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      console.warn('[BioSCom] loadGroupOptions: SDK timed out after 5s, using REST fallback');
      loadViaREST();
    }
  }, 5000);

  db.ref('groups').once('value', snapshot => {
    if (resolved) return;
    resolved = true;
    clearTimeout(timeout);
    console.log('[BioSCom] loadGroupOptions: SDK succeeded');
    populateSelect(snapshot.val());
  }, error => {
    if (resolved) return;
    resolved = true;
    clearTimeout(timeout);
    console.error('[BioSCom] loadGroupOptions SDK error:', error);
    loadViaREST();
  });
}

function showAuthPanel(panelId) {
  $$('.login-overlay .login-card').forEach(c => c.classList.add('hidden'));
  $(panelId).classList.remove('hidden');
  $$('.login-overlay .login-error').forEach(e => e.classList.remove('visible'));
}

function getActiveViewName() {
  let activeView = 'rooms';
  $$('.view').forEach(v => {
    if (v.classList.contains('active')) {
      activeView = v.id.replace('view-', '');
    }
  });
  return activeView;
}

function updateSharedContainersListSync() {
  const shared = [];
  if (allInventoriesData && currentGroupId) {
    Object.keys(allInventoriesData).forEach(gid => {
      if (gid !== currentGroupId) {
        const inv = allInventoriesData[gid];
        const groupName = (allGroupsData && allGroupsData[gid]) ? allGroupsData[gid].name : gid;
        if (inv && inv.rooms) {
          inv.rooms.forEach(room => {
            if (room.containers) {
              room.containers.forEach(container => {
                const sharedIds = container.sharedWithGroupIds || (container.sharedWithGroupId ? [container.sharedWithGroupId] : []);
                if (sharedIds.includes(currentGroupId)) {
                  shared.push({
                    ...container,
                    isSharedAsset: true,
                    originalRoomName: room.name,
                    originalGroupId: gid,
                    ownerGroupId: gid,
                    ownerGroupName: groupName
                  });
                }
              });
            }
          });
        }
      }
    });
  }
  sharedContainersList = shared;
  window.sharedContainersList = shared;
}

function startDbSync() {
  if (activeDbListener) {
    db.ref('inventories').off('value', activeDbListener);
  }
  
  activeDbListener = db.ref('inventories').on('value', snapshot => {
    const data = snapshot.val() || {};
    allInventoriesData = data;
    
    if (currentGroupId && data[currentGroupId]) {
      appData = migrateData(data[currentGroupId]);
      try {
        safeStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      } catch(e) {
        console.error(e);
      }
    } else if (currentGroupId) {
      appData = { rooms: [] };
    }
    
    updateSharedContainersListSync();
    
    // Automatically re-render views on remote changes
    const activeView = getActiveViewName();
    if (activeView === 'rooms') renderRooms();
    else if (activeView === 'containers') renderContainers();
    else if (activeView === 'detail') renderDetail();
    else if (activeView === 'assets') renderAssets();
    
    enforceRolePermissions();
  }, error => {
    console.error('[BioSCom Auth] Inventories listener error:', error);
    showToast('Failed to sync inventory data', 'error');
  });

  if (activeGroupsListener) {
    db.ref('groups').off('value', activeGroupsListener);
  }
  activeGroupsListener = db.ref('groups').on('value', snapshot => {
    allGroupsData = snapshot.val() || {};
    updateSharedContainersListSync();
    
    const activeView = getActiveViewName();
    if (activeView === 'rooms') renderRooms();
    else if (activeView === 'containers') renderContainers();
    else if (activeView === 'detail') renderDetail();
  }, error => {
    console.error('[BioSCom Auth] Groups listener error:', error);
    showToast('Failed to sync groups data', 'error');
  });

  if (activeChallengesListener) {
    db.ref('game_challenges').off('value', activeChallengesListener);
  }
  activeChallengesListener = db.ref('game_challenges').on('value', snapshot => {
    gameChallenges = snapshot.val() || {};
    if (getActiveViewName() === 'minigames') {
      renderMinigames();
    }
  });

  if (activeSharedNoticesListener) {
    db.ref('shared_notices').off('value', activeSharedNoticesListener);
  }
  activeSharedNoticesListener = db.ref('shared_notices').on('value', snapshot => {
    const data = snapshot.val();
    sharedNotices = data ? Object.values(data) : [];
    if ($('#view-noticeboard').classList.contains('active')) {
      renderNoticeboard();
    }
  });

  if (activeSharedInstrumentsListener) {
    db.ref('shared_instruments').off('value', activeSharedInstrumentsListener);
  }
  activeSharedInstrumentsListener = db.ref('shared_instruments').on('value', snapshot => {
    const data = snapshot.val();
    sharedInstruments = data ? Object.values(data) : [];
    if ($('#view-instruments').classList.contains('active')) {
      renderInstruments();
    }
  });

  if (activeSharedPrintCatalogListener) {
    db.ref('shared_print_catalog').off('value', activeSharedPrintCatalogListener);
  }
  activeSharedPrintCatalogListener = db.ref('shared_print_catalog').on('value', snapshot => {
    const data = snapshot.val();
    sharedPrintCatalog = data ? Object.values(data) : [];
    if ($('#view-printing').classList.contains('active')) {
      renderPrintCatalog();
    }
  });

  if (activeSharedPrintRequestsListener) {
    db.ref('shared_print_requests').off('value', activeSharedPrintRequestsListener);
  }
  activeSharedPrintRequestsListener = db.ref('shared_print_requests').on('value', snapshot => {
    const data = snapshot.val();
    sharedPrintRequests = data ? Object.values(data) : [];
    if ($('#view-printing').classList.contains('active')) {
      renderPrintCatalog();
    }
  });
}

function checkAuth() {
  const role = getCurrentRole();
  if (!role) {
    $('#login-overlay').classList.remove('hidden');
    $('#app-header').style.display = 'none';
    $('#app-main').style.display = 'none';
  } else {
    $('#login-overlay').classList.add('hidden');
    $('#app-header').style.display = '';
    $('#app-main').style.display = '';
    enforceRolePermissions();
    
    // Validate current view navigation
    let currentActiveView = null;
    $$('.view').forEach(v => {
      if (v.classList.contains('active')) {
        currentActiveView = v.id.replace('view-', '');
      }
    });
    if (currentActiveView === 'assets' && role === 'reader') {
      navigateTo('rooms');
    } else if (currentActiveView) {
      showView(currentActiveView);
    } else {
      navigateTo('rooms');
    }
  }
}

function getAuthErrorMessage(errCode, isRegistration) {
  const loginMessages = {
    'auth/invalid-email': 'Please enter a valid email address',
    'auth/user-disabled': 'This account has been disabled. Contact your lab administrator.',
    'auth/user-not-found': 'No account found with this email. Check the address or create a new account.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/too-many-requests': 'Too many login attempts. Please wait and try again.',
    'auth/invalid-credential': 'Invalid email or password. Please check your credentials.'
  };
  
  const regMessages = {
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
    'auth/weak-password': 'Password is too weak. Use at least 6 characters.'
  };
  
  if (isRegistration && regMessages[errCode]) {
    return regMessages[errCode];
  }
  return loginMessages[errCode] || 'Connection error. Check your internet and try again.';
}

function handleLoginSubmit() {
  const email = $('#login-email').value.trim();
  const password = $('#login-password-field').value.trim();
  
  console.log('[BioSCom Auth] handleLoginSubmit called for email=' + email);
  
  if (!email || !password) {
    $('#auth-login-error').textContent = 'Please fill in all fields';
    $('#auth-login-error').classList.add('visible');
    return;
  }
  
  // Task 8: Pre-login offline check
  db.ref('.info/connected').once('value').then(connectedSnap => {
    const isConnected = connectedSnap.val();
    if (!isConnected) {
      $('#auth-login-error').textContent = 'No internet connection. Please check your network.';
      $('#auth-login-error').classList.add('visible');
      const card = $('#auth-panel-login');
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 400);
      return;
    }
    
    // Task 7: Loading state
    const btn = $('#btn-login-submit');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    
    auth.signInWithEmailAndPassword(email, password)
      .then(() => {
        // Re-enable button
        btn.disabled = false;
        btn.textContent = originalText;
        $('#login-email').value = '';
        $('#login-password-field').value = '';
        $('#auth-login-error').classList.remove('visible');
      })
      .catch(err => {
        // Re-enable button
        btn.disabled = false;
        btn.textContent = originalText;
        // Task 6: Specific error message
        $('#auth-login-error').textContent = getAuthErrorMessage(err.code, false);
        $('#auth-login-error').classList.add('visible');
        const card = $('#auth-panel-login');
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 400);
      });
  });
}

function handleRegUserSubmit() {
  const name = $('#reg-user-name').value.trim();
  const email = $('#reg-user-email').value.trim();
  const password = $('#reg-user-password').value.trim();
  const joinCode = $('#reg-user-code').value.trim();
  
  if (auth.currentUser) {
    if (!name || !joinCode) {
      $('#auth-reg-user-error').textContent = 'Please fill in all fields';
      $('#auth-reg-user-error').classList.add('visible');
      return;
    }
  } else {
    if (!name || !email || !password || !joinCode) {
      $('#auth-reg-user-error').textContent = 'Please fill in all fields';
      $('#auth-reg-user-error').classList.add('visible');
      return;
    }
    if (password.length < 6) {
      $('#auth-reg-user-error').textContent = 'Password must be at least 6 characters';
      $('#auth-reg-user-error').classList.add('visible');
      return;
    }
  }
  
  db.ref('groups').once('value', snapshot => {
    const groups = snapshot.val();
    let matchedGroupId = null;
    
    if (groups) {
      Object.keys(groups).forEach(id => {
        if (groups[id].joinCode && groups[id].joinCode.toUpperCase() === joinCode.toUpperCase()) {
          matchedGroupId = id;
        }
      });
    }
    
    if (!matchedGroupId) {
      $('#auth-reg-user-error').textContent = 'Invalid laboratory join code';
      $('#auth-reg-user-error').classList.add('visible');
      return;
    }
    
    const btn = $('#btn-reg-user-submit');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Joining Lab…';

    isRegistering = true;
    const registerPromise = auth.currentUser
      ? Promise.resolve({ user: auth.currentUser })
      : auth.createUserWithEmailAndPassword(email, password);

    registerPromise
      .then(userCredential => {
        const uid = userCredential.user.uid;
        const userEmail = auth.currentUser ? auth.currentUser.email : email;
        const userProfile = {
          name: name,
          email: userEmail,
          groupId: matchedGroupId,
          role: 'reader'
        };
        
        db.ref('users/' + uid).set(userProfile)
          .then(() => {
            btn.disabled = false;
            btn.textContent = originalText;
            isRegistering = false;
            currentUserProfile = userProfile;
            currentGroupId = matchedGroupId;
            currentUserRole = 'reader';

            db.ref('groups/' + matchedGroupId).once('value').then(groupSnap => {
              const group = groupSnap.val();
              currentGroupName = group ? group.name : '';
              const badge = $('#user-badge');
              if (badge) {
                badge.style.display = 'flex';
                $('#user-badge-name').textContent = name;
                $('#user-badge-lab').textContent = currentGroupName;
                if (group) {
                  const codeEl = $('#user-badge-code');
                  if (codeEl) {
                    codeEl.textContent = 'Join Code: ' + group.joinCode;
                    codeEl.onclick = function() {
                      navigator.clipboard.writeText(group.joinCode).then(function() {
                        showToast('Join code copied to clipboard!', 'info');
                      });
                    };
                  }
                }
              }
              if ($('#btn-user-menu')) {
                $('#btn-user-menu').innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
              }
              checkAuth();
              startDbSync();
              handleHashChange();
              enforceRolePermissions();
            }).catch(function(error) {
              console.error('[BioSCom Auth] Registration group lookup error:', error);
              checkAuth();
              startDbSync();
              handleHashChange();
              enforceRolePermissions();
            });

            console.log('[BioSCom Auth] handleRegUserSubmit SUCCESS - user registered and joined lab, groupId=' + matchedGroupId);
            $('#reg-user-name').value = '';
            $('#reg-user-email').value = '';
            $('#reg-user-password').value = '';
            $('#reg-user-code').value = '';
            showToast('Account registered and joined lab successfully!', 'success');
          });
      })
      .catch(err => {
        btn.disabled = false;
        btn.textContent = originalText;
        isRegistering = false;
        $('#auth-reg-user-error').textContent = getAuthErrorMessage(err.code, true);
        $('#auth-reg-user-error').classList.add('visible');
      });
  });
}

function handleRegGroupSubmit() {
  const labName = $('#reg-group-labname').value.trim();
  const name = $('#reg-group-name').value.trim();
  const email = $('#reg-group-email').value.trim();
  const password = $('#reg-group-password').value.trim();
  
  if (auth.currentUser) {
    if (!labName || !name) {
      $('#auth-reg-group-error').textContent = 'Please fill in all fields';
      $('#auth-reg-group-error').classList.add('visible');
      return;
    }
  } else {
    if (!labName || !name || !email || !password) {
      $('#auth-reg-group-error').textContent = 'Please fill in all fields';
      $('#auth-reg-group-error').classList.add('visible');
      return;
    }
    if (password.length < 6) {
      $('#auth-reg-group-error').textContent = 'Password must be at least 6 characters';
      $('#auth-reg-group-error').classList.add('visible');
      return;
    }
  }
  
  if (countWords(labName) > 300 || countWords(name) > 300) {
    $('#auth-reg-group-error').textContent = 'Laboratory or display name exceeds 300 words';
    $('#auth-reg-group-error').classList.add('visible');
    return;
  }
  
  const cleanPrefix = labName.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase();
  const randomNum = Math.floor(100 + Math.random() * 900);
  const joinCode = `${cleanPrefix || 'LAB'}-${randomNum}`;
  
  const isBioSCom = labName.toLowerCase().trim() === 'bioscom';
  
  const btn = $('#btn-reg-group-submit');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creating Lab…';

  isRegistering = true;
  const registerPromise = auth.currentUser
    ? Promise.resolve({ user: auth.currentUser })
    : auth.createUserWithEmailAndPassword(email, password);

  registerPromise
    .then(userCredential => {
      const uid = userCredential.user.uid;
      const userEmail = auth.currentUser ? auth.currentUser.email : email;
      
      // Now authenticated, read the template inventory
      return db.ref(isBioSCom ? 'inventory' : 'empty_sandbox_placeholder').once('value')
        .then(invSnapshot => {
          const existingInventory = invSnapshot.val() || { rooms: [] };
          const groupRef = db.ref('groups').push();
          const groupId = groupRef.key;
          
          const groupData = {
            name: labName,
            created: Date.now(),
            joinCode: joinCode
          };
          
          const userProfile = {
            name: name,
            email: userEmail,
            groupId: groupId,
            role: 'admin'
          };

          return db.ref('users/' + uid).set(userProfile)
            .then(() => {
              return Promise.all([
                db.ref('groups/' + groupId).set(groupData),
                db.ref('inventories/' + groupId).set(existingInventory)
              ]);
            }).then(() => {
              return { userProfile, groupId, labName };
            });
        })
        .then(result => {
          btn.disabled = false;
          btn.textContent = originalText;
          isRegistering = false;
          currentUserProfile = result.userProfile;
          currentGroupId = result.groupId;
          currentUserRole = 'admin';
          currentGroupName = result.labName;

          const badge = $('#user-badge');
          if (badge) {
            badge.style.display = 'flex';
            $('#user-badge-name').textContent = name;
            $('#user-badge-lab').textContent = labName;
            const codeEl = $('#user-badge-code');
            if (codeEl) {
              codeEl.textContent = 'Join Code: ' + joinCode;
              codeEl.onclick = function() {
                navigator.clipboard.writeText(joinCode).then(function() {
                  showToast('Join code copied to clipboard!', 'info');
                });
              };
            }
          }
          if ($('#btn-user-menu')) {
            $('#btn-user-menu').innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
          }

          checkAuth();
          startDbSync();
          handleHashChange();
          enforceRolePermissions();

          console.log('[BioSCom Auth] handleRegGroupSubmit SUCCESS - lab created, groupId=' + groupId + ', labName=' + labName);
          $('#reg-group-labname').value = '';
          $('#reg-group-name').value = '';
          $('#reg-group-email').value = '';
          $('#reg-group-password').value = '';
          showToast('Laboratory group created successfully!', 'success');
        });
    })
    .catch(err => {
      btn.disabled = false;
      btn.textContent = originalText;
      isRegistering = false;
      $('#auth-reg-group-error').textContent = getAuthErrorMessage(err.code, true);
      $('#auth-reg-group-error').classList.add('visible');
    });
}

function enforceRolePermissions() {
  const role = getCurrentRole();
  if (role === 'reader') {
    const tabAssets = $('#tab-assets');
    if (tabAssets) tabAssets.style.display = 'none';
    
    const btnImport = $('#btn-import');
    if (btnImport) btnImport.style.display = 'none';
    
    const btnExport = $('#btn-export');
    if (btnExport) btnExport.style.display = 'none';
    
    const btnAddRoom = $('#btn-add-room');
    if (btnAddRoom) btnAddRoom.style.display = 'none';
    
    $$('.add-room-btn').forEach(b => b.style.display = 'none');
    
    const btnEditRoom = $('#btn-edit-room');
    if (btnEditRoom) btnEditRoom.style.display = 'none';
    
    const btnDeleteRoom = $('#btn-delete-room');
    if (btnDeleteRoom) btnDeleteRoom.style.display = 'none';
    
    const btnAddCabinet = $('#btn-add-cabinet');
    if (btnAddCabinet) btnAddCabinet.style.display = 'none';
    
    const btnAddFridge = $('#btn-add-fridge');
    if (btnAddFridge) btnAddFridge.style.display = 'none';
    
    const btnAddFreezer = $('#btn-add-freezer');
    if (btnAddFreezer) btnAddFreezer.style.display = 'none';
    
    const btnEditContainer = $('#btn-edit-container');
    if (btnEditContainer) btnEditContainer.style.display = 'none';
    
    const btnDeleteContainer = $('#btn-delete-container');
    if (btnDeleteContainer) btnDeleteContainer.style.display = 'none';
    
    const btnAddShelf = $('#btn-add-shelf');
    if (btnAddShelf) btnAddShelf.style.display = 'none';
    
    const btnAddChem = $('#btn-add-chemical');
    if (btnAddChem) btnAddChem.style.display = 'none';
    
    $$('.add-chem-btn').forEach(b => b.style.display = 'none');
    
    const btnAddInst = $('#btn-add-instrument');
    if (btnAddInst) btnAddInst.style.display = 'none';
    const btnAddInstEmpty = $('#btn-add-instrument-empty');
    if (btnAddInstEmpty) btnAddInstEmpty.style.display = 'none';
    
    const btnCustomPrint = $('#btn-custom-print-request');
    if (btnCustomPrint) btnCustomPrint.style.display = 'none';
  } else {
    const tabAssets = $('#tab-assets');
    if (tabAssets) tabAssets.style.display = '';
    
    const btnImport = $('#btn-import');
    if (btnImport) btnImport.style.display = '';
    
    const btnExport = $('#btn-export');
    if (btnExport) btnExport.style.display = '';
    
    const btnAddRoom = $('#btn-add-room');
    if (btnAddRoom) btnAddRoom.style.display = '';
    
    $$('.add-room-btn').forEach(b => b.style.display = '');
    
    const btnEditRoom = $('#btn-edit-room');
    if (btnEditRoom) btnEditRoom.style.display = '';
    
    const btnDeleteRoom = $('#btn-delete-room');
    if (btnDeleteRoom) btnDeleteRoom.style.display = '';
    
    const btnAddCabinet = $('#btn-add-cabinet');
    if (btnAddCabinet) btnAddCabinet.style.display = '';
    
    const btnAddFridge = $('#btn-add-fridge');
    if (btnAddFridge) btnAddFridge.style.display = '';
    
    const btnAddFreezer = $('#btn-add-freezer');
    if (btnAddFreezer) btnAddFreezer.style.display = '';
    
    const btnEditContainer = $('#btn-edit-container');
    if (btnEditContainer) btnEditContainer.style.display = '';
    
    const btnDeleteContainer = $('#btn-delete-container');
    if (btnDeleteContainer) btnDeleteContainer.style.display = '';
    
    const btnAddShelf = $('#btn-add-shelf');
    if (btnAddShelf) {
      const cont = getContainer(currentRoomId, currentContainerId);
      btnAddShelf.style.display = (cont && cont.type === 'deepfreezer') ? 'none' : '';
    }
    
    const btnAddChem = $('#btn-add-chemical');
    if (btnAddChem) btnAddChem.style.display = '';
    
    $$('.add-chem-btn').forEach(b => b.style.display = '');
    
    const btnAddInst = $('#btn-add-instrument');
    if (btnAddInst) btnAddInst.style.display = '';
    const btnAddInstEmpty = $('#btn-add-instrument-empty');
    if (btnAddInstEmpty) btnAddInstEmpty.style.display = '';
    
    const btnCustomPrint = $('#btn-custom-print-request');
    if (btnCustomPrint) btnCustomPrint.style.display = '';
  }
  
  // 3D Catalog addition is STRICTLY superadmin only
  const btnAddCatalog = $('#btn-add-catalog-item');
  if (btnAddCatalog) btnAddCatalog.style.display = (role === 'superadmin' || role === 'admin') ? '' : 'none';
}

// Bind panel actions
$('#btn-to-login').addEventListener('click', () => {
  showAuthPanel('#auth-panel-login');
  const selectEl = $('#auth-lab-select');
  if (selectEl && selectEl.value && selectEl.selectedIndex !== -1) {
    const labName = selectEl.options[selectEl.selectedIndex].text;
    $('#auth-login-subtitle').textContent = 'Sign In to ' + labName;
  } else {
    $('#auth-login-subtitle').textContent = 'Sign In to BioSCom';
  }
});

$('#btn-to-register-user').addEventListener('click', () => {
  showAuthPanel('#auth-panel-register-user');
  if (auth.currentUser) {
    $('#reg-user-email').value = auth.currentUser.email;
    $('#reg-user-email').disabled = true;
    $('#reg-user-password').value = '••••••';
    $('#reg-user-password').disabled = true;
  } else {
    $('#reg-user-email').value = '';
    $('#reg-user-email').disabled = false;
    $('#reg-user-password').value = '';
    $('#reg-user-password').disabled = false;
  }
});
$('#btn-to-register-group').addEventListener('click', () => {
  showAuthPanel('#auth-panel-register-group');
  if (auth.currentUser) {
    $('#reg-group-email').value = auth.currentUser.email;
    $('#reg-group-email').disabled = true;
    $('#reg-group-password').value = '••••••';
    $('#reg-group-password').disabled = true;
  } else {
    $('#reg-group-email').value = '';
    $('#reg-group-email').disabled = false;
    $('#reg-group-password').value = '';
    $('#reg-group-password').disabled = false;
  }
});

$('#btn-login-back').addEventListener('click', () => showAuthPanel('#auth-panel-welcome'));
$('#btn-reg-user-back').addEventListener('click', () => showAuthPanel('#auth-panel-welcome'));
$('#btn-reg-group-back').addEventListener('click', () => showAuthPanel('#auth-panel-welcome'));

// Forms submissions bindings
$('#btn-login-submit').addEventListener('click', handleLoginSubmit);
$('#login-password-field').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLoginSubmit();
});

const btnForgotPassword = $('#btn-forgot-password');
if (btnForgotPassword) {
  btnForgotPassword.addEventListener('click', e => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    if (!email) {
      showToast('Please enter your email address in the Email field first.', 'error');
      return;
    }
    
    const originalText = btnForgotPassword.textContent;
    btnForgotPassword.style.pointerEvents = 'none';
    btnForgotPassword.textContent = 'Sending...';
    
    auth.sendPasswordResetEmail(email)
      .then(() => {
        showToast('Password reset email sent! Please check your inbox.', 'success');
        btnForgotPassword.textContent = originalText;
        btnForgotPassword.style.pointerEvents = 'auto';
      })
      .catch(err => {
        showToast(getAuthErrorMessage(err.code, true), 'error');
        btnForgotPassword.textContent = originalText;
        btnForgotPassword.style.pointerEvents = 'auto';
      });
  });
}

$('#btn-reg-user-submit').addEventListener('click', handleRegUserSubmit);
$('#reg-user-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleRegUserSubmit();
});

$('#btn-reg-group-submit').addEventListener('click', handleRegGroupSubmit);
$('#reg-group-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleRegGroupSubmit();
});

// Logout action
$('#btn-logout').addEventListener('click', () => {
  if (window.activeHistoryListenerGroupId) {
    db.ref('history/' + window.activeHistoryListenerGroupId).off('value');
    db.ref('backups/' + window.activeHistoryListenerGroupId).off('value');
    window.activeHistoryListenerGroupId = null;
    window.activeHistoryListener = false;
    window.activeBackupsListener = false;
  }
  if (window.backupIntervalId) clearInterval(window.backupIntervalId);
  auth.signOut().then(() => {
    showToast('Logged out successfully', 'info');
  });
});

// Firebase Auth Session State Trigger
auth.onAuthStateChanged(user => {
  console.log('[BioSCom Auth] onAuthStateChanged triggered:', user ? 'user=' + user.uid : 'no user');
  if (user) {
    // Race-condition guard: during registration, skip profile check – the registration
    // handler's .then() chain will set isRegistering=false and run init manually.
    if (isRegistering) {
      console.log('[BioSCom Auth] Registration in progress - skipping profile check');
      return;
    }

    const uid = user.uid;
    console.log('[BioSCom Auth] Starting profile fetch for uid=' + uid);
  showToast('Loading your laboratory data…', 'info');
    // Use on('value') listener to handle Firebase RTDB auth-token propagation race condition
    // (firebase-js-sdk#7381, #7841). Unlike once('value')+retry, this listener fires
    // automatically when data becomes available after the auth token propagates.
    window._profileUid = uid;
    let profileResolved = false;
    const profileRef = db.ref('users/' + uid);

    const cleanupProfileListener = () => {
      if (window._profileTimeout) { clearTimeout(window._profileTimeout); window._profileTimeout = null; }
      if (window._profileListener) { profileRef.off('value', window._profileListener); window._profileListener = null; }
      profileResolved = true;
    };

    window._profileListener = profileRef.on('value', snapshot => {
      const p = snapshot.val();
      if (p && !profileResolved) {
        console.log('[BioSCom Auth] Profile fetch SUCCESS for uid=' + uid + ', name=' + (p.name || 'N/A'));
        cleanupProfileListener();
        currentUserProfile = p;
        currentGroupId = p.groupId;
        currentUserRole = p.role;

        // Update user badge in nav
        if ($('#user-badge')) {
          $('#user-badge').style.display = 'flex';
          $('#user-badge-name').textContent = p.name || user.email;
          if (p.status) {
            $('#user-badge-lab').textContent = p.status;
          } else {
            $('#user-badge-lab').textContent = p.role === 'superadmin' ? 'Super Admin' : (p.role === 'admin' ? 'Lab Admin' : 'Member');
          }
        }

        // Update Avatar icon
        if ($('#btn-user-menu') && p.avatar) {
          $('#btn-user-menu').innerHTML = `<img src="${escHtml(p.avatar)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">`;
        } else if ($('#btn-user-menu')) {
          $('#btn-user-menu').innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
        }

        // Stepan Superadmin Check
        const isSuperAdmin = p.email && p.email.toLowerCase() === '505618@muni.cz';
        if (isSuperAdmin) {
          currentUserRole = 'superadmin';
        }

        db.ref('groups/' + currentGroupId).once('value')
          .then(groupSnapshot => {
          const group = groupSnapshot.val();
          console.log('[BioSCom Auth] Group lookup SUCCESS for groupId=' + currentGroupId + ', name=' + (group ? group.name : 'N/A'));
          currentGroupName = group ? group.name : '';

          const badge = $('#user-badge');
          if (badge) {
            $('#user-badge-name').textContent = p.name;
            $('#user-badge-lab').textContent = group ? group.name : 'Unknown Lab';

            const codeEl = $('#user-badge-code');
            if (codeEl) {
              codeEl.textContent = group ? `Join Code: ${group.joinCode}` : '';
              codeEl.onclick = () => {
                navigator.clipboard.writeText(group.joinCode).then(() => {
                  showToast('Join code copied to clipboard!', 'info');
                });
              };
            }
            badge.style.display = 'flex';
          }

          // Render Super Admin Console
          if (currentUserRole === 'superadmin') {
            const superSelect = $('#superadmin-lab-select');
            if (superSelect) {
              superSelect.innerHTML = '';
              db.ref('groups').once('value', snap => {
                const groups = snap.val();
                if (groups) {
                  Object.keys(groups).forEach(id => {
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = groups[id].name;
                    superSelect.appendChild(opt);
                  });
                  superSelect.value = currentGroupId;
                }
              });
            }
            $('#superadmin-console').style.display = 'inline-flex';
          } else {
            $('#superadmin-console').style.display = 'none';
          }

          checkAuth();
          startDbSync();
          handleHashChange();

          const btnMembers = $('#btn-group-members');
          if (btnMembers) btnMembers.style.display = 'inline-flex';
        })
        .catch(error => {
          console.error('[BioSCom Auth] Group lookup error:', error.message);
          currentGroupName = 'Unknown Lab'; // fallback
          showToast('Failed to load laboratory data. Check your connection.', 'error');
          checkAuth();
          startDbSync();
          handleHashChange();
        });
      }
      // If p is null, keep listening – data may arrive after auth token propagates to RTDB
    }, error => {
      if (!profileResolved) {
        cleanupProfileListener();
        if (error.code === 'PERMISSION_DENIED') {
          showToast('Access denied. Your account does not have the required permissions.', 'error');
        } else {
          showToast('Network error while loading your profile. Please try again.', 'error');
        }
        showAuthPanel('#auth-panel-welcome');
        loadGroupOptions();
      }
    });

    // 10 s timeout – if profile data has not arrived via SDK, try REST API fallback
    window._profileTimeout = setTimeout(() => {
      if (!profileResolved) {
        cleanupProfileListener();
        console.warn('[BioSCom Auth] SDK profile fetch timed out after 10s, trying REST API fallback');
        
        // REST API fallback: fetch profile using auth token
        user.getIdToken().then(token => {
          return fetch(firebaseConfig.databaseURL + '/users/' + uid + '.json?auth=' + token);
        }).then(r => r.json()).then(p => {
          if (!p || !p.groupId) {
            console.error('[BioSCom Auth] REST profile fetch returned empty or invalid data');
            showToast('Account profile not found. Please contact your lab administrator.', 'error');
            
            const btnSignIn = $('#btn-to-login');
            if (btnSignIn) {
              btnSignIn.textContent = 'Sign Out (' + user.email + ')';
              btnSignIn.onclick = () => {
                auth.signOut().then(() => {
                  btnSignIn.textContent = 'Sign In';
                  btnSignIn.onclick = null;
                  showToast('Logged out successfully', 'info');
                });
              };
            }
            
            showAuthPanel('#auth-panel-welcome');
            loadGroupOptions();
            return;
          }
          
          console.log('[BioSCom Auth] REST profile fetch SUCCESS for uid=' + uid + ', name=' + (p.name || 'N/A'));
          currentUserProfile = p;
          currentGroupId = p.groupId;
          currentUserRole = p.role;
          currentUserId = uid;

          // Stepan Superadmin Check
          const isSuperAdmin = p.email && p.email.toLowerCase() === '505618@muni.cz';
          if (isSuperAdmin) {
            currentUserRole = 'superadmin';
          }

          // Update user badge in nav
          if ($('#user-badge')) {
            $('#user-badge').style.display = 'flex';
            $('#user-badge-name').textContent = p.name || user.email;
            if (p.status) {
              $('#user-badge-lab').textContent = p.status;
            } else {
              $('#user-badge-lab').textContent = p.role === 'superadmin' ? 'Super Admin' : (p.role === 'admin' ? 'Lab Admin' : 'Member');
            }
          }

          // Update Avatar icon
          if ($('#btn-user-menu') && p.avatar) {
            $('#btn-user-menu').innerHTML = `<img src="${escHtml(p.avatar)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">`;
          } else if ($('#btn-user-menu')) {
            $('#btn-user-menu').innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
          }

          // Fetch group info via REST
          return user.getIdToken().then(token => {
            return fetch(firebaseConfig.databaseURL + '/groups/' + currentGroupId + '.json?auth=' + token);
          }).then(r => r.json()).then(group => {
            console.log('[BioSCom Auth] REST group lookup SUCCESS for groupId=' + currentGroupId);
            currentGroupName = group ? group.name : '';

            const badge = $('#user-badge');
            if (badge) {
              $('#user-badge-name').textContent = p.name;
              $('#user-badge-lab').textContent = group ? group.name : 'Unknown Lab';
              const codeEl = $('#user-badge-code');
              if (codeEl) {
                codeEl.textContent = group ? `Join Code: ${group.joinCode}` : '';
                codeEl.onclick = () => {
                  navigator.clipboard.writeText(group.joinCode).then(() => {
                    showToast('Join code copied to clipboard!', 'info');
                  });
                };
              }
              badge.style.display = 'flex';
            }

            // Render Super Admin Console
            if (currentUserRole === 'superadmin') {
              const superSelect = $('#superadmin-lab-select');
              if (superSelect) {
                superSelect.innerHTML = '';
                fetch(firebaseConfig.databaseURL + '/groups.json').then(r => r.json()).then(groups => {
                  if (groups) {
                    Object.keys(groups).forEach(id => {
                      const opt = document.createElement('option');
                      opt.value = id;
                      opt.textContent = groups[id].name;
                      superSelect.appendChild(opt);
                    });
                    superSelect.value = currentGroupId;
                  }
                });
              }
              $('#superadmin-console').style.display = 'inline-flex';
            } else {
              $('#superadmin-console').style.display = 'none';
            }

            checkAuth();
            startDbSync();
            handleHashChange();

            const btnMembers = $('#btn-group-members');
            if (btnMembers) btnMembers.style.display = 'inline-flex';
          });
        }).catch(err => {
          console.error('[BioSCom Auth] REST profile fallback failed:', err);
          showToast('Failed to load profile. Please try refreshing the page.', 'error');
          showAuthPanel('#auth-panel-welcome');
          loadGroupOptions();
        });
      }
    }, 10000);
  } else {
    // Detach profile listener on sign-out so it does not leak
    if (window._profileTimeout) { clearTimeout(window._profileTimeout); window._profileTimeout = null; }
    if (window._profileListener) { db.ref('users/' + window._profileUid).off('value', window._profileListener); window._profileListener = null; }
    window._profileUid = null;

    currentUserProfile = null;
    currentGroupId = null;
    currentUserRole = null;
    currentGroupName = '';
    
    if (activeDbListener && db) {
      db.ref('inventories').off('value', activeDbListener);
      activeDbListener = null;
    }
    if (activeGroupsListener && db) {
      db.ref('groups').off('value', activeGroupsListener);
      activeGroupsListener = null;
    }
    if (activeChallengesListener && db) {
      db.ref('game_challenges').off('value', activeChallengesListener);
      activeChallengesListener = null;
    }
    if (activeSharedNoticesListener && db) {
      db.ref('shared_notices').off('value', activeSharedNoticesListener);
      activeSharedNoticesListener = null;
    }
    if (activeSharedInstrumentsListener && db) {
      db.ref('shared_instruments').off('value', activeSharedInstrumentsListener);
      activeSharedInstrumentsListener = null;
    }
    if (activeSharedPrintCatalogListener && db) {
      db.ref('shared_print_catalog').off('value', activeSharedPrintCatalogListener);
      activeSharedPrintCatalogListener = null;
    }
    if (activeSharedPrintRequestsListener && db) {
      db.ref('shared_print_requests').off('value', activeSharedPrintRequestsListener);
      activeSharedPrintRequestsListener = null;
    }
    
    const badge = $('#user-badge');
    if (badge) badge.style.display = 'none';
    $('#superadmin-console').style.display = 'none';
    
    const btnMembers = $('#btn-group-members');
    if (btnMembers) btnMembers.style.display = 'none';
    
    const btnSignIn = $('#btn-to-login');
    if (btnSignIn) {
      btnSignIn.textContent = 'Sign In';
      btnSignIn.onclick = null;
    }
    
    checkAuth();
    showAuthPanel('#auth-panel-welcome');
    loadGroupOptions();
  }
});

// Global Function to display and manage Group Members
function showGroupMembersModal() {
  if (!currentGroupId) return;
  
  const canManage = (currentUserRole === 'superadmin' || currentUserRole === 'admin');
  const isSuperadminViewer = auth.currentUser && (currentUserRole === 'superadmin' || auth.currentUser.email === '505618@muni.cz');
  
  db.ref('users').once('value', snapshot => {
    const allUsers = snapshot.val();
    let html = '<div style="margin-top: 1rem; max-height: 350px; overflow-y: auto;"><table style="width:100%; border-collapse:collapse; font-size:0.85rem;">';
    const actionsHeader = isSuperadminViewer ? '<th style="padding:0.6rem 0; text-align:right;">Actions</th>' : '';
    html += `<tr style="border-bottom:1px solid var(--border-subtle); text-align:left; color:var(--text-muted);"><th style="padding:0.6rem 0;">Name</th><th style="padding:0.6rem 0;">Email</th><th style="padding:0.6rem 0;">Role</th>${actionsHeader}</tr>`;
    
    let count = 0;
    if (allUsers) {
      Object.keys(allUsers).forEach(uid => {
        const u = allUsers[uid];
        if (u.groupId === currentGroupId) {
          count++;
          
          let roleCell = '';
          const isMe = (auth.currentUser && auth.currentUser.uid === uid);
          const userIsSuperadmin = u.email && u.email.toLowerCase() === '505618@muni.cz';
          const canEditThisUser = userIsSuperadmin ? false : (isSuperadminViewer ? true : (canManage && !isMe && u.role !== 'superadmin'));
          
          if (canEditThisUser) {
            const saOption = isSuperadminViewer ? `<option value="superadmin" ${u.role === 'superadmin' ? 'selected' : ''}>Super Admin</option>` : '';
            roleCell = `
              <select class="login-input" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; margin: 0; background: var(--bg-card); border: 1px solid var(--border-subtle); color: var(--text-primary); border-radius: var(--radius-sm); outline: none; cursor: pointer; width: auto;" onchange="window.updateUserRole('${uid}', this.value)">
                <option value="reader" ${u.role === 'reader' ? 'selected' : ''}>Reader</option>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                ${saOption}
              </select>
            `;
          } else {
            const displayRole = u.role === 'superadmin' ? 'Super Admin' : (u.role === 'admin' ? 'Admin' : 'Reader');
            const colorClass = u.role === 'superadmin' ? 'var(--accent-purple)' : (u.role === 'admin' ? 'var(--accent-cyan)' : 'var(--text-muted)');
            roleCell = `<span style="font-weight: 600; color: ${colorClass};">${displayRole}${isMe ? ' (You)' : ''}</span>`;
          }
          
          let actionsCell = '';
          if (isSuperadminViewer) {
            if (isMe || userIsSuperadmin) {
              actionsCell = `<td style="padding:0.6rem 0; text-align:right; color:var(--text-muted);">—</td>`;
            } else {
              actionsCell = `<td style="padding:0.6rem 0; text-align:right;"><button class="login-btn" style="padding:0.2rem 0.5rem; font-size:0.7rem; background:var(--accent-red); margin:0; width:auto; border-radius: var(--radius-sm);" onclick="window.deleteUserProfile('${uid}')">Delete</button></td>`;
            }
          }
          
          const memberAvatarHtml = u.avatar ? `<img src="${escHtml(u.avatar)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-subtle); margin-right: 0.5rem;" title="${escHtml(u.name || 'User')}">` : `<span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: rgba(255,255,255,0.06); border: 1px solid var(--border-subtle); margin-right: 0.5rem; font-size: 0.75rem; color: var(--text-muted);">👤</span>`;
          html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:0.6rem 0; font-weight:600; color:var(--text-primary); display: flex; align-items: center;">${memberAvatarHtml}${escHtml(u.name || 'Unknown')}</td><td style="padding:0.6rem 0; color:var(--text-secondary);">${escHtml(u.email || '')}</td><td style="padding:0.6rem 0;">${roleCell}</td>${actionsCell}</tr>`;
        }
      });
    }
    
    if (count === 0) {
      const colSpan = isSuperadminViewer ? 4 : 3;
      html += `<tr><td colspan="${colSpan}" style="padding:1rem 0; text-align:center; color:var(--text-muted);">No members registered in this group.</td></tr>`;
    }
    
    html += '</table></div>';
    
    let labName = 'Active Lab';
    const badgeLab = $('#user-badge-lab');
    if (badgeLab) labName = badgeLab.textContent;
    
    openModal(`Members of ${labName}`, html, 'Close', () => closeModal());
  });
}

// Global window reference to allow inline element event calling
window.updateUserRole = function(uid, newRole) {
  db.ref(`users/${uid}/role`).set(newRole)
    .then(() => {
      showToast('User role updated successfully!', 'success');
      showGroupMembersModal(); // Dynamic refresh in place!
    })
    .catch(err => {
      showToast('Error updating role: ' + err.message, 'danger');
    });
};

window.deleteUserProfile = function(uid) {
  if (confirm('Are you sure you want to delete this user profile? The user will be removed from this laboratory group.')) {
    db.ref(`users/${uid}`).remove()
      .then(() => {
        showToast('User profile deleted successfully!', 'success');
        showGroupMembersModal(); // Dynamic refresh in place!
      })
      .catch(err => {
        showToast('Error deleting profile: ' + err.message, 'danger');
      });
  }
};

// Event Bindings
const btnGroupMembers = $('#btn-group-members');
if (btnGroupMembers) {
  btnGroupMembers.addEventListener('click', showGroupMembersModal);
}

const saMembersBtn = $('#btn-superadmin-members');
if (saMembersBtn) {
  saMembersBtn.addEventListener('click', showGroupMembersModal);
}

// Super Admin Switcher Event Bindings
const saSelect = $('#superadmin-lab-select');
if (saSelect) {
  saSelect.addEventListener('change', e => {
    const selectedGroupId = e.target.value;
    if (selectedGroupId && currentUserRole === 'superadmin') {
      currentGroupId = selectedGroupId;
      
      db.ref('groups/' + currentGroupId).once('value', groupSnapshot => {
        const group = groupSnapshot.val();
        if (group) {
          $('#user-badge-lab').textContent = group.name;
          const codeEl = $('#user-badge-code');
          if (codeEl) {
            codeEl.textContent = `Join Code: ${group.joinCode}`;
            codeEl.onclick = () => {
              navigator.clipboard.writeText(group.joinCode).then(() => {
                showToast('Join code copied to clipboard!', 'info');
              });
            };
          }
        }
        startDbSync();
        showToast(`Switched active view to ${group ? group.name : 'laboratory'}`, 'info');
      });
    }
  });
}

// ---------- Super Admin: Labs Management ----------
function showLabsManagement() {
  if (currentUserRole !== 'superadmin') { showToast('Access Denied', 'error'); return; }
  
  Promise.all([
    new Promise(r => db.ref('groups').once('value', s => r(s.val()))),
    new Promise(r => db.ref('users').once('value', s => r(s.val()))),
    new Promise(r => db.ref('inventories').once('value', s => r(s.val())))
  ]).then(([groups, users, inventories]) => {
    let html = '<div style="max-height: 450px; overflow-y: auto;">';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">';
    html += '<thead><tr style="border-bottom: 2px solid var(--border-subtle); text-align: left;">';
    html += '<th style="padding: 0.6rem 0.5rem; color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">Laboratory</th>';
    html += '<th style="padding: 0.6rem 0.5rem; color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase;">Join Code</th>';
    html += '<th style="padding: 0.6rem 0.5rem; color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase;">Members</th>';
    html += '<th style="padding: 0.6rem 0.5rem; color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase;">Rooms</th>';
    html += '<th style="padding: 0.6rem 0.5rem; color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; text-align: center;">Actions</th>';
    html += '</tr></thead><tbody>';
    
    if (groups) {
      Object.keys(groups).forEach(gid => {
        const g = groups[gid];
        const memberCount = users ? Object.values(users).filter(u => u.groupId === gid).length : 0;
        const inv = inventories && inventories[gid] ? inventories[gid] : null;
        const roomCount = inv && inv.rooms ? inv.rooms.length : 0;
        const isCurrentLab = (gid === currentGroupId);
        
        html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);${isCurrentLab ? ' background: rgba(59,130,246,0.06);' : ''}">`;
        html += `<td style="padding: 0.6rem 0.5rem; font-weight: 600; color: var(--text-primary);">${escHtml(g.name)}${isCurrentLab ? ' <span style="font-size:0.65rem;color:var(--accent-blue);font-weight:700;">(Active)</span>' : ''}</td>`;
        html += `<td style="padding: 0.6rem 0.5rem;"><span style="font-family: monospace; font-size: 0.8rem; background: rgba(255,255,255,0.05); padding: 0.15rem 0.4rem; border-radius: 4px; color: var(--accent-cyan); cursor: pointer;" onclick="navigator.clipboard.writeText('${escHtml(g.joinCode || '')}').then(()=>showToast('Code copied!','info'))" title="Click to copy">${escHtml(g.joinCode || '—')}</span></td>`;
        html += `<td style="padding: 0.6rem 0.5rem; color: var(--text-secondary);">${memberCount}</td>`;
        html += `<td style="padding: 0.6rem 0.5rem; color: var(--text-secondary);">${roomCount}</td>`;
        html += `<td style="padding: 0.6rem 0.5rem; text-align: center;">`;
        html += `<button class="btn-inline" onclick="window.saLabSwitch('${gid}')" title="Switch to this lab" style="margin-right: 0.25rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg></button>`;
        html += `<button class="btn-inline danger" onclick="window.saLabDelete('${gid}','${escHtml(g.name)}')" title="Delete lab"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
        html += `</td></tr>`;
      });
    }
    
    html += '</tbody></table></div>';
    
    const totalLabs = groups ? Object.keys(groups).length : 0;
    html = `<div style="margin-bottom: 1rem; font-size: 0.8rem; color: var(--text-muted);">Total laboratories: <strong style="color: var(--text-primary);">${totalLabs}</strong></div>` + html;
    
    openModal('🔬 Laboratory Management', html, 'Close', () => closeModal());
  });
}

window.saLabSwitch = function(gid) {
  if (currentUserRole !== 'superadmin') return;
  currentGroupId = gid;
  const saSelect = $('#superadmin-lab-select');
  if (saSelect) saSelect.value = gid;
  
  db.ref('groups/' + gid).once('value', groupSnapshot => {
    const group = groupSnapshot.val();
    if (group) {
      $('#user-badge-lab').textContent = group.name;
      const codeEl = $('#user-badge-code');
      if (codeEl) {
        codeEl.textContent = `Join Code: ${group.joinCode}`;
        codeEl.onclick = () => {
          navigator.clipboard.writeText(group.joinCode).then(() => {
            showToast('Join code copied to clipboard!', 'info');
          });
        };
      }
    }
    closeModal();
    startDbSync();
    showToast(`Switched to ${group ? group.name : 'laboratory'}`, 'info');
  });
};

window.saLabDelete = function(gid, labName) {
  if (currentUserRole !== 'superadmin') return;
  if (gid === currentGroupId) {
    showToast('Cannot delete the currently active lab. Switch to another lab first.', 'error');
    return;
  }
  
  closeModal();
  openModal('⚠️ Delete Laboratory', `
    <div style="line-height: 1.6;">
      <p>Are you sure you want to permanently delete <strong style="color: var(--accent-red);">${escHtml(labName)}</strong>?</p>
      <div style="margin-top: 1rem; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: var(--radius-md); padding: 0.75rem;">
        <p style="font-size: 0.85rem; color: var(--accent-red); font-weight: 600; margin-bottom: 0.25rem;">⚠️ This action is irreversible!</p>
        <p style="font-size: 0.8rem; color: var(--text-secondary);">This will delete all inventory data, protocols, assets, and remove all members from this laboratory group.</p>
      </div>
    </div>
  `, 'Delete Lab', () => {
    verifyCaptchaAndExecute(() => {
      // Delete inventory, group, and reassign/remove users
      Promise.all([
      db.ref('inventories/' + gid).remove(),
      db.ref('groups/' + gid).remove(),
      new Promise(resolve => {
        db.ref('users').once('value', snap => {
          const users = snap.val();
          const updates = {};
          if (users) {
            Object.keys(users).forEach(uid => {
              if (users[uid].groupId === gid) {
                updates['users/' + uid] = null;
              }
            });
          }
          if (Object.keys(updates).length > 0) {
            db.ref().update(updates).then(resolve);
          } else {
            resolve();
          }
        });
      })
    ]).then(() => {
      closeModal();
      showToast(`Laboratory "${labName}" deleted successfully`, 'success');
      // Refresh superadmin lab selector
      const saSelect = $('#superadmin-lab-select');
      if (saSelect) {
        db.ref('groups').once('value', snap => {
          saSelect.innerHTML = '';
          const groups = snap.val();
          if (groups) {
            Object.keys(groups).forEach(id => {
              const opt = document.createElement('option');
              opt.value = id;
              opt.textContent = groups[id].name;
              saSelect.appendChild(opt);
            });
            saSelect.value = currentGroupId;
          }
        });
      }
    }).catch(err => {
      showToast('Error deleting lab: ' + err.message, 'error');
    });
    });
  });
};

// Bind Labs Management button
const saLabsBtn = $('#btn-superadmin-labs');
if (saLabsBtn) {
  saLabsBtn.addEventListener('click', showLabsManagement);
}


// ---------- Frog CAPTCHA ----------
function verifyCaptchaAndExecute(actionCallback) {
  const frogs = [
    { file: 'Dendrobates_auratus.jpg', name: 'Dendrobates auratus' },
    { file: 'Dendrobates_azureus.jpg', name: 'Dendrobates azureus' },
    { file: 'Dendrobates_leucomelas.jpg', name: 'Dendrobates leucomelas' },
    { file: 'Dendrobates_tinctorius_citronella.webp', name: 'Dendrobates tinctorius citronella' },
    { file: 'Dendrobates_tinctorius_nominant.jpg', name: 'Dendrobates tinctorius nominant' },
    { file: 'Dendrobates_tinctorius_tumucumaque.jpg', name: 'Dendrobates tinctorius tumucumaque' },
    { file: 'Dendrobates_truncatus.jpg', name: 'Dendrobates truncatus' },
    { file: 'Excidobates_captivus.jpg', name: 'Excidobates captivus' },
    { file: 'Excidobates_mysteriosus.jpg', name: 'Excidobates mysteriosus' },
    { file: 'Oophaga_histrionica.webp', name: 'Oophaga histrionica' },
    { file: 'Oophaga_pumilio.jpg', name: 'Oophaga pumilio' },
    { file: 'Oophaga_sylvatica.jpg', name: 'Oophaga sylvatica' },
    { file: 'Phyllobates_aurotaenia.jpg', name: 'Phyllobates aurotaenia' },
    { file: 'Phyllobates_bicolor.jpg', name: 'Phyllobates bicolor' },
    { file: 'Phyllobates_terribillis.jpg', name: 'Phyllobates terribillis' },
    { file: 'Ranitomeya_fulgurita.jpg', name: 'Ranitomeya fulgurita' },
    { file: 'pralesnicka-pruhovana-phyllobates-vittatus-2631.jpg', name: 'Phyllobates vittatus' }
  ];
  
  const targetFrog = frogs[Math.floor(Math.random() * frogs.length)];
  let options = [targetFrog.name];
  while(options.length < 3) {
    const f = frogs[Math.floor(Math.random() * frogs.length)].name;
    if(!options.includes(f)) options.push(f);
  }
  options.sort(() => Math.random() - 0.5);
  
  const buttonsHtml = options.map(opt => 
    `<button class="btn-primary" style="margin: 0.25rem; width: 100%; padding: 0.75rem;" onclick="window.checkFrogCaptcha('${opt.replace(/'/g, "\\'")}', '${targetFrog.name.replace(/'/g, "\\'")}')">${opt}</button>`
  ).join('');
  
  window.pendingCaptchaCallback = actionCallback;
  window.checkFrogCaptcha = function(selected, target) {
    if (selected === target) {
      closeModal();
      if(window.pendingCaptchaCallback) window.pendingCaptchaCallback();
      window.pendingCaptchaCallback = null;
    } else {
      showToast('Wrong frog! Try again.', 'error');
      closeModal();
    }
  };
  
  openModal('🐸 Anti-Bot Check', `
    <style>.modal-footer { display: none !important; }</style>
    <div style="text-align: center;">
      <p style="margin-bottom: 1rem; color: var(--text-secondary);">Please identify this dendrobatid frog to confirm deletion:</p>
      <img src="Capcha/${targetFrog.file}" style="max-width: 100%; max-height: 250px; border-radius: 8px; margin-bottom: 1.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
      <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;">
        ${buttonsHtml}
      </div>
      <button class="btn-secondary" style="margin-top: 1rem; width: 100%;" onclick="closeModal()">Cancel</button>
    </div>
  `, null, null);
}

// ---------- Instruments ----------
function renderInstruments() {
  const instruments = sharedInstruments || [];
  const searchVal = ($('#instruments-search-input') ? $('#instruments-search-input').value : '').toLowerCase();
  let filtered = instruments;
  if (searchVal) {
    filtered = instruments.filter(i => (i.name||'').toLowerCase().includes(searchVal) || (i.description||'').toLowerCase().includes(searchVal) || (i.location||'').toLowerCase().includes(searchVal) || (i.ownerLabName||'').toLowerCase().includes(searchVal));
  }
  if (!filtered.length) {
    $('#instruments-grid').innerHTML = '';
    $('#instruments-grid').style.display = 'none';
    $('#instruments-empty').style.display = 'block';
    return;
  }
  $('#instruments-empty').style.display = 'none';
  $('#instruments-grid').style.display = 'grid';
  
  const today = new Date().toISOString().slice(0,10);
  
  $('#instruments-grid').innerHTML = filtered.map(inst => {
    const bookingsList = inst.bookings ? Object.values(inst.bookings) : [];
    const upcoming = bookingsList
      .filter(b => b.date >= today)
      .sort((a,b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    
    let bookingPreviewHtml = '';
    if (upcoming.length > 0) {
      bookingPreviewHtml += '<div class="instrument-card-schedule">';
      upcoming.slice(0, 3).forEach(b => {
        const displayDate = b.date === today ? 'Today' : b.date.slice(5);
        bookingPreviewHtml += `
          <div class="instrument-schedule-item">
            <span class="instrument-schedule-time">📅 ${displayDate} ${b.startTime}–${b.endTime}</span>
            <span class="instrument-schedule-user">${escHtml(b.userName)} (${escHtml(b.labName ? b.labName.slice(0, 10) : 'Lab')})</span>
          </div>
        `;
      });
      if (upcoming.length > 3) {
        bookingPreviewHtml += `
          <div class="instrument-schedule-item" style="justify-content: center; font-size: 0.7rem; opacity: 0.7;">
            <span>+ ${upcoming.length - 3} more booking${upcoming.length - 3 !== 1 ? 's' : ''}</span>
          </div>
        `;
      }
      bookingPreviewHtml += '</div>';
    } else {
      bookingPreviewHtml = `
        <div class="instrument-card-schedule">
          <div class="instrument-schedule-free">🟢 Free to book</div>
        </div>
      `;
    }
    
    const isSuperadmin = getCurrentRole() === 'superadmin';
    const isOwner = inst.ownerLabId === currentGroupId;
    const canEditDelete = isSuperadmin || isOwner;
    const editBtn = canEditDelete ? `<button class="btn-inline" onclick="event.stopPropagation();editInstrument('${inst.id}')" title="Edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : '';
    const deleteBtn = canEditDelete ? `<button class="btn-inline danger" onclick="event.stopPropagation();deleteInstrument('${inst.id}')" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : '';
    const actionsHtml = canEditDelete ? `<div class="asset-actions">${editBtn}${deleteBtn}</div>` : '';

    return `<div class="instrument-card" data-inst-id="${inst.id}" onclick="viewInstrument('${inst.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="asset-title">${escHtml(inst.name)}</div>
        <span class="instrument-badge">🔬 Instrument</span>
      </div>
      <div class="asset-description">${escHtml(inst.description || '')}</div>
      <div class="instrument-info-row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span>${escHtml(inst.location || 'Not specified')}</span>
      </div>
      <div class="instrument-info-row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        <span>${escHtml(inst.ownerLabName || 'Unknown lab')} — ${escHtml(inst.contactPerson || '')}</span>
      </div>
      ${bookingPreviewHtml}
      ${actionsHtml}
    </div>`;
  }).join('');
}

function addInstrument() {
  if (getCurrentRole() === 'reader') { showToast('Access Denied','error'); return; }
  const labName = currentGroupName || '';
  const userName = currentUserProfile ? currentUserProfile.name || '' : '';
  const userEmail = currentUserProfile ? currentUserProfile.email || '' : '';
  openModal('Add Instrument', `
    <div class="form-group"><label class="form-label">Instrument Name *</label><input class="form-input" id="f-inst-name" placeholder="e.g. HPLC Agilent 1260"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="f-inst-desc" placeholder="e.g. High-performance liquid chromatography"></textarea></div>
    <div class="form-group"><label class="form-label">Location *</label><input class="form-input" id="f-inst-loc" placeholder="e.g. Room B302, Desk 4"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Contact Person</label><input class="form-input" id="f-inst-contact" value="${escHtml(userName)}"></div>
      <div class="form-group"><label class="form-label">Contact E-mail</label><input class="form-input" id="f-inst-email" value="${escHtml(userEmail)}"></div>
    </div>
  `, 'Add', () => {
    const name = $('#f-inst-name').value.trim();
    const loc = $('#f-inst-loc').value.trim();
    const desc = $('#f-inst-desc').value.trim();
    const contact = $('#f-inst-contact').value.trim();
    const email = $('#f-inst-email').value.trim();
    if (!name || name.length > 80) { showToast('Instrument name is required (max 80 chars)','error'); return; }
    if (!loc) { showToast('Please enter location','error'); return; }
    if (countWords(name) > 300 || countWords(loc) > 300 || countWords(desc) > 300 || countWords(contact) > 300 || countWords(email) > 300) {
      showToast('Instrument fields exceed 300 words!', 'error');
      return;
    }
    const instId = genId();
    const instData = {
      id: instId, name, description: desc,
      location: loc, ownerLabName: labName, ownerLabId: currentGroupId,
      contactPerson: contact,
      contactEmail: email,
      bookings: []
    };
    db.ref('shared_instruments/' + instId).set(instData)
      .then(() => {
        closeModal();
        showToast('Instrument "'+name+'" was added');
        logHistory(`Added instrument "${name}"`);
      })
      .catch(e => { showToast('Failed to add instrument', 'error'); });
  });
}

function editInstrument(id) {
  const inst = (sharedInstruments||[]).find(i=>i.id===id);
  if (!inst) return;
  const isSuperadmin = getCurrentRole() === 'superadmin';
  const isOwner = inst.ownerLabId === currentGroupId;
  if (!isSuperadmin && !isOwner) {
    showToast('Access Denied: This instrument can only be edited by the lab that added it, or a superadmin.', 'error');
    return;
  }
  openModal('Edit Instrument', `
    <div class="form-group"><label class="form-label">Instrument Name *</label><input class="form-input" id="f-inst-name" value="${escHtml(inst.name)}"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="f-inst-desc">${escHtml(inst.description||'')}</textarea></div>
    <div class="form-group"><label class="form-label">Location *</label><input class="form-input" id="f-inst-loc" value="${escHtml(inst.location||'')}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Contact Person</label><input class="form-input" id="f-inst-contact" value="${escHtml(inst.contactPerson||'')}"></div>
      <div class="form-group"><label class="form-label">Contact E-mail</label><input class="form-input" id="f-inst-email" value="${escHtml(inst.contactEmail||'')}"></div>
    </div>
  `, 'Save', () => {
    const name = $('#f-inst-name').value.trim();
    const loc = $('#f-inst-loc').value.trim();
    const desc = $('#f-inst-desc').value.trim();
    const contact = $('#f-inst-contact').value.trim();
    const email = $('#f-inst-email').value.trim();
    if (!name) { showToast('Please enter a name','error'); return; }
    if (!loc) { showToast('Please enter location','error'); return; }
    if (countWords(name) > 300 || countWords(loc) > 300 || countWords(desc) > 300 || countWords(contact) > 300 || countWords(email) > 300) {
      showToast('Instrument fields exceed 300 words!', 'error');
      return;
    }
    const updated = {
      ...inst,
      name,
      description: desc,
      location: loc,
      contactPerson: contact,
      contactEmail: email
    };
    db.ref('shared_instruments/' + id).set(updated)
      .then(() => {
        closeModal();
        showToast('Saved successfully');
        logHistory(`Edited instrument "${name}"`);
      })
      .catch(e => { showToast('Failed to save changes', 'error'); });
  });
}

function deleteInstrument(id) {
  const inst = (sharedInstruments||[]).find(i=>i.id===id);
  if (!inst) return;
  const isSuperadmin = getCurrentRole() === 'superadmin';
  const isOwner = inst.ownerLabId === currentGroupId;
  if (!isSuperadmin && !isOwner) {
    showToast('Access Denied: This instrument can only be deleted by the lab that added it, or a superadmin.', 'error');
    return;
  }
  openModal('Delete Instrument', `<p>Are you sure you want to delete the instrument <strong>${escHtml(inst.name)}</strong>?</p>`, 'Delete', () => {
    verifyCaptchaAndExecute(() => {
      db.ref('shared_instruments/' + id).remove()
        .then(() => {
          showToast('Instrument deleted');
          logHistory(`Deleted instrument "${inst.name}"`);
        })
        .catch(e => { showToast('Error deleting instrument', 'error'); });
    });
  });
}

function viewInstrument(id) {
  const inst = (sharedInstruments||[]).find(i=>i.id===id);
  if (!inst) return;
  const today = new Date().toISOString().slice(0,10);
  const bookingsList = inst.bookings ? Object.values(inst.bookings) : [];
  const upcoming = bookingsList.filter(b => b.date >= today).sort((a,b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const past = bookingsList.filter(b => b.date < today).sort((a,b) => b.date.localeCompare(a.date));
  let bookingsHtml = '';
  if (upcoming.length) {
    bookingsHtml += '<h4 style="margin:1rem 0 0.5rem;color:var(--accent-amber);font-size:0.85rem">📅 Upcoming Bookings</h4>';
    upcoming.forEach(b => {
      const isSuperadmin = getCurrentRole() === 'superadmin';
      const currentUserId = auth.currentUser ? auth.currentUser.uid : '';
      const isCreator = b.userId === currentUserId || (b.userName && b.userName === (currentUserProfile ? currentUserProfile.name || '' : ''));
      const canCancel = isSuperadmin || isCreator;
      const cancelBtnHtml = canCancel ? `<button class="btn-inline danger" onclick="cancelBooking('${inst.id}','${b.id}')" title="Cancel Booking" style="margin-left:0.5rem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : '';

      bookingsHtml += `<div class="booking-item"><div><span class="booking-time">${escHtml(b.date)} ${escHtml(b.startTime)}–${escHtml(b.endTime)}</span></div><div><span class="booking-user">${escHtml(b.userName)}</span><br><span class="booking-lab">${escHtml(b.labName||'')}</span></div><div>${b.note ? '<span style="font-size:0.75rem;color:var(--text-muted)">'+escHtml(b.note)+'</span>' : ''}${cancelBtnHtml}</div></div>`;
    });
  }
  if (past.length) {
    bookingsHtml += '<h4 style="margin:1rem 0 0.5rem;color:var(--text-muted);font-size:0.85rem">Past Bookings</h4>';
    past.slice(0,5).forEach(b => {
      bookingsHtml += `<div class="booking-item" style="opacity:0.5"><div><span class="booking-time">${escHtml(b.date)} ${escHtml(b.startTime)}–${escHtml(b.endTime)}</span></div><div><span class="booking-user">${escHtml(b.userName)}</span></div><div></div></div>`;
    });
  }
  if (!upcoming.length && !past.length) {
    bookingsHtml = '<p style="text-align:center;color:var(--text-muted);padding:1rem">No bookings yet</p>';
  }

  const html = `
    <div style="margin-bottom:1rem">
      <div class="instrument-info-row" style="margin-bottom:0.5rem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${escHtml(inst.location||'N/A')}</div>
      <div class="instrument-info-row" style="margin-bottom:0.5rem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> ${escHtml(inst.ownerLabName||'')} — ${escHtml(inst.contactPerson||'')} ${inst.contactEmail ? '(<a href="mailto:'+escHtml(inst.contactEmail)+'" style="color:var(--accent-blue)">'+escHtml(inst.contactEmail)+'</a>)' : ''}</div>
      ${inst.description ? '<p style="font-size:0.85rem;color:var(--text-secondary);margin-top:0.5rem">'+escHtml(inst.description)+'</p>' : ''}
    </div>
    <div style="border-top:1px solid var(--border-subtle);padding-top:1rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="font-size:1rem;font-weight:700">Schedule</h3>
        <button class="btn-primary" onclick="bookInstrument('${inst.id}')" style="font-size:0.8rem;padding:0.4rem 0.8rem">+ Book Time Slot</button>
      </div>
      <div class="booking-list">${bookingsHtml}</div>
    </div>
  `;
  openModal('🔬 ' + escHtml(inst.name), html, 'Close', () => closeModal());
}

function bookInstrument(instId) {
  const inst = (sharedInstruments||[]).find(i=>i.id===instId);
  if (!inst) return;
  const userName = currentUserProfile ? currentUserProfile.name || 'Unknown' : 'Unknown';
  const labName = currentGroupName || '';
  const today = new Date().toISOString().slice(0,10);
  closeModal();
  setTimeout(() => {
    openModal('Book: ' + escHtml(inst.name), `
      <div class="form-group"><label class="form-label">Date *</label><input class="form-input" id="f-book-date" type="date" value="${today}" min="${today}"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Start Time *</label><input class="form-input" id="f-book-start" type="time" value="09:00"></div>
        <div class="form-group"><label class="form-label">End Time *</label><input class="form-input" id="f-book-end" type="time" value="12:00"></div>
      </div>
      <div class="form-group"><label class="form-label">Note</label><input class="form-input" id="f-book-note" placeholder="e.g. Running 10 samples"></div>
    `, 'Book', () => {
      const date = $('#f-book-date').value;
      const start = $('#f-book-start').value;
      const end = $('#f-book-end').value;
      if (!date||!start||!end) { showToast('Fill all fields','error'); return; }
      if (start >= end) { showToast('End time must be after start','error'); return; }
      const bookingsList = inst.bookings ? Object.values(inst.bookings) : [];
      const conflict = bookingsList.find(b => b.date === date && b.startTime < end && b.endTime > start);
      if (conflict) { showToast('Time conflict with '+conflict.userName+' ('+conflict.startTime+'-'+conflict.endTime+')','error'); return; }
      
      const bookingId = genId();
      const newBooking = { id: bookingId, userId: auth.currentUser?.uid||'', userName, labName, date, startTime: start, endTime: end, note: $('#f-book-note').value.trim() };
      
      db.ref('shared_instruments/' + instId + '/bookings/' + bookingId).set(newBooking)
        .then(() => {
          closeModal();
          showToast('Booked!');
          logHistory(`Booked instrument "${inst.name}" for ${date} ${start}–${end}`);
          setTimeout(() => viewInstrument(instId), 200);
        })
        .catch(e => { showToast('Booking failed', 'error'); });
    });
  }, 250);
}

function cancelBooking(instId, bookingId) {
  const inst = (sharedInstruments||[]).find(i=>i.id===instId);
  if (!inst) return;
  const booking = inst.bookings ? inst.bookings[bookingId] : null;
  if (!booking) return;

  const isSuperadmin = getCurrentRole() === 'superadmin';
  const currentUserId = auth.currentUser ? auth.currentUser.uid : '';
  const isCreator = booking.userId === currentUserId || (booking.userName && booking.userName === (currentUserProfile ? currentUserProfile.name || '' : ''));

  if (!isSuperadmin && !isCreator) {
    showToast('Access Denied: This booking can only be cancelled by its creator or a superadmin.', 'error');
    return;
  }

  openModal('Cancel Instrument Booking', `<p>Are you sure you want to cancel the booking for <strong>${escHtml(inst.name)}</strong> on ${escHtml(booking.date)} from ${escHtml(booking.startTime)} to ${escHtml(booking.endTime)}?</p>`, 'Cancel', () => {
    verifyCaptchaAndExecute(() => {
      db.ref('shared_instruments/' + instId + '/bookings/' + bookingId).remove()
        .then(() => {
          showToast('Booking cancelled');
          logHistory(`Cancelled booking for instrument "${inst.name}" on ${booking.date} ${booking.startTime}–${booking.endTime}`);
          setTimeout(() => viewInstrument(instId), 200);
        })
        .catch(e => {
          showToast('Failed to cancel booking', 'error');
        });
    });
  });
}

// Helper: Canvas image compression
function compressImage(file, callback) {
  const reader = new FileReader();
  reader.onload = function(event) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      const MAX_SIDE = 300;
      if (width > height) {
        if (width > MAX_SIDE) {
          height *= MAX_SIDE / width;
          width = MAX_SIDE;
        }
      } else {
        if (height > MAX_SIDE) {
          width *= MAX_SIDE / height;
          height = MAX_SIDE;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const base64 = canvas.toDataURL('image/jpeg', 0.7);
      callback(base64);
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// ---------- 3D Print ----------
const categoryOptions = [
  'Racks & Holders',
  'Adapters & Clamps',
  'Fluidics & Tubing',
  'Enclosures & Boxes',
  'Safety Gears',
  'Others'
];

const materialOptions = [
  'PLA',
  'PETG',
  'ABS',
  'TPU',
  'Nylon',
  'SLA Resin'
];

function switchPrintTab(tab) {
  activePrintTab = tab;
  if (tab === 'catalog') {
    $('#print-tab-catalog-btn').classList.add('active');
    $('#print-tab-requests-btn').classList.remove('active');
  } else {
    $('#print-tab-catalog-btn').classList.remove('active');
    $('#print-tab-requests-btn').classList.add('active');
  }
  renderPrintCatalog();
}

function filterCatalogCategory(category) {
  activeCatalogCategory = category;
  $$('#print-category-filters .filter-pill').forEach(pill => {
    if (pill.getAttribute('onclick').includes("'" + category + "'")) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
  renderPrintCatalog();
}

function renderPrintCatalog() {
  if (activePrintTab === 'catalog') {
    $('#print-catalog-tab-content').style.display = 'block';
    $('#print-requests-tab-content').style.display = 'none';
    
    const catalog = sharedPrintCatalog || [];
    const filtered = activeCatalogCategory === 'all'
      ? catalog
      : catalog.filter(item => item.category === activeCatalogCategory);
      
    if (!filtered.length) {
      $('#print-catalog-grid').innerHTML = '';
      $('#print-catalog-grid').style.display = 'none';
      $('#print-catalog-empty').style.display = 'block';
    } else {
      $('#print-catalog-empty').style.display = 'none';
      $('#print-catalog-grid').style.display = 'grid';
      $('#print-catalog-grid').innerHTML = filtered.map(item => {
        const imageHtml = item.image 
          ? `<div class="catalog-card-image-wrapper"><img src="${item.image}" class="catalog-card-image" alt="${escHtml(item.name)}"></div>`
          : `<div class="catalog-card-image-wrapper"><div class="catalog-card-no-image">🖨️</div></div>`;
          
        const isSuperadmin = getCurrentRole() === 'superadmin';
        const editDeleteBtns = isSuperadmin ? `
          <button class="btn-inline" onclick="event.stopPropagation();editCatalogItem('${item.id}')" title="Edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn-inline danger" onclick="event.stopPropagation();deleteCatalogItem('${item.id}')" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        ` : '';

        return `
          <div class="print-catalog-card" data-catalog-id="${item.id}" onclick="requestPrint('${item.id}')">
            ${imageHtml}
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:0.5rem">
              <div class="asset-title" style="font-size:1rem;font-weight:600">${escHtml(item.name)}</div>
              ${item.category ? '<span class="print-badge category" style="font-size:0.7rem;background:rgba(14,165,233,0.15);color:var(--accent-blue);padding:0.15rem 0.4rem;border-radius:4px;font-weight:600">' + escHtml(item.category) + '</span>' : ''}
            </div>
            <div class="asset-description" style="margin:0.5rem 0;font-size:0.8rem;color:var(--text-secondary);min-height:2.4rem">${escHtml(item.description || '')}</div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
              ${item.estimatedTime ? '<span class="print-badge time" style="font-size:0.7rem;background:rgba(245,158,11,0.15);color:var(--accent-amber);padding:0.15rem 0.4rem;border-radius:4px;font-weight:600">⏱ ' + escHtml(item.estimatedTime) + '</span>' : ''}
              ${item.material ? '<span class="print-badge material" style="font-size:0.7rem;background:rgba(255,255,255,0.08);color:var(--text-primary);padding:0.15rem 0.4rem;border-radius:4px;font-weight:600">🧱 ' + escHtml(item.material) + '</span>' : ''}
            </div>
            <div class="asset-actions" style="display:flex;justify-content:space-between;align-items:center;margin-top:auto">
              <div style="display:flex;gap:0.35rem">${editDeleteBtns}</div>
              ${getCurrentRole() !== 'reader' ? `<button class="btn-primary" onclick="event.stopPropagation();requestPrint('${item.id}')" style="font-size:0.75rem;padding:0.35rem 0.7rem">Print</button>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
  } else {
    $('#print-catalog-tab-content').style.display = 'none';
    $('#print-requests-tab-content').style.display = 'block';
    
    const requests = [...(sharedPrintRequests || [])].sort((a, b) => b.requestDate.localeCompare(a.requestDate));
    if (!requests.length) {
      $('#print-requests-list').innerHTML = '';
      $('#print-requests-empty').style.display = 'block';
    } else {
      $('#print-requests-empty').style.display = 'none';
      const statusColors = { pending: 'pending', printing: 'printing', done: 'done', rejected: 'rejected' };
      const statusLabels = { pending: 'Pending', printing: 'Printing', done: 'Done', rejected: 'Rejected' };
      
      $('#print-requests-list').innerHTML = requests.map(r => {
        const isSuperadmin = getCurrentRole() === 'superadmin';
        const canManage = isSuperadmin;
        const selectHtml = canManage ? `
          <select onchange="updatePrintStatus('${r.id}',this.value)" style="font-size:0.75rem;padding:0.25rem;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;cursor:pointer">
            <option value="pending" ${r.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="printing" ${r.status === 'printing' ? 'selected' : ''}>Printing</option>
            <option value="done" ${r.status === 'done' ? 'selected' : ''}>Done</option>
            <option value="rejected" ${r.status === 'rejected' ? 'selected' : ''}>Rejected</option>
          </select>
        ` : '';


        const currentUserId = auth.currentUser ? auth.currentUser.uid : '';
        const isCreator = r.requestedByUid === currentUserId || (r.requestedBy && r.requestedBy === (currentUserProfile ? currentUserProfile.name || '' : ''));
        const canDeleteRequest = isSuperadmin || isCreator;
        const deleteRequestBtn = canDeleteRequest ? `<button class="btn-inline danger" onclick="deletePrintRequest('${r.id}')" title="Delete request" style="padding:0.35rem;border-radius:4px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : '';

        return `
          <div class="print-request-card" data-request-id="${r.id}" style="padding:1rem;border:1px solid var(--border-subtle);border-radius:var(--radius-md);margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.01);transition:border-color 0.2s" onmouseover="this.style.borderColor='var(--border-light)'" onmouseout="this.style.borderColor='var(--border-subtle)'">
            <div style="flex:1;min-width:0;padding-right:1rem">
              <div style="font-weight:600;color:var(--text-primary);font-size:0.95rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
                <span>${escHtml(r.catalogItemName)}</span>
                ${r.customDesign ? '<span style="font-size:0.7rem;background:rgba(245,158,11,0.15);color:var(--accent-amber);padding:0.1rem 0.3rem;border-radius:4px;font-weight:600">Custom Design</span>' : ''}
                <span style="font-size:0.8rem;background:rgba(255,255,255,0.05);color:var(--text-secondary);padding:0.1rem 0.4rem;border-radius:4px">× ${r.quantity} pcs</span>
              </div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem">
                From: <strong>${escHtml(r.requestedBy)}</strong> (${escHtml(r.requestedByLabName || 'Unknown lab')}) — ${escHtml(r.requestDate)}
              </div>
              ${r.note ? '<div style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.4rem;background:rgba(255,255,255,0.02);padding:0.4rem;border-radius:4px;border-left:2px solid var(--border-subtle)">' + escHtml(r.note) + '</div>' : ''}
            </div>
            <div style="display:flex;align-items:center;gap:0.75rem;flex-shrink:0">
              <span class="status-badge ${statusColors[r.status] || 'pending'}" style="font-size:0.75rem;padding:0.25rem 0.5rem;border-radius:4px;font-weight:600">${statusLabels[r.status] || r.status}</span>
              ${selectHtml}
              ${deleteRequestBtn}
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

function addCatalogItem() {
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  const catOptionsHtml = categoryOptions.map(c => `<option value="${c}">${c}</option>`).join('');
  const matOptionsHtml = materialOptions.map(m => `<option value="${m}">${m}</option>`).join('');

  openModal('Add to 3D Catalog', `
    <div class="form-group"><label class="form-label">Item Name *</label><input class="form-input" id="f-cat-name" placeholder="e.g. Test tube rack (15ml)"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="f-cat-desc" placeholder="e.g. Holds 24 tubes, suitable for standard desk"></textarea></div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Category *</label>
        <select class="form-select" id="f-cat-category" style="width:100%;padding:0.5rem;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:var(--radius-sm)">
          ${catOptionsHtml}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Material *</label>
        <select class="form-select" id="f-cat-material" style="width:100%;padding:0.5rem;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:var(--radius-sm)">
          ${matOptionsHtml}
        </select>
      </div>
    </div>
    <div class="form-row" style="margin-top: 1rem;">
      <div class="form-group"><label class="form-label">Estimated Print Time</label><input class="form-input" id="f-cat-time" placeholder="e.g. 4h"></div>
      <div class="form-group">
        <label class="form-label">Product Photo</label>
        <input type="file" id="f-cat-image-file" accept="image/*" style="display:none">
        <button type="button" class="btn-secondary" onclick="$('#f-cat-image-file').click()" style="width:100%;padding:0.5rem;display:flex;align-items:center;justify-content:center;gap:0.5rem">
          📷 Select Photo
        </button>
        <div id="f-cat-image-preview-wrap" style="margin-top:0.5rem;max-height:100px;display:none;position:relative">
          <img id="f-cat-image-preview" style="max-height:100px;border-radius:4px;object-fit:cover;border:1px solid var(--border-subtle)">
          <button type="button" class="btn-inline danger" onclick="$('#f-cat-image-file').value='';$('#f-cat-image-preview-wrap').style.display='none';window.tempCatImageBase64='';" style="position:absolute;top:5px;left:90px;padding:0.2rem">🗑️</button>
        </div>
      </div>
    </div>
  `, 'Add', () => {
    const name = $('#f-cat-name').value.trim();
    const desc = $('#f-cat-desc').value.trim();
    const estTime = $('#f-cat-time').value.trim();
    if (!name) { showToast('Please enter item name', 'error'); return; }
    if (countWords(name) > 300 || countWords(desc) > 300 || countWords(estTime) > 300) {
      showToast('Catalog item fields exceed 300 words!', 'error');
      return;
    }
    
    const itemId = genId();
    const itemData = {
      id: itemId,
      name,
      description: desc,
      category: $('#f-cat-category').value,
      material: $('#f-cat-material').value,
      estimatedTime: estTime,
      image: window.tempCatImageBase64 || ''
    };
    
    db.ref('shared_print_catalog/' + itemId).set(itemData)
      .then(() => {
        closeModal();
        showToast('Item "' + name + '" added to catalog');
        window.tempCatImageBase64 = '';
        logHistory(`Added 3D print catalog item "${name}"`);
      })
      .catch(e => {
        showToast('Error saving item', 'error');
      });
  });

  window.tempCatImageBase64 = '';
  setTimeout(() => {
    const fileInput = $('#f-cat-image-file');
    if (fileInput) {
      fileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
          compressImage(file, base64 => {
            window.tempCatImageBase64 = base64;
            $('#f-cat-image-preview').src = base64;
            $('#f-cat-image-preview-wrap').style.display = 'block';
          });
        }
      });
    }
  }, 100);
}

function editCatalogItem(id) {
  const isSuperadmin = getCurrentRole() === 'superadmin';
  if (!isSuperadmin) {
    showToast('Access Denied: Catalog items can only be edited by superadmins.', 'error');
    return;
  }
  const item = (sharedPrintCatalog || []).find(i => i.id === id);
  if (!item) return;

  const catOptionsHtml = categoryOptions.map(c => `<option value="${c}" ${item.category === c ? 'selected' : ''}>${c}</option>`).join('');
  const matOptionsHtml = materialOptions.map(m => `<option value="${m}" ${item.material === m ? 'selected' : ''}>${m}</option>`).join('');

  openModal('Edit Catalog Item', `
    <div class="form-group"><label class="form-label">Item Name *</label><input class="form-input" id="f-cat-name" value="${escHtml(item.name)}"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="f-cat-desc">${escHtml(item.description || '')}</textarea></div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Category *</label>
        <select class="form-select" id="f-cat-category" style="width:100%;padding:0.5rem;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:var(--radius-sm)">
          ${catOptionsHtml}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Material *</label>
        <select class="form-select" id="f-cat-material" style="width:100%;padding:0.5rem;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:var(--radius-sm)">
          ${matOptionsHtml}
        </select>
      </div>
    </div>
    <div class="form-row" style="margin-top: 1rem;">
      <div class="form-group"><label class="form-label">Estimated Print Time</label><input class="form-input" id="f-cat-time" value="${escHtml(item.estimatedTime || '')}"></div>
      <div class="form-group">
        <label class="form-label">Product Image</label>
        <input type="file" id="f-cat-image-file" accept="image/*" style="display:none">
        <button type="button" class="btn-secondary" onclick="$('#f-cat-image-file').click()" style="width:100%;padding:0.5rem;display:flex;align-items:center;justify-content:center;gap:0.5rem">
          📷 Change Photo
        </button>
        <div id="f-cat-image-preview-wrap" style="margin-top:0.5rem;max-height:100px;${item.image ? 'display:block;' : 'display:none;'}position:relative">
          <img id="f-cat-image-preview" src="${item.image || ''}" style="max-height:100px;border-radius:4px;object-fit:cover;border:1px solid var(--border-subtle)">
          <button type="button" class="btn-inline danger" onclick="$('#f-cat-image-file').value='';$('#f-cat-image-preview-wrap').style.display='none';window.tempCatImageBase64='';" style="position:absolute;top:5px;left:90px;padding:0.2rem">🗑️</button>
        </div>
      </div>
    </div>
  `, 'Save', () => {
    const name = $('#f-cat-name').value.trim();
    const desc = $('#f-cat-desc').value.trim();
    const estTime = $('#f-cat-time').value.trim();
    if (!name) { showToast('Please enter item name', 'error'); return; }
    if (countWords(name) > 300 || countWords(desc) > 300 || countWords(estTime) > 300) {
      showToast('Catalog item fields exceed 300 words!', 'error');
      return;
    }
    
    const updatedData = {
      ...item,
      name,
      description: desc,
      category: $('#f-cat-category').value,
      material: $('#f-cat-material').value,
      estimatedTime: estTime,
      image: window.tempCatImageBase64 !== undefined ? window.tempCatImageBase64 : (item.image || '')
    };
    
    db.ref('shared_print_catalog/' + id).set(updatedData)
      .then(() => {
        closeModal();
        showToast('Item updated successfully');
        window.tempCatImageBase64 = undefined;
        logHistory(`Edited 3D print catalog item "${name}"`);
      })
      .catch(e => {
        showToast('Failed to save', 'error');
      });
  });

  window.tempCatImageBase64 = item.image || '';
  setTimeout(() => {
    const fileInput = $('#f-cat-image-file');
    if (fileInput) {
      fileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
          compressImage(file, base64 => {
            window.tempCatImageBase64 = base64;
            $('#f-cat-image-preview').src = base64;
            $('#f-cat-image-preview-wrap').style.display = 'block';
          });
        }
      });
    }
  }, 100);
}

function deleteCatalogItem(id) {
  const isSuperadmin = getCurrentRole() === 'superadmin';
  if (!isSuperadmin) {
    showToast('Access Denied: Only a superadmin can delete catalog items.', 'error');
    return;
  }
  const item = (sharedPrintCatalog || []).find(i => i.id === id);
  if (!item) return;
  openModal('Delete Catalog Item', `<p>Are you sure you want to delete <strong>${escHtml(item.name)}</strong> from the catalog?</p>`, 'Delete', () => {
    verifyCaptchaAndExecute(() => {
      db.ref('shared_print_catalog/' + id).remove()
        .then(() => {
          showToast('Item deleted');
          logHistory(`Deleted 3D print catalog item "${item.name}"`);
        })
        .catch(e => {
          showToast('Error during deletion', 'error');
        });
    });
  });
}

function requestPrint(catalogId) {
  const item = (sharedPrintCatalog || []).find(i => i.id === catalogId);
  if (!item) return;
  if (getCurrentRole() === 'reader') {
    showToast('Readers cannot request prints', 'error');
    return;
  }
  const userName = currentUserProfile ? currentUserProfile.name || 'Unknown' : 'Unknown';
  const labName = currentGroupName || '';
  
  openModal('Request Print: ' + escHtml(item.name), `
    <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:var(--radius-md);padding:1rem;margin-bottom:1rem;display:flex;gap:1rem">
      ${item.image ? `<img src="${item.image}" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid var(--border-subtle)">` : '<div style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:4px;font-size:1.5rem">🖨️</div>'}
      <div style="flex:1">
        <strong style="font-size:0.95rem">${escHtml(item.name)}</strong>
        <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.25rem">${escHtml(item.description || '')}</div>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
          ${item.estimatedTime ? '<span class="print-badge time" style="font-size:0.7rem;background:rgba(245,158,11,0.15);color:var(--accent-amber);padding:0.15rem 0.4rem;border-radius:4px;font-weight:600">⏱ ' + escHtml(item.estimatedTime) + '</span>' : ''}
          ${item.material ? '<span class="print-badge material" style="font-size:0.7rem;background:rgba(255,255,255,0.08);color:var(--text-primary);padding:0.15rem 0.4rem;border-radius:4px;font-weight:600">🧱 ' + escHtml(item.material) + '</span>' : ''}
        </div>
      </div>
    </div>
    <div class="form-group"><label class="form-label">Quantity *</label><input class="form-input" id="f-pr-qty" type="number" min="1" value="1"></div>
    <div class="form-group"><label class="form-label">Notes / Special requests</label><textarea class="form-textarea" id="f-pr-note" placeholder="e.g. Blue color if available"></textarea></div>
  `, 'Submit Request', () => {
    const qty = parseInt($('#f-pr-qty').value) || 1;
    const note = $('#f-pr-note').value.trim();
    if (countWords(note) > 300) {
      showToast('Note exceeds 300 words!', 'error');
      return;
    }
    const reqId = genId();
    const requestData = {
      id: reqId,
      catalogItemId: catalogId,
      catalogItemName: item.name,
      requestedBy: userName,
      requestedByLabName: labName,
      requestedByUid: auth.currentUser ? auth.currentUser.uid : '',
      requestDate: new Date().toISOString().slice(0, 10),
      quantity: qty,
      note: note,
      status: 'pending',
      customDesign: false
    };
    
    db.ref('shared_print_requests/' + reqId).set(requestData)
      .then(() => {
        closeModal();
        showToast('Print request submitted!');
        switchPrintTab('requests');
        logHistory(`Requested 3D print for "${item.name}" (qty: ${qty})`);
      })
      .catch(e => {
        showToast('Error submitting request', 'error');
      });
  });
}

function submitCustomPrintRequest() {
  const userName = currentUserProfile ? currentUserProfile.name || 'Unknown' : 'Unknown';
  const labName = currentGroupName || '';
  const matOptionsHtml = materialOptions.map(m => `<option value="${m}">${m}</option>`).join('');

  openModal('Custom 3D Print Request', `
    <div class="form-group"><label class="form-label">What do you need to print? *</label><input class="form-input" id="f-cpr-name" placeholder="e.g. Custom PCR tube holder"></div>
    <div class="form-group"><label class="form-label">Description / Specifications *</label><textarea class="form-textarea" id="f-cpr-desc" placeholder="Describe dimensions, purpose, special requirements..."></textarea></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Quantity</label><input class="form-input" id="f-cpr-qty" type="number" min="1" value="1"></div>
      <div class="form-group">
        <label class="form-label">Preferred Material *</label>
        <select class="form-select" id="f-cpr-material" style="width:100%;padding:0.5rem;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:var(--radius-sm)">
          ${matOptionsHtml}
        </select>
      </div>
    </div>
  `, 'Submit Request', () => {
    const name = $('#f-cpr-name').value.trim();
    const desc = $('#f-cpr-desc').value.trim();
    if (!name || !desc) { showToast('Please fill all required fields', 'error'); return; }
    if (countWords(name) > 300 || countWords(desc) > 300) {
      showToast('Name or description exceeds 300 words!', 'error');
      return;
    }
    
    const reqId = genId();
    const material = $('#f-cpr-material').value;
    const qty = parseInt($('#f-cpr-qty').value) || 1;
    const requestData = {
      id: reqId,
      catalogItemId: null,
      catalogItemName: name,
      requestedBy: userName,
      requestedByLabName: labName,
      requestedByUid: auth.currentUser ? auth.currentUser.uid : '',
      requestDate: new Date().toISOString().slice(0, 10),
      quantity: qty,
      note: desc + ' | Preferred material: ' + material,
      status: 'pending',
      customDesign: true
    };
    
    db.ref('shared_print_requests/' + reqId).set(requestData)
      .then(() => {
        closeModal();
        showToast('Custom print request submitted!');
        switchPrintTab('requests');
        logHistory(`Requested custom 3D print for "${name}" (qty: ${qty})`);
      })
      .catch(e => {
        showToast('Error submitting request', 'error');
      });
  });
}

function deletePrintRequest(id) {
  const req = (sharedPrintRequests || []).find(r => r.id === id);
  if (!req) return;
  const isSuperadmin = getCurrentRole() === 'superadmin';
  const currentUserId = auth.currentUser ? auth.currentUser.uid : '';
  const isCreator = req.requestedByUid === currentUserId || (req.requestedBy && req.requestedBy === (currentUserProfile ? currentUserProfile.name || '' : ''));
  if (!isSuperadmin && !isCreator) {
    showToast('Access Denied: This request can only be deleted by its author or a superadmin.', 'error');
    return;
  }
  openModal('Cancel Print Request', '<p>Are you sure you want to cancel and delete this print request?</p>', 'Delete', () => {
    verifyCaptchaAndExecute(() => {
      db.ref('shared_print_requests/' + id).remove()
        .then(() => {
          showToast('Request deleted');
          logHistory(`Cancelled 3D print request for "${req.catalogItemName}"`);
        })
        .catch(e => {
          showToast('Error during deletion', 'error');
        });
    });
  });
}

function updatePrintStatus(reqId, status) {
  const isSuperadmin = getCurrentRole() === 'superadmin';
  if (!isSuperadmin) {
    showToast('Access Denied: Only superadmins can change request status.', 'error');
    return;
  }
  db.ref('shared_print_requests/' + reqId + '/status').set(status)
    .then(() => {
      showToast('Status updated to ' + status);
      const req = (sharedPrintRequests || []).find(r => r.id === reqId);
      const reqName = req ? req.catalogItemName : 'Unknown Item';
      logHistory(`Updated 3D print status of "${reqName}" to "${status}"`);
    })
        .catch(e => {
          showToast('Error during deletion', 'error');
        });
}

window.switchPrintTab = switchPrintTab;
window.filterCatalogCategory = filterCatalogCategory;
window.renderPrintCatalog = renderPrintCatalog;
window.addCatalogItem = addCatalogItem;
window.editCatalogItem = editCatalogItem;
window.deleteCatalogItem = deleteCatalogItem;
window.requestPrint = requestPrint;
window.submitCustomPrintRequest = submitCustomPrintRequest;
window.deletePrintRequest = deletePrintRequest;
window.updatePrintStatus = updatePrintStatus;
window.selectInstrumentAutocomplete = selectInstrumentAutocomplete;
window.selectPrintCatalogAutocomplete = selectPrintCatalogAutocomplete;
window.selectPrintRequestAutocomplete = selectPrintRequestAutocomplete;

// ---------- User Dropdown & Theme ----------
const btnUserMenu = document.getElementById('btn-user-menu');
const userDropdownContent = document.getElementById('user-dropdown-content');
const btnToggleTheme = document.getElementById('btn-toggle-theme');

if (btnUserMenu && userDropdownContent) {
  btnUserMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdownContent.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#user-dropdown-container')) {
      userDropdownContent.classList.remove('show');
    }
  });
}

function initTheme() {
  const savedTheme = localStorage.getItem('bioscom-theme');
  if (savedTheme === 'lite') {
    document.body.classList.add('lite-mode');
  } else {
    document.body.classList.remove('lite-mode');
  }
}
initTheme();

if (btnToggleTheme) {
  btnToggleTheme.addEventListener('click', (e) => {
    e.stopPropagation();
    document.body.classList.toggle('lite-mode');
    const isLite = document.body.classList.contains('lite-mode');
    localStorage.setItem('bioscom-theme', isLite ? 'lite' : 'dark');
    userDropdownContent.classList.remove('show');
  });
}

// --- HISTORY & BACKUPS ---
let activeHistoryTab = 'log';


function switchHistoryTab(tab) {
  activeHistoryTab = tab;
  $$('#view-history .print-tab-btn').forEach(b => b.classList.remove('active'));
  const btn = $('#history-tab-' + tab + '-btn');
  if (btn) btn.classList.add('active');
  
  const logContent = $('#history-log-tab-content');
  const backupContent = $('#history-backups-tab-content');
  
  if (logContent) logContent.style.display = tab === 'log' ? 'block' : 'none';
  if (backupContent) backupContent.style.display = tab === 'backups' ? 'block' : 'none';
}
window.switchHistoryTab = switchHistoryTab;

function renderHistory() {
  const role = getCurrentRole();
  const isSuperadmin = (role === 'superadmin' || (auth.currentUser && auth.currentUser.email === '505618@muni.cz'));
  const isAdmin = (role === 'admin');
  const acts = $('#history-superadmin-actions');
  const sel = $('#history-lab-select');
  
  const backupsBtn = $('#history-tab-backups-btn');
  const backupsActions = $('#history-backups-actions');
  
  if (backupsBtn) {
    if (isSuperadmin || isAdmin) {
      backupsBtn.style.display = 'inline-block';
    } else {
      backupsBtn.style.display = 'none';
      if (activeHistoryTab === 'backups') {
        switchHistoryTab('log');
      }
    }
  }
  
  if (isSuperadmin) {
    currentHistoryGroupId = currentHistoryGroupId || currentGroupId;
  } else {
    currentHistoryGroupId = currentGroupId;
  }
  
  if (backupsActions) {
    const hasWriteAccess = isSuperadmin || (isAdmin && currentHistoryGroupId === currentGroupId);
    backupsActions.style.display = hasWriteAccess ? 'block' : 'none';
  }
  
  if (isSuperadmin) {
    if (acts) acts.style.display = 'flex';
    if (sel) {
      sel.style.display = 'inline-block';
      // Populate select if empty
      if (sel.options.length === 0 && typeof db !== 'undefined') {
        db.ref('groups').once('value', snap => {
          const groups = snap.val() || {};
          sel.innerHTML = '';
          Object.keys(groups).forEach(gid => {
            const opt = document.createElement('option');
            opt.value = gid;
            opt.textContent = groups[gid].name;
            sel.appendChild(opt);
          });
          sel.value = currentGroupId;
          sel.onchange = () => {
            currentHistoryGroupId = sel.value;
            fetchHistoryData(currentHistoryGroupId);
            // Re-evaluate backup action visibility upon group switch
            if (backupsActions) {
              const hasWriteAccessNew = isSuperadmin || (isAdmin && currentHistoryGroupId === currentGroupId);
              backupsActions.style.display = hasWriteAccessNew ? 'block' : 'none';
            }
          };
        });
      }
    }
  } else {
    if (acts) acts.style.display = 'none';
  }
  
  fetchHistoryData(currentHistoryGroupId);
}
window.renderHistory = renderHistory;

function fetchHistoryData(groupId) {
  if (!groupId || typeof db === 'undefined' || !db) return;
  
  const role = getCurrentRole();
  const isSuperadmin = (role === 'superadmin' || (auth.currentUser && auth.currentUser.email === '505618@muni.cz'));
  const isAdmin = (role === 'admin');
  
  // Guard: non-superadmins can ONLY fetch data for their own group
  if (!isSuperadmin && groupId !== currentGroupId) {
    groupId = currentGroupId;
  }
  
  // Turn off previous value listeners to avoid leakages
  if (window.activeHistoryListenerGroupId && window.activeHistoryListenerGroupId !== groupId) {
    db.ref('history/' + window.activeHistoryListenerGroupId).off('value');
    db.ref('backups/' + window.activeHistoryListenerGroupId).off('value');
    window.activeHistoryListener = false;
    window.activeBackupsListener = false;
  }
  
  window.activeHistoryListenerGroupId = groupId;

  // Real-time listener for history logs
  if (!window.activeHistoryListener) {
    window.activeHistoryListener = true;
    db.ref('history/' + groupId).orderByChild('timestamp').limitToLast(100).on('value', snap => {
      const logs = [];
      snap.forEach(child => { logs.push(child.val()); });
      logs.reverse(); // Newest first
      
      const cont = $('#history-log-list');
      const empty = $('#history-log-empty');
      if (!cont || !empty) return;
      
      if (!logs.length) {
        cont.innerHTML = '';
        empty.style.display = 'block';
      } else {
        empty.style.display = 'none';
        cont.innerHTML = logs.map(l => {
          const d = new Date(l.timestamp);
          return `<div class="protocol-card" style="padding: 1rem; border-left: 4px solid var(--accent-blue);">
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem;">${d.toLocaleDateString()} ${d.toLocaleTimeString()} &bull; <strong>${escHtml(l.user)}</strong></div>
            <div style="font-size: 0.95rem; color: var(--text-primary);">${escHtml(l.action)}</div>
          </div>`;
        }).join('');
      }
    });
  }

  // Real-time listener for backups
  const hasBackupAccess = isSuperadmin || (isAdmin && groupId === currentGroupId);
  
  if (!hasBackupAccess) {
    // If they don't have access, make sure to clean up any active listener
    if (window.activeBackupsListener) {
      db.ref('backups/' + groupId).off('value');
      window.activeBackupsListener = false;
    }
    const cont = $('#history-backups-list');
    const empty = $('#history-backups-empty');
    if (cont) cont.innerHTML = '';
    if (empty) empty.style.display = 'block';
    
    // Safety fallback: switch reader to log tab if active
    if (activeHistoryTab === 'backups') {
      switchHistoryTab('log');
    }
  } else {
    if (!window.activeBackupsListener) {
      window.activeBackupsListener = true;
      db.ref('backups/' + groupId).orderByChild('timestamp').on('value', snap => {
        const backups = [];
        snap.forEach(child => { backups.push({id: child.key, ...child.val()}); });
        backups.reverse();
        
        const cont = $('#history-backups-list');
        const empty = $('#history-backups-empty');
        if (!cont || !empty) return;
        
        if (!backups.length) {
          cont.innerHTML = '';
          empty.style.display = 'block';
        } else {
          empty.style.display = 'none';
          cont.innerHTML = backups.map(b => {
            const d = new Date(b.timestamp);
            const canRestore = isSuperadmin || (isAdmin && groupId === currentGroupId);
            return `<div class="protocol-card" style="padding: 1rem; display: flex; align-items: center; justify-content: space-between;">
              <div>
                <div style="font-size: 0.9rem; font-weight: 600;">Backup: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">ID: ${b.id}</div>
              </div>
              <div>
                ${canRestore ? `<button class="btn-secondary" style="font-size: 0.8rem;" onclick="restoreBackup('${groupId}', '${b.id}')">Restore</button>` : ''}
              </div>
            </div>`;
          }).join('');
        }
      });
    }
  }
}
window.fetchHistoryData = fetchHistoryData;

function restoreBackup(groupId, backupId) {
  const role = getCurrentRole();
  const isSuperadmin = (role === 'superadmin' || (auth.currentUser && auth.currentUser.email === '505618@muni.cz'));
  const isAdmin = (role === 'admin');
  
  if (!isSuperadmin && !(isAdmin && groupId === currentGroupId)) {
    showToast('Access Denied', 'error');
    return;
  }
  
  if (!confirm('Are you sure you want to restore this backup? Current data for this lab will be overwritten.')) return;
  
  showToast('Restoring backup...', 'info');
  
  db.ref(`backups/${groupId}/${backupId}/data`).once('value').then(snap => {
    const d = snap.val();
    if (!d) {
      showToast('Backup data is empty or invalid', 'error');
      return;
    }
    
    return db.ref(`inventories/${groupId}`).set(d).then(() => {
      showToast('Backup restored successfully');
      if (groupId === currentGroupId) {
        appData = migrateData(d);
        try {
          safeStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
        } catch(e) {
          console.error(e);
        }
        navigateTo('rooms');
        renderRooms();
      }
    });
  }).catch(err => {
    console.error('Error during backup restore:', err);
    showToast('Backup restore failed: ' + err.message, 'error');
  });
}
window.restoreBackup = restoreBackup;

function createManualBackup() {
  const role = getCurrentRole();
  const isSuperadmin = (role === 'superadmin' || (auth.currentUser && auth.currentUser.email === '505618@muni.cz'));
  const isAdmin = (role === 'admin');
  
  const groupId = currentHistoryGroupId || currentGroupId;
  if (!groupId || typeof db === 'undefined' || !db) {
    showToast('Database or Group ID not available', 'error');
    return;
  }
  
  if (!isSuperadmin && !(isAdmin && groupId === currentGroupId)) {
    showToast('Access Denied', 'error');
    return;
  }
  
  db.ref(`inventories/${groupId}`).once('value', snap => {
    const data = snap.val();
    if (!data) {
      showToast('No data found for this laboratory to back up', 'error');
      return;
    }
    
    const now = Date.now();
    const backupRef = db.ref('backups/' + groupId).push();
    backupRef.set({
      timestamp: now,
      data: data
    }).then(() => {
      showToast('Manual backup created successfully');
      fetchHistoryData(groupId);
      // Prune old backups (> 24 hours)
      const cutoff = now - 24 * 60 * 60 * 1000;
      db.ref('backups/' + groupId).orderByChild('timestamp').endAt(cutoff).once('value', pruneSnap => {
        pruneSnap.forEach(child => {
          child.ref.remove();
        });
      });
    }).catch(e => {
      showToast('Backup creation failed', 'error');
    });
  });
}
window.createManualBackup = createManualBackup;

// Deep Freezer Rack & Box Mutations
window.addDeepFreezerRack = function() {
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont) return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  
  const shelves = cont.shelves || [];
  const parsedRacks = {};
  shelves.forEach(sh => {
    const { rack } = parseDeepFreezerShelf(sh);
    parsedRacks[rack] = true;
  });
  const nextRackNum = Object.keys(parsedRacks).length + 1;
  
  const newRackName = prompt('Enter new Rack name:', 'Rack ' + nextRackNum);
  if (!newRackName || !newRackName.trim()) return;
  
  const newBoxName = prompt('Enter first Box name inside ' + newRackName.trim() + ':', 'Box 1');
  if (!newBoxName || !newBoxName.trim()) return;
  
  const rName = newRackName.trim();
  const bName = newBoxName.trim();
  
  const newShelf = {
    id: genId(),
    name: `${rName} / ${bName}`,
    rackName: rName,
    boxName: bName,
    chemicals: []
  };
  
  cont.shelves = cont.shelves || [];
  cont.shelves.push(newShelf);
  
  saveData(appData);
  renderDetail();
  logHistory(`Added rack "${rName}" with box "${bName}" to deep freezer "${cont.name}"`, cont.ownerGroupId);
  showToast(`Rack "${rName}" added`);
};

window.renameDeepFreezerRack = function(oldRackName) {
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont) return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  
  const newRackName = prompt('Rename Rack:', oldRackName);
  if (!newRackName || !newRackName.trim() || newRackName.trim() === oldRackName) return;
  
  const rName = newRackName.trim();
  let updatedCount = 0;
  
  (cont.shelves || []).forEach(sh => {
    const { rack, box } = parseDeepFreezerShelf(sh);
    if (rack === oldRackName) {
      sh.rackName = rName;
      sh.boxName = box;
      sh.name = `${rName} / ${box}`;
      updatedCount++;
    }
  });
  
  if (updatedCount > 0) {
    if (selectedDeepFreezerRack === oldRackName) {
      selectedDeepFreezerRack = rName;
    }
    saveData(appData);
    renderDetail();
    logHistory(`Renamed rack from "${oldRackName}" to "${rName}" in deep freezer "${cont.name}"`, cont.ownerGroupId);
    showToast('Rack renamed');
  }
};

window.deleteDeepFreezerRack = function(rackName) {
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont) return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  
  let chemCount = 0;
  (cont.shelves || []).forEach(sh => {
    const { rack } = parseDeepFreezerShelf(sh);
    if (rack === rackName) {
      chemCount += (sh.chemicals || []).length;
    }
  });
  
  const warningText = chemCount > 0 
    ? `Are you sure you want to delete Rack "${rackName}"? It contains ${chemCount} chemicals! This action CANNOT be undone.`
    : `Are you sure you want to delete Rack "${rackName}"?`;
    
  openModal('Delete Rack', `<p>${escHtml(warningText)}</p>`, 'Delete', () => {
    verifyCaptchaAndExecute(() => {
      cont.shelves = (cont.shelves || []).filter(sh => {
        const { rack } = parseDeepFreezerShelf(sh);
        return rack !== rackName;
      });
      
      if (selectedDeepFreezerRack === rackName) {
        selectedDeepFreezerRack = null;
        selectedDeepFreezerBox = null;
      }
      
      saveData(appData);
      closeModal();
      renderDetail();
      logHistory(`Deleted rack "${rackName}" from deep freezer "${cont.name}"`, cont.ownerGroupId);
      showToast('Rack deleted');
    });
  });
};

window.addDeepFreezerBox = function() {
  if (getCurrentRole() === 'reader') { showToast('Access Denied', 'error'); return; }
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont || !selectedDeepFreezerRack) return;
  
  const shelves = cont.shelves || [];
  let boxCount = 0;
  shelves.forEach(sh => {
    const { rack } = parseDeepFreezerShelf(sh);
    if (rack === selectedDeepFreezerRack) {
      boxCount++;
    }
  });
  
  const newBoxName = prompt('Enter new Box name:', 'Box ' + (boxCount + 1));
  if (!newBoxName || !newBoxName.trim()) return;
  
  const bName = newBoxName.trim();
  const rName = selectedDeepFreezerRack;
  
  const newShelf = {
    id: genId(),
    name: `${rName} / ${bName}`,
    rackName: rName,
    boxName: bName,
    color: '#3b82f6',
    chemicals: []
  };
  
  cont.shelves = cont.shelves || [];
  cont.shelves.push(newShelf);
  
  saveData(appData);
  renderDetail();
  logHistory(`Added box "${bName}" to rack "${rName}" in deep freezer "${cont.name}"`, cont.ownerGroupId);
  showToast(`Box "${bName}" added`);
};

window.renameDeepFreezerBox = function(oldBoxName, shelfId) {
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont) return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  
  const sh = (cont.shelves || []).find(s => s.id === shelfId);
  if (!sh) return;
  
  const newBoxName = prompt('Rename Box:', oldBoxName);
  if (!newBoxName || !newBoxName.trim() || newBoxName.trim() === oldBoxName) return;
  
  const bName = newBoxName.trim();
  const rName = sh.rackName || parseDeepFreezerShelf(sh).rack;
  
  sh.boxName = bName;
  sh.rackName = rName;
  sh.name = `${rName} / ${bName}`;
  
  saveData(appData);
  renderDetail();
  logHistory(`Renamed box from "${oldBoxName}" to "${bName}" inside rack "${rName}" of deep freezer "${cont.name}"`, cont.ownerGroupId);
  showToast('Box renamed');
};

window.deleteDeepFreezerBox = function(shelfId) {
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont) return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  
  const sh = (cont.shelves || []).find(s => s.id === shelfId);
  if (!sh) return;
  
  const chemCount = (sh.chemicals || []).length;
  const warningText = chemCount > 0 
    ? `Are you sure you want to delete Box "${sh.boxName || sh.name}"? It contains ${chemCount} chemicals! This action CANNOT be undone.`
    : `Are you sure you want to delete Box "${sh.boxName || sh.name}"?`;
    
  openModal('Delete Box', `<p>${escHtml(warningText)}</p>`, 'Delete', () => {
    verifyCaptchaAndExecute(() => {
      cont.shelves = (cont.shelves || []).filter(s => s.id !== shelfId);
      saveData(appData);
      closeModal();
      renderDetail();
      logHistory(`Deleted box "${sh.boxName || sh.name}" from deep freezer "${cont.name}"`, cont.ownerGroupId);
      showToast('Box deleted');
    });
  });
};

window.changeDeepFreezerBoxColor = function(shelfId) {
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont) return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  
  const sh = (cont.shelves || []).find(s => s.id === shelfId);
  if (!sh) return;
  
  const currentColor = sh.color || '#3b82f6';
  
  const presets = [
    '#ef4444', // Red
    '#f43f5e', // Rose
    '#f59e0b', // Amber/Orange
    '#10b981', // Emerald/Green
    '#14b8a6', // Teal
    '#3b82f6', // Royal Blue
    '#6366f1', // Indigo
    '#8b5cf6', // Violet/Purple
    '#d946ef', // Fuchsia
    '#64748b'  // Slate
  ];
  
  let selectedColor = currentColor;

  // Window callbacks for real-time interactivity
  window.selectPaletteColor = function(color) {
    selectedColor = color;
    
    // Update inputs
    const picker = document.getElementById('custom-color-picker');
    const text = document.getElementById('color-hex-text');
    if (picker) picker.value = color;
    if (text) text.value = color.toUpperCase();
    
    // Update preview card
    updatePreview(color);
    
    // Highlight active swatch
    document.querySelectorAll('.color-swatch').forEach(sw => {
      const swatchColor = sw.getAttribute('data-color');
      if (swatchColor === color) {
        sw.style.border = '2px solid var(--text-primary)';
        sw.style.boxShadow = `0 0 10px ${color}`;
        sw.style.transform = 'scale(1.1)';
      } else {
        sw.style.border = '2px solid rgba(255,255,255,0.15)';
        sw.style.boxShadow = 'none';
        sw.style.transform = 'scale(1)';
      }
    });
  };

  window.updateCustomColorFromPicker = function(color) {
    selectedColor = color;
    
    const text = document.getElementById('color-hex-text');
    if (text) text.value = color.toUpperCase();
    
    updatePreview(color);
    updatePresetsHighlight(color);
  };

  window.updateCustomColorFromText = function(val) {
    let cleanVal = val.trim();
    if (!cleanVal.startsWith('#')) {
      cleanVal = '#' + cleanVal;
    }
    
    const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (hexRegex.test(cleanVal)) {
      selectedColor = cleanVal;
      
      const picker = document.getElementById('custom-color-picker');
      if (picker) picker.value = cleanVal;
      
      updatePreview(cleanVal);
      updatePresetsHighlight(cleanVal);
    }
  };

  function updatePreview(color) {
    const previewCard = document.getElementById('color-preview-card');
    const previewIcon = document.getElementById('color-preview-icon');
    if (previewCard) {
      previewCard.style.borderColor = color;
      previewCard.style.background = color + '2d'; // ~18% opacity
      previewCard.style.boxShadow = `0 0 12px ${color}33`;
    }
    if (previewIcon) {
      previewIcon.style.color = color;
    }
  }

  function updatePresetsHighlight(color) {
    document.querySelectorAll('.color-swatch').forEach(sw => {
      const swatchColor = sw.getAttribute('data-color');
      if (swatchColor.toLowerCase() === color.toLowerCase()) {
        sw.style.border = '2px solid var(--text-primary)';
        sw.style.boxShadow = `0 0 10px ${swatchColor}`;
        sw.style.transform = 'scale(1.1)';
      } else {
        sw.style.border = '2px solid rgba(255,255,255,0.15)';
        sw.style.boxShadow = 'none';
        sw.style.transform = 'scale(1)';
      }
    });
  }

  const gridHtml = presets.map(color => {
    const isActive = color.toLowerCase() === currentColor.toLowerCase();
    const borderStyle = isActive ? '2px solid var(--text-primary)' : '2px solid rgba(255,255,255,0.15)';
    const shadowStyle = isActive ? `0 0 10px ${color}` : 'none';
    const transformStyle = isActive ? 'scale(1.1)' : 'scale(1)';
    return `<button class="color-swatch" 
                    type="button"
                    style="width: 38px; height: 38px; border-radius: 50%; background-color: ${color}; border: ${borderStyle}; cursor: pointer; transition: all 0.2s; box-shadow: ${shadowStyle}; transform: ${transformStyle};" 
                    onclick="window.selectPaletteColor('${color}')"
                    data-color="${color}"
                    title="${color}">
            </button>`;
  }).join('');

  const modalHtml = `
    <div class="color-palette-modal" style="display: flex; flex-direction: column; gap: 1.25rem; padding: 0.25rem 0;">
      <div style="font-size: 0.9rem; color: var(--text-muted);">Choose a beautiful preset color or select your own custom color:</div>
      
      <!-- Presets Swatches -->
      <div style="display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: center; padding: 0.5rem 0;">
        ${gridHtml}
      </div>

      <!-- Custom Input & Synced Hex -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem; background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); gap: 1rem; margin-top: 0.25rem;">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <div style="position: relative; width: 44px; height: 44px; overflow: hidden; border-radius: 50%; border: 2px solid var(--border-subtle); box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
            <input type="color" id="custom-color-picker" style="position: absolute; top: -10px; left: -10px; width: 64px; height: 64px; border: none; padding: 0; cursor: pointer; background: transparent;" value="${currentColor}" oninput="window.updateCustomColorFromPicker(this.value)">
          </div>
          <div>
            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Custom Color</div>
            <input type="text" id="color-hex-text" class="form-input" style="font-family: monospace; font-size: 0.95rem; padding: 0.3rem 0.6rem; width: 110px; text-transform: uppercase; margin-top: 0.3rem; letter-spacing: 0.05em;" value="${currentColor.toUpperCase()}" oninput="window.updateCustomColorFromText(this.value)">
          </div>
        </div>
        
        <!-- Premium Box Preview -->
        <div id="color-preview-card" style="width: 140px; height: 85px; border-radius: var(--radius-lg); border: 1px solid ${currentColor}; background: ${currentColor}2d; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.35rem; transition: all 0.25s; box-shadow: 0 0 12px ${currentColor}33;">
          <div id="color-preview-icon" style="font-size: 1.8rem; color: ${currentColor}; transition: color 0.25s;">📦</div>
          <div style="font-weight: 700; font-size: 0.8rem; color: var(--text-primary); letter-spacing: 0.02em;">Box Preview</div>
        </div>
      </div>
      
      <div style="display: flex; justify-content: flex-end; margin-top: 0.25rem;">
        <button class="btn btn-secondary" type="button" onclick="window.resetDeepFreezerBoxColorToDefault()" style="font-size: 0.85rem; padding: 0.4rem 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem; border-radius: 4px; cursor: pointer;">
          🔄 Reset to Default Color
        </button>
      </div>
    </div>
  `;

  window.resetDeepFreezerBoxColorToDefault = function() {
    delete sh.color;
    saveData(appData);
    closeModal();
    renderDetail();
    showToast('Box color reset to default');
  };

  openModal('Change Box Color', modalHtml, 'Save', () => {
    // Validate selectedColor
    const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (!hexRegex.test(selectedColor.trim())) {
      showToast('Invalid color format. Please use Hex (e.g. #FF5733)', 'error');
      return;
    }

    sh.color = selectedColor.trim();
    saveData(appData);
    renderDetail();
    logHistory(`Changed color of box "${sh.boxName || sh.name}" to "${sh.color}" in deep freezer "${cont.name}"`, cont.ownerGroupId);
    showToast('Color updated');
    
    // Clean up window actions
    delete window.selectPaletteColor;
    delete window.updateCustomColorFromPicker;
    delete window.updateCustomColorFromText;
    
    closeModal();
  });
};

window.renameShelf = function(sid) {
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont) return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  const sh = (cont.shelves || []).find(s => s.id === sid);
  if (!sh) return;

  const currentName = sh.name;
  
  const html = `
    <div class="form-group">
      <label class="form-label">Name / Suffix *</label>
      <input class="form-input" id="f-rename-shelf-name" type="text" value="${escHtml(currentName)}">
    </div>
  `;
  
  openModal('Rename Shelf / Place', html, 'Save', () => {
    const val = $('#f-rename-shelf-name').value.trim();
    if (!val) { showToast('Enter name', 'error'); return; }
    
    const oldName = sh.name;
    sh.name = val;
    saveData(appData);
    closeModal();
    renderDetail();
    logHistory(`Renamed shelf/place from "${oldName}" to "${sh.name}" in container "${cont.name}"`, cont.ownerGroupId);
    showToast('Shelf renamed');
  });
};

window.addBoxToShelf = function(parentShelfId) {
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont) return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  const parentShelf = (cont.shelves || []).find(s => s.id === parentShelfId);
  if (!parentShelf) return;

  const html = `
    <div class="form-group">
      <label class="form-label">Box Name *</label>
      <input class="form-input" id="f-new-box-name" type="text" placeholder="e.g. Box A" value="">
    </div>
    <div class="form-group">
      <label class="form-label">Box Color</label>
      <div style="display: flex; gap: 0.5rem; align-items: center; margin-top: 0.25rem;">
        <input type="color" id="f-new-box-color" value="#3b82f6" style="width: 40px; height: 40px; padding: 0; border: none; background: none; cursor: pointer; border-radius: 50%;">
        <span style="font-size: 0.85rem; color: var(--text-muted);">Pick a color for the box card</span>
      </div>
    </div>
  `;

  openModal('Add Box to ' + parentShelf.name, html, 'Add', () => {
    const name = $('#f-new-box-name').value.trim();
    const color = $('#f-new-box-color').value;
    if (!name) { showToast('Enter box name', 'error'); return; }

    if (!cont.shelves) cont.shelves = [];
    const newBox = {
      id: genId(),
      name: name,
      parentShelfId: parentShelfId,
      color: color,
      chemicals: []
    };
    cont.shelves.push(newBox);
    saveData(appData);
    closeModal();
    renderDetail();
    logHistory(`Added box "${name}" to shelf "${parentShelf.name}" in container "${cont.name}"`, cont.ownerGroupId);
    showToast('Box added');
  });
};

window.renameBoxDirect = function(boxId) {
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont) return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  const box = (cont.shelves || []).find(s => s.id === boxId);
  if (!box) return;

  const html = `
    <div class="form-group">
      <label class="form-label">Box Name *</label>
      <input class="form-input" id="f-rename-box-name" type="text" value="${escHtml(box.name)}">
    </div>
  `;

  openModal('Rename Box', html, 'Save', () => {
    const name = $('#f-rename-box-name').value.trim();
    if (!name) { showToast('Enter box name', 'error'); return; }

    const oldName = box.name;
    box.name = name;
    saveData(appData);
    closeModal();
    renderDetail();
    logHistory(`Renamed box from "${oldName}" to "${name}" in container "${cont.name}"`, cont.ownerGroupId);
    showToast('Box renamed');
  });
};

window.deleteBoxDirect = function(boxId) {
  const cont = getContainer(currentRoomId, currentContainerId);
  if (!cont) return;
  if (!canManageContainerContents(cont)) { showToast('Access Denied', 'error'); return; }
  const box = (cont.shelves || []).find(s => s.id === boxId);
  if (!box) return;

  const chemCount = (box.chemicals || []).length;
  const warningText = chemCount > 0 
    ? `Are you sure you want to delete Box "${box.name}"? It contains ${chemCount} chemicals! This action CANNOT be undone.`
    : `Are you sure you want to delete Box "${box.name}"?`;
    
  openModal('Delete Box', `<p>${escHtml(warningText)}</p>`, 'Delete', () => {
    verifyCaptchaAndExecute(() => {
      cont.shelves = (cont.shelves || []).filter(s => s.id !== boxId);
      saveData(appData);
      closeModal();
      renderDetail();
      logHistory(`Deleted box "${box.name}" from container "${cont.name}"`, cont.ownerGroupId);
      showToast('Box deleted');
    });
  });
};

window.addChemicalToBoxDirect = function(boxId) {
  addChemical(boxId);
};

window.startLabRadio = function(station) {
  const widget = $('#lab-radio-widget');
  const audio = $('#lab-radio-audio');
  const stationEl = $('#radio-station');
  const songEl = widget ? widget.querySelector('.song-title') : null;
  const vinyl = widget ? widget.querySelector('.vinyl-container') : null;
  
  if (!widget || !audio) return;
  
  let streamUrl = '';
  let stationName = '';
  let songName = '';
  
  if (station === 'cechomor') {
    streamUrl = 'https://icecast6.play.cz/jihcimbalka128.mp3';
    stationName = 'Čechomor Radio';
    songName = 'Traditional Czech Fiddle & Folk';
  } else if (station === 'moravanka') {
    streamUrl = 'https://rozhlas.stream/brno.mp3';
    stationName = 'Moravanka Brass';
    songName = 'Traditional Moravian Brass Band';
  }
  
  audio.src = streamUrl;
  audio.volume = 0.5;
  
  if (stationEl) stationEl.textContent = stationName;
  if (songEl) songEl.textContent = songName;
  
  widget.classList.remove('hidden');
  
  audio.play().then(() => {
    if (vinyl) vinyl.classList.add('playing');
    const playBtn = $('#btn-radio-play');
    if (playBtn) playBtn.textContent = '⏸️';
  }).catch(e => {
    console.error('[LabRadio] Playback failed:', e, {
      src: audio.src,
      networkState: audio.networkState,
      readyState: audio.readyState,
      errorCode: audio.error ? audio.error.code : null
    });
    showToast('Failed to start radio stream', 'error');
  });
};

window.toggleRadioPlay = function() {
  const audio = $('#lab-radio-audio');
  const vinyl = $('#lab-radio-widget .vinyl-container');
  const playBtn = $('#btn-radio-play');
  if (!audio) return;
  
  if (audio.paused) {
    audio.play().then(() => {
      if (vinyl) vinyl.classList.add('playing');
      if (playBtn) playBtn.textContent = '⏸️';
    }).catch(e => console.error(e));
  } else {
    audio.pause();
    if (vinyl) vinyl.classList.remove('playing');
    if (playBtn) playBtn.textContent = '▶️';
  }
};

window.setRadioVolume = function(val) {
  const audio = $('#lab-radio-audio');
  if (audio) audio.volume = parseFloat(val);
};

window.closeLabRadio = function() {
  const widget = $('#lab-radio-widget');
  const audio = $('#lab-radio-audio');
  const vinyl = $('#lab-radio-widget .vinyl-container');
  if (audio) {
    audio.pause();
    audio.src = '';
  }
  if (vinyl) vinyl.classList.remove('playing');
  if (widget) widget.classList.add('hidden');
};

// ========== MINI-GAMES SYSTEM ==========

const FROG_IMAGES = [
  { file: 'Dendrobates_auratus.jpg', species: 'Dendrobates auratus' },
  { file: 'Dendrobates_azureus.jpg', species: 'Dendrobates azureus' },
  { file: 'Dendrobates_leucomelas.jpg', species: 'Dendrobates leucomelas' },
  { file: 'Dendrobates_tinctorius_citronella.webp', species: 'Dendrobates tinctorius (citronella)' },
  { file: 'Dendrobates_tinctorius_nominant.jpg', species: 'Dendrobates tinctorius (nominant)' },
  { file: 'Dendrobates_tinctorius_tumucumaque.jpg', species: 'Dendrobates tinctorius (tumucumaque)' },
  { file: 'Dendrobates_truncatus.jpg', species: 'Dendrobates truncatus' },
  { file: 'Excidobates_captivus.jpg', species: 'Excidobates captivus' },
  { file: 'Excidobates_mysteriosus.jpg', species: 'Excidobates mysteriosus' },
  { file: 'Oophaga_histrionica.webp', species: 'Oophaga histrionica' },
  { file: 'Oophaga_pumilio.jpg', species: 'Oophaga pumilio' },
  { file: 'Oophaga_sylvatica.jpg', species: 'Oophaga sylvatica' },
  { file: 'Phyllobates_aurotaenia.jpg', species: 'Phyllobates aurotaenia' },
  { file: 'Phyllobates_bicolor.jpg', species: 'Phyllobates bicolor' },
  { file: 'Phyllobates_terribillis.jpg', species: 'Phyllobates terribilis' },
  { file: 'Ranitomeya_fulgurita.jpg', species: 'Ranitomeya fulgurita' },
  { file: 'pralesnicka-pruhovana-phyllobates-vittatus-2631.jpg', species: 'Phyllobates vittatus' }
];

const CHESS_INITIAL_BOARD = [
  ['r','n','b','q','k','b','n','r'],
  ['p','p','p','p','p','p','p','p'],
  ['','','','','','','',''],
  ['','','','','','','',''],
  ['','','','','','','',''],
  ['','','','','','','',''],
  ['P','P','P','P','P','P','P','P'],
  ['R','N','B','Q','K','B','N','R']
];

const CHESS_PIECE_MAP = {
  'P': '🧬', 'R': '🏭', 'N': '🔬', 'B': '🧪', 'Q': '⚗️', 'K': '👨‍🔬',
  'p': '🦠', 'r': '💊', 'n': '🧫', 'b': '☣️', 'q': '☠️', 'k': '🧟'
};

function renderMinigames() {
  const uid = auth.currentUser ? auth.currentUser.uid : '';
  if (!uid) return;
  
  // Populate opponent dropdown
  db.ref('users').once('value', snap => {
    const users = snap.val() || {};
    const sel = $('#game-opponent-select');
    if (!sel) return;
    sel.innerHTML = '<option value="" disabled selected>Select a colleague...</option>';
    Object.keys(users).forEach(id => {
      if (id === uid) return;
      const u = users[id];
      const name = u.name || u.email || id;
      sel.innerHTML += `<option value="${id}">${escHtml(name)}</option>`;
    });
  });
  
  // Render challenge lists
  const pendingEl = $('#game-pending-list');
  const activeEl = $('#game-active-list');
  const completedEl = $('#game-completed-list');
  if (!pendingEl || !activeEl || !completedEl) return;
  
  let pendingHtml = '';
  let activeHtml = '';
  let completedHtml = '';
  
  const challenges = Object.values(gameChallenges).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  
  challenges.forEach(c => {
    const isChallenger = c.challengerUid === uid;
    const isOpponent = c.opponentUid === uid;
    if (!isChallenger && !isOpponent) return;
    
    const otherName = isChallenger ? (c.opponentName || 'Unknown') : (c.challengerName || 'Unknown');
    const gameIcon = c.gameType === 'frog' ? '🐸' : '🧬';
    const gameName = c.gameType === 'frog' ? 'Frog Quiz' : 'Bio Chess';
    
    if (c.status === 'pending') {
      if (isOpponent) {
        pendingHtml += `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:var(--radius-md);">
            <span>${gameIcon} <strong>${escHtml(otherName)}</strong> challenges you to ${gameName}</span>
            <div style="display:flex;gap:0.4rem;">
              <button class="btn-primary" style="padding:0.3rem 0.7rem;font-size:0.8rem;" onclick="window.acceptGameChallenge('${c.id}')">Accept</button>
              <button class="btn-secondary" style="padding:0.3rem 0.7rem;font-size:0.8rem;" onclick="window.declineGameChallenge('${c.id}')">Decline</button>
            </div>
          </div>`;
      } else {
        pendingHtml += `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem;background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:var(--radius-md);">
            <span>${gameIcon} Waiting for <strong>${escHtml(otherName)}</strong> to accept ${gameName}...</span>
            <span style="font-size:0.7rem;color:var(--text-muted);">⏳ Pending</span>
          </div>`;
      }
    } else if (c.status === 'active') {
      const myTurn = c.gameType === 'chess' ? (c.turn === (isChallenger ? 'white' : 'black')) : true;
      activeHtml += `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-md);cursor:pointer;" onclick="window.playGame('${c.id}')">
          <span>${gameIcon} vs <strong>${escHtml(otherName)}</strong> — ${gameName}</span>
          <span style="font-size:0.75rem;color:${myTurn ? 'var(--accent-green)' : 'var(--text-muted)'};">${myTurn ? '🟢 Your turn' : '⏳ Waiting'}</span>
        </div>`;
    } else if (c.status === 'completed') {
      const winnerName = c.winnerUid === uid ? 'You' : otherName;
      const isDraw = !c.winnerUid;
      completedHtml += `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem;background:rgba(255,255,255,0.02);border:1px solid var(--border-subtle);border-radius:var(--radius-md);">
          <span>${gameIcon} vs <strong>${escHtml(otherName)}</strong></span>
          <span style="font-size:0.75rem;color:${isDraw ? 'var(--text-muted)' : (c.winnerUid === uid ? 'var(--accent-green)' : 'var(--accent-red)')};">${isDraw ? '🤝 Draw' : (c.winnerUid === uid ? '🏆 Won' : '❌ Lost')}</span>
        </div>`;
    }
  });
  
  pendingEl.innerHTML = pendingHtml || '<div style="color:var(--text-muted);font-size:0.85rem;">No pending challenges</div>';
  activeEl.innerHTML = activeHtml || '<div style="color:var(--text-muted);font-size:0.85rem;">No active matches</div>';
  completedEl.innerHTML = completedHtml || '<div style="color:var(--text-muted);font-size:0.85rem;">No completed matches yet</div>';
}

window.sendGameChallenge = function() {
  const uid = auth.currentUser ? auth.currentUser.uid : '';
  if (!uid) { showToast('Please log in', 'error'); return; }
  
  const opponentUid = $('#game-opponent-select').value;
  if (!opponentUid) { showToast('Select a colleague', 'error'); return; }
  
  const gameType = $('#game-type-select').value;
  const challengerName = currentUserProfile ? currentUserProfile.name || 'Unknown' : 'Unknown';
  const opponentName = $('#game-opponent-select').selectedOptions[0]?.textContent || 'Unknown';
  
  const id = genId();
  const challenge = {
    id,
    gameType,
    challengerUid: uid,
    challengerName,
    opponentUid,
    opponentName,
    status: 'pending',
    createdAt: Date.now()
  };
  
  db.ref('game_challenges/' + id).set(challenge)
    .then(() => {
      showToast(`Challenge sent to ${opponentName}!`);
      logHistory(`Sent ${gameType === 'frog' ? 'Frog Quiz' : 'Bio Chess'} challenge to ${opponentName}`);
    })
    .catch(e => { showToast('Failed to send challenge', 'error'); });
};

window.acceptGameChallenge = function(id) {
  const c = gameChallenges[id];
  if (!c) return;
  
  const updates = { status: 'active' };
  
  if (c.gameType === 'chess') {
    updates.board = JSON.parse(JSON.stringify(CHESS_INITIAL_BOARD));
    updates.turn = 'white';
    updates.moveHistory = [];
  } else {
    updates.frogRound = {};
    updates.frogScores = {};
    updates.frogStatus = {};
    updates.frogRound[c.challengerUid] = 0;
    updates.frogRound[c.opponentUid] = 0;
    updates.frogScores[c.challengerUid] = 0;
    updates.frogScores[c.opponentUid] = 0;
    updates.frogStatus[c.challengerUid] = 'playing';
    updates.frogStatus[c.opponentUid] = 'playing';
  }
  
  db.ref('game_challenges/' + id).update(updates)
    .then(() => {
      showToast('Challenge accepted!');
      logHistory(`Accepted ${c.gameType === 'frog' ? 'Frog Quiz' : 'Bio Chess'} challenge from ${c.challengerName}`);
    })
    .catch(e => { showToast('Failed to accept', 'error'); });
};

window.declineGameChallenge = function(id) {
  db.ref('game_challenges/' + id).remove()
    .then(() => showToast('Challenge declined'))
    .catch(e => showToast('Error', 'error'));
};

window.playGame = function(id) {
  const c = gameChallenges[id];
  if (!c || c.status !== 'active') return;
  
  const ws = $('#active-game-workspace');
  if (!ws) return;
  ws.style.display = 'block';
  ws.scrollIntoView({ behavior: 'smooth', block: 'start' });
  
  const uid = auth.currentUser.uid;
  
  if (c.gameType === 'frog') {
    renderActiveFrogGame(c, ws, uid);
  } else {
    renderActiveChessGame(c, ws, uid);
  }
};

window.closeGameWorkspace = function() {
  const ws = $('#active-game-workspace');
  if (ws) {
    ws.style.display = 'none';
    ws.innerHTML = '';
  }
};

// ---- FROG CAPTCHA QUIZ ----
function renderActiveFrogGame(c, ws, uid) {
  const myRound = (c.frogRound && c.frogRound[uid]) || 0;
  const myScore = (c.frogScores && c.frogScores[uid]) || 0;
  const myStatus = (c.frogStatus && c.frogStatus[uid]) || 'playing';
  
  const otherUid = c.challengerUid === uid ? c.opponentUid : c.challengerUid;
  const otherName = c.challengerUid === uid ? c.opponentName : c.challengerName;
  const otherStatus = (c.frogStatus && c.frogStatus[otherUid]) || 'playing';
  const otherScore = (c.frogScores && c.frogScores[otherUid]) || 0;
  
  if (myStatus === 'completed') {
    let resultHtml = `
      <div style="text-align:center;">
        <h2>🐸 Frog Quiz Complete!</h2>
        <p style="font-size:1.2rem;margin:1rem 0;">Your Score: <strong>${myScore}/5</strong></p>`;
    
    if (otherStatus === 'completed') {
      resultHtml += `<p style="font-size:1rem;color:var(--text-secondary);">${escHtml(otherName)}'s Score: <strong>${otherScore}/5</strong></p>`;
      if (myScore > otherScore) {
        resultHtml += `<p style="font-size:1.5rem;color:var(--accent-green);">🏆 You Win!</p>`;
      } else if (myScore < otherScore) {
        resultHtml += `<p style="font-size:1.5rem;color:var(--accent-red);">❌ You Lost</p>`;
      } else {
        resultHtml += `<p style="font-size:1.5rem;color:var(--accent-amber);">🤝 It's a Draw!</p>`;
      }
    } else {
      resultHtml += `<p style="color:var(--text-muted);">Waiting for ${escHtml(otherName)} to finish...</p>`;
    }
    
    resultHtml += `<button class="btn-secondary" style="margin-top:1rem;" onclick="window.closeGameWorkspace()">Close</button></div>`;
    ws.innerHTML = resultHtml;
    return;
  }
  
  // Pick a random frog for this round
  const shuffled = [...FROG_IMAGES].sort(() => Math.random() - 0.5);
  const correctFrog = shuffled[0];
  const options = shuffled.slice(0, 4).sort(() => Math.random() - 0.5);
  
  // Ensure correct answer is among options
  if (!options.find(o => o.species === correctFrog.species)) {
    options[Math.floor(Math.random() * 4)] = correctFrog;
  }
  
  ws.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <h2 style="margin:0;">🐸 Frog CAPTCHA Quiz — Round ${myRound + 1}/5</h2>
      <div style="display:flex;gap:1rem;align-items:center;">
        <span style="font-weight:600;">Score: ${myScore}/5</span>
        <button class="btn-secondary" style="padding:0.3rem 0.7rem;font-size:0.8rem;" onclick="window.closeGameWorkspace()">Close</button>
      </div>
    </div>
    <div class="quiz-container">
      <div style="font-size:0.95rem;color:var(--text-secondary);margin-bottom:0.5rem;">Identify this dart frog species:</div>
      <img src="Capcha/${correctFrog.file}" alt="Frog" style="max-width:380px;max-height:280px;border-radius:var(--radius-lg);border:2px solid var(--border-subtle);object-fit:cover;">
      <div class="quiz-options">
        ${options.map(o => `
          <button class="quiz-option-btn" onclick="window.handleFrogAnswer('${c.id}', '${o.species.replace(/'/g, "\\'")}', '${correctFrog.species.replace(/'/g, "\\'")}')">${escHtml(o.species)}</button>
        `).join('')}
      </div>
    </div>`;
}

window.handleFrogAnswer = function(challengeId, answer, correct) {
  const c = gameChallenges[challengeId];
  if (!c) return;
  const uid = auth.currentUser.uid;
  const isCorrect = answer === correct;
  
  // Disable buttons
  document.querySelectorAll('.quiz-option-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === correct) btn.classList.add('correct');
    if (btn.textContent === answer && !isCorrect) btn.classList.add('wrong');
  });
  
  const newRound = ((c.frogRound && c.frogRound[uid]) || 0) + 1;
  const newScore = ((c.frogScores && c.frogScores[uid]) || 0) + (isCorrect ? 1 : 0);
  
  const updates = {};
  updates[`frogRound/${uid}`] = newRound;
  updates[`frogScores/${uid}`] = newScore;
  
  if (newRound >= 5) {
    updates[`frogStatus/${uid}`] = 'completed';
    
    // Check if the other player is also completed
    const otherUid = c.challengerUid === uid ? c.opponentUid : c.challengerUid;
    const otherStatus = (c.frogStatus && c.frogStatus[otherUid]) || 'playing';
    
    if (otherStatus === 'completed') {
      const otherScore = (c.frogScores && c.frogScores[otherUid]) || 0;
      updates['status'] = 'completed';
      if (newScore > otherScore) updates['winnerUid'] = uid;
      else if (otherScore > newScore) updates['winnerUid'] = otherUid;
      else updates['winnerUid'] = '';
    }
  }
  
  setTimeout(() => {
    db.ref('game_challenges/' + challengeId).update(updates)
      .then(() => {
        // Re-render
        const ws = $('#active-game-workspace');
        const updatedC = { ...c };
        if (!updatedC.frogRound) updatedC.frogRound = {};
        if (!updatedC.frogScores) updatedC.frogScores = {};
        if (!updatedC.frogStatus) updatedC.frogStatus = {};
        updatedC.frogRound[uid] = newRound;
        updatedC.frogScores[uid] = newScore;
        if (newRound >= 5) updatedC.frogStatus[uid] = 'completed';
        if (updates.status) updatedC.status = updates.status;
        if (updates.winnerUid !== undefined) updatedC.winnerUid = updates.winnerUid;
        gameChallenges[challengeId] = updatedC;
        renderActiveFrogGame(updatedC, ws, uid);
      });
  }, 1200);
};

// ---- BIOCHEMICAL CHESS ----
function renderActiveChessGame(c, ws, uid) {
  const isChallenger = c.challengerUid === uid;
  const myColor = isChallenger ? 'white' : 'black';
  const otherName = isChallenger ? c.opponentName : c.challengerName;
  const isMyTurn = c.turn === myColor;
  const board = c.board || JSON.parse(JSON.stringify(CHESS_INITIAL_BOARD));
  
  let turnInfo = isMyTurn
    ? `<span style="color:var(--accent-green);font-weight:700;">🟢 Your turn (${myColor})</span>`
    : `<span style="color:var(--text-muted);">⏳ Waiting for ${escHtml(otherName)}...</span>`;
  
  ws.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <h2 style="margin:0;">🧬 Biochemical Chess vs ${escHtml(otherName)}</h2>
      <div style="display:flex;gap:1rem;align-items:center;">
        ${turnInfo}
        <button class="btn-secondary" style="padding:0.3rem 0.7rem;font-size:0.8rem;" onclick="window.resignChessGame('${c.id}')">🏳️ Resign</button>
        <button class="btn-secondary" style="padding:0.3rem 0.7rem;font-size:0.8rem;" onclick="window.closeGameWorkspace()">Close</button>
      </div>
    </div>
    <div style="display:flex;justify-content:center;align-items:center;gap:2rem;">
      <div>
        <div style="text-align:center;margin-bottom:0.5rem;font-weight:600;font-size:0.85rem;">
          ${myColor === 'white' ? '🧬 Synthesis (White)' : '🦠 Pathogens (Black)'}
        </div>
        <div class="chess-board" id="chess-board-grid"></div>
        <div style="display:flex;justify-content:space-between;margin-top:0.75rem;">
          <div style="font-size:0.75rem;color:var(--text-muted);">
            White: 🧬P 🏭R 🔬N 🧪B ⚗️Q 👨‍🔬K
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);">
            Black: 🦠p 💊r 🧫n ☣️b ☠️q 🧟k
          </div>
        </div>
      </div>
    </div>`;
  
  const grid = document.getElementById('chess-board-grid');
  if (!grid) return;
  
  // Render board (flip for black player)
  const rows = myColor === 'black' ? [...Array(8).keys()] : [...Array(8).keys()];
  const cols = [...Array(8).keys()];
  
  for (let ri = 0; ri < 8; ri++) {
    const r = myColor === 'black' ? (7 - ri) : ri;
    for (let ci = 0; ci < 8; ci++) {
      const col = myColor === 'black' ? (7 - ci) : ci;
      const isLight = (r + col) % 2 === 0;
      const piece = board[r][col];
      const sq = document.createElement('div');
      sq.className = `chess-square ${isLight ? 'light' : 'dark'}`;
      sq.dataset.row = r;
      sq.dataset.col = col;
      sq.textContent = piece ? (CHESS_PIECE_MAP[piece] || piece) : '';
      
      if (isMyTurn) {
        sq.addEventListener('click', (e) => window.handleChessSquareClick(e, r, col, c.id));
      }
      
      grid.appendChild(sq);
    }
  }
}

let chessSelectedSquare = null;
let chessValidMoves = [];

function isUpperCase(ch) { return ch === ch.toUpperCase() && ch !== ch.toLowerCase(); }
function isWhitePiece(p) { return p && isUpperCase(p); }
function isBlackPiece(p) { return p && !isUpperCase(p) && p !== ''; }
function getPieceColor(p) { return !p ? null : (isWhitePiece(p) ? 'white' : 'black'); }

function getChessValidMoves(board, r, c, myColor) {
  const piece = board[r][c];
  if (!piece) return [];
  const color = getPieceColor(piece);
  if (color !== myColor) return [];
  
  const moves = [];
  const isWhite = color === 'white';
  const type = piece.toUpperCase();
  
  function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function canMoveTo(tr, tc) {
    if (!inBounds(tr, tc)) return false;
    const target = board[tr][tc];
    if (!target) return true;
    return getPieceColor(target) !== color;
  }
  function isEnemy(tr, tc) {
    if (!inBounds(tr, tc)) return false;
    const target = board[tr][tc];
    return target && getPieceColor(target) !== color;
  }
  
  if (type === 'P') {
    const dir = isWhite ? -1 : 1;
    const startRow = isWhite ? 6 : 1;
    // Forward
    if (inBounds(r + dir, c) && !board[r + dir][c]) {
      moves.push([r + dir, c]);
      // Double forward from start
      if (r === startRow && !board[r + 2 * dir][c]) {
        moves.push([r + 2 * dir, c]);
      }
    }
    // Captures
    if (isEnemy(r + dir, c - 1)) moves.push([r + dir, c - 1]);
    if (isEnemy(r + dir, c + 1)) moves.push([r + dir, c + 1]);
  }
  
  if (type === 'R' || type === 'Q') {
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
    dirs.forEach(([dr, dc]) => {
      for (let i = 1; i < 8; i++) {
        const tr = r + dr * i, tc = c + dc * i;
        if (!inBounds(tr, tc)) break;
        if (!board[tr][tc]) { moves.push([tr, tc]); continue; }
        if (getPieceColor(board[tr][tc]) !== color) moves.push([tr, tc]);
        break;
      }
    });
  }
  
  if (type === 'B' || type === 'Q') {
    const dirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
    dirs.forEach(([dr, dc]) => {
      for (let i = 1; i < 8; i++) {
        const tr = r + dr * i, tc = c + dc * i;
        if (!inBounds(tr, tc)) break;
        if (!board[tr][tc]) { moves.push([tr, tc]); continue; }
        if (getPieceColor(board[tr][tc]) !== color) moves.push([tr, tc]);
        break;
      }
    });
  }
  
  if (type === 'N') {
    const jumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    jumps.forEach(([dr, dc]) => {
      if (canMoveTo(r + dr, c + dc)) moves.push([r + dr, c + dc]);
    });
  }
  
  if (type === 'K') {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        if (canMoveTo(r + dr, c + dc)) moves.push([r + dr, c + dc]);
      }
    }
  }
  
  return moves;
}

window.handleChessSquareClick = function(event, r, col, challengeId) {
  const c = gameChallenges[challengeId];
  if (!c || c.status !== 'active') return;
  
  const uid = auth.currentUser.uid;
  const isChallenger = c.challengerUid === uid;
  const myColor = isChallenger ? 'white' : 'black';
  
  if (c.turn !== myColor) return;
  
  const board = c.board;
  const piece = board[r][col];
  
  // If we already have a selection and click on a valid move target, execute the move
  if (chessSelectedSquare) {
    const [sr, sc] = chessSelectedSquare;
    const isValid = chessValidMoves.some(([mr, mc]) => mr === r && mc === col);
    
    if (isValid) {
      // Execute move
      const capturedPiece = board[r][col];
      board[r][col] = board[sr][sc];
      board[sr][sc] = '';
      
      // Pawn promotion
      if (board[r][col].toUpperCase() === 'P') {
        if ((myColor === 'white' && r === 0) || (myColor === 'black' && r === 7)) {
          board[r][col] = myColor === 'white' ? 'Q' : 'q';
        }
      }
      
      const nextTurn = myColor === 'white' ? 'black' : 'white';
      const updates = {
        board: board,
        turn: nextTurn
      };
      
      // Check if king was captured
      if (capturedPiece && capturedPiece.toUpperCase() === 'K') {
        updates.status = 'completed';
        updates.winnerUid = uid;
      }
      
      db.ref('game_challenges/' + challengeId).update(updates)
        .then(() => {
          chessSelectedSquare = null;
          chessValidMoves = [];
          if (updates.status === 'completed') {
            showToast('🏆 You captured the King! You win!');
            logHistory(`Won Biochemical Chess against ${isChallenger ? c.opponentName : c.challengerName}`);
            window.closeGameWorkspace();
            renderMinigames();
          }
        })
        .catch(e => console.error(e));
      
      return;
    }
    
    // Clicking on own piece — re-select
    if (piece && getPieceColor(piece) === myColor) {
      chessSelectedSquare = [r, col];
      chessValidMoves = getChessValidMoves(board, r, col, myColor);
      highlightChessSquares(board, myColor);
      return;
    }
    
    // Clicking elsewhere — deselect
    chessSelectedSquare = null;
    chessValidMoves = [];
    highlightChessSquares(board, myColor);
    return;
  }
  
  // No selection yet — select own piece
  if (piece && getPieceColor(piece) === myColor) {
    chessSelectedSquare = [r, col];
    chessValidMoves = getChessValidMoves(board, r, col, myColor);
    highlightChessSquares(board, myColor);
  }
};

function highlightChessSquares(board, myColor) {
  document.querySelectorAll('.chess-square').forEach(sq => {
    sq.classList.remove('selected', 'valid-move', 'occupied');
    const sr = parseInt(sq.dataset.row);
    const sc = parseInt(sq.dataset.col);
    
    if (chessSelectedSquare && chessSelectedSquare[0] === sr && chessSelectedSquare[1] === sc) {
      sq.classList.add('selected');
    }
    
    if (chessValidMoves.some(([mr, mc]) => mr === sr && mc === sc)) {
      sq.classList.add('valid-move');
      if (board[sr][sc]) sq.classList.add('occupied');
    }
  });
}

window.resignChessGame = function(id) {
  const c = gameChallenges[id];
  if (!c) return;
  const uid = auth.currentUser.uid;
  const otherUid = c.challengerUid === uid ? c.opponentUid : c.challengerUid;
  
  openModal('Resign Game', '<p>Are you sure you want to resign? This will count as a loss.</p>', 'Resign', () => {
    db.ref('game_challenges/' + id).update({
      status: 'completed',
      winnerUid: otherUid
    }).then(() => {
      closeModal();
      showToast('You resigned.');
      window.closeGameWorkspace();
      renderMinigames();
    });
  });
};
// test comment
