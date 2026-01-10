(function(){
  var CONFIG = {
    temporalHierarchy: {
      immediate: ['navigation'],
      short: ['layers','stages'],
      medium: ['variants','anticipation'],
      long: ['irreversibility','specialization']
    },
    thresholds: {
      PAUSE_RETURN_MS: 30000,
      LONG_READ_MS: 12000,
      MIN_TIME_IN_PROJECTS_FOR_AUTO: 6000,
      IGNORE_WINDOW_MS: 15000,
      IRREVERSIBLE_IGNORES: 1,
      SPECIALIZATION_WINDOW_MS: 120000,
      SPECIALIZATION_COUNT: 3,
      FATIGUE_DECAY_MS: 3600000,
      FATIGUE_INCREASE_PER_EVENT: 1,
      FATIGUE_LOCK_THRESHOLD: 6,
      ANTICIPATION_SCROLL_VELOCITY: 1.2,
      ANTICIPATION_WINDOW_MS: 4000
    },
    lossPolicy: {
      lockLayersOnDeviance: ['system'],
      irreversibleByIgnoreKeys: true
    },
    variantProfiles: ['direct','neutral','contemplative']
  };

  var states = Array.from(document.querySelectorAll('.state'));
  var navButtons = Array.from(document.querySelectorAll('nav button'));
  var stateOrder = ['home','projects','about','contact'];
  var currentState = 'home';
  var stages = Array.from(document.querySelectorAll('#narrative .stage'));
  var stageIndex = 0;
  var layers = Array.from(document.querySelectorAll('.layer'));
  var revealed = new Set();

  var readerSignals = {
    projectsEnteredAt: null,
    timeInProjects: 0,
    scrollSamples: [],
    lastScrollTs: 0,
    pauseReturnDetected: false,
    deviationDetected: false,
    skimDetected: false
  };

  var readerState = 'neutral';
  var allowAutoReveal = true;
  var lockedLayers = new Set();

  function now(){ return Date.now(); }

  var storage = {
    get: function(k){ try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null} },
    set: function(k,v){ try{localStorage.setItem(k,JSON.stringify(v))}catch(e){} }
  };

  var session = {
    get: function(k){ try{return JSON.parse(sessionStorage.getItem(k)||'null')}catch(e){return null} },
    set: function(k,v){ try{sessionStorage.setItem(k,JSON.stringify(v))}catch(e){} }
  };

  var persistent = {
    fatigueKey:'site.fatigue',
    irreversibleKey:'site.irreversible',
    specKey:'site.spec'
  };

  function loadFatigue(){
    var f = storage.get(persistent.fatigueKey) || {score:0,ts:now()};
    var age = now() - (f.ts||0);
    var decay = Math.floor(age / CONFIG.thresholds.FATIGUE_DECAY_MS);
    if(decay>0){
      f.score = Math.max(0, f.score - decay);
      f.ts = now();
      storage.set(persistent.fatigueKey,f);
    }
    return f;
  }

  function addFatigue(n){
    var f = loadFatigue();
    f.score = (f.score||0) + (n||CONFIG.thresholds.FATIGUE_INCREASE_PER_EVENT);
    f.ts = now();
    storage.set(persistent.fatigueKey,f);
    Instrumentation.log('fatigue.update',{score:f.score});
    return f.score;
  }

  function getFatigueScore(){ var f=loadFatigue(); return f.score||0 }

  function loadIrreversibleSet(){
    var s = storage.get(persistent.irreversibleKey) || [];
    return new Set(s);
  }

  function saveIrreversibleSet(set){
    storage.set(persistent.irreversibleKey, Array.from(set));
  }

  function markIrreversible(key){
    if(!key) return;
    var set = loadIrreversibleSet();
    set.add(key);
    saveIrreversibleSet(set);
    applyIrreversibleToDOM(key);
    Instrumentation.log('irreversible.mark',{key:key});
  }

  function applyIrreversibleToDOM(key){
    var el = document.querySelector('[data-irreversible-key="'+key+'"]');
    if(el){
      el.classList.add('irreversible-removed');
      el.style.display = 'none';
    }
  }

  function hydrateIrreversiblesOnLoad(){
    var set = loadIrreversibleSet();
    set.forEach(function(k){ applyIrreversibleToDOM(k); });
  }

  function loadSpecialization(){
    var s = storage.get(persistent.specKey) || {};
    return s;
  }

  function saveSpecialization(obj){
    storage.set(persistent.specKey,obj);
  }

function bumpSpecializationSignal(type){
  var s = loadSpecialization();
  var nowTs = now();
  var list = s[type] || [];
  
  if(Array.isArray(list)){
     list = list.filter(function(item){ return nowTs - item < CONFIG.thresholds.SPECIALIZATION_WINDOW_MS });
     list.push(nowTs);
     s[type] = list;
  }

  for(var k in s){
    if(Array.isArray(s[k])){
       s[k] = s[k].filter(function(item){ return nowTs - item < CONFIG.thresholds.SPECIALIZATION_WINDOW_MS });
    }
  }
  
  saveSpecialization(s);
  for(var k in s){
    if(Array.isArray(s[k]) && s[k].length >= CONFIG.thresholds.SPECIALIZATION_COUNT){
      promoteSpecialization(k);
    }
  }
}

  function promoteSpecialization(key){
    var s = loadSpecialization();
    s.profile = s.profile || {};
    s.profile[key] = true;
    saveSpecialization(s);
    Instrumentation.log('specialization.promote',{key:key});
  }

  function hasSpecialization(key){
    var s = loadSpecialization();
    return (s.profile && s.profile[key]) || false;
  }

  function applyVariantsByProfile(){
    var profile = loadSpecialization().profile || {};
    var chosen = 'neutral';
    if(profile['fast_reader'] || readerState === 'deviant') chosen = 'direct';
    else if(profile['deep_reader'] || readerState === 'persistent') chosen = 'contemplative';
    applyVariantFor(chosen);
  }

  function applyVariantFor(profile){
    var variantTargets = [
      {sel: '.state[data-state="home"] p', key: 'homeIntro'},
      {sel: '.state[data-state="about"] p', key: 'aboutIntro'},
      {sel: '.layer.layer-game p', key: 'gameIntro'},
      {sel: '.layer.layer-system p', key: 'systemIntro'}
    ];
    var variants = {
      homeIntro: {
        direct: 'Exploração concentrada de sistemas e projetos.',
        neutral: 'Exploração narrativa de sistemas interativos. O texto assume densidade; a leitura exige continuidade.',
        contemplative: 'Exploração narrativa de sistemas interativos. O texto assume densidade; a leitura exige continuidade e retorno reflexivo.'
      },
      aboutIntro: {
        direct: 'Arquitetura cognitiva aplicada ao design.',
        neutral: 'Arquitetura cognitiva aplicada ao design de produtos interativos.',
        contemplative: 'Arquitetura cognitiva aplicada ao design de produtos interativos; ênfase em economia de afirmação.'
      },
      gameIntro: {
        direct: 'Jogo 2D: mecânica modular e decisão em tempo real.',
        neutral: 'Experiência interativa baseada em decisões. Mecânica modular, narrativa dirigida por estado.',
        contemplative: 'Jogo 2D em desenvolvimento que explora mecânicas modulares e síntese cognitiva em decisões contínuas.'
      },
      systemIntro: {
        direct: 'Arquitetura modular. Integração explícita.',
        neutral: 'Arquitetura viva e extensível que integra estado, narrativa e regras de tomada de decisão.',
        contemplative: 'Arquitetura viva e extensível que integra estado, narrativa e regras de tomada de decisão; projeto em evolução.'
      }
    };
    variantTargets.forEach(function(t){
      var el = document.querySelector(t.sel);
      if(!el) return;
      if(!el.dataset.orig) el.dataset.orig = el.textContent;
      var text = (variants[t.key] && variants[t.key][profile]) || el.dataset.orig;
      el.textContent = text;
    });
    Instrumentation.log('variant.apply',{profile:profile});
  }

  function anticipateByScroll(e){
    var y = window.scrollY;
    var ts = now();
    var last = readerSignals.lastScrollTs || ts;
    var dy = Math.abs(y - (readerSignals.lastY||y));
    var dt = ts - last || 1;
    var velocity = dy / dt * 1000;
    readerSignals.lastY = y;
    readerSignals.lastScrollTs = ts;
    readerSignals.scrollSamples.push({v:velocity,ts:ts});
    readerSignals.scrollSamples = readerSignals.scrollSamples.filter(function(s){ return ts - s.ts < CONFIG.thresholds.ANTICIPATION_WINDOW_MS });
    var avgV = readerSignals.scrollSamples.reduce(function(acc,s){ return acc + s.v },0) / Math.max(1,readerSignals.scrollSamples.length);
    if(avgV > CONFIG.thresholds.ANTICIPATION_SCROLL_VELOCITY){
      document.documentElement.classList.add('anticipation-fast');
      Instrumentation.log('anticipation.fast',{avgV:avgV});
    } else {
      document.documentElement.classList.remove('anticipation-fast');
    }
    bumpSpecializationSignal('scroll');
  }

  function checkFatigueAndLock(){
    var score = getFatigueScore();
    if(score >= CONFIG.thresholds.FATIGUE_LOCK_THRESHOLD){
      CONFIG.lossPolicy.lockLayersOnDeviance.forEach(function(l){ lockedLayers.add(l); });
      Instrumentation.log('fatigue.lock',{score:score});
    }
  }

  function revealLayer(name, explicit){
    var el = document.querySelector('.layer-'+name) || document.querySelector('[data-layer="'+name+'"]') || document.querySelector('.layer[data-layer="'+name+'"]');
    if(!el) return;
    if(revealed.has(name)) return;
    if(lockedLayers.has(name)) return;
    if(!explicit){
      var sinceEnter = readerSignals.projectsEnteredAt ? now() - readerSignals.projectsEnteredAt : Infinity;
      if(sinceEnter < CONFIG.thresholds.MIN_TIME_IN_PROJECTS_FOR_AUTO) return;
      if(getFatigueScore() >= CONFIG.thresholds.FATIGUE_LOCK_THRESHOLD) return;
    }
    el.classList.add('active');
    el.setAttribute('aria-hidden','false');
    revealed.add(name);
    Instrumentation.log('layer.reveal',{layer:name,explicit:!!explicit});
    checkDependencies();
  }

  function checkDependencies(){
    layers.forEach(function(l){
      var req = (l.dataset.requires||'').split(',').map(function(s){return s.trim()}).filter(Boolean);
      if(req.length === 0) return;
      var ok = req.every(function(r){ return revealed.has(r) });
      if(ok && !revealed.has(l.dataset.layer)) revealLayer(l.dataset.layer,false);
    });
  }

  function monitorIgnoreCandidates(){
    stages.forEach(function(s){
      var key = s.dataset.stage;
      var timer = s._ignoreTimer;
      if(timer) clearTimeout(timer);
      if(!s.classList.contains('active')) return;
      s._ignoreTimer = setTimeout(function(){
        var ignoredKey = s.dataset.irreversibleKey || s.dataset.stage || null;
        if(ignoredKey && CONFIG.thresholds.IRREVERSIBLE_IGNORES){
          markIrreversible(ignoredKey);
        }
        addFatigue(1);
      }, CONFIG.thresholds.IGNORE_WINDOW_MS);
    });
  }

  function cancelIgnoreTimers(){
    stages.forEach(function(s){ if(s._ignoreTimer){ clearTimeout(s._ignoreTimer); s._ignoreTimer = null } });
  }

  function startNarrative(){
    stageIndex = 0;
    stages.forEach(function(s){ s.classList.remove('active') });
    if(stages[0]) {
      stages[0].classList.add('active');
      Instrumentation.log('narrative.start',{stage:stages[0].dataset.stage});
    }
    readerSignals.projectsEnteredAt = now();
    readerSignals.timeInProjects = 0;
    cancelIgnoreTimers();
    monitorIgnoreCandidates();
    applyVariantsByProfile();
  }

  function setState(target){
    currentState = target;
    states.forEach(function(s){ s.classList.toggle('active', s.dataset.state===target) });
    navButtons.forEach(function(b){ b.classList.toggle('active', b.dataset.target===target) });
    if(target === 'projects') startNarrative();
    session.set('lastState',{state:target,ts:now()});
    Instrumentation.log('setState',{state:target});
    evaluateReaderState();
  }

  navButtons.forEach(function(btn){ btn.addEventListener('click', function(){ var prev=currentState; setState(this.dataset.target); detectDeviation(prev,this.dataset.target); }) });

  document.querySelectorAll('[data-action="next"]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(stages[stageIndex]) stages[stageIndex].classList.remove('active');
      stageIndex++;
      if(stages[stageIndex]) stages[stageIndex].classList.add('active');
      var layer = btn.dataset.layer;
      if(layer) revealLayer(layer,true);
      Instrumentation.log('stage.advance',{index:stageIndex,layer:layer});
      cancelIgnoreTimers();
      monitorIgnoreCandidates();
      bumpSpecializationSignal('stage.advance');
    });
  });

  window.addEventListener('scroll', function(e){ anticipateByScroll(e); evaluateReaderState() },{passive:true});

  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState==='hidden'){
      session.set('lastHidden',{state:currentState,ts:now()});
      Instrumentation.log('visibility.hidden',{state:currentState});
    } else {
      var prev = session.get('lastHidden') || {};
      if(prev.ts && now() - prev.ts > CONFIG.thresholds.PAUSE_RETURN_MS && prev.state === 'projects'){
        readerSignals.pauseReturnDetected = true;
        applyPolicyFor('persistenceReturn');
      }
      Instrumentation.log('visibility.shown',{state:currentState});
    }
  });

  function applyPolicyFor(signal){
    if(signal === 'persistenceReturn'){
      document.documentElement.classList.add('pol-persistent');
      Instrumentation.log('policy.apply',{policy:'persistent.mode'});
      writerOnPersistence();
    }
    if(signal === 'deviation'){
      document.documentElement.classList.add('pol-deviation');
      CONFIG.lossPolicy.lockLayersOnDeviance.forEach(function(l){ lockedLayers.add(l) });
      Instrumentation.log('policy.apply',{policy:'deviation.mode'});
      addFatigue(2);
    }
  }

  function writerOnPersistence(){
    applyVariantFor('contemplative');
    revealLayer('game',false);
  }

  function detectDeviation(prev,target){
    var pi = stateOrder.indexOf(prev||'home');
    var ti = stateOrder.indexOf(target||'home');
    if(Math.abs(ti-pi) > 1){
      readerSignals.deviationDetected = true;
      applyPolicyFor('deviation');
      Instrumentation.log('signal.deviation',{from:prev,to:target});
      return true;
    }
    return false;
  }

  function evaluateReaderState(){
    var prev = readerState;
    var timeInProjects = readerSignals.projectsEnteredAt ? now() - readerSignals.projectsEnteredAt : 0;
    readerSignals.timeInProjects = timeInProjects;
    var fatigue = getFatigueScore();
    if(readerSignals.deviationDetected || fatigue >= CONFIG.thresholds.FATIGUE_LOCK_THRESHOLD){
      readerState = 'deviant';
    } else if(readerSignals.pauseReturnDetected || timeInProjects > CONFIG.thresholds.LONG_READ_MS){
      readerState = 'persistent';
    } else if(readerSignals.skimDetected){
      readerState = 'saturated';
    } else {
      readerState = 'neutral';
    }
    if(prev !== readerState){
      Instrumentation.log('reader.state.change',{from:prev,to:readerState});
      applyReaderPolicies(readerState,prev);
    }
    checkFatigueAndLock();
    applyVariantsByProfile();
  }

  function applyReaderPolicies(state,prev){
    if(state === 'persistent'){
      allowAutoReveal = true;
      lockedLayers.delete('system');
      document.documentElement.classList.remove('pol-deviation');
      document.documentElement.classList.add('pol-persistent');
    } else if(state === 'deviant'){
      allowAutoReveal = false;
      CONFIG.lossPolicy.lockLayersOnDeviance.forEach(function(l){ lockedLayers.add(l) });
      document.documentElement.classList.add('pol-deviation');
    } else if(state === 'saturated'){
      allowAutoReveal = false;
    } else {
      allowAutoReveal = true;
      document.documentElement.classList.remove('pol-deviation');
      document.documentElement.classList.remove('pol-persistent');
    }
  }

  function bootstrap(){
    hydrateIrreversiblesOnLoad();
    var initial = location.hash.replace('#','') || 'home';
    if(stateOrder.indexOf(initial)===-1) initial = 'home';
    setState(initial);
    renderEvents('data/decisions.json');
    checkDependencies();
    evaluateReaderState();
  }

  function renderEvents(url){
    fetch(url).then(function(r){ return r.json() }).then(function(events){
      var container = document.getElementById('events');
      if(!container) return;
      container.innerHTML = events.sort(function(a,b){
        var ia = {alto:3,medio:2,baixo:1}[b.impact||'medio'] - {alto:3,medio:2,baixo:1}[a.impact||'medio'];
        if(ia) return ia;
        return new Date(b.timestamp) - new Date(a.timestamp);
      }).map(function(e,i){ return '<article class="decision"><h3>'+escapeHtml(e.title||'')+'</h3><p>'+escapeHtml(e.description||'')+'</p><span class="meta">'+(e.timestamp||'')+'</span></article>' }).join('');
      container.querySelectorAll('.decision').forEach(function(el){ requestAnimationFrame(function(){ el.classList.add('in-view') }) });
      Instrumentation.log('events.render',{count:events.length});
    }).catch(function(){});
  }

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]; }); }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();

function updateSystemMonitor() {
    const fatigue = localStorage.getItem('site.fatigue') || 0;
    const state = JSON.parse(localStorage.getItem('site.specialization') || '{}').profile || 'NEUTRO';
    
    document.getElementById('monitor-fatigue').innerText = fatigue;
    document.getElementById('monitor-state').innerText = JSON.stringify(state).toUpperCase();
}

window.addEventListener('scroll', updateSystemMonitor);
document.addEventListener('click', updateSystemMonitor);

function monitorCognitiveNoise() {
    const currentFatigue = parseInt(localStorage.getItem('site.fatigue') || 0);
    
    if (currentFatigue > 8) {
        document.body.classList.add('high-fatigue');
    } else {
        document.body.classList.remove('high-fatigue');
    }
}

setInterval(monitorCognitiveNoise, 1000);

document.addEventListener('mousemove', e => {
    document.body.style.setProperty('--mouse-x', (e.clientX) + 'px');
    document.body.style.setProperty('--mouse-y', (e.clientY) + 'px');
});

function advanceStage(nextId) {
    const current = document.querySelector('.stage.active');
    const next = document.getElementById('stage-' + nextId);

    if (current && next) {
        current.classList.remove('active');
        current.classList.add('irreversible-removed');

        next.classList.add('active');
        
        const monitorState = document.getElementById('monitor-state');
        if(monitorState) monitorState.innerText = nextId.toUpperCase();

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}