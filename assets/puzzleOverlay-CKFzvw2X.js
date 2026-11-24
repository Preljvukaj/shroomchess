import{n as e}from"./puzzle-DCUVPCWP.js";import{n as t,o as n}from"./index-BeIDvgK-.js";var r=class{ctl;el=document.createElement(`section`);last=``;constructor(e,t){this.ctl=t,this.el.className=`panel puzzle-panel`,this.el.setAttribute(`aria-live`,`polite`),e.appendChild(this.el),this.el.addEventListener(`click`,e=>{let t=e.target.closest(`button[data-pz]`);t&&this.ctl.action(t.dataset.pz)}),this.el.addEventListener(`change`,e=>{let t=e.target;t.id===`pzTheme`&&this.ctl.setTheme(t.value),t.id===`pzDiff`&&this.ctl.setDifficulty(t.value)})}render(){let r=this.ctl.panel(),i=this.ctl.settings,a=e=>e.replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`})[e]),o=r.phase===`solved`||r.phase===`showing`,s=r.phase===`player`||r.phase===`replying`||r.phase===`opponent`,c=`
      <header class="pz-head"><b>${a(r.title)}</b><span>${a(r.rating)}</span></header>
      <p class="pz-status ${r.alert?`alert`:``}">${a(r.status)}</p>
      <div class="pz-nums"><span class="pz-time">${a(r.time)}</span><span class="pz-err">${a(r.errors)}</span></div>
      <p class="pz-details">${a(r.details).replace(/\n/g,`<br>`)}</p>
      <p class="pz-src">${r.link?`<a href="https://${a(r.link)}" target="_blank" rel="noopener">${a(r.link)} ↗</a>`:a(r.source)}</p>
      <div class="btn-row wrap">
        ${s?`<button data-pz="hint" ${r.phase===`player`?``:`disabled`}>💡 ${r.hintsUsed>=1?t(`hint2`):t(`hint`)}</button>
        <button data-pz="solution" ${r.phase===`player`?``:`disabled`}>${t(`solution`)}</button>`:``}
        ${o?`<button data-pz="next" class="primary">${t(`next`)}</button><button data-pz="retry">${t(`retry`)}</button><button data-pz="replay">${t(`replay`)}</button>`:`<button data-pz="next">${t(`next`)}</button>`}
      </div>
      <div class="pz-sel">
        <label>${t(`theme`)} <select id="pzTheme">${e.map(e=>`<option value="${e}" ${e===i.theme?`selected`:``}>${a(n(e))}</option>`).join(``)}</select></label>
        <label>${t(`difficulty`)} <select id="pzDiff">${[`auto`,`easy`,`medium`,`hard`].map(e=>`<option value="${e}" ${e===i.difficulty?`selected`:``}>${t(e===`auto`?`dAuto`:e===`easy`?`dEasy`:e===`medium`?`dMedium`:`dHard`)}</option>`).join(``)}</select></label>
      </div>
      <button data-pz="menu" class="pz-menu">← ${t(`menu`)}</button>`;if(c===this.last)return;let l=document.activeElement?.id;l===`pzTheme`||l===`pzDiff`?this.el.querySelector(`.pz-time`).textContent=r.time:(this.last=c,this.el.innerHTML=c)}set visible(e){this.el.hidden=!e}};export{r as PuzzleOverlay};