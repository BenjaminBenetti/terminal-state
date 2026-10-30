// Task loot-reference-pages-20261030 (lane SITE): landing page and playtest-access page.
// The game description is short explanatory prose; every count and level comes from the LootReference object.
import {esc, href, renderPage} from './html';
import {prose, type Site} from './common';

export function renderLanding(site: Site): string {
  const p = 'index.html';
  const {ref} = site;
  const holderContexts = ref.levels.reduce((n, l) => n + l.holders.length, 0);
  const levels = ref.levels.map(l => `<li class="card">
<h3><a href="${esc(href(p, `${site.levelDir.get(l.id)!}/index.html`))}">${esc(l.label)}</a></h3>
<p>${prose(l.blurb)}</p>
</li>`).join('\n');
  const body = `
<h2 id="reference">Reference</h2>
<ul class="cards">
<li class="card">
<h3><a href="${esc(href(p, 'loot/index.html'))}">Loot tables</a></h3>
<p>Per level: which surfaces, containers and loose-floor programs can hold which items, with weights, conditional shares and every
stage gate between a table row and an item in the world.</p>
<p class="stat">${ref.levels.length} levels · ${Object.keys(ref.tables).length} distinct tables · ${Object.keys(ref.items).length} items · ${holderContexts} holder contexts</p>
</li>
<li class="card">
<h3><a href="${esc(href(p, 'loot/how-to-read.html'))}">How to read the numbers</a></h3>
<p>What a weight, a conditional share and an expected count before fit mean, and which probabilities the site deliberately does
not state.</p>
</li>
<li class="card">
<h3><a href="${esc(href(p, 'playtest.html'))}">Playtest</a></h3>
<p>How playtest builds are shared. This site does not host the game.</p>
</li>
<li class="card card-soon">
<h3>More sections later</h3>
<p>This site is built to grow: further reference sections can be added next to the loot tables as the game develops.</p>
</li>
</ul>

<h2 id="levels">Levels</h2>
<p>The logical levels registered in the game today. New levels appear here automatically when they are registered.</p>
<ul class="cards">
${levels}
</ul>

<h2 id="about">About this site</h2>
<ul>
<li>Every page is <strong>generated from the game source</strong> each time the site is built. Item names, tables, weights and rules
are read from the game's own code, never typed in by hand, so the site stays in step with the game.</li>
<li>It is rebuilt and republished automatically when changes land on the main branch. Pull-request builds are checked but never
published.</li>
<li>The footer of every page shows the source commit and a digest of the generated data, so you can tell how fresh it is.</li>
<li>The game's source repository is private: source links are labelled “repository access required”.</li>
</ul>`;
  return renderPage(site.ctx, {
    path: p,
    section: 'home',
    title: 'Home',
    heading: site.ctx.gameTitle,
    description: `${site.ctx.gameTitle} game reference: source-generated loot tables per level.`,
    lede: 'A desktop first-person survival prototype for the browser, set in a procedurally generated North American subway '
      + 'station and the office tower above it. Explore, scavenge finite supplies, manage your inventory and fight the infected. '
      + 'This site is a reference generated from the game itself, starting with the loot tables.',
    body,
  });
}

export function renderPlaytest(site: Site): string {
  const p = 'playtest.html';
  const body = `
<div class="callout">
<p><strong>There is no public game link.</strong> ${esc(site.ctx.gameTitle)} is an early, private prototype. This reference site does not
host, embed or link a playable build.</p>
</div>
<h2 id="access">Getting a playtest build</h2>
<ul>
<li>Playtest builds are produced by the game's own CI from the main branch and shared with playtesters privately. Ask the
maintainer for the current playtest link.</li>
<li>The game is desktop-first: keyboard and mouse in a current desktop browser. There are no touch controls yet.</li>
</ul>
<h2 id="local">Running it yourself (repository access required)</h2>
<p>With access to the private source repository you can build and play it locally with Node.js 22:</p>
<ol>
<li><code>npm ci</code></li>
<li><code>npm run build</code></li>
<li><code>npm run preview</code>, then open the address it prints (port 4180 by default).</li>
</ol>
<h2 id="feedback">Balance feedback</h2>
<p>When something feels too rare or too common, the <a href="${esc(href(p, 'loot/index.html'))}">loot tables</a> name the exact value
and the place it is tuned, for example a table row's weight, a holder's empty chance or a theme's keep chance. Quoting that name
makes a tuning request precise.</p>`;
  return renderPage(site.ctx, {
    path: p,
    section: 'playtest',
    title: 'Playtest',
    description: `How ${site.ctx.gameTitle} playtest builds are shared.`,
    lede: 'How to get a playable build, and what this site does and does not provide.',
    body,
  });
}
