'use strict';

/* global el, api, store */

document.getElementById('join-form').addEventListener('submit', (event) => {
	event.preventDefault();
	const code = document.getElementById('join-code').value.trim().toUpperCase();
	location.href = '/play.html?code=' + encodeURIComponent(code);
});

async function hostQuiz(quizId) {
	const errorNode = document.getElementById('host-error');
	errorNode.textContent = '';
	try {
		const game = await api('POST', '/api/games', { quizId });
		store('host:' + game.code, game.hostToken);
		location.href = '/host.html?code=' + game.code;
	} catch (err) {
		errorNode.textContent = err.message;
	}
}

(async function loadQuizzes() {
	const list = document.getElementById('quiz-list');
	try {
		const quizzes = await api('GET', '/api/quizzes');
		if (!quizzes.length) {
			list.replaceChildren(el('li', { class: 'muted' }, 'Nog geen quizzen. Maak er eerst een.'));
			return;
		}
		list.replaceChildren(...quizzes.map((q) => el('li', null,
			el('div', null,
				el('div', null, el('strong', null, q.title)),
				el('div', { class: 'muted', style: { fontSize: '.85em' } },
					q.rounds + (q.rounds === 1 ? ' ronde' : ' rondes') + ', ' + q.questions + (q.questions === 1 ? ' vraag' : ' vragen'))
			),
			el('button', { class: 'btn primary small', type: 'button', disabled: !q.questions, onclick: () => hostQuiz(q.id) }, 'Start')
		)));
	} catch (err) {
		list.replaceChildren(el('li', { class: 'error' }, err.message));
	}
})();
