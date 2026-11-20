'use strict';

/* global el, api, store, connect, renderDisplay, formatPoints */

(function () {
	const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
	const token = store('host:' + code);
	const stage = document.getElementById('stage');
	const panel = document.getElementById('panel');
	let busy = false;
	let lastError = '';
	let view = null;

	function fatal(text) {
		stage.replaceChildren(el('div', { class: 'display' }, el('div', { class: 'd-main d-center' },
			el('h1', null, text), el('p', null, el('a', { href: '/' }, 'Terug naar start')))));
		panel.replaceChildren();
	}

	if (!/^[A-Z]{4}$/.test(code) || !token) {
		return fatal('Geen quizmaster-toegang voor dit spel op dit apparaat.');
	}

	document.getElementById('screen-link').href = '/screen.html?code=' + code;
	document.getElementById('stop-btn').addEventListener('click', async () => {
		if (!confirm('Spel stoppen? Teams worden afgemeld en de stand gaat verloren.')) {
			return;
		}
		await action({ action: 'stop' });
		store('host:' + code, null);
		location.href = '/';
	});

	async function action(body) {
		if (busy) {
			return;
		}
		busy = true;
		try {
			await api('POST', '/api/games/' + code + '/action', Object.assign({ token }, body));
			lastError = '';
		} catch (err) {
			lastError = err.message;
			if (view) {
				renderPanel(view);
			}
		} finally {
			busy = false;
		}
	}

	function verdictButtons(a) {
		return el('span', { class: 'verdict' },
			el('button', {
				class: 'btn small yes' + (a.correct === true ? ' on' : ''), type: 'button', title: 'Goed',
				onclick: () => action({ action: 'verdict', teamId: a.teamId, correct: true })
			}, '✓'),
			el('button', {
				class: 'btn small no' + (a.correct === false ? ' on' : ''), type: 'button', title: 'Fout',
				onclick: () => action({ action: 'verdict', teamId: a.teamId, correct: false })
			}, '✗')
		);
	}

	function renderPanel(v) {
		const parts = [];
		parts.push(el('section', null,
			v.nextLabel
				? el('button', { class: 'btn primary big block', type: 'button', onclick: () => action({ action: 'next' }) }, v.nextLabel + ' →')
				: el('p', { class: 'muted' }, v.phase === 'end' ? 'De quiz is afgelopen.' : 'Deze quiz heeft geen vragen.'),
			el('p', { class: 'error' }, lastError)
		));

		if (v.hostQuestion) {
			const hq = v.hostQuestion;
			parts.push(el('section', null,
				el('h3', null, 'Antwoorden'),
				el('div', { class: 'correct-hint' }, 'Juist: ', el('strong', null, hq.correctText)),
				el('ul', { class: 'host-answers' }, v.answers.map((a) => el('li', null,
					el('span', { class: 'who' }, a.name),
					el('span', { class: 'what' + (a.answered ? '' : ' muted') }, a.answered ? a.answerText : '—'),
					hq.judgeable ? verdictButtons(a) : null
				))),
				hq.judgeable
					? el('p', { class: 'muted', style: { fontSize: '.85em' } },
						'Automatisch nagekeken. Pas aan met ✓/✗; ook teams zonder telefoonantwoord kun je goed rekenen.')
					: null
			));
		}

		parts.push(el('section', null,
			el('h3', null, 'Teams (' + v.scoreboard.length + ')'),
			v.scoreboard.length ? null : el('p', { class: 'muted' }, 'Nog niemand aangemeld.'),
			v.scoreboard.map((row) => el('div', { class: 'team-row' },
				el('span', { class: 'name' }, row.rank + '. ' + row.name),
				el('span', { class: 'pts' }, formatPoints(row.score)),
				el('button', { class: 'btn small', type: 'button', title: 'Punt eraf', onclick: () => action({ action: 'adjust', teamId: row.id, delta: -1 }) }, '−1'),
				el('button', { class: 'btn small', type: 'button', title: 'Punt erbij', onclick: () => action({ action: 'adjust', teamId: row.id, delta: 1 }) }, '+1'),
				el('button', {
					class: 'btn small danger', type: 'button', title: 'Team verwijderen',
					onclick: () => confirm('Team "' + row.name + '" verwijderen?') && action({ action: 'kick', teamId: row.id })
				}, '×')
			))
		));

		if (v.phase !== 'end' && v.phase !== 'lobby') {
			parts.push(el('section', null,
				el('button', {
					class: 'btn small block', type: 'button',
					onclick: () => confirm('Quiz nu beëindigen en de eindstand tonen?') && action({ action: 'end' })
				}, 'Direct naar eindstand')
			));
		}
		panel.replaceChildren(...parts);
	}

	connect('/api/games/' + code + '/stream?role=host&token=' + encodeURIComponent(token),
		'/api/games/' + code + '/check?role=host&token=' + encodeURIComponent(token),
		(v) => {
			view = v;
			renderDisplay(stage, v);
			renderPanel(v);
		},
		() => {
			store('host:' + code, null);
			fatal('Dit spel bestaat niet meer.');
		});
})();
