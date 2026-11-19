'use strict';

/* global el, api, store, connect, clock, letterBadge, timerNode, scoreboardNode, formatPoints, typeHint */

(function () {
	const app = document.getElementById('app');
	let code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
	let session = null;
	let conn = null;
	let lastKey = '';
	let view = null;
	let sendError = '';

	function head() {
		return el('div', { class: 'play-head' },
			el('a', { href: '/', class: 'brand', style: { textDecoration: 'none' } }, 'Pub Quiz'),
			view && view.me ? el('span', null, el('span', { class: 'team' }, view.me.name), ' · ', formatPoints(view.me.score) + ' pt') : null
		);
	}

	function showJoin(message) {
		if (conn) {
			conn.close();
			conn = null;
		}
		view = null;
		const codeInput = el('input', { class: 'code-input', type: 'text', maxlength: '4', autocomplete: 'off', autocapitalize: 'characters', required: true, value: code });
		const nameInput = el('input', { type: 'text', maxlength: '30', autocomplete: 'off', required: true, placeholder: 'Bijv. De Quizzards' });
		const error = el('p', { class: 'error' }, message || '');
		const button = el('button', { class: 'btn primary big block', type: 'submit' }, 'Meedoen');
		const form = el('form', {
			onsubmit: async (event) => {
				event.preventDefault();
				button.disabled = true;
				error.textContent = '';
				code = codeInput.value.trim().toUpperCase();
				try {
					const res = await api('POST', '/api/games/' + encodeURIComponent(code) + '/join', { name: nameInput.value });
					session = { teamId: res.teamId, token: res.token };
					store('team:' + code, session);
					history.replaceState(null, '', '/play.html?code=' + code);
					start();
				} catch (err) {
					error.textContent = err.message;
					button.disabled = false;
				}
			}
		},
			el('label', { class: 'field' }, el('span', null, 'Spelcode'), codeInput),
			el('label', { class: 'field' }, el('span', null, 'Teamnaam'), nameInput),
			button,
			error
		);
		app.replaceChildren(head(), el('div', { class: 'play-main' }, el('h1', null, 'Meedoen'), form));
		(code ? nameInput : codeInput).focus();
	}

	async function send(value) {
		sendError = '';
		try {
			await api('POST', '/api/games/' + code + '/answer', { teamId: session.teamId, token: session.token, value });
		} catch (err) {
			sendError = err.message;
			lastKey = '';
			render(view);
		}
	}

	function questionInput(v) {
		const q = v.question;
		const mine = v.myAnswer;
		if (q.type === 'mc') {
			return el('div', { class: 'choice-grid' }, q.options.map((opt, i) =>
				el('button', {
					class: 'choice' + (mine && mine.value === i ? ' selected' : ''), type: 'button',
					onclick: () => send(i)
				}, letterBadge(i), el('span', null, opt))
			));
		}
		const input = el('input', {
			type: 'text',
			inputmode: q.type === 'estimate' ? 'decimal' : 'text',
			maxlength: '200',
			autocomplete: 'off',
			placeholder: q.type === 'estimate' ? 'Jouw schatting (getal)' : 'Jouw antwoord',
			value: mine ? String(mine.value) : ''
		});
		return el('form', {
			onsubmit: (event) => {
				event.preventDefault();
				if (input.value.trim()) {
					send(input.value);
				}
			}
		},
			el('label', { class: 'field' }, el('span', null, typeHint(q.type)), input),
			el('button', { class: 'btn primary big block', type: 'submit' }, mine ? 'Antwoord wijzigen' : 'Versturen')
		);
	}

	function body(v) {
		const q = v.question;
		switch (v.phase) {
			case 'lobby':
				return [el('h1', null, 'Je doet mee!'), el('p', { class: 'muted' }, 'Wacht tot de quizmaster begint.'),
					el('p', null, v.teams.length + (v.teams.length === 1 ? ' team' : ' teams') + ' aangemeld.')];
			case 'round':
				return [el('div', { class: 'muted' }, 'Ronde ' + v.round.number + ' van ' + v.roundCount), el('h1', null, v.round.title),
					el('p', { class: 'muted' }, 'De eerste vraag komt zo.')];
			case 'question':
				return [
					el('div', { class: 'muted' }, 'Ronde ' + v.round.number + ' · Vraag ' + q.number + ' · ' + q.points + ' pt ',
						v.deadline ? timerNode(v.deadline) : null),
					el('div', { class: 'q-text' }, q.text),
					q.image ? el('img', { class: 'q-image', src: q.image, alt: '' }) : null,
					questionInput(v),
					v.myAnswer ? el('p', { class: 'muted' }, 'Verstuurd: ', el('strong', null, v.myAnswer.text), '. Wijzigen mag tot de vraag sluit.') : null,
					el('p', { class: 'error' }, sendError)
				];
			case 'closed':
				return [el('div', { class: 'status' },
					el('div', { class: 'big' }, '⏳'),
					el('p', null, 'Antwoorden gesloten.'),
					el('p', null, v.myAnswer ? ['Jouw antwoord: ', el('strong', null, v.myAnswer.text)] : 'Je hebt niet geantwoord.'))];
			case 'reveal':
				return [
					el('div', { class: 'status ' + (v.myCorrect ? 'good' : 'bad') },
						el('div', { class: 'big' }, v.myCorrect ? 'Goed!' : (v.myAnswer ? 'Helaas' : 'Geen antwoord')),
						v.myCorrect ? el('p', null, '+' + q.points + (q.points === 1 ? ' punt' : ' punten')) : null),
					el('p', null, 'Juiste antwoord: ', el('strong', null, v.reveal.correctText)),
					v.myAnswer ? el('p', { class: 'muted' }, 'Jullie antwoord: ' + v.myAnswer.text) : null
				];
			case 'scores':
			case 'end':
				return [
					el('h1', null, v.phase === 'end' ? 'Eindstand' : 'Tussenstand'),
					el('div', { class: 'status' },
						el('div', { class: 'big' }, v.me.rank + 'e plaats'),
						el('p', null, formatPoints(v.me.score) + ' punten')),
					scoreboardNode(v.scoreboard, v.me.id, 10)
				];
			default:
				return [];
		}
	}

	// Only re-render when something relevant to this team changed, so typing
	// is not interrupted by other teams' answers.
	function render(v) {
		clock.sync(v.serverNow);
		const key = JSON.stringify([v.phase, v.round && v.round.number, v.question && v.question.number,
			v.myAnswer, v.myCorrect, v.me, v.phase === 'lobby' ? v.teams.length : 0,
			['scores', 'end'].includes(v.phase) ? v.scoreboard : 0, v.deadline]);
		if (key === lastKey) {
			return;
		}
		if (lastKey && JSON.parse(lastKey)[0] !== v.phase) {
			sendError = '';
		}
		lastKey = key;
		const active = document.activeElement;
		const keepFocus = active && active.tagName === 'INPUT' && v.phase === 'question';
		app.replaceChildren(head(), el('div', { class: 'play-main' }, body(v)));
		if (keepFocus) {
			const input = app.querySelector('input');
			if (input) {
				input.focus();
			}
		}
	}

	function start() {
		lastKey = '';
		conn = connect(
			'/api/games/' + code + '/stream?role=team&team=' + encodeURIComponent(session.teamId) + '&token=' + encodeURIComponent(session.token),
			'/api/games/' + code + '/check?role=team&team=' + encodeURIComponent(session.teamId) + '&token=' + encodeURIComponent(session.token),
			(v) => {
				view = v;
				render(v);
			},
			(err) => {
				store('team:' + code, null);
				session = null;
				showJoin(err.status === 403 ? 'Je team is afgemeld. Meld je opnieuw aan.' : 'Dit spel bestaat niet (meer).');
			});
	}

	session = /^[A-Z]{4}$/.test(code) ? store('team:' + code) : null;
	if (session) {
		start();
	} else {
		showJoin();
	}
})();
