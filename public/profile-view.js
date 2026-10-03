(() => {
  const db = window.APP_SUPABASE_CLIENT;
  if (!db) return;

  const styles = document.createElement('style');
  styles.textContent =     '.profile-viewer{position:fixed;z-index:60;inset:0;display:grid;place-items:center;padding:18px;background:rgba(25,14,39,.72);backdrop-filter:blur(8px)}' +
    '.public-profile-card{position:relative;width:min(100%,680px);max-height:min(90dvh,900px);overflow:auto;padding:24px;border:1px solid #eadff7;border-radius:24px;background:linear-gradient(155deg,#fff 0%,#fff 65%,#fff8fb 100%);box-shadow:0 24px 80px #170b2b55}' +
    '.public-profile-close{position:sticky;z-index:2;top:0;float:right;width:38px;height:38px;border:0;border-radius:50%;background:#f2eafe;color:#56329d;font-size:24px;cursor:pointer}' +
    '.public-profile-hero{display:flex;align-items:center;gap:20px;margin:0 0 24px;padding:18px;border:1px solid #eee5f8;border-radius:20px;background:linear-gradient(120deg,#f1eaff,#fff0f3 65%,#fff8e9)}' +
    '.public-profile-avatar{display:grid;flex:none;width:112px;height:112px;place-items:center;overflow:hidden;border:4px solid white;border-radius:50%;background:linear-gradient(145deg,#7855d4,#df6e9f);color:#fff;font:800 42px Manrope,sans-serif;box-shadow:0 0 0 3px #a783df55,0 8px 20px #5a3b7c2b}' +
    '.public-profile-avatar img{width:100%;height:100%;object-fit:cover}' +
    '.public-profile-identity{min-width:0}.public-profile-identity .eyebrow{color:#d94f91}.public-profile-identity h2{margin:5px 0 7px;color:#322448;font:800 26px Manrope,sans-serif;overflow-wrap:anywhere}.public-profile-identity p:last-child{margin:0;color:#766a85;line-height:1.5;overflow-wrap:anywhere}' +
    '.public-profile-section h3{margin:0 0 12px;color:#322448;font:700 18px Manrope,sans-serif}.public-profile-stories{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.public-profile-story{overflow:hidden;border:1px solid #eee5f8;border-radius:15px;background:#fff;box-shadow:0 5px 16px #412f5c0b}.public-profile-story img,.public-profile-story video{display:block;width:100%;max-height:360px;min-height:150px;object-fit:cover;background:#17131f}.public-profile-story figcaption{padding:10px 12px;color:#58496d;font-size:12px;line-height:1.45;overflow-wrap:anywhere}.public-profile-story time{display:block;margin-bottom:5px;color:#9b8cab;font-size:10px}.public-profile-empty{padding:16px;border:1px dashed #d9c9ed;border-radius:14px;background:#faf7ff;color:#786c89;text-align:center;font-size:13px;line-height:1.5}.public-profile-status{min-height:18px;color:#786c89;font-size:12px}.person-card .view-profile-button{flex:none;min-height:34px;padding:0 10px;border:1px solid #e8def7;border-radius:9px;background:#faf7ff;color:#4f2ba8;font-size:11px;font-weight:700;cursor:pointer}.person-card .view-profile-button:hover{background:#f0e8ff}' +
    '@media(max-width:560px){.public-profile-card{padding:17px;border-radius:18px}.public-profile-hero{align-items:flex-start;gap:14px;padding:13px}.public-profile-avatar{width:82px;height:82px;font-size:31px}.public-profile-identity h2{font-size:21px}.public-profile-stories{grid-template-columns:1fr 1fr}}';
  document.head.append(styles);

  const viewer = document.createElement('section');
  viewer.id = 'public-profile-viewer';
  viewer.className = 'profile-viewer';
  viewer.hidden = true;
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.setAttribute('aria-labelledby', 'public-profile-name');
  viewer.innerHTML = '<article class="public-profile-card"><button class="public-profile-close" type="button" aria-label="Cerrar perfil">×</button><div class="public-profile-status" role="status"></div><header class="public-profile-hero"><div class="public-profile-avatar" aria-label="Foto de perfil"></div><div class="public-profile-identity"><p class="eyebrow">PERFIL DE LA COMUNIDAD</p><h2 id="public-profile-name"></h2><p id="public-profile-bio"></p></div></header><section class="public-profile-section"><h3>Historias activas</h3><div class="public-profile-stories"></div></section></article>';
  document.body.append(viewer);
  const close = () => { viewer.hidden = true; };
  viewer.querySelector('.public-profile-close').addEventListener('click', close);
  viewer.addEventListener('click', (event) => { if (event.target === viewer) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !viewer.hidden) close(); });

  async function signedUrl(path) {
    if (!path) return '';
    const { data, error } = await db.storage.from('media').createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  async function showProfile(profileId) {
    const status = viewer.querySelector('.public-profile-status');
    const avatar = viewer.querySelector('.public-profile-avatar');
    const storyList = viewer.querySelector('.public-profile-stories');
    viewer.hidden = false;
    status.textContent = 'Cargando perfil…';
    avatar.replaceChildren();
    storyList.replaceChildren();
    const [{ data: profile, error: profileError }, { data: stories, error: storiesError }] = await Promise.all([
      db.from('profiles').select('id,username,bio,avatar_path').eq('id', profileId).maybeSingle(),
      db.from('stories').select('id,media_path,media_type,caption,created_at').eq('user_id', profileId).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true })
    ]);
    if (profileError || !profile) { status.textContent = 'No se pudo abrir este perfil.'; return; }
    if (storiesError) { status.textContent = 'No se pudieron cargar las historias de este perfil.'; return; }
    viewer.querySelector('#public-profile-name').textContent = profile.username || 'Amigo';
    viewer.querySelector('#public-profile-bio').textContent = profile.bio || 'Aún no ha escrito una descripción.';
    avatar.textContent = (profile.username || '✦').trim().slice(0, 1).toUpperCase();
    if (profile.avatar_path) {
      try {
        const img = document.createElement('img');
        img.src = await signedUrl(profile.avatar_path);
        img.alt = 'Foto de perfil de ' + (profile.username || 'Amigo');
        avatar.replaceChildren(img);
      } catch { /* Keep the initial as a visual fallback. */ }
    }
    if (!stories?.length) {
      const empty = document.createElement('p');
      empty.className = 'public-profile-empty';
      empty.textContent = profile.avatar_path ? 'Esta persona no tiene historias activas. Aquí puedes ver su foto de perfil.' : 'Esta persona aún no tiene historias ni foto de perfil.';
      storyList.append(empty);
      status.textContent = '';
      return;
    }
    for (const story of stories) {
      const figure = document.createElement('figure');
      figure.className = 'public-profile-story';
      const caption = document.createElement('figcaption');
      const time = document.createElement('time');
      time.dateTime = story.created_at;
      time.textContent = new Date(story.created_at).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
      caption.append(time);
      if (story.caption) caption.append(document.createTextNode(story.caption));
      try {
        const url = await signedUrl(story.media_path);
        const media = document.createElement(story.media_type === 'video' ? 'video' : 'img');
        media.src = url;
        if (story.media_type === 'video') { media.controls = true; media.playsInline = true; media.preload = 'metadata'; media.setAttribute('aria-label', 'Historia en video de ' + profile.username); }
        else { media.alt = 'Historia de ' + profile.username; media.loading = 'lazy'; }
        figure.append(media);
      } catch {
        const unavailable = document.createElement('p');
        unavailable.className = 'public-profile-empty';
        unavailable.textContent = 'No se pudo cargar esta historia.';
        figure.append(unavailable);
      }
      figure.append(caption);
      storyList.append(figure);
    }
    status.textContent = '';
  }

  async function addProfileButtons() {
    const list = document.querySelector('#profiles-list');
    if (!list || !list.children.length) return;
    const { data: profiles, error } = await db.from('profiles').select('id,username').order('username', { ascending: true });
    if (error || !profiles) return;
    const cards = [...list.querySelectorAll('.person-card')];
    cards.forEach((card, index) => {
      const profile = profiles[index];
      if (!profile) return;
      card.dataset.profileId = profile.id;
      let actions = card.querySelector('.profile-actions');
      if (!actions) { actions = document.createElement('div'); actions.className = 'profile-actions'; card.append(actions); }
      if (actions.querySelector('.view-profile-button')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'view-profile-button';
      button.textContent = profile.id === db.auth.getUser?.id ? 'Ver perfil' : 'Ver perfil';
      button.textContent = 'Ver perfil';
      button.addEventListener('click', () => showProfile(profile.id));
      actions.prepend(button);
    });
  }

  const list = document.querySelector('#profiles-list');
  if (list) {
    new MutationObserver(() => { addProfileButtons(); }).observe(list, { childList: true });
    addProfileButtons();
  }
})();
