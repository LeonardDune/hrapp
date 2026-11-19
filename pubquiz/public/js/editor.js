'use strict';

/* global el, api, store, letterBadge */

(function () {
	const listNode = document.getElementById('quiz-list');
	const root = document.getElementById('editor');
	let quizzes = [];
	let quiz = null;
	let dirty = false;
	let message = '';

	const blankQuestion = (type) => ({
		type: type || 'mc', text: '', image: '', points: 1, timeLimit: 30,
		options: ['', '', '', ''], correct: 0, answer: '', alternatives: []
	});
	const blankQuiz = () => ({ title: 'Nieuwe quiz', rounds: [{ title: 'Ronde 1', questions: [blankQuestion()] }] });

	function markDirty() {
		dirty = true;
		message = '';
		const note = document.getElementById('save-note');
		if (note) {
			note.textContent = 'Niet opgeslagen wijzigingen';
			note.className = 'muted';
		}
	}

	window.addEventListener('beforeunload', (event) => {
		if (dirty) {
			event.preventDefault();
			event.returnValue = '';
		}
	});

	async function loadList() {
		quizzes = await api('GET', '/api/quizzes');
		listNode.replaceChildren(...quizzes.map((q) => el('li', {
			class: quiz && quiz.id === q.id ? 'active' : '',
			onclick: () => open(q.id)
		}, q.title, el('span', { class: 'muted', style: { fontSize: '.8em' } }, ' (' + q.questions + ')'))));
		if (!quizzes.length) {
			listNode.replaceChildren(el('li', { class: 'muted' }, 'Nog geen quizzen.'));
		}
	}

	function confirmLeave() {
		return !dirty || confirm('Niet opgeslagen wijzigingen weggooien?');
	}

	async function open(id) {
		if (!confirmLeave()) {
			return;
		}
		quiz = await api('GET', '/api/quizzes/' + id);
		quiz.rounds.forEach((r) => r.questions.forEach(fillDefaults));
		dirty = false;
		message = '';
		history.replaceState(null, '', '/editor.html?id=' + id);
		render();
		loadList();
	}

	function fillDefaults(q) {
		const blank = blankQuestion(q.type);
		for (const key of Object.keys(blank)) {
			if (q[key] === undefined) {
				q[key] = blank[key];
			}
		}
	}

	function newQuiz(data) {
		if (!confirmLeave()) {
			return;
		}
		quiz = data || blankQuiz();
		delete quiz.id;
		quiz.rounds.forEach((r) => r.questions.forEach(fillDefaults));
		dirty = true;
		history.replaceState(null, '', '/editor.html');
		render();
		loadList();
	}

	function problems() {
		const out = [];
		quiz.rounds.forEach((r, ri) => r.questions.forEach((q, qi) => {
			const where = 'Ronde ' + (ri + 1) + ', vraag ' + (qi + 1) + ': ';
			if (!q.text.trim()) {
				out.push(where + 'vraagtekst ontbreekt.');
			}
			if (q.type === 'mc' && q.options.some((o) => !o.trim())) {
				out.push(where + 'niet alle antwoordopties zijn ingevuld.');
			}
			if (q.type === 'open' && !String(q.answer).trim()) {
				out.push(where + 'juiste antwoord ontbreekt.');
			}
			if (q.type === 'estimate' && (!String(q.answer).trim() || !Number.isFinite(Number(String(q.answer).replace(',', '.'))))) {
				out.push(where + 'het juiste antwoord moet een getal zijn.');
			}
		}));
		return out;
	}

	async function save() {
		try {
			const saved = quiz.id
				? await api('PUT', '/api/quizzes/' + quiz.id, quiz)
				: await api('POST', '/api/quizzes', quiz);
			saved.rounds.forEach((r) => r.questions.forEach(fillDefaults));
			quiz = saved;
			dirty = false;
			const warn = problems();
			message = warn.length ? 'Opgeslagen, maar let op: ' + warn[0] + (warn.length > 1 ? ' (+' + (warn.length - 1) + ' meer)' : '') : 'Opgeslagen.';
			history.replaceState(null, '', '/editor.html?id=' + quiz.id);
			render();
			loadList();
		} catch (err) {
			message = err.message;
			render();
		}
	}

	async function host() {
		if (dirty) {
			await save();
			if (dirty) {
				return;
			}
		}
		const warn = problems();
		if (warn.length && !confirm('Er zijn nog onvolledige vragen:\n\n' + warn.slice(0, 5).join('\n') + '\n\nToch starten?')) {
			return;
		}
		try {
			const game = await api('POST', '/api/games', { quizId: quiz.id });
			store('host:' + game.code, game.hostToken);
			location.href = '/host.html?code=' + game.code;
		} catch (err) {
			message = err.message;
			render();
		}
	}

	async function remove() {
		if (!quiz.id) {
			dirty = false;
			quiz = null;
			return render();
		}
		if (!confirm('Quiz "' + quiz.title + '" definitief verwijderen?')) {
			return;
		}
		await api('DELETE', '/api/quizzes/' + quiz.id);
		quiz = null;
		dirty = false;
		history.replaceState(null, '', '/editor.html');
		render();
		loadList();
	}

	function exportJson() {
		const data = { title: quiz.title, rounds: quiz.rounds };
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const a = el('a', { href: URL.createObjectURL(blob), download: (quiz.title || 'quiz').replace(/[^\w-]+/g, '_') + '.json' });
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	document.getElementById('new-btn').addEventListener('click', () => newQuiz());
	document.getElementById('import-file').addEventListener('change', async (event) => {
		const file = event.target.files[0];
		event.target.value = '';
		if (!file) {
			return;
		}
		try {
			const data = JSON.parse(await file.text());
			if (!data || !Array.isArray(data.rounds)) {
				throw new Error('Geen geldig quizbestand.');
			}
			newQuiz({ title: String(data.title || 'Geïmporteerde quiz'), rounds: data.rounds.map((r) => ({
				title: String(r.title || ''), questions: Array.isArray(r.questions) ? r.questions : []
			})) });
		} catch (err) {
			alert('Importeren mislukt: ' + err.message);
		}
	});

	// ---- rendering ---------------------------------------------------------

	function bind(obj, key, transform) {
		return (event) => {
			obj[key] = transform ? transform(event.target.value) : event.target.value;
			markDirty();
		};
	}

	function move(list, index, delta) {
		const target = index + delta;
		if (target < 0 || target >= list.length) {
			return;
		}
		[list[index], list[target]] = [list[target], list[index]];
		markDirty();
		render();
	}

	function imageField(q) {
		const preview = el('img', { class: 'img-preview' + (q.image ? '' : ' hidden'), src: q.image || null, alt: '' });
		const urlInput = el('input', {
			type: 'text', placeholder: 'https://… of upload een bestand', value: q.image || '',
			oninput: (event) => {
				q.image = event.target.value.trim();
				preview.src = q.image;
				preview.classList.toggle('hidden', !q.image);
				markDirty();
			}
		});
		const fileInput = el('input', {
			type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', class: 'hidden',
			onchange: async (event) => {
				const file = event.target.files[0];
				event.target.value = '';
				if (!file) {
					return;
				}
				if (file.size > 5 * 1024 * 1024) {
					return alert('Afbeelding is groter dan 5 MB.');
				}
				const dataUrl = await new Promise((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result);
					reader.onerror = reject;
					reader.readAsDataURL(file);
				});
				try {
					const res = await api('POST', '/api/uploads', { dataUrl });
					q.image = res.url;
					urlInput.value = res.url;
					preview.src = res.url;
					preview.classList.remove('hidden');
					markDirty();
				} catch (err) {
					alert(err.message);
				}
			}
		});
		return el('div', { class: 'field' },
			el('span', { class: 'muted', style: { fontSize: '.85em' } }, 'Afbeelding (optioneel)'),
			el('div', { class: 'img-row' },
				urlInput,
				el('label', { class: 'btn small' }, 'Upload', fileInput),
				el('button', {
					class: 'btn small', type: 'button', title: 'Afbeelding weghalen',
					onclick: () => { q.image = ''; urlInput.value = ''; preview.classList.add('hidden'); markDirty(); }
				}, '×')
			),
			preview
		);
	}

	function typeFields(q, ri, qi) {
		if (q.type === 'mc') {
			const name = 'correct-' + ri + '-' + qi;
			return el('div', null,
				el('div', { class: 'muted', style: { fontSize: '.85em', marginBottom: '.3em' } }, 'Antwoordopties (kies het juiste)'),
				q.options.map((opt, i) => el('div', { class: 'opt-row' },
					letterBadge(i),
					el('input', { type: 'text', value: opt, placeholder: 'Optie ' + 'ABCDEFGH'[i], oninput: (e) => { q.options[i] = e.target.value; markDirty(); } }),
					el('label', null,
						el('input', { type: 'radio', name, checked: q.correct === i, onchange: () => { q.correct = i; markDirty(); } }),
						'juist'),
					el('button', {
						class: 'btn small', type: 'button', title: 'Optie verwijderen', disabled: q.options.length <= 2,
						onclick: () => {
							q.options.splice(i, 1);
							if (q.correct >= q.options.length || q.correct === i) {
								q.correct = 0;
							} else if (q.correct > i) {
								q.correct--;
							}
							markDirty();
							render();
						}
					}, '×')
				)),
				q.options.length < 8
					? el('button', { class: 'btn small', type: 'button', onclick: () => { q.options.push(''); markDirty(); render(); } }, '+ optie')
					: null
			);
		}
		if (q.type === 'open') {
			return el('div', { class: 'q-grid', style: { gridTemplateColumns: '1fr 1fr' } },
				el('label', { class: 'field' }, el('span', null, 'Juiste antwoord'),
					el('input', { type: 'text', value: q.answer, oninput: bind(q, 'answer') })),
				el('label', { class: 'field' }, el('span', null, 'Ook goed (scheiden met ;)'),
					el('input', {
						type: 'text', value: (q.alternatives || []).join('; '),
						oninput: bind(q, 'alternatives', (v) => v.split(';').map((s) => s.trim()).filter(Boolean))
					}))
			);
		}
		return el('label', { class: 'field' }, el('span', null, 'Juiste antwoord (getal)'),
			el('input', { type: 'text', inputmode: 'decimal', value: String(q.answer), oninput: bind(q, 'answer') }));
	}

	function questionNode(round, q, ri, qi) {
		return el('div', { class: 'question' },
			el('div', { class: 'question-head' },
				el('span', { class: 'qnum' }, (qi + 1) + '.'),
				el('select', {
					onchange: (event) => {
						q.type = event.target.value;
						if (q.type === 'estimate' && !Number.isFinite(Number(q.answer))) {
							q.answer = '';
						}
						markDirty();
						render();
					}
				},
					el('option', { value: 'mc', selected: q.type === 'mc' }, 'Meerkeuze'),
					el('option', { value: 'open', selected: q.type === 'open' }, 'Open vraag'),
					el('option', { value: 'estimate', selected: q.type === 'estimate' }, 'Schatvraag')
				),
				el('span', { class: 'spacer' }),
				el('button', { class: 'btn small', type: 'button', title: 'Omhoog', onclick: () => move(round.questions, qi, -1) }, '↑'),
				el('button', { class: 'btn small', type: 'button', title: 'Omlaag', onclick: () => move(round.questions, qi, 1) }, '↓'),
				el('button', {
					class: 'btn small', type: 'button', title: 'Dupliceren',
					onclick: () => { round.questions.splice(qi + 1, 0, JSON.parse(JSON.stringify(q))); markDirty(); render(); }
				}, 'Kopie'),
				el('button', {
					class: 'btn small danger', type: 'button', title: 'Vraag verwijderen',
					onclick: () => { round.questions.splice(qi, 1); markDirty(); render(); }
				}, 'Verwijder')
			),
			el('div', { class: 'q-grid' },
				el('label', { class: 'field' }, el('span', null, 'Vraag'),
					el('textarea', { rows: '2', value: q.text, oninput: bind(q, 'text') })),
				el('label', { class: 'field' }, el('span', null, 'Punten'),
					el('input', { type: 'number', min: '1', max: '100', value: String(q.points), oninput: bind(q, 'points', Number) })),
				el('label', { class: 'field' }, el('span', null, 'Tijd (sec, 0 = geen)'),
					el('input', { type: 'number', min: '0', max: '3600', value: String(q.timeLimit), oninput: bind(q, 'timeLimit', Number) }))
			),
			imageField(q),
			typeFields(q, ri, qi)
		);
	}

	function roundNode(round, ri) {
		return el('section', { class: 'card round' },
			el('div', { class: 'round-head' },
				el('input', { type: 'text', value: round.title, oninput: bind(round, 'title'), 'aria-label': 'Rondenaam' }),
				el('button', { class: 'btn small', type: 'button', title: 'Ronde omhoog', onclick: () => move(quiz.rounds, ri, -1) }, '↑'),
				el('button', { class: 'btn small', type: 'button', title: 'Ronde omlaag', onclick: () => move(quiz.rounds, ri, 1) }, '↓'),
				el('button', {
					class: 'btn small danger', type: 'button', title: 'Ronde verwijderen',
					onclick: () => {
						if (round.questions.length && !confirm('Ronde "' + round.title + '" met ' + round.questions.length + ' vragen verwijderen?')) {
							return;
						}
						quiz.rounds.splice(ri, 1);
						markDirty();
						render();
					}
				}, 'Verwijder')
			),
			round.questions.map((q, qi) => questionNode(round, q, ri, qi)),
			el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
				el('button', { class: 'btn small', type: 'button', onclick: () => { round.questions.push(blankQuestion('mc')); markDirty(); render(); } }, '+ Meerkeuze'),
				el('button', { class: 'btn small', type: 'button', onclick: () => { round.questions.push(blankQuestion('open')); markDirty(); render(); } }, '+ Open vraag'),
				el('button', {
					class: 'btn small', type: 'button',
					onclick: () => { const q = blankQuestion('estimate'); q.answer = ''; round.questions.push(q); markDirty(); render(); }
				}, '+ Schatvraag')
			)
		);
	}

	function render() {
		if (!quiz) {
			root.replaceChildren(el('div', { class: 'card' },
				el('h2', null, 'Kies of maak een quiz'),
				el('p', { class: 'muted' }, 'Selecteer links een quiz om te bewerken, of begin een nieuwe.')));
			return;
		}
		root.replaceChildren(
			el('div', { class: 'editor-toolbar' },
				el('button', { class: 'btn primary', type: 'button', onclick: save }, 'Opslaan'),
				el('button', { class: 'btn', type: 'button', onclick: host }, 'Start deze quiz'),
				el('button', { class: 'btn', type: 'button', onclick: exportJson }, 'Exporteer JSON'),
				el('span', { class: 'spacer' }),
				el('span', { id: 'save-note', class: dirty ? 'muted' : 'saved-note' }, message || (dirty ? 'Niet opgeslagen wijzigingen' : '')),
				el('button', { class: 'btn danger', type: 'button', onclick: remove }, 'Verwijderen')
			),
			el('label', { class: 'field card' }, el('span', null, 'Titel van de quiz'),
				el('input', { type: 'text', value: quiz.title, oninput: bind(quiz, 'title'), style: { fontSize: '1.3em', fontWeight: '700' } })),
			el('div', { style: { height: '16px' } }),
			...quiz.rounds.map(roundNode),
			el('button', {
				class: 'btn block', type: 'button',
				onclick: () => { quiz.rounds.push({ title: 'Ronde ' + (quiz.rounds.length + 1), questions: [] }); markDirty(); render(); }
			}, '+ Ronde toevoegen')
		);
	}

	loadList().then(() => {
		const id = new URLSearchParams(location.search).get('id');
		if (id) {
			open(id);
		} else {
			render();
		}
	});
})();
