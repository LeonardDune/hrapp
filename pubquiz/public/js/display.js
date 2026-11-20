'use strict';

/* global el, letterBadge, timerNode, scoreboardNode, formatPoints, typeHint, clock, api */

// Renders the big-screen view (used by the beamer page and the host stage).
// On localhost the phones need the laptop's network address instead.
let joinBase = location.origin;
let joinAlternatives = [];
(async function resolveJoinBase() {
	if (!/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
		return;
	}
	try {
		const info = await api('GET', '/api/info');
		if (info.lanUrls && info.lanUrls.length) {
			joinBase = info.lanUrls[0];
			joinAlternatives = info.lanUrls.slice(1, 4);
			document.querySelectorAll('[data-join-url]').forEach((n) => { n.textContent = joinBase + '/play.html'; });
			document.querySelectorAll('[data-join-alt]').forEach((n) => n.replaceWith(joinAltNode()));
		}
	} catch (e) {
		/* keep location.origin */
	}
})();

function joinAltNode() {
	return el('div', { class: 'join-alt muted', 'data-join-alt': '' }, joinAlternatives.length
		? 'Werkt dat niet? Probeer ' + joinAlternatives.map((u) => u + '/play.html').join(' of ')
		: null);
}

function renderDisplay(container, view) {
	clock.sync(view.serverNow);
	const top = el('div', { class: 'd-top' },
		el('span', null, view.title),
		view.phase !== 'lobby' ? el('span', null, 'Code ', el('strong', null, view.code)) : null
	);
	let main;
	switch (view.phase) {
		case 'lobby': main = lobby(view); break;
		case 'round': main = roundIntro(view); break;
		case 'question':
		case 'closed':
		case 'reveal': main = question(view); break;
		case 'scores': main = scores(view, 'Tussenstand na ronde ' + view.round.number); break;
		case 'end': main = finalScores(view); break;
		default: main = el('div');
	}
	container.replaceChildren(el('div', { class: 'display' }, top, el('div', { class: 'd-main' }, main)));
}

function lobby(view) {
	return el('div', { class: 'd-center' },
		el('h1', null, view.title),
		el('div', null, 'Doe mee op je telefoon via'),
		el('div', { class: 'join-url', 'data-join-url': '' }, joinBase + '/play.html'),
		joinAltNode(),
		el('div', { style: { marginTop: '.6em' } }, 'met code'),
		el('div', { class: 'big-code' }, view.code),
		el('div', { class: 'muted' }, view.teams.length
			? view.teams.length + (view.teams.length === 1 ? ' team' : ' teams') + ' aangemeld'
			: 'Nog geen teams aangemeld'),
		el('div', { class: 'chips' }, view.teams.map((t) => el('span', { class: 'chip' }, t.name)))
	);
}

function roundIntro(view) {
	return el('div', { class: 'd-center round-intro' },
		el('div', { class: 'round-num' }, 'Ronde ' + view.round.number + ' van ' + view.roundCount),
		el('h1', null, view.round.title),
		el('div', { class: 'muted' }, view.round.questionCount + (view.round.questionCount === 1 ? ' vraag' : ' vragen'))
	);
}

function question(view) {
	const q = view.question;
	const reveal = view.reveal;
	const header = el('div', { class: 'd-top', style: { fontSize: '.75em' } },
		el('span', null, 'Ronde ' + view.round.number + ' · Vraag ' + q.number + ' van ' + view.round.questionCount +
			' · ' + q.points + (q.points === 1 ? ' punt' : ' punten')),
		view.phase === 'question'
			? el('span', null, view.answeredCount + '/' + view.teams.length + ' geantwoord ',
				view.deadline ? timerNode(view.deadline) : null)
			: el('span', null, view.phase === 'closed' ? 'Antwoorden gesloten' : '')
	);
	const parts = [header, el('div', { class: 'q-text' }, q.text)];
	if (q.image) {
		parts.push(el('img', { class: 'q-image', src: q.image, alt: '' }));
	}
	if (q.type === 'mc') {
		parts.push(el('div', { class: 'options' }, q.options.map((opt, i) => {
			let cls = 'option';
			if (reveal) {
				cls += i === reveal.correctIndex ? ' correct' : ' dim';
			}
			return el('div', { class: cls }, letterBadge(i), el('span', null, opt));
		})));
	} else if (!reveal) {
		parts.push(el('div', { class: 'type-hint' }, typeHint(q.type)));
	}
	if (reveal) {
		if (q.type !== 'mc') {
			parts.push(el('div', { class: 'answer-box' }, 'Antwoord: ' + reveal.correctText));
		}
		const good = reveal.results.filter((r) => r.correct);
		parts.push(el('div', { class: 'muted', style: { fontSize: '.8em', marginTop: '.4em' } },
			good.length ? (q.type === 'estimate' ? 'Dichtstbij:' : 'Goed:') : 'Niemand had het goed.'));
		parts.push(el('div', { class: 'result-list' }, reveal.results
			.filter((r) => r.answered)
			.sort((a, b) => b.correct - a.correct)
			.map((r) => el('span', { class: 'chip ' + (r.correct ? 'good' : 'bad') },
				r.name + (q.type === 'mc' ? '' : ': ' + r.answerText)))));
	}
	return el('div', null, parts);
}

function scores(view, title) {
	return el('div', null,
		el('h1', { class: 'd-center' }, title),
		view.scoreboard.length ? scoreboardNode(view.scoreboard) : el('p', { class: 'd-center muted' }, 'Geen teams.')
	);
}

function finalScores(view) {
	const rows = view.scoreboard;
	const step = (row, cls) => row ? el('div', { class: 'step ' + cls },
		el('div', { class: 'name' }, row.name),
		el('div', { class: 'pts' }, formatPoints(row.score) + ' pt'),
		el('div', { class: 'block' }, row.rank)
	) : null;
	return el('div', null,
		el('h1', { class: 'd-center' }, 'Eindstand'),
		rows.length ? el('div', { class: 'podium' }, step(rows[1], 'p2'), step(rows[0], 'p1'), step(rows[2], 'p3')) : null,
		rows.length > 3 ? scoreboardNode(rows.slice(3)) : null
	);
}
